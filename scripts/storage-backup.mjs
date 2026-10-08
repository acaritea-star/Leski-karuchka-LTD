// Free, explicit Storage byte backup/restore. Credentials come only from the environment.
// Never run a restore against the source project. Existing objects are not overwritten.
import {createClient} from '@supabase/supabase-js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const [mode,directory]=process.argv.slice(2);
if(!['backup','restore','verify'].includes(mode)||!directory) throw Error('Usage: node scripts/storage-backup.mjs backup|restore|verify /private/backup-directory');
const root=resolve(directory),manifestFile=resolve(root,'storage-manifest.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readObject=async item=>{
 if(!/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('Invalid archive checksum');
 const bytes=await readFile(resolve(root,'objects',item.sha256));
 if(sha(bytes)!==item.sha256||bytes.length!==item.size) throw Error('Archive checksum mismatch');
 return bytes;
};
if(mode==='verify') {
 const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
 for(const item of manifest.objects) await readObject(item);
 console.log(`Verified ${manifest.objects.length} archived objects`);
} else {
 const url=process.env.LESKI_STORAGE_URL,key=process.env.LESKI_STORAGE_SERVICE_KEY;
 if(!url||!key) throw Error('Set LESKI_STORAGE_URL and LESKI_STORAGE_SERVICE_KEY without putting them in source control');
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(30000)})}});
 const check=result=>{if(result.error) throw result.error;return result.data;};
 if(mode==='backup') {
  await mkdir(resolve(root,'objects'),{recursive:true,mode:0o700});
  // wx refuses to silently replace an earlier backup manifest.
  await writeFile(manifestFile+'.incomplete',JSON.stringify({source:url,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
  const buckets=check(await client.storage.listBuckets()),objects=[];
  for(const bucket of buckets) {
   const folders=[''];let scanned=0;
   while(folders.length) {
    const folder=folders.shift();let offset=0;
    for(;;) {
     const page=check(await client.storage.from(bucket.id).list(folder,{limit:100,offset,sortBy:{column:'name',order:'asc'}}));
     for(const item of page) {
      if(++scanned>1000000) throw Error('Archive exceeds the supported object bound');
      const path=folder?`${folder}/${item.name}`:item.name;
      if(!item.id) {folders.push(path);continue;}
      const blob=check(await client.storage.from(bucket.id).download(path));const bytes=Buffer.from(await blob.arrayBuffer());const hash=sha(bytes);
      await writeFile(resolve(root,'objects',hash),bytes,{mode:0o600});
      objects.push({bucket:bucket.id,path,size:bytes.length,sha256:hash,contentType:blob.type||'application/octet-stream',updatedAt:item.updated_at});
     }
     if(page.length<100) break;offset+=page.length;
    }
   }
  }
  await writeFile(manifestFile,JSON.stringify({version:1,source:url,createdAt:new Date().toISOString(),buckets,objects},null,2),{flag:'wx',mode:0o600});
  console.log(`Backed up ${objects.length} Storage objects. Archive contains personal data; encrypt and restrict access.`);
 } else {
  const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  if(new URL(url).origin===new URL(manifest.source).origin) throw Error('Restore into the source project is forbidden');
  const ref=new URL(url).hostname.split('.')[0];
  if(process.env.LESKI_RESTORE_PROJECT_REF!==ref) throw Error('LESKI_RESTORE_PROJECT_REF must name the separate destination');
  // Validate every archived byte before creating anything in the destination.
  for(const item of manifest.objects) await readObject(item);
  const existing=check(await client.storage.listBuckets());
  if(existing.some(b=>manifest.buckets.some(s=>s.id===b.id))) throw Error('Use an empty restore destination; a source bucket already exists');
  for(const b of manifest.buckets) check(await client.storage.createBucket(b.id,{public:b.public,fileSizeLimit:b.file_size_limit,allowedMimeTypes:b.allowed_mime_types}));
  for(const item of manifest.objects) {
   check(await client.storage.from(item.bucket).upload(item.path,await readObject(item),{upsert:false,contentType:item.contentType}));
   const restored=check(await client.storage.from(item.bucket).download(item.path));
   if(sha(Buffer.from(await restored.arrayBuffer()))!==item.sha256) throw Error('Restored file failed checksum verification');
  }
  console.log(`Restored and downloaded back ${manifest.objects.length} matching objects`);
 }
}
