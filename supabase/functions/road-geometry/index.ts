import { admin, authorize, cors, json, validPoint } from '../_shared/auth.ts';
import { isInBulgaria } from '../_shared/serviceArea.ts';
// Only a coarse geographic tile is sent upstream, never user or driver identities.
export async function roadGeometry(req: Request): Promise<Response> {
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST') return json({error:'POST required'},405);
 try {
  await authorize(req);
  const body=await req.json();
  if(!validPoint(body)||!isInBulgaria(body.lat,body.lng)) return json({error:'Invalid location'},400);
  const y=Math.floor(body.lat/.02),x=Math.floor(body.lng/.02),key=`${y}:${x}`;
  const {data:cache,error}=await admin.rpc('road_tile_cache',{p_key:key});
  if(error) return json({error:'Road cache unavailable'},503);
  if(!cache.fetch) return json({key,roads:cache.roads,attribution:'OpenStreetMap contributors'});
  const south=y*.02-.015,west=x*.02-.025,north=(y+1)*.02+.015,east=(x+1)*.02+.025;
  const query=`[out:json][timeout:12];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["access"!~"^(private|no)$"](${south},${west},${north},${east});out geom;`;
  const response=await fetch('https://overpass.private.coffee/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'LeskiKaruchka/1.0 (https://leskikaruchka.com)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(15000)});
  if(!response.ok) return json({key,roads:cache.roads,unavailable:true});
  const reader=response.body!.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4_000_000){await reader.cancel();return json({key,roads:cache.roads,unavailable:true});}chunks.push(value);}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  const raw=JSON.parse(new TextDecoder().decode(buffer));
  const roads=[];let points=0;
  for(const way of raw.elements??[]){
   if(!Array.isArray(way.geometry)||way.geometry.length<2)continue;
   const geometry=way.geometry.map((p:{lat:number;lon:number})=>[p.lat,p.lon]);
   if(!geometry.every((p:number[])=>Number.isFinite(p[0])&&Number.isFinite(p[1])))continue;
   points+=geometry.length;if(points>30000)break;
   roads.push({points:geometry,oneway:(way.tags?.oneway==='yes'||way.tags?.oneway==='1'||way.tags?.oneway==='true'||way.tags?.junction==='roundabout'&&way.tags?.oneway!=='no')?1:way.tags?.oneway==='-1'?-1:0});
  }
  const {error:saveError}=await admin.rpc('road_tile_cache',{p_key:key,p_roads:roads});
  if(saveError)return json({error:'Road cache unavailable'},503);
  return json({key,roads,attribution:'OpenStreetMap contributors'});
 }catch(error){return error instanceof Response?error:json({error:'Road geometry unavailable'},503);}
}
Deno.serve(roadGeometry);
