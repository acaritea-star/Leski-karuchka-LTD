import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('deployment/legal-source-manifest.json','utf8'));
const contents=await Promise.all(manifest.sources.map(p=>readFile(p,'utf8')));
if(createHash('sha256').update(contents.join('')).digest('hex')!==manifest.sha256) throw Error('Public legal text changed without a new version digest');
console.log('Legal source digest matches the accepted version manifest');
