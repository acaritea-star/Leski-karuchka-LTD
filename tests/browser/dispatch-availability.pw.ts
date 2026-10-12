import { test, expect, type Page } from '@playwright/test';
const actor='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
async function setup(page:Page) {
 const state={google:0,bookings:[] as Record<string,unknown>[],vanished:false,errors:[] as string[]};
 page.on('pageerror',e=>state.errors.push(e.message));
 page.on('requestfinished',r=>{if(/maps\.google|maps\.googleapis|places\.googleapis|routes\.googleapis/.test(new URL(r.url()).hostname))state.google++;});
 const user={id:actor,email:'synthetic@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'google'}};
 await page.addInitScript(user=>{
  const token=[btoa(JSON.stringify({alg:'HS256'})),btoa(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})),'synthetic'].join('.');
  localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user}));
  localStorage.setItem('i18nextLng','bg');const savedAt=Date.now();localStorage.setItem('lk_cookie_consent_v3',JSON.stringify({version:3,savedAt,expiresAt:savedAt+180*86400000,consent:{necessary:true,functional:true,analytics:false,marketing:false}}));
  localStorage.setItem('leski_recent_locations',JSON.stringify([{id:'a',name:'Начало',address:'ул. Иван Вазов 2, Левски',lat:43.35,lng:25.14},{id:'b',name:'Край',address:'Гара, Левски',lat:43.36,lng:25.13}]));
 },user);
 await page.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url());
  if(u.origin==='http://127.0.0.1:4100')return route.continue();
  if(u.origin!=='http://127.0.0.1:54329')return route.abort();
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,range,range-unit'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  let data:unknown=[];
  if(u.pathname.endsWith('/auth/v1/user'))data=user;
  else if(u.pathname.endsWith('/profiles'))data={id:actor,role:'CUSTOMER',company_id:null,is_active:true,email:user.email};
  else if(u.pathname.endsWith('/companies'))data=[{id:a,name:'Първа фирма',is_active:true},{id:b,name:'Втора фирма',is_active:true}];
  else if(u.pathname.endsWith('/vehicle_types'))data=u.searchParams.get('company_id')==='eq.'+b?[{id:'standard',company_id:b,name:'Стандарт',capacity:4,is_active:true}]:[{id:'eco',company_id:a,name:'Eco',capacity:4,is_active:true},{id:'comfort',company_id:a,name:'Comfort',capacity:4,is_active:true}];
  else if(u.pathname.endsWith('/legal_acceptances'))data={id:'accepted'};
  else if(u.pathname.endsWith('/taxi_requests'))data=null;
  else if(u.pathname.endsWith('/carrier_identity')){const c=request.postDataJSON().p_company;data={id:c,name:c===b?'Втора фирма':'Първа фирма',verified:false};}
  else if(u.pathname.endsWith('/marketplace_availability'))data={company_id:'marketplace',sampled_at:new Date().toISOString(),categories:[{id:'standard',drivers:state.vanished?0:2,configured:true},{id:'comfort',drivers:0,configured:false},{id:'van',drivers:0,configured:false}]};
  else if(u.pathname.endsWith('/google-routes')){
   const quotes=[{company_id:b,company_name:'Втора фирма',price:9,quote_id:'quote-b'},{company_id:a,company_name:'Първа фирма',price:5,quote_id:'quote-a'}]
    .map(c=>({...c,vehicle_type_id:'type-'+c.company_id,type_name:'Стандарт',capacity:4,service_class:'standard',quote_expires_at:new Date(Date.now()+120000).toISOString(),breakdown:{total:c.price}}));
   data={success:true,...quotes[1],quotes,distance_km:1.7,duration_min:5,duration_sec:300,polyline:'',legs:[],alternatives_count:0};
  }
  else if(u.pathname.endsWith('/create_taxi_request')){
   const payload=request.postDataJSON();state.bookings.push(payload);
   if(state.vanished)return route.fulfill({status:400,headers,contentType:'application/json',body:JSON.stringify({code:'P0001',message:'NO_AVAILABLE_DRIVER: Няма свободен шофьор за тази фирма.'})});
   data={id:payload.p_request_id,company_id:payload.p_quote_id==='quote-b'?b:a,customer_id:actor,driver_id:null,status:'pending',pickup_address:'Начало',destination_address:'Край',estimated_price:payload.p_quote_id==='quote-b'?9:5};
  }
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(data)});
 });return state;
}
async function chooseRoute(page:Page){await page.goto('/customer/home');await page.getByRole('button',{name:/Начало.*Иван Вазов/}).click();await page.getByRole('button',{name:/Край.*Гара/}).click();}
test('customer sees exact sorted carrier offers and books only the chosen firm',async({page},testInfo)=>{
 const state=await setup(page);await chooseRoute(page);const order=page.getByRole('button',{name:/Поръчай каручка/});
 await expect(page.getByRole('radio',{name:/Комфорт/})).toBeDisabled();
 await expect(page.getByLabel('Фирма за тази поръчка')).toHaveCount(0);
 await expect(page.getByRole('radio',{name:/Стандарт/})).toBeChecked();
 await page.getByRole('button',{name:/Виж офертите/}).click();
 await expect(order).toContainText('5.00');await expect(order).not.toContainText('–');
 const cards=page.getByRole('radio');await expect(cards.first()).toBeChecked();await expect(cards.first().locator('..')).toContainText('Първа фирма');
 await cards.nth(1).check();await expect(order).toContainText('9.00');await expect(order).toBeEnabled();
 await page.screenshot({path:testInfo.outputPath('booking-operator-availability.png'),fullPage:true});
 await order.click();await expect(page.getByRole('heading',{name:'Търсим твоя шофьор'})).toBeVisible();
 expect(state.bookings).toHaveLength(1);expect(state.bookings[0].p_quote_id).toBe('quote-b');expect(state.errors).toEqual([]);expect(state.google).toBe(0);
});
test('a driver disappearing at submission keeps the customer out of a false searching state',async({page})=>{
 const state=await setup(page);await chooseRoute(page);await page.getByRole('button',{name:/Виж офертите/}).click();const order=page.getByRole('button',{name:/Поръчай каручка/});await expect(order).toBeEnabled();
 state.vanished=true;await order.click();await expect(page.getByRole('alert')).toContainText('няма свободен шофьор');await expect(order).toBeDisabled();
 await expect(page.getByRole('heading',{name:'Търсим твоя шофьор'})).toHaveCount(0);expect(state.bookings).toHaveLength(1);expect(state.errors).toEqual([]);expect(state.google).toBe(0);
});
