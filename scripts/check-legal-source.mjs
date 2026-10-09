import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('deployment/legal-source-manifest.json','utf8'));
const contents=await Promise.all(manifest.sources.map(p=>readFile(p,'utf8')));
if(createHash('sha256').update(contents.join('')).digest('hex')!==manifest.sha256) throw Error('Public legal text changed without a new version digest');
const migrations=await Promise.all((await readdir('supabase/migrations')).filter(p=>p.endsWith('.sql')).map(p=>readFile(`supabase/migrations/${p}`,'utf8')));
const registration=`VALUES('${manifest.termsVersion}','${manifest.privacyVersion}','${manifest.sha256}')`;
if(!migrations.some(sql=>sql.includes(registration))) throw Error('The displayed legal versions and digest are missing from the database migration');
console.log('Legal source digest matches the accepted version manifest');
