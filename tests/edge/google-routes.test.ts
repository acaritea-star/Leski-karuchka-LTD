import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fake=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),authorize:vi.fn(),rows:[] as Record<string,unknown>[]}));
vi.mock('../../supabase/functions/_shared/auth.ts',()=>({admin:{from:fake.from,rpc:fake.rpc},authorize:fake.authorize,
 validPoint:(p:{lat:number;lng:number})=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)}));
let handler:(req:Request)=>Promise<Response>;
const companyPricing=()=>({id:'company',currency:'EUR',base_fare:2,price_per_km:1.1,price_per_minute:.28,min_fare:0,tariff_period:'day',priced_at:'2026-10-18T09:00:00Z',types:[{id:'eco',multiplier:1},{id:'comfort',multiplier:1.1}]});
beforeEach(async()=>{
 vi.stubGlobal('Deno',{env:{get:()=> 'synthetic-key'},serve:vi.fn()});fake.rows=[];
 fake.authorize.mockResolvedValue({id:'customer',role:'CUSTOMER'});
 fake.rpc.mockImplementation(async name=>({data:name==='company_route_pricing'?companyPricing():{allowed:true},error:null}));
 fake.from.mockImplementation((table:string)=>{
  const result=()=>({data:table==='companies'?{id:'company',is_active:true,currency:'EUR',base_fare:2,price_per_km:1.1,price_per_minute:.28,min_fare:0}:
   table==='ride_quotes'?fake.rows.map(r=>({id:r.id,expires_at:'2026-10-08T23:00:00Z'})):
   [{id:'eco',multiplier:1},{id:'comfort',multiplier:1.1}],error:null});
  const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,insert:(rows:Record<string,unknown>[])=>{fake.rows=rows;return q;},
   single:async()=>table==='vehicle_types'?{data:{id:'eco',company_id:'company',is_active:true},error:null}:result(),
   then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q;
 });
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({routes:[{distanceMeters:62970,duration:'4140s',polyline:{encodedPolyline:'mock'},legs:[]}]}))));
 handler=(await import('../../supabase/functions/google-routes/index.ts')).googleRoutes;
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
const request=()=>new Request('https://local.invalid',{method:'POST',body:JSON.stringify({origin:{lat:43.2,lng:25.6},destination:{lat:43.3,lng:25.7},quote:{vehicle_type_id:'eco',pickup_address:'A',destination_address:'B'}})});
it('uses one Google result for all categories with raw-unit fares and a server quote per category',async()=>{
 const response=await handler(request());const body=await response.json();
 expect(response.status).toBe(200);expect(fetch).toHaveBeenCalledTimes(1);expect(fake.rows).toHaveLength(2);
 expect(body.quotes.find((q:{vehicle_type_id:string})=>q.vehicle_type_id==='comfort').price).toBe(99.65);
 expect(body.quotes[0].quote_id).not.toBe(body.quotes[1].quote_id);
 expect(body.breakdown.pricingVersion).toBe('fixed-fare-v2');
});
it('does not call Google or save quotes when the reserved budget denies access',async()=>{
 fake.rpc.mockImplementation(async name=>({data:name==='company_route_pricing'?companyPricing():{allowed:false,status:429,code:'daily_budget',retry_after_sec:600},error:null}));
 const response=await handler(request());expect(response.status).toBe(429);expect(fetch).not.toHaveBeenCalled();expect(fake.rows).toHaveLength(0);
});
it('does not generate zero-priced quotes for missing route measurements',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({routes:[{polyline:{encodedPolyline:'mock'}}]})));
 expect((await handler(request())).status).toBe(502);expect(fake.rows).toHaveLength(0);
});
it('requests only route measurements and geometry for booking, without navigation steps', async () => {
 const response = await handler(request()); const body = await response.json();
 expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
  'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
 });
 expect(body.legs).toEqual([]); expect(body.quotes).toHaveLength(2);
});
it('preserves navigation instructions with a precise field mask and the API staticDuration field', async () => {
 vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ routes: [{ distanceMeters: 1200, duration: '240s', polyline: { encodedPolyline: 'road' },
  legs: [{ distanceMeters: 1200, duration: '240s', steps: [{ distanceMeters: 1200, staticDuration: '200s', navigationInstruction: { instructions: 'Завийте надясно' } }] }] }] })));
 const response = await handler(new Request('https://local.invalid', { method: 'POST', body: JSON.stringify({ origin: { lat: 43.2, lng: 25.6 }, destination: { lat: 43.3, lng: 25.7 } }) }));
 const body = await response.json();
 const mask = (vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>)['X-Goog-FieldMask'];
 expect(mask).toContain('routes.legs.steps.navigationInstruction.instructions');
 expect(mask).toContain('routes.legs.steps.staticDuration');
 expect(mask.split(',')).not.toContain('routes.legs');
 expect(body.legs[0].steps[0]).toEqual({ instruction: 'Завийте надясно', distance_meters: 1200, duration: '200s' });
});

it('uses the server night tariff and saves its timestamp in the immutable quote', async () => {
 fake.rpc.mockImplementation(async name=>({data:name==='company_route_pricing'?{...companyPricing(),base_fare:3,price_per_km:2,price_per_minute:0,tariff_period:'night',priced_at:'2026-10-18T19:00:00Z'}:{allowed:true},error:null}));
 const response=await handler(request());const body=await response.json();
 expect(response.status).toBe(200);expect(body.price).toBe(128.94);
 expect(body.breakdown).toMatchObject({baseFare:3,perKm:2,perMin:0,tariff_period:'night',priced_at:'2026-10-18T19:00:00Z'});
 expect(fake.rpc).toHaveBeenCalledWith('company_route_pricing',{p_company:'company',p_lat:43.2,p_lng:25.6});
 expect(fake.rows[0]).toMatchObject({company_id:'company',payload:{total:128.94,breakdown:{tariff_period:'night'}}});
});

it('does not buy a route for a company outside its configured pickup zone',async()=>{
 fake.rpc.mockImplementation(async name=>({data:name==='company_route_pricing'?null:{allowed:true},error:null}));
 expect((await handler(request())).status).toBe(400);expect(fetch).not.toHaveBeenCalled();expect(fake.rows).toHaveLength(0);
 expect(fake.rpc).not.toHaveBeenCalledWith('reserve_route_request_v2',expect.anything());
});
