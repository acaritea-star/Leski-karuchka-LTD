import { test, expect } from '@playwright/test';
const company='11111111-2222-4333-8444-555555555555', category='22222222-2222-4333-8444-555555555555', driver='33333333-2222-4333-8444-555555555555', driverUser='44444444-2222-4333-8444-555555555555';
test('new-company admin saves a vehicle with its base category and driver without paid traffic', async ({ page }) => {
 const pageErrors: string[]=[]; page.on('pageerror', error => pageErrors.push(error.message));
 let writes=0; const cars: Record<string,unknown>[]=[];
 const user={id:'55555555-2222-4333-8444-555555555555',email:'synthetic-admin@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{provider:'google'}};
 await page.addInitScript(user => {
  const token=[btoa(JSON.stringify({alg:'HS256'})),btoa(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})),'synthetic'].join('.');
  localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user}));
  localStorage.setItem('i18nextLng','bg');
  const savedAt=Date.now();localStorage.setItem('lk_cookie_consent_v3',JSON.stringify({version:3,savedAt,expiresAt:savedAt+180*86400000,consent:{necessary:true,functional:true,analytics:false,marketing:false}}));
 },user);
 await page.route('**/*',async route => {
  const url=new URL(route.request().url());
  if(url.origin==='http://127.0.0.1:4100') return route.continue();
  if(url.origin!=='http://127.0.0.1:54329') return route.abort();
  let data: unknown=[];
  if(url.pathname.endsWith('/auth/v1/user')) data=user;
  else if(url.pathname.endsWith('/profiles')) data=url.searchParams.has('id')&&url.searchParams.get('id')?.startsWith('in.')
   ? [{id:driverUser,first_name:'Тест',last_name:'Водач'}]
   : {id:user.id,role:'SUPER_ADMIN',company_id:null,is_active:true,first_name:'Тест',last_name:'Администратор',email:user.email};
  else if(url.pathname.endsWith('/companies')) data=[{id:company,name:'Нова фирма',is_active:true}];
  else if(url.pathname.endsWith('/vehicle_types')) data=[{id:category,company_id:company,name:'Стандарт',capacity:4,multiplier:1,is_active:true}];
  else if(url.pathname.endsWith('/drivers')) data=[{id:driver,user_id:driverUser,vehicle_id:cars[0]?.id??null}];
  else if(url.pathname.endsWith('/vehicles')) data=cars;
  else if(url.pathname.endsWith('/save_driver_vehicle')) {
   writes++;const body=route.request().postDataJSON();
   expect(body.p_company).toBe(company);expect(body.p_driver).toBe(driver);expect(body.p_details.vehicle_type_id).toBe(category);
   expect(body.p_details.registration_number).toBe('A2255KX');
   cars.push({...body.p_details,id:body.p_id,company_id:company,is_active:true,created_at:new Date().toISOString()});data=body.p_id;
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
 });
 await page.goto('/admin/vehicles');
 await expect(page.getByRole('button',{name:'Добави автомобил',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Добави автомобил',exact:true}).click();
 await expect(page.getByLabel('Тип',{exact:true})).toHaveValue(category);
 await page.getByLabel('Марка',{exact:true}).fill('Мерцедес');
 await page.getByLabel('Модел',{exact:true}).fill('CLK');
 await page.getByLabel('Рег. номер',{exact:true}).fill('A2255KX');
 await page.getByLabel('Шофьор',{exact:true}).selectOption(driver);
 await page.getByRole('button',{name:'Запази',exact:true}).click();
 await expect(page.getByText('Мерцедес CLK',{exact:true})).toBeVisible();
 await expect(page.getByText('A2255KX',{exact:true})).toBeVisible();
 await expect(page.getByText('Тест Водач',{exact:true})).toBeVisible();
 await expect(page.getByText('Стандарт',{exact:true})).toBeVisible();
 expect(writes).toBe(1);expect(pageErrors).toEqual([]);
});
