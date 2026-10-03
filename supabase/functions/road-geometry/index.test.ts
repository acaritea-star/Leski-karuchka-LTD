import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({authorize:vi.fn(),rpc:vi.fn()}));
vi.mock('../_shared/auth.ts',()=>({admin:{rpc:mocks.rpc},authorize:mocks.authorize,cors:{'Access-Control-Allow-Origin':'*'},json:(data:unknown,status=200)=>new Response(JSON.stringify(data),{status}),validPoint:(p:{lat:number;lng:number})=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180}));
vi.stubGlobal('Deno',{serve:vi.fn()});
const {roadGeometry}=await import('./index');
const request=(body:unknown={lat:43.35,lng:25.13})=>new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.authorize.mockResolvedValue({id:'user'});mocks.rpc.mockResolvedValue({data:{fetch:false,roads:[{points:[[43,25],[43.001,25]],oneway:0}]},error:null});vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{vi.unstubAllGlobals();});
it('requires a validated session before touching the cache or upstream provider',async()=>{
 mocks.authorize.mockRejectedValue(new Response('Invalid session',{status:401}));
 expect((await roadGeometry(request())).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('rejects foreign or invalid points and only accepts POST/OPTIONS',async()=>{
 expect((await roadGeometry(request({lat:48,lng:2}))).status).toBe(400);
 expect((await roadGeometry(request({lat:null,lng:25}))).status).toBe(400);
 expect((await roadGeometry(new Request('https://example.invalid'))).status).toBe(405);
 expect((await roadGeometry(new Request('https://example.invalid',{method:'OPTIONS'}))).status).toBe(204);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('serves cached roads without another external request',async()=>{
 const data=await (await roadGeometry(request())).json();expect(data.roads).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();
 expect(mocks.rpc).toHaveBeenCalledWith('road_tile_cache',{p_key:'2167:1256'});
});
it('fetches only a coarse bbox, parses one-way geometry and saves it once',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:{fetch:true,roads:[]},error:null}).mockResolvedValue({error:null});
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({elements:[{geometry:[{lat:43,lon:25},{lat:43.001,lon:25}],tags:{oneway:'-1'}},{geometry:[{lat:43,lon:25},{lat:43,lon:25.001}],tags:{junction:'roundabout'}}]})));
 const data=await (await roadGeometry(request())).json();expect(data.roads.map((r:{oneway:number})=>r.oneway)).toEqual([-1,1]);
 expect(fetch).toHaveBeenCalledOnce();const [url,options]=vi.mocked(fetch).mock.calls[0];expect(url).toBe('https://overpass.private.coffee/api/interpreter');
 const query=String(options?.body);expect(query).not.toContain('43.35');expect(query).not.toContain('user');expect(query).not.toContain('driver');
 expect(mocks.rpc).toHaveBeenCalledTimes(2);expect(mocks.rpc).toHaveBeenLastCalledWith('road_tile_cache',expect.objectContaining({p_roads:data.roads}));
});
it('fails safely without a paid fallback when the provider fails or exceeds the response cap',async()=>{
 mocks.rpc.mockResolvedValue({data:{fetch:true,roads:[]},error:null});
 vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable',{status:503}));
 expect((await (await roadGeometry(request())).json()).unavailable).toBe(true);
 vi.mocked(fetch).mockResolvedValueOnce(new Response(' '.repeat(4_000_001)));
 expect((await (await roadGeometry(request())).json()).unavailable).toBe(true);
 expect(mocks.rpc).toHaveBeenCalledTimes(2);expect(fetch).toHaveBeenCalledTimes(2);
});
