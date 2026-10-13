import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('../_shared/auth.ts', () => ({
  authorize: fake.authorize, admin: { rpc: fake.rpc, from: fake.from },
  validPoint: (p: {lat?:number;lng?:number} | null) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat!)<=90 && Math.abs(p.lng!)<=180,
}));
let handler: (request: Request) => Promise<Response>;
const body = { origin:{lat:43.2,lng:25.6}, destination:{lat:43.3,lng:25.7},request_id:'11111111-1111-4111-8111-111111111111',purpose:'destination' };
const call = (payload: unknown = body) => handler(new Request('https://example.invalid/google-routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  fake.authorize.mockResolvedValue({id:'22222222-2222-4222-8222-222222222222',role:'CUSTOMER'});
  fake.rpc.mockResolvedValue({data:{allowed:true},error:null});
  vi.stubGlobal('Deno',{env:{get:()=> 'test-key'},serve:(run:typeof handler)=> {handler=run;}});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({routes:[{duration:'600s',distanceMeters:3000,polyline:{encodedPolyline:'road'},legs:[]}]}))));
  await import('./index.ts');
});
afterEach(()=>vi.unstubAllGlobals());
it('reserves the authenticated actor and ride budget before the single Google call',async()=>{
  const response=await call();
  expect(response.status).toBe(200);
  expect(fake.rpc).toHaveBeenCalledWith('reserve_route_request_v2',expect.objectContaining({p_user_id:'22222222-2222-4222-8222-222222222222',p_request_id:body.request_id,p_purpose:'destination',p_quote:false}));
  expect(fake.rpc.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetch).mock.invocationCallOrder[0]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(await response.json()).toMatchObject({success:true,distance_km:3,duration_sec:600});
});
it('does not contact Google when the shared ride or daily budget is exhausted',async()=>{
  fake.rpc.mockResolvedValue({data:{allowed:false,status:429,code:'ROUTE_RIDE_LIMIT',retry_after_sec:90000},error:null});
  const response=await call();
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('90000');
  expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
  expect(await response.json()).toMatchObject({success:false,code:'ROUTE_RIDE_LIMIT'});
  expect(fetch).not.toHaveBeenCalled();
});
it('fails closed when the budget database cannot be reached',async()=>{
  fake.rpc.mockResolvedValue({data:null,error:{message:'unavailable'}});
  expect((await call()).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
});
it('does not buy routes for a foreign request or invalid active-leg coordinates',async()=>{
  fake.rpc.mockResolvedValue({data:{allowed:false,status:403,code:'ROUTE_ACCESS_DENIED'},error:null});
  expect((await call()).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects malformed IDs and points outside Bulgaria without spending any route budget',async()=>{
  expect((await call({...body,request_id:'wrong'})).status).toBe(400);
  expect((await call({...body,origin:{lat:51.5,lng:-0.12}})).status).toBe(400);
  expect(fake.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('denies an unauthenticated request before any paid or database route operation',async()=>{
  fake.authorize.mockRejectedValue(new Response('denied',{status:401}));
  expect((await call()).status).toBe(401);
  expect(fake.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('checks quote vehicle availability before calling Google',async()=>{
  fake.from.mockReturnValue({select:()=>({eq:()=>({single:async()=>({data:null,error:null})})})});
  expect((await call({origin:body.origin,destination:body.destination,quote:{vehicle_type_id:'vehicle'}})).status).toBe(400);
  expect(fake.rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('keeps old clients on the same authoritative budget by sending null route context',async()=>{
  expect((await call({origin:body.origin,destination:body.destination})).status).toBe(200);
  expect(fake.rpc).toHaveBeenCalledWith('reserve_route_request_v2',expect.objectContaining({p_request_id:null,p_purpose:null}));
});
it('passes Google rate-limit retry guidance back to the browser',async()=>{
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({error:{message:'quota'}}),{status:429,headers:{'Retry-After':'120'}}));
  const response=await call();
  expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).toBe('120');
});
it('uses one route request for the whole marketplace and preserves both carrier prices',async()=>{
  const types=[{id:'eco-a',company_id:'a',service_class:'standard',multiplier:1,base_fare:2,price_per_km:1,price_per_minute:0,min_fare:0,currency:'EUR'},
    {id:'standard-b',company_id:'b',service_class:'standard',multiplier:1,base_fare:4,price_per_km:1,price_per_minute:0,min_fare:0,currency:'EUR'}];
  fake.rpc.mockImplementation(async name=>({data:name==='marketplace_quote_types'?types:{allowed:true},error:null}));
  let rows: Array<Record<string,unknown>>=[];
  fake.from.mockImplementation(()=>({insert:(input:typeof rows)=>{rows=input;return{select:async()=>({data:input.map(row=>({id:row.id,expires_at:new Date(Date.now()+120000).toISOString()})),error:null})};}}));
  const response=await call({origin:body.origin,destination:body.destination,quote:{marketplace:true,vehicle_type_id:'standard',pickup_address:'A',destination_address:'B'}});
  expect(response.status).toBe(200);expect(fetch).toHaveBeenCalledOnce();expect(rows).toHaveLength(1);
  const reply=await response.json();expect(reply).toMatchObject({vehicle_type_id:'standard',price_min:5,price_max:7,breakdown:{marketplace:{min:5,max:7}}});
  expect(reply.breakdown.marketplace.offers).toBeUndefined();
  expect(rows[0]).toMatchObject({payload:{breakdown:{marketplace:{offers:[{company_id:'a',total:5},{company_id:'b',total:7}]}}}});
});
it('never contacts Google for a marketplace category without a nearby eligible driver',async()=>{
  fake.rpc.mockResolvedValue({data:[],error:null});
  expect((await call({origin:body.origin,destination:body.destination,quote:{marketplace:true,vehicle_type_id:'standard'}})).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});
it('saves independent exact named carrier quotes from one route and returns cheapest first',async()=>{
  const types=[{id:'b',company_id:'firm-b',company_name:'Фирма Б',type_name:'Стандарт',capacity:4,service_class:'standard',multiplier:1,base_fare:4,price_per_km:1,price_per_minute:0,min_fare:0,currency:'EUR'},
    {id:'a',company_id:'firm-a',company_name:'Фирма А',type_name:'Eco',capacity:4,service_class:'standard',multiplier:1,base_fare:2,price_per_km:1,price_per_minute:0,min_fare:0,currency:'EUR'}];
  fake.rpc.mockImplementation(async name=>({data:name==='marketplace_quote_types'?types:{allowed:true},error:null}));
  let rows: Array<Record<string,unknown>>=[];
  fake.from.mockImplementation(()=>({insert:(input:typeof rows)=>{rows=input;return{select:async()=>({data:input.map(row=>({id:row.id,expires_at:new Date(Date.now()+120000).toISOString()})),error:null})};}}));
  const response=await call({origin:body.origin,destination:body.destination,quote:{marketplace:true,carrier_choice:true,vehicle_type_id:'standard',pickup_address:'A',destination_address:'B'}});
  expect(response.status).toBe(200);expect(fetch).toHaveBeenCalledOnce();expect(rows).toHaveLength(2);
  const reply=await response.json();expect(reply.quotes).toMatchObject([{company_id:'firm-a',company_name:'Фирма А',service_class:'standard',price:5},{company_id:'firm-b',company_name:'Фирма Б',price:7}]);
  expect(reply.quotes[0].quote_id).not.toBe(reply.quotes[1].quote_id);
  expect(reply.price_min).toBeUndefined();expect(reply.price_max).toBeUndefined();
  expect(rows[0]).toMatchObject({company_id:'firm-a',vehicle_type_id:'a',payload:{total:5,breakdown:{total:5,carrier_choice:{company_name:'Фирма А'}}}});
  for(const row of rows) expect((row.payload as {breakdown:{marketplace?:unknown}}).breakdown.marketplace).toBeUndefined();
});
it('refuses incomplete named offers before reserving budget or calling Google',async()=>{
  fake.rpc.mockResolvedValue({data:[{id:'a',service_class:'standard'}],error:null});
  expect((await call({origin:body.origin,destination:body.destination,quote:{marketplace:true,carrier_choice:true,vehicle_type_id:'standard'}})).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();expect(fake.rpc).toHaveBeenCalledOnce();
});
