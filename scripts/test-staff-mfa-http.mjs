// Real Auth/TOTP -> signed JWT -> PostgREST/RLS. Disposable localhost only.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const exec = promisify(execFile);
const database = process.env.LESKI_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const db = new URL(database);
if (!['127.0.0.1', 'localhost'].includes(db.hostname) || db.port !== '54322') throw Error('Disposable local database only');
const status = JSON.parse((await exec('npx', ['--yes', 'supabase@2.120.0', 'status', '--output', 'json'], {
 cwd: process.env.RUNNER_TEMP + '/leski-db', env: { ...process.env, DO_NOT_TRACK: '1', SUPABASE_TELEMETRY_DISABLED: '1' }, timeout: 30000,
})).stdout);
const url = status.API_URL, anon = status.ANON_KEY, service = status.SERVICE_ROLE_KEY;
if (!url || !anon || !service || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) || new URL(url).port !== '54321') throw Error('Missing isolated local Auth configuration');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, service, options);
const sql = async q => (await exec('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q], { timeout: 20000 })).stdout.trim();
const company = randomUUID(), users = [];
function totp(secret) {
 const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
 let bits = ''; for (const character of secret.toUpperCase().replace(/=+$/, '')) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
 const bytes = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
 const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
 const hash = createHmac('sha1', bytes).update(counter).digest(), offset = hash[19] & 15;
 return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function rpcWithToken(token) {
 const response = await fetch(url + '/rest/v1/rpc/notification_inbox_state', {
  method: 'POST', headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}',
 });
 return { status: response.status, body: await response.text() };
}
try {
 await sql(`INSERT INTO public.companies(id,name,slug) VALUES('${company}','MFA HTTP test','mfa-http-${company}'); UPDATE private.app_security SET staff_mfa_enforced=true;`);
 for (const role of ['CUSTOMER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'DRIVER']) {
  const email = `mfa-http-${randomUUID()}@example.invalid`, password = randomBytes(24).toString('base64url');
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw createError;
  const id = created.user.id; users.push(id);
  if (role !== 'CUSTOMER') await sql(`UPDATE public.profiles SET role='${role}',company_id='${company}' WHERE id='${id}';`);
  const client = createClient(url, anon, options);
  const { data: signed, error: signError } = await client.auth.signInWithPassword({ email, password });
  if (signError) throw signError;
  const lowToken = signed.session.access_token;
  const own = await client.from('profiles').select('id,role').eq('id', id).single();
  if (own.error || own.data.role !== role) throw Error('Own-profile MFA bootstrap failed for ' + role);
  const low = await rpcWithToken(lowToken);
  if (role === 'CUSTOMER') {
   if (low.status !== 200) throw Error('Customer unexpectedly requires MFA');
   continue;
  }
  if (low.status !== 403 || !low.body.includes('MFA_REQUIRED')) throw Error('Staff aal1 RPC was not denied: ' + role);
  const { data: factor, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Synthetic MFA test' });
  if (enrollError) throw enrollError;
  const bad = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: 'not-a-code' });
  if (!bad.error) throw Error('Invalid MFA code accepted');
  if ((await rpcWithToken(lowToken)).status !== 403) throw Error('Failed code unlocked staff access');
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) });
  if (verified.error) throw verified.error;
  const token = (await client.auth.getSession()).data.session.access_token;
  if ((await rpcWithToken(token)).status !== 200) throw Error('Verified staff session denied: ' + role);
  if ((await rpcWithToken(lowToken)).status !== 403) throw Error('Old aal1 token upgraded without MFA');
  const secondLogin = createClient(url, anon, options);
  const signedAgain = await secondLogin.auth.signInWithPassword({ email, password });
  if (signedAgain.error) throw signedAgain.error;
  if ((await rpcWithToken(signedAgain.data.session.access_token)).status !== 403) throw Error('Fresh first-factor login bypassed MFA');
  const forbiddenRemove = await secondLogin.auth.mfa.unenroll({ factorId: factor.id });
  if (!forbiddenRemove.error) throw Error('aal1 could remove a verified factor');
  const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
  if (removed.error) throw removed.error;
  if ((await rpcWithToken(token)).status !== 403) throw Error('Old aal2 token survived factor removal');
 }
 console.log('PASS: real Auth TOTP for all staff roles; aal1/invalid code/old token/factor removal denied; customer unchanged');
} finally {
 await sql('UPDATE private.app_security SET staff_mfa_enforced=false;');
 for (const id of users) {
  const result = await admin.auth.admin.deleteUser(id); if (result.error) throw Error('Synthetic Auth cleanup failed');
 }
 await sql(`DELETE FROM public.companies WHERE id='${company}';`);
}
