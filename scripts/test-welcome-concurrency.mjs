// Disposable local Supabase only: separate devices must share one first claim.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const database = process.env.LESKI_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const parsed = new URL(database);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '54322') throw Error('Disposable local database only');
const sql = async command => (await exec('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', command], { timeout: 25000 })).stdout.trim();
const id = randomUUID();
await sql(`INSERT INTO auth.users(id,email) VALUES('${id}','${id}@example.invalid')`);
const claim = () => sql(`BEGIN; SELECT set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true); SET LOCAL ROLE authenticated; SELECT public.claim_customer_welcome(); COMMIT;`).then(value => value.split('\n').at(-1));
const claims = await Promise.all(Array.from({ length: 12 }, claim));
if (claims.filter(x => x === 't').length !== 1 || claims.filter(x => x === 'f').length !== 11) throw Error('First welcome was not unique across devices');
if (await sql(`SELECT count(*) FROM private.customer_welcome_seen WHERE user_id='${id}'`) !== '1') throw Error('Duplicate welcome records');
console.log('PASS: 12 simultaneous customer devices = one welcome claim');
