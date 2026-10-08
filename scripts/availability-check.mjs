// GET-only checks. No browser, login, Google call, GPS write or synthetic ride.
import {readFile} from 'node:fs/promises';
const c=JSON.parse(await readFile('deployment/public-monitor.json','utf8'));
if(!/^sb_publishable_/.test(c.publishable_key)) throw Error('Use a publishable key only');
const checks=[
 {name:'Website',url:`${c.website}/auth/login`,html:true},
 {name:'Public database endpoint',url:`https://${c.project}.supabase.co/rest/v1/companies?select=id&limit=1`,headers:{apikey:c.publishable_key}},
];
let failed=false;
for(const c of checks) {
 try {
  const started=Date.now();const response=await fetch(c.url,{headers:c.headers,signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw Error(`HTTP ${response.status}`);
  if(c.html) {if(!(await response.text()).includes('id="root"')) throw Error('Missing app entry');}
  else if(!Array.isArray(await response.json())) throw Error('Invalid Data API response');
  console.log(`${c.name}: ${Date.now()-started} ms`);
 } catch(e) {failed=true;console.error(`${c.name}: ${e.message}`);}
}
if(failed) process.exitCode=1;
