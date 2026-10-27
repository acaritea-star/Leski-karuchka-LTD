// Two actual database connections. Disposable localhost ONLY. No Google calls.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const database = process.env.LESKI_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const parsed = new URL(database);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '54322') throw Error('Disposable local database only');
const sql = async command => (await exec('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', command], { timeout: 25000 })).stdout.trim();
const [company, account, operation, ride, secondRide, customer, vehicleType] = Array.from({ length: 7 }, randomUUID);
await sql(`BEGIN;
 INSERT INTO public.companies(id,name,slug) VALUES('${company}','Checkout concurrency','checkout-race-${company}');
 INSERT INTO auth.users(id,email) VALUES('${account}','${account}@example.invalid'),('${customer}','${customer}@example.invalid');
 UPDATE public.profiles SET role='DRIVER',company_id='${company}' WHERE id='${account}';
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES('${vehicleType}','${company}','Checkout');
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,destination_latitude,destination_longitude,destination_address,status,accepted_at,started_at,estimated_price)
 SELECT r.id,'${company}','${customer}',d.id,'${vehicleType}',43.2,25.6,'Synthetic',43.21,25.61,'Synthetic','in_progress',now()-interval '10 minutes',now()-interval '8 minutes',12.34 FROM public.drivers d CROSS JOIN (VALUES('${ride}'::uuid)) r(id) WHERE d.user_id='${account}'; COMMIT;`);
const asDriver = command => `BEGIN; SELECT set_config('request.jwt.claims','{"sub":"${account}","role":"authenticated"}',true); SET LOCAL ROLE authenticated; ${command} COMMIT;`;
const write = (id, requestId, choice) => `SELECT public.complete_ride_payment('${id}','${requestId}','${account}','${choice}');`;
const retries = await Promise.all(Array.from({ length: 12 }, () => sql(asDriver(write(operation, ride, 'cash')))));
if (retries.some(output => !output.includes(operation))) throw Error('Retry did not return its checkout');
if (await sql(`SELECT count(*) FROM public.driver_money_entries WHERE id='${operation}'`) !== '1') throw Error('Checkout retry duplicated money');
await sql(`INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,destination_latitude,destination_longitude,destination_address,status,accepted_at,started_at,estimated_price)
 SELECT '${secondRide}',company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,destination_latitude,destination_longitude,destination_address,'in_progress',now()-interval '10 minutes',now()-interval '8 minutes',estimated_price FROM public.taxi_requests WHERE id='${ride}';`);
const contenders = await Promise.allSettled([sql(asDriver(write(randomUUID(), secondRide, 'cash'))), sql(asDriver(write(randomUUID(), secondRide, 'card')))]);
if (contenders.filter(r => r.status === 'fulfilled').length !== 1 || contenders.filter(r => r.status === 'rejected' && String(r.reason.stderr).includes('already completed')).length !== 1) throw Error('Two-device checkout did not reject one competing payment');
if (await sql(`SELECT count(*) FROM public.driver_money_entries WHERE request_id='${secondRide}'`) !== '1' || await sql(`SELECT count(*) FROM public.ride_payment_receipts WHERE request_id='${secondRide}'`) !== '1' || await sql(`SELECT count(*) FROM public.request_outcomes WHERE request_id='${secondRide}'`) !== '1') throw Error('Checkout duplicated income, receipt or outcome');
console.log('PASS: atomic checkout: 12 concurrent retries = 1 payment; two devices = 1 completion and 1 rejection');

// The same ride lock serializes cash confirmation against online reservation.
const merchant = `acct_cashrace${company.replaceAll('-', '')}`;
await sql(`INSERT INTO private.ride_stripe_merchants(account_id,root_company_id,enabled,livemode,publishable_key) VALUES('${merchant}','${company}',true,false,'pk_test_cashrace');
 INSERT INTO private.ride_stripe_test_customers VALUES('${customer}','${company}',true);`);
async function nextRide() {
 const id = randomUUID();
 await sql(`INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,accepted_at,started_at,estimated_price)
 SELECT '${id}',company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,'in_progress',now()-interval '10 minutes',now()-interval '8 minutes',estimated_price FROM public.taxi_requests WHERE id='${ride}';`);
 await sql(asDriver(`SELECT public.end_ride_trip('${id}');`)); return id;
}
const tenderRide = await nextRide();
const tenderRace = await Promise.allSettled([
 sql(asDriver(write(randomUUID(), tenderRide, 'cash'))),
 sql(`SELECT public.begin_ride_elements_checkout('${tenderRide}','${customer}','${merchant}');`),
]);
if (tenderRace.filter(result => result.status === 'fulfilled').length !== 1) throw Error('Cash and online reservation both won or both failed');
const reserved = await sql(`SELECT id FROM private.ride_stripe_orders WHERE request_id='${tenderRide}'`);
if (reserved) {
 if (await sql(`SELECT count(*) FROM public.ride_payment_receipts WHERE request_id='${tenderRide}'`) !== '0') throw Error('Reserved online order also received cash');
 await sql(`SELECT public.cancel_uninitialized_ride_checkout('${reserved}','${account}')`);
 await sql(asDriver(write(randomUUID(), tenderRide, 'cash')));
}

// Cancellation may only win before Customer binding. Binding is the barrier
// after which an external Session may exist and Stripe expiry is mandatory.
const bindingRide = await nextRide();
const bindingOrder = JSON.parse(await sql(`SELECT public.begin_ride_elements_checkout('${bindingRide}','${customer}','${merchant}')`));
const race = await Promise.allSettled([
 sql(`SELECT public.cancel_uninitialized_ride_checkout('${bindingOrder.id}','${account}')`),
 sql(`SELECT public.bind_ride_stripe_customer('${bindingOrder.id}','${customer}','cus_cashrace')`),
]);
const stored = JSON.parse(await sql(`SELECT to_jsonb(o) FROM private.ride_stripe_orders o WHERE id='${bindingOrder.id}'`));
if (race[0].status !== 'fulfilled') throw Error('Cancellation could not inspect its locked order');
if (stored.state === 'canceled') {
 if (race[1].status !== 'rejected' || stored.stripe_customer_id) throw Error('Canceled initialization was bound to a Customer');
} else {
 if (race[1].status !== 'fulfilled' || stored.stripe_customer_id !== 'cus_cashrace' || stored.state !== 'creating') throw Error('Invalid initialization race result');
 const unsafeCash = await Promise.allSettled([sql(asDriver(write(randomUUID(), bindingRide, 'cash')))]);
 if (unsafeCash[0].status !== 'rejected') throw Error('Cash accepted without verifying the bound Stripe order');
 await sql(`SELECT public.attach_ride_checkout('${bindingOrder.id}','cs_test_cashrace',NULL);
  SELECT public.record_ride_stripe_snapshot('${bindingOrder.id}','${merchant}','cs_test_cashrace',NULL,'evt_cashrace_expired','canceled',1234,0,0);`);
}
await sql(asDriver(write(randomUUID(), bindingRide, 'cash')));
if (await sql(`SELECT count(*) FROM public.ride_payment_receipts WHERE request_id IN ('${tenderRide}','${bindingRide}')`) !== '2') throw Error('Recovery did not preserve exactly one receipt per ride');
console.log('PASS: cash vs online reservation has one winner; cancellation vs Customer binding preserves the Stripe verification barrier');
