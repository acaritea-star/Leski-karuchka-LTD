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
