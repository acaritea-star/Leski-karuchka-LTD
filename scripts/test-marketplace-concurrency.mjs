// Real overlapping SQL sessions, never production or external map services.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const database = process.env.LESKI_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const endpoint = new URL(database);
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.port !== '54322') throw Error('Disposable local database only');
const sql = async command => (await exec('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', command], { timeout: 20000 })).stdout.trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const [company, category, ...users] = Array.from({ length: 7 }, randomUUID);
const drivers = users.slice(0, 2), customers = users.slice(2);
const companyB=randomUUID(),categoryB=randomUUID();

// The runner stubs outbound dispatch before these committed fixtures. RLS,
// eligibility, real row locks, triggers and unique constraints remain enabled.
if (await sql("SELECT position('SELECT 0' IN pg_get_functiondef('private.dispatch_push_outbox()'::regprocedure))>0") !== 't') throw Error('Outbound dispatch must be disabled in the disposable runner');
await sql(`BEGIN;
 INSERT INTO public.companies(id,name,slug) VALUES('${company}','Market race A','market-race-${company}'),('${companyB}','Market race B','market-race-${companyB}');
 INSERT INTO auth.users(id,email) VALUES ${users.map(id => `('${id}','${id}@example.invalid')`).join(',')};
 UPDATE public.profiles SET role='DRIVER',company_id='${company}' WHERE id='${drivers[0]}';
 UPDATE public.profiles SET role='DRIVER',company_id='${companyB}' WHERE id='${drivers[1]}';
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES('${category}','${company}','Race category A'),('${categoryB}','${companyB}','Race category B');
 ${drivers.map((user, n) => `INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
 VALUES('${user}','${n?companyB:company}','${n?categoryB:category}','Fixture','Race','RACE-${company.slice(0,8)}-${n}');
 UPDATE public.drivers SET document_verification_required=false,vehicle_id='${user}',is_verified=true WHERE user_id='${user}';
 INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT id,company_id,42.6977,23.3219,10,clock_timestamp() FROM public.drivers WHERE user_id='${user}';`).join('\n')}
 UPDATE public.drivers SET is_online=true WHERE company_id IN ('${company}','${companyB}'); COMMIT;`);
const asUser = (user, command, tag = '') => `BEGIN; SET LOCAL statement_timeout='12s'; ${tag ? `SET LOCAL application_name='${tag}';` : ''}
 SELECT set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated; ${command} COMMIT;`;
async function request(customer) {
 const quote = randomUUID(), ride = randomUUID();
 await sql(`INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 VALUES('${quote}','${customer}','${company}','${category}',
 '{"pickup_latitude":42.6977,"pickup_longitude":23.3219,"destination_latitude":42.70,"destination_longitude":23.33,"pickup_address":"Race fixture","destination_address":"Destination fixture","distance_km":2,"duration_min":5,"total":6,"breakdown":{"total":6,"marketplace":{"service_class":"standard","min":5,"max":6,"offers":[{"company_id":"${company}","vehicle_type_id":"${category}","total":5,"breakdown":{"total":5}},{"company_id":"${companyB}","vehicle_type_id":"${categoryB}","total":6,"breakdown":{"total":6}}]}}}');`);
 await sql(asUser(customer, `SELECT public.create_taxi_request('${quote}','${ride}','cash');`));
 return ride;
}
async function gate(lock) {
 const child = spawn('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
 let output = '', errors = '', ready = false, signalReady, rejectReady;
 const waiting = new Promise((resolve, reject) => { signalReady = resolve; rejectReady = reject; });
 const timer = setTimeout(() => { rejectReady(Error('Lock gate did not start')); child.kill(); }, 8000);
 const finished = new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', code => { clearTimeout(timer); if (!ready) rejectReady(Error('Gate closed before locking: ' + errors)); if (code === 0) resolve(); else reject(Error('Gate failed: ' + errors)); });
 });
 void finished.catch(() => {});
 child.stderr.on('data', chunk => { errors += chunk; });
 child.stdout.on('data', chunk => { output += chunk; if (!ready && output.includes('GATE_READY')) { ready = true; clearTimeout(timer); signalReady(); } });
 child.stdin.on('error', rejectReady);
 child.stdin.write(`BEGIN; SET LOCAL statement_timeout='12s'; ${lock}; SELECT 'GATE_READY';\n`);
 try { await waiting; } catch (e) { child.kill(); await finished.catch(() => {}); throw e; }
 return { release: async (change = '') => { child.stdin.end(`${change} COMMIT;\n`); await finished; }, abort: () => child.kill() };
}
async function race(lock, attempts, beforeRelease = '') {
 const held = await gate(lock);
 const tags = attempts.map(() => 'accept-race-' + randomUUID());
 const results = Promise.allSettled(attempts.map(({ user, ride }, n) => sql(asUser(user,
  `SELECT jsonb_build_object('id',r.id,'driver',r.driver_id,'status',r.status) FROM public.accept_taxi_request('${ride}') r;`, tags[n]))));
 let released = false;
 try {
  // Do not infer overlap from Promise.all alone. Prove that every contender
  // is waiting on a real PostgreSQL lock before releasing the common gate.
  const until = Date.now() + 6000;
  while (true) {
   const blocked = Number(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN (${tags.map(tag => `'${tag}'`).join(',')}) AND wait_event_type='Lock';`));
   if (blocked === attempts.length) break;
   if (Date.now() >= until) throw Error('Contenders did not overlap on database locks');
   await delay(80);
  }
  await held.release(beforeRelease); released = true;
  return await results;
 } finally { if (!released) held.abort(); await results; }
}
const winnerOf = results => {
 const successes = results.filter(r => r.status === 'fulfilled');
 const failures = results.filter(r => r.status === 'rejected');
 if (successes.length !== 1 || failures.length !== results.length - 1) throw Error('Race must have exactly one winner');
 if (failures.some(r => !String(r.reason.stderr).includes('Заявката вече не е налична.'))) throw Error('Race failed with an unexpected database error');
 return JSON.parse(successes[0].value.split('\n').at(-1));
};
const lockedRequest = ride => `SELECT id FROM public.taxi_requests WHERE id='${ride}' FOR UPDATE`;
const freshGps = () => sql(`UPDATE public.driver_locations SET position_at=clock_timestamp() WHERE company_id IN ('${company}','${companyB}');`);

// Two drivers, one offer: one assignment and one customer acceptance event.
const first = await request(customers[0]);
await freshGps();
const firstWinner = winnerOf(await race(lockedRequest(first), drivers.map(user => ({ user, ride: first }))));
if (firstWinner.id !== first || firstWinner.status !== 'accepted') throw Error('Wrong accepted ride');
if (await sql(`SELECT count(*) FROM private.push_outbox WHERE request_id='${first}' AND event_type='accepted';`) !== '1') throw Error('Duplicate acceptance event');
const winningUser = await sql(`SELECT user_id FROM public.drivers WHERE id='${firstWinner.driver}';`);
const retries = await race(lockedRequest(first), Array.from({ length: 3 }, () => ({ user: winningUser, ride: first })));
if (retries.some(r => r.status !== 'fulfilled' || JSON.parse(r.value.split('\n').at(-1)).driver !== firstWinner.driver)) throw Error('Owned retry was not idempotent');
if (await sql(`SELECT count(*) FROM private.push_outbox WHERE request_id='${first}' AND event_type='accepted';`) !== '1') throw Error('Retry replayed acceptance event');
await sql(`UPDATE public.taxi_requests SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by='system',cancel_reason='test_finished' WHERE id='${first}';`);

// One driver, two offers: the driver-row lock and unique index allow one ride.
const second = await request(customers[1]), third = await request(customers[2]);
await freshGps();
winnerOf(await race(`SELECT id FROM public.drivers WHERE user_id='${drivers[0]}' FOR UPDATE`, [second, third].map(ride => ({ user: drivers[0], ride }))));
if (await sql(`SELECT count(*) FROM public.taxi_requests WHERE company_id IN ('${company}','${companyB}') AND status IN ('accepted','arrived','in_progress');`) !== '1') throw Error('Driver obtained two active rides');
await sql(`UPDATE public.taxi_requests SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by='system',cancel_reason='test_finished' WHERE id IN ('${second}','${third}');`);

// Cancellation and expiry happen while acceptance is already waiting.
for (const expires of [false, true]) {
 const ride = await request(customers[0]); await freshGps();
 const change = expires ? `UPDATE public.taxi_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${ride}';`
  : `UPDATE public.taxi_requests SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by='system',cancel_reason='test_race' WHERE id='${ride}';`;
 const results = await race(lockedRequest(ride), [{ user: drivers[0], ride }], change);
 if (results[0].status !== 'rejected' || !String(results[0].reason.stderr).includes('Заявката вече не е налична.')) throw Error('Closed offer was accepted or failed unexpectedly');
 if (await sql(`SELECT driver_id IS NULL FROM public.taxi_requests WHERE id='${ride}';`) !== 't') throw Error('Closed offer obtained a driver');
}
console.log('PASS marketplace across two carriers: proven overlapping locks; 2 drivers/1 ride = 1 winner; 1 driver/2 rides = 1 active; retries = 1 event; cancellation/expiry reject waiting acceptance');
