import { test,expect } from '@playwright/test';
const customer='11111111-1111-4111-8111-111111111111',company='22222222-2222-4222-8222-222222222222';
test('mobile booking keeps the price action visible and reuses the category route without Google traffic',async({page})=>{
 const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));let routes=0;
 const user={id:customer,email:'synthetic@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'google'}};
 await page.addInitScript(({user,company})=>{
  const token=[btoa(JSON.stringify({alg:'HS256',typ:'JWT'})),btoa(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})), 'synthetic'].join('.');
  localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user}));
  localStorage.setItem('i18nextLng','bg');
  const savedAt=Date.now();localStorage.setItem('lk_cookie_consent_v3',JSON.stringify({version:3,savedAt,expiresAt:savedAt+180*86400000,consent:{necessary:true,functional:true,analytics:false,marketing:false}}));
  localStorage.setItem('leski_recent_locations',JSON.stringify([{id:'a',name:'Начало',address:'ул. Иван Вазов 2, Левски',lat:43.35,lng:25.14},{id:'b',name:'Край',address:'Гара, Левски',lat:43.36,lng:25.13}]));
  void company;
 },{user,company});
 // Every non-app request is fulfilled or blocked here. This test cannot spend API quota.
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin==='http://127.0.0.1:4100') return route.continue();
  if(u.origin!=='http://127.0.0.1:54329') return route.abort();
  let data:unknown=[];
  if(u.pathname.endsWith('/auth/v1/user')) data=user;
  else if(u.pathname.endsWith('/profiles')) data={id:customer,role:'CUSTOMER',company_id:company,first_name:'Тест',last_name:'Клиент',is_active:true,email:user.email};
  else if(u.pathname.endsWith('/companies')) data=[{id:company,name:'Тестова фирма',is_active:true}];
  else if(u.pathname.endsWith('/vehicle_types')) data=[{id:'eco',company_id:company,name:'Economy',capacity:4,is_active:true},{id:'comfort',company_id:company,name:'Comfort',capacity:4,is_active:true}];
  else if(u.pathname.endsWith('/legal_acceptances')) data={id:'accepted'};
  else if(u.pathname.endsWith('/taxi_requests')) data=null;
  else if(u.pathname.endsWith('/carrier_identity')) data={id:company,name:'Тестова фирма',verified:false};
  else if(u.pathname.endsWith('/google-routes')) {
   routes++;
   const quotes=['eco','comfort'].map((id,i)=>({vehicle_type_id:id,quote_id:`quote-${id}`,quote_expires_at:new Date(Date.now()+120000).toISOString(),price:5+i,breakdown:{total:5+i}}));
   data={success:true,...quotes[0],quotes,distance_km:1.7,duration_min:5,duration_sec:300,polyline:'',legs:[],alternatives_count:0};
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
 });
 await page.goto('/customer/home');
 await expect(page.getByRole('heading',{name:'Откъде тръгваш?'})).toBeVisible();
 await page.getByRole('button',{name:/Начало.*Иван Вазов/}).click();
 await page.getByRole('button',{name:/Край.*Гара/}).click();
 const order=page.getByRole('button',{name:/Поръчай каручка/});
 await expect(order).toBeEnabled();await expect(order).toContainText('5.00');
 await page.getByRole('radio',{name:/Комфорт/}).check();await expect(order).toContainText('6.00');
 expect(routes).toBe(1);
 for(const size of [{width:320,height:568},{width:390,height:650},{width:720,height:390}]) {
  await page.setViewportSize(size);await expect(order).toBeInViewport({ratio:1});
  await page.getByLabel('Превозвач').scrollIntoViewIfNeeded();await expect(page.getByLabel('Превозвач')).toBeInViewport();
  await expect(order).toBeInViewport({ratio:1});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 expect(pageErrors).toEqual([]);
});
