// Runs only against the disposable local Supabase started by CI. No production URL accepted.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const url = process.env.LESKI_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const parsed=new URL(url);
if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.port!=='54322') throw Error('Only local disposable port 54322 is allowed');
function run(file) {
 const result=spawnSync('psql',[url,'-v','ON_ERROR_STOP=1','-f',file],{stdio:'inherit'});
 if(result.status!==0) process.exit(result.status||1);
}
run('supabase/tests/schema-baseline.sql');
const manifest=JSON.parse(readFileSync('supabase/tests/baseline-manifest.json','utf8'));
for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) {
 if(!manifest.includedMigrations.includes(file)) run(`supabase/migrations/${file}`);
}
run('supabase/tests/run.sql');
