// Two real connections against CI's disposable localhost DB, never production.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const database = process.env.LESKI_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const parsed = new URL(database);
if (!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.port!=='54322') throw Error('Disposable local database only');
const sql = async command => (await exec('psql',[database,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',command],{timeout:25000})).stdout.trim();
const [company,order] = Array.from({length:2},randomUUID);
const suffix = order.replaceAll('-','');
const merchant = `acct_race${suffix}`, payment = `pi_race${suffix}`;
await sql(`BEGIN;
 INSERT INTO public.companies(id,name,slug) VALUES('${company}','Sandbox concurrency','stripe-race-${company}');
 INSERT INTO private.stripe_sandbox_merchants(account_id,root_company_id,enabled) VALUES('${merchant}','${company}',true);
 SET LOCAL ROLE service_role;
 SELECT public.register_stripe_sandbox_order('${order}','${merchant}','${company}','${payment}',1234,'eur'); COMMIT;`);
const event = {account_id:merchant,event_id:`evt_race${suffix}`,type:'payment_intent.succeeded',livemode:false,order_id:order,
 payment_id:payment,amount_minor:1234,received_minor:1234,refunded_minor:0,currency:'eur',state:'paid'};
const write = body => sql(`BEGIN; SET LOCAL ROLE service_role; SELECT public.record_stripe_sandbox_event('${JSON.stringify(body)}'); COMMIT;`);
const copies = await Promise.all(Array.from({length:12},()=>write(event)));
if(copies.filter(r=>r.includes('"duplicate": false')).length!==1||copies.filter(r=>r.includes('"duplicate": true')).length!==11) throw Error('Duplicate Stripe delivery was not atomic');
const updates = await Promise.all([
 write({...event,event_id:`evt_refund${suffix}`,type:'charge.refunded',refunded_minor:1234}),
 write({...event,event_id:`evt_failure${suffix}`,type:'payment_intent.payment_failed',state:'failed',received_minor:0}),
 write({...event,event_id:`evt_partial${suffix}`,type:'refund.updated',refunded_minor:100}),
]);
if(updates.length!==3||await sql(`SELECT state||':'||received_minor||':'||refunded_minor FROM private.stripe_sandbox_orders WHERE id='${order}'`)!=='refunded:1234:1234') throw Error('Concurrent late Stripe events reversed the refund');
if(await sql(`SELECT count(*) FROM private.stripe_sandbox_events WHERE account_id='${merchant}'`)!=='4') throw Error('Stripe event ledger duplicated entries');
console.log('PASS: 12 concurrent Stripe deliveries = 1 application; concurrent refund/failure/success preserve confirmed money');
