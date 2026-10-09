import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('deployment/legal-source-manifest.json','utf8'));
const contents=await Promise.all(manifest.sources.map(p=>readFile(p,'utf8')));
if(createHash('sha256').update(contents.join('')).digest('hex')!==manifest.sha256) throw Error('Public legal text changed without a new version digest');
const migrations=await Promise.all((await readdir('supabase/migrations')).filter(p=>p.endsWith('.sql')).map(p=>readFile(`supabase/migrations/${p}`,'utf8')));
const registration=`VALUES('${manifest.termsVersion}','${manifest.privacyVersion}','${manifest.sha256}')`;
if(!migrations.some(sql=>sql.includes(registration))) throw Error('The displayed legal versions and digest are missing from the database migration');
console.log('Legal source digest matches the accepted version manifest');
const driverManifest=JSON.parse(await readFile('deployment/driver-source-manifest.json','utf8'));
const driverSource=await readFile(driverManifest.source,'utf8');
const driverDocument=JSON.parse(driverSource);
if(createHash('sha256').update(driverSource).digest('hex')!==driverManifest.sha256
 || driverDocument.termsVersion!==driverManifest.termsVersion || driverDocument.trainingVersion!==driverManifest.trainingVersion) {
 throw Error('Driver legal source changed without a matching version digest');
}
const driverMigration=await readFile('supabase/migrations/'+driverManifest.migration,'utf8');
if(!driverMigration.includes(`VALUES('${driverManifest.termsVersion}','${driverManifest.trainingVersion}','${driverManifest.sha256}',`)
 || !driverMigration.includes('$driver_document$'+driverSource+'$driver_document$::jsonb')) {
 throw Error('The accepted driver version does not contain the displayed policy and training');
}
console.log('Driver conditions and training match the immutable database version');
