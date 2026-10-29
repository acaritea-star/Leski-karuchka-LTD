// Real GoTrue + HIBP, using only the disposable CI database and synthetic users.
// Existing local Auth is untouched; a second container enables HIBP explicitly.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
const exec = promisify(execFile);
if (!process.env.RUNNER_TEMP) throw Error('Disposable GitHub runner required');
const status = JSON.parse((await exec('npx',['--yes','supabase@2.120.0','status','--output','json'],{
 cwd:join(process.env.RUNNER_TEMP,'leski-db'),timeout:30000,
 env:{...process.env,DO_NOT_TRACK:'1',SUPABASE_TELEMETRY_DISABLED:'1'},
})).stdout);
const api = new URL(status.API_URL);
if (!['127.0.0.1','localhost'].includes(api.hostname) || api.port!=='54321') throw Error('Local test API required');
const admin = createClient(api.href,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const containers = (await exec('docker',['ps','--format','{{.Names}}'])).stdout.trim().split('\n').filter(n=>n.startsWith('supabase_auth_'));
if (containers.length!==1) throw Error('Exactly one disposable Auth container required');
const original = JSON.parse((await exec('docker',['inspect',containers[0]])).stdout)[0];
const settings = new Map(original.Config.Env.map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
settings.set('GOTRUE_PASSWORD_HIBP_ENABLED','true');
settings.set('GOTRUE_PASSWORD_HIBP_FAIL_CLOSED','true');
const directory = await mkdtemp(join(process.env.RUNNER_TEMP,'leski-hibp-'));
const name = 'leski-hibp-'+randomUUID();
const users = [];
let started = false;
const base = 'http://127.0.0.1:54330';
const strong = () => randomBytes(32).toString('base64url')+'!Aa9';
const email = () => 'password-security-'+randomUUID()+'@example.invalid';
const call = async (path,method='GET',body,token) => {
 const response = await fetch(base+path,{method,signal:AbortSignal.timeout(20000),
  headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json()};
};
const track = data => {const id=data?.user?.id??data?.id;if(id)users.push(id);};
const pwned = result => result.status===422 && result.data?.weak_password?.reasons?.includes('pwned');
try {
 // An existing password customer was created before the stricter setting.
 const legacyEmail=email();
 const legacy=await admin.auth.admin.createUser({email:legacyEmail,password:'password123',email_confirm:true});
 if(legacy.error||!legacy.data.user)throw Error('Could not create synthetic legacy account');
 users.push(legacy.data.user.id);
 const envFile=join(directory,'auth.env');
 if([...settings.values()].some(value=>value.includes('\n')))throw Error('Unexpected multiline test setting');
 await writeFile(envFile,[...settings].map(([key,value])=>key+'='+value).join('\n'),{mode:0o600});
 // Never print this command's environment or captured inspection output.
 try {
  await exec('docker',['run','--detach','--rm','--name',name,'--network',original.HostConfig.NetworkMode,
   '--publish','127.0.0.1:54330:9999','--env-file',envFile,original.Config.Image],{timeout:30000});
 } catch { throw Error('Could not start isolated password-protection Auth'); }
 started=true;
 let ready=false;
 for(let i=0;i<40;i++){
  try{ready=(await fetch(base+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{/* startup */}
  if(ready)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!ready)throw Error('Isolated Auth did not become ready');
 const rejected=await call('/signup','POST',{email:email(),password:'password123'});track(rejected.data);
 if(!pwned(rejected))throw Error('Leaked password was not rejected by HIBP (HTTP '+rejected.status+')');
 const password=strong(),newEmail=email();
 const created=await call('/signup','POST',{email:newEmail,password});track(created.data);
 if(created.status!==200)throw Error('Strong password signup failed (HTTP '+created.status+')');
 const login=await call('/token?grant_type=password','POST',{email:newEmail,password});
 if(login.status!==200||!login.data.access_token)throw Error('Strong-password sign-in failed');
 const change=await call('/user','PUT',{password:'password123'},login.data.access_token);
 if(!pwned(change))throw Error('Leaked password update was not rejected');
 const changed=await call('/user','PUT',{password:strong()},login.data.access_token);
 if(changed.status!==200)throw Error('Strong password change failed');
 const oldLogin=await call('/token?grant_type=password','POST',{email:legacyEmail,password:'password123'});
 if(oldLogin.status!==200||!oldLogin.data.access_token)throw Error('Existing password customer was locked out');
 const before=await (await fetch(api.href+'auth/v1/settings',{headers:{apikey:status.ANON_KEY}})).json();
 const after=await call('/settings');
 if(JSON.stringify(before.external)!==JSON.stringify(after.data.external))throw Error('Provider settings changed');
 console.log('PASS: real HIBP rejects leaked signup/update, strong signup/login/change works, existing password login and provider settings preserved');
} finally {
 for(const id of new Set(users))await admin.auth.admin.deleteUser(id);
 if(started)await exec('docker',['stop',name],{timeout:15000}).catch(()=>{});
 await rm(directory,{recursive:true,force:true});
}
