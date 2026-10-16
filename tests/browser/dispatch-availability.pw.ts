import { test, expect, type Page } from '@playwright/test';
const actor='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
async function setup(page:Page) {
 const state={google:0,routes:0,unavailable:[] as string[],extra:0,connectionLost:false,bookings:[] as Record<string,unknown>[],vanished:false,errors:[] as string[]};
 page.on('pageerror',e=>state.errors.push(e.message));
 page.on('requestfinished',r=>{if(/maps\.google|maps\.googleapis|places\.googleapis|routes\.googleapis/.test(new URL(r.url()).hostname))state.google++;});
 const user={id:actor,email:'synthetic@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'google'}};
 await page.addInitScript(user=>{
  const token=[btoa(JSON.stringify({alg:'HS256'})),btoa(JSON.stringify({sub:user.id,role:'authenticated',aal:'aal2',exp:Math.floor(Date.now()/1000)+3600})),'synthetic'].join('.');
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
  if(state.connectionLost && u.pathname.endsWith('/marketplace_availability'))return route.abort('failed');
  let data:unknown=[];
  if(u.pathname.endsWith('/auth/v1/user'))data=user;
  else if(u.pathname.endsWith('/profiles'))data={id:actor,role:'CUSTOMER',company_id:null,is_active:true,email:user.email};
  else if(u.pathname.endsWith('/companies'))data=[{id:a,name:'Първа фирма',is_active:true},{id:b,name:'Втора фирма',is_active:true}];
  else if(u.pathname.endsWith('/vehicle_types'))data=u.searchParams.get('company_id')==='eq.'+b?[{id:'standard',company_id:b,name:'Стандарт',capacity:4,is_active:true}]:[{id:'eco',company_id:a,name:'Eco',capacity:4,is_active:true},{id:'comfort',company_id:a,name:'Comfort',capacity:4,is_active:true}];
  else if(u.pathname.endsWith('/legal_acceptances'))data={id:'accepted'};
  else if(u.pathname.endsWith('/taxi_requests'))data=null;
  else if(u.pathname.endsWith('/carrier_identity')){const c=request.postDataJSON().p_company;data={id:c,name:c===b?'Втора фирма':'Първа фирма',verified:false};}
  else if(u.pathname.endsWith('/marketplace_availability'))data={company_id:'marketplace',sampled_at:new Date().toISOString(),categories:[{id:'standard',drivers:state.vanished?0:2+state.extra-state.unavailable.length,configured:true},{id:'comfort',drivers:0,configured:false},{id:'van',drivers:0,configured:false}],carriers:state.vanished?[]:[a,b,...Array.from({length:state.extra},(_,i)=>'extra-'+i)].filter(id=>!state.unavailable.includes(id)).map(id=>({company_id:id,vehicle_type_id:'type-'+id,service_class:'standard'}))};
  else if(u.pathname.endsWith('/google-routes')){
   state.routes++;
   const quotes=[{company_id:b,company_name:'Втора фирма',price:9,quote_id:'quote-b'},{company_id:a,company_name:'Първа фирма',price:5,quote_id:'quote-a'},...Array.from({length:state.extra},(_,i)=>({company_id:'extra-'+i,company_name:i===0?'ОРИОН':'Фирма '+i,price:10+i,quote_id:'quote-extra-'+i}))]
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
 await expect(page.getByRole('option',{name:/Комфорт/})).toHaveAttribute('disabled','');
 await expect(page.getByLabel('Фирма за тази поръчка')).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'Категория автомобил'})).toHaveValue('standard');
 await expect(order).toContainText('5.00');await expect(order).not.toContainText('–');
 const cards=page.getByRole('radio');await expect(cards.first()).toBeChecked();await expect(cards.first().locator('..')).toContainText('Първа фирма');
 await cards.nth(1).click();await expect(order).toContainText('9.00');await expect(order).toBeEnabled();
 await expect(page.locator('.customer-experience')).toHaveAttribute('data-offer-view','selected');
 await expect(page.getByRole('button',{name:'Смени',exact:true})).toBeFocused();
 await page.screenshot({path:testInfo.outputPath('booking-operator-availability.png'),fullPage:true});
 await order.click();await expect(page.getByRole('heading',{name:'Търсим твоя шофьор'})).toBeVisible();
 expect(state.bookings).toHaveLength(1);expect(state.bookings[0].p_quote_id).toBe('quote-b');expect(state.errors).toEqual([]);expect(state.google).toBe(0);
});
test('a driver disappearing at submission keeps the customer out of a false searching state',async({page})=>{
 const state=await setup(page);await chooseRoute(page);const order=page.getByRole('button',{name:/Поръчай каручка/});await expect(order).toBeEnabled();
 state.vanished=true;await order.click();await expect(page.getByRole('alert')).toContainText('няма свободен шофьор');await expect(order).toBeDisabled();
 await expect(page.getByRole('heading',{name:'Търсим твоя шофьор'})).toHaveCount(0);expect(state.bookings).toHaveLength(1);expect(state.errors).toEqual([]);expect(state.google).toBe(0);
});
test('carrier names and prices are visible together above the fixed action on small phones',async({page},testInfo)=>{
 const state=await setup(page);await chooseRoute(page);
 for(const size of [{width:320,height:568},{width:390,height:650},{width:430,height:820},{width:720,height:390}]) {
  await page.setViewportSize(size);
  const change=page.getByRole('button',{name:'Смени',exact:true});if(await change.isVisible())await change.click();
  const cards=page.locator('.carrier-offer');const order=page.getByRole('button',{name:/Поръчай каручка/});
  await cards.first().scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`carrier-layout-${size.width}.png`),fullPage:true});
  if(size.height>=568) {
   await expect(cards.nth(0)).toBeInViewport({ratio:1});await expect(cards.nth(1)).toBeInViewport({ratio:1});
   // WebKit rounds fractional text rectangles (e.g. 0.99977 for a fully visible
   // price). Whole cards still require 100% visibility above the fixed footer.
   for(const price of await page.locator('.carrier-offer-price').all()) await expect(price).toBeInViewport({ratio:0.999});
  }
  const cardBox=await cards.nth(1).boundingBox(),footerBox=await page.locator('.carrier-offer-footer').boundingBox();
  if(size.height>=568)expect(cardBox!.y+cardBox!.height).toBeLessThanOrEqual(footerBox!.y+1);
  const sheet=await page.locator('.customer-sheet').boundingBox(),map=await page.locator('.customer-map').boundingBox();
  if(size.height>=568){expect(sheet!.height).toBeLessThanOrEqual(size.height*.47);expect(map!.height).toBeGreaterThan(size.height*.5);}
  await cards.nth(1).scrollIntoViewIfNeeded();await cards.nth(1).getByRole('radio').click();
  await expect(order).toContainText('9.00');await expect(order).toBeInViewport({ratio:1});
  await expect(page.locator('.carrier-offer-summary')).toHaveText('Избрано: Втора фирма');
  await expect(page.locator('.customer-experience')).toHaveAttribute('data-offer-view','selected');
  const compact=await page.locator('.customer-sheet').boundingBox();
  if(size.height>=568)expect(compact!.height).toBeLessThan(size.height*.26);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`carrier-list-${size.width}.png`),fullPage:true});
 }
 expect(state.google).toBe(0);expect(state.bookings).toHaveLength(0);expect(state.errors).toEqual([]);
});

test('another company cannot keep a vanished selected offer bookable',async({page})=>{
 const state=await setup(page);await chooseRoute(page);
 const order=page.getByRole('button',{name:/Поръчай каручка/});await expect(order).toBeEnabled();
 state.unavailable=[a];await page.getByRole('button',{name:'Обнови наличността'}).click();
 await expect(order).toBeDisabled();await expect(order).toContainText('5.00');
 const cards=page.getByRole('radio');await expect(cards.first()).toBeChecked();await expect(cards.first()).toBeDisabled();
 await expect(cards.nth(1)).toBeEnabled();expect(state.bookings).toHaveLength(0);
 await cards.nth(1).click();await expect(order).toBeEnabled();await expect(order).toContainText('9.00');
 await order.click();await expect(page.getByRole('heading',{name:'Търсим твоя шофьор'})).toBeVisible();
 expect(state.bookings[0].p_quote_id).toBe('quote-b');expect(state.routes).toBe(1);expect(state.errors).toEqual([]);
});

test('many firms can be searched without replacing the selection or requesting another route',async({page},testInfo)=>{
 const state=await setup(page);state.extra=12;await chooseRoute(page);
 const order=page.getByRole('button',{name:/Поръчай каручка/});await expect(order).toBeEnabled();
 await expect(page.getByRole('radio')).toHaveCount(2);
 await expect(page.getByRole('searchbox',{name:'Търси фирма'})).toHaveCount(0);
 await page.getByRole('button',{name:'Всички 14',exact:true}).click();
 const search=page.getByRole('searchbox',{name:'Търси фирма'});
 await search.fill('орион');await expect(page.getByRole('radio')).toHaveCount(1);
 await page.getByRole('radio',{name:/ОРИОН/}).click();await expect(order).toContainText('10.00');
 await expect(page.getByRole('button',{name:'Смени',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Смени',exact:true}).click();
 await search.fill('липсваща фирма');await expect(page.getByRole('radio')).toHaveCount(0);
 await expect(page.locator('.carrier-offer-summary')).toHaveText('Избрано: ОРИОН');
 await expect(order).toBeEnabled();await expect(order).toContainText('10.00');
 await page.getByRole('button',{name:'Изчисти'}).click();await expect(page.getByRole('radio')).toHaveCount(14);
 await page.getByRole('radio',{name:/ОРИОН/}).scrollIntoViewIfNeeded();
 await expect(page.getByRole('radio',{name:/ОРИОН/})).toBeChecked();await expect(order).toBeInViewport({ratio:1});
 await page.screenshot({path:testInfo.outputPath('many-carrier-offers.png'),fullPage:true});
 expect(state.routes).toBe(1);expect(state.bookings).toHaveLength(0);expect(state.google).toBe(0);expect(state.errors).toEqual([]);
});

test('lost availability connection blocks booking and recovers the same chosen firm and quote',async({page})=>{
 const state=await setup(page);await chooseRoute(page);
 const order=page.getByRole('button',{name:/Поръчай каручка/});await expect(order).toBeEnabled();
 const chosen=page.getByRole('radio',{name:/Втора фирма/});await chosen.click();
 await expect(order).toContainText('9.00');
 state.connectionLost=true;await page.getByRole('button',{name:'Обнови наличността'}).click();
 await expect(order).toBeDisabled();
 await page.getByRole('button',{name:'Смени',exact:true}).click();
 await expect(chosen).toBeChecked();await expect(chosen).toBeDisabled();
 await expect(page.getByText('Наличността не е потвърдена. Провери връзката и обнови.')).toBeVisible();
 await expect(page.locator('.carrier-offer-summary')).toHaveText('Избрано: Втора фирма');
 expect(state.bookings).toHaveLength(0);
 state.connectionLost=false;await page.getByRole('button',{name:'Обнови наличността'}).click();
 await expect(order).toBeEnabled();await expect(chosen).toBeChecked();await expect(order).toContainText('9.00');
 expect(state.routes).toBe(1);expect(state.bookings).toHaveLength(0);
 await order.click();await expect(page.getByRole('heading',{name:'Търсим твоя шофьор'})).toBeVisible();
 expect(state.bookings).toHaveLength(1);expect(state.bookings[0].p_quote_id).toBe('quote-b');
 expect(state.google).toBe(0);expect(state.errors).toEqual([]);
});

test('search remains usable above a short visual viewport and details keep the selected carrier',async({page},testInfo)=>{
 const state=await setup(page);state.extra=12;await chooseRoute(page);
 await page.getByRole('button',{name:'Всички 14',exact:true}).click();
 await page.evaluate(()=>{
  Object.defineProperty(window.visualViewport!,'height',{configurable:true,value:340});
  window.visualViewport!.dispatchEvent(new Event('resize'));
 });
 const search=page.getByRole('searchbox',{name:'Търси фирма'});await search.fill('орион');
 const root=await page.locator('.customer-experience').boundingBox(),input=await search.boundingBox();
 const order=page.getByRole('button',{name:/Поръчай каручка/}),button=await order.boundingBox();
 expect(input!.y).toBeGreaterThanOrEqual(root!.y);expect(input!.y+input!.height).toBeLessThanOrEqual(button!.y);
 expect(button!.y+button!.height).toBeLessThanOrEqual(root!.y+root!.height);
 await expect(page.locator('.customer-header')).toBeHidden();
 const emergency=page.getByRole('button',{name:'Спешна помощ на 112',exact:true});await expect(emergency).toBeVisible();
 await emergency.click();await expect(page.getByRole('link',{name:'Обади се на 112',exact:true})).toHaveAttribute('href','tel:112');
 await page.getByRole('button',{name:'Назад към приложението',exact:true}).click();
 await page.getByRole('radio',{name:/ОРИОН/}).click();await expect(order).toContainText('10.00');
 await page.evaluate(()=>{delete (window.visualViewport as unknown as {height?:number}).height;window.visualViewport!.dispatchEvent(new Event('resize'));});
 await expect(page.locator('.customer-header')).toBeVisible();
 await page.getByRole('button',{name:'Цена, условия и превозвач'}).click();
 await expect(page.getByRole('link',{name:'Общи условия'})).toBeVisible();
 await expect(page.getByLabel('Превозвач')).toBeVisible();
 await expect(order).toContainText('ОРИОН');await expect(order).toContainText('10.00');
 await page.getByRole('button',{name:'Назад',exact:true}).click();
 await expect(page.getByRole('button',{name:'Смени',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('compact-offer-selected.png'),fullPage:true});
 expect(state.routes).toBe(1);expect(state.bookings).toHaveLength(0);expect(state.google).toBe(0);expect(state.errors).toEqual([]);
});
