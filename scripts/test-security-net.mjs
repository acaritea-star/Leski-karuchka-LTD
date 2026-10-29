import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const url = new URL(process.env.LESKI_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.port !== '54322') throw Error('Disposable localhost database required');
// This credential is the disposable Supabase bootstrap account, never hosted.
url.username = 'supabase_admin';
const hardening = readFileSync('deployment/security/net-owner-hardening.sql','utf8');
const checks = `
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_schema_privilege(name,'net','USAGE') OR EXISTS(
   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='net' AND has_function_privilege(name,p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'FAIL client net access remains'; END IF;
 END LOOP;
END $$;
SET LOCAL ROLE postgres;
-- pg_net only sends on commit. The enclosing transaction is rolled back;
-- the address is loopback as an additional guard against any external send.
SELECT net.http_post(url:='http://127.0.0.1:1/isolated-security-test',body:='{}'::jsonb) IS NOT NULL AS owner_enqueue_works;
RESET ROLE;
`;
const result = spawnSync('psql',[url.href,'-X','-v','ON_ERROR_STOP=1'],{
 input:`BEGIN;\n${hardening}\n${checks}\nROLLBACK;\nBEGIN;\n${hardening}\nCOMMIT;\n`,encoding:'utf8',stdio:['pipe','pipe','pipe'],
});
if(result.status!==0){console.error(result.stderr);process.exit(result.status||1);}
console.log('PASS: managed-owner net restriction, postgres enqueue, rollback and reapply in disposable database');
