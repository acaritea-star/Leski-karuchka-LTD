import {test,expect} from '@playwright/test';
import {setupUi,uiAccount,uiCompany,uiDriver,setShortViewport} from './helpers/uiFixture';
const id='48484848-4848-4484-8484-484848484848',cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS'};
const ride=()=>({id,company_id:uiCompany,driver_id:uiDriver,customer_id:uiAccount,status:'in_progress',estimated_price:2.95,final_price:null as number|null,trip_ended_at:null as string|null,online_payment_state:'none',payment_status:'pending',payment_method:'cash',pickup_latitude:43.08,pickup_longitude:25.63,destination_latitude:43.09,destination_longitude:25.64,pickup_address:'Велико Търново, център',destination_address:'Велико Търново, Акация',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
test('driver ends trip; client pay unlocks; a verified server update reaches driver even without realtime',async({browser},info)=>{
 const cc=await browser.newContext(),dc=await browser.newContext();const customer=await cc.newPage(),driver=await dc.newPage();
 const c=await setupUi(customer,'CUSTOMER'),d=await setupUi(driver,'DRIVER');const row=ride();c.rides=[row];d.rides=[row];let checkouts=0,manual=0;
 for(const page of [customer,driver]){
  await page.route('**/rest/v1/rpc/ride_payment_state',route=>route.fulfill({headers:cors,json:{request_id:id,eligible:true,ended_at:row.trip_ended_at,amount:row.final_price??row.estimated_price,state:row.online_payment_state,payment_status:row.payment_status,payment_method:row.payment_method}}));
 }
 await customer.route('**/functions/v1/ride-checkout',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});const body=route.request().postDataJSON();expect(body).toEqual({action:'checkout',request_id:id});checkouts++;row.online_payment_state='open';return route.fulfill({headers:cors,json:{state:'open',url:'https://checkout.stripe.com/c/pay/cs_live_synthetic'}});});
 await customer.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>Тестов Checkout</h1>'}));
 await driver.route('**/rest/v1/rpc/complete_ride_payment',route=>{manual++;return route.abort();});
 await customer.goto('/customer/home');await driver.goto('/driver/requests');
 const pay=customer.getByRole('button',{name:'Плати онлайн с карта',exact:true});await expect(pay).toBeDisabled();await expect(customer.getByText('2.95 €',{exact:true})).toBeVisible();
 await expect(customer.getByRole('button',{name:'Потвърди начало'})).toHaveCount(0);
 await driver.getByRole('button',{name:'Край на пътуване',exact:true}).click();await expect(driver.getByRole('dialog')).toBeVisible();expect(row.trip_ended_at).not.toBeNull();expect(manual).toBe(0);
 await customer.reload();await expect(customer.getByRole('heading',{name:'Пристигнахте',exact:true})).toBeVisible();await expect(pay).toBeEnabled();
 await setShortViewport(customer,320);await pay.scrollIntoViewIfNeeded();await expect(pay).toBeInViewport();await customer.screenshot({path:info.outputPath('client-pay-ready.png')});
 await pay.click();await expect(customer.getByRole('heading',{name:'Тестов Checkout'})).toBeVisible();expect(checkouts).toBe(1);
 // The webhook contract is exercised separately in unit + SQL tests. Here the
 // authoritative persisted row simulates its result, never a browser paid write.
 row.status='completed';row.payment_method='online';row.payment_status='paid';row.online_payment_state='paid';row.updated_at=new Date().toISOString();
 await customer.goto('/customer/home?payment_return='+id);await expect(customer.getByText('Платено онлайн',{exact:true})).toBeVisible();
 await driver.clock.install();await driver.clock.fastForward(40000);await expect(driver.getByText('Платено онлайн',{exact:true}).first()).toBeVisible();expect(manual).toBe(0);
 expect(c.errors).toEqual([]);expect(d.errors).toEqual([]);await cc.close();await dc.close();
});
test('a foreign company never exposes online checkout',async({page})=>{
 const state=await setupUi(page,'CUSTOMER');state.rides=[ride()];await page.goto('/customer/home');
 await expect(page.getByText('2.95 €',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Плати онлайн с карта'})).toHaveCount(0);
 expect(state.errors).toEqual([]);
});
