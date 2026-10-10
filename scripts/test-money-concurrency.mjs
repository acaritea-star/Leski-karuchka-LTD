// Two actual database connections. Disposable localhost ONLY. No Google calls.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const database = process.env.LESKI_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const parsed = new URL(database);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '54322') throw Error('Disposable local database only');
const sql = async command => (await exec('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', command], { timeout: 25000 })).stdout.trim();
const [company, account, operation, ride, customer, vehicleType] = Array.from({ length: 6 }, randomUUID);
// This isolated fixture is committed so concurrent sessions can see it. The
// entire disposable database is destroyed by CI; never connects to production.
await sql(`BEGIN;
 INSERT INTO public.companies(id,name,slug) VALUES('${company}','Money concurrency','concurrency-${company}');
 INSERT INTO auth.users(id,email) VALUES('${account}','${account}@example.invalid'),('${customer}','${customer}@example.invalid');
 UPDATE public.profiles SET role='DRIVER',company_id='${company}' WHERE id='${account}';
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES('${vehicleType}','${company}','Concurrency');
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,destination_latitude,destination_longitude,destination_address,status,accepted_at,started_at,estimated_price)
 SELECT '${ride}','${company}','${customer}',id,'${vehicleType}',43.2,25.6,'Synthetic',43.21,25.61,'Synthetic','in_progress',now()-interval '10 minutes',now()-interval '8 minutes',12.34 FROM public.drivers WHERE user_id='${account}';
 UPDATE public.taxi_requests SET status='completed',completed_at=clock_timestamp(),final_price=12.34 WHERE id='${ride}'; COMMIT;`);
const asDriver = command => `BEGIN; SELECT set_config('request.jwt.claims','{"sub":"${account}","role":"authenticated"}',true); SET LOCAL ROLE authenticated; ${command} COMMIT;`;
const write = (id, linked = false) => `SELECT public.record_driver_money_verified('${id}','income',12.34,'Concurrent payment','${account}'${linked ? `,'${ride}'` : ''});`;
// Twelve in-flight retries must all return the same operation, with one row.
const retries = await Promise.all(Array.from({ length: 12 }, () => sql(asDriver(write(operation)))));
if (retries.some(output => !output.endsWith(operation))) throw Error('Retry did not return its operation ID');
if (await sql(`SELECT count(*) FROM public.driver_money_entries WHERE id='${operation}'`) !== '1') throw Error('Retry created duplicate money');
// Separate devices can submit different IDs for the same ride. Row locking
// must allow exactly one linked payment and reject the competing command.
const contenders = await Promise.allSettled([sql(asDriver(write(randomUUID(), true))), sql(asDriver(write(randomUUID(), true)))]);
if (contenders.filter(r => r.status === 'fulfilled').length !== 1 || contenders.filter(r => r.status === 'rejected' && String(r.reason.stderr).includes('Income already recorded')).length !== 1) throw Error('Linked payment race did not reject exactly one contender');
if (await sql(`SELECT count(*) FROM public.driver_money_entries WHERE request_id='${ride}'`) !== '1') throw Error('Linked payment duplicated');
console.log('PASS: 12 concurrent retries = 1 row; two distinct operations for one ride = 1 success + 1 rejection');
