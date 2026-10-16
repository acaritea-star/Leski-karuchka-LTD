import {test,expect} from '@playwright/test';
import {setupUi,uiAccount,uiCompany,uiDriver,setShortViewport} from './helpers/uiFixture';
const rideId='44444444-4444-4444-8444-444444444444';
const cors={'access-control-allow-origin':'*'};
for(const choice of ['cash','card','unpaid','partial_cash'] as const){
 test(`ride checkout ${choice}: one confirmation, fixed fare and one persisted operation after a lost response`,async({page},testInfo)=>{
  const state=await setupUi(page,'DRIVER');
  const ride={id:rideId,company_id:uiCompany,driver_id:uiDriver,customer_id:'99999999-9999-4999-8999-999999999999',status:'in_progress',estimated_price:12.34,final_price:null as number|null,pickup_latitude:43.08,pickup_longitude:25.63,destination_latitude:43.12,destination_longitude:25.7,pickup_address:'Велико Търново, център',destination_address:'Горна Оряховица, гара',payment_method:'cash',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  state.rides=[ride];let writes=0,receipt:Record<string,unknown>|null=null,patches=0;
  await page.route('**/rest/v1/taxi_requests*',async route=>{
   if(route.request().method()==='PATCH'){patches++;return route.abort();}
   const url=new URL(route.request().url());
   return route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify(url.searchParams.has('id')?ride:ride.status==='in_progress'?[ride]:[])});
  });
  await page.route('**/rest/v1/rpc/complete_ride_payment',async route=>{
   writes++;const c=route.request().postDataJSON();expect(c.p_actor).toBe(uiAccount);expect(c.p_choice).toBe(choice);expect(c).not.toHaveProperty('p_amount');expect(c).not.toHaveProperty('p_price');
   const amount=choice==='unpaid'?0:choice==='partial_cash'?5:12.34;
   const method=choice==='unpaid'?null:choice.replace('partial_','');
   receipt={id:c.p_id,request_id:rideId,company_id:uiCompany,driver_id:uiDriver,driver_user_id:uiAccount,expected_amount:12.34,received_amount:amount,choice,partial_amount:c.p_partial_amount,note:c.p_note,payment_method:method,entry_id:amount>0?c.p_id:null};
   ride.status='completed';ride.final_price=12.34;if(method)ride.payment_method=method;
   return route.abort(); // Both committed; reply lost. Client must verify, not repost.
  });
  await page.route('**/rest/v1/ride_payment_receipts*',route=>route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify(receipt)}));
  await page.goto('/driver/requests');
  await page.getByRole('button',{name:'Край на пътуване',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Плащане и приключване на курс'});
  await expect(dialog.getByText('12.34 €',{exact:true})).toBeVisible();expect(writes).toBe(0);
  if(choice==='unpaid'||choice==='partial_cash'){
   await dialog.getByRole('button',{name:'Проблем с плащането'}).click();
   await dialog.getByLabel('Получено плащане').selectOption(choice);
   if(choice==='partial_cash')await dialog.getByLabel('Получена сума в евро').fill('5,00');
   await dialog.getByLabel('Причина').fill('Картата е отказана');
   await page.screenshot({path:testInfo.outputPath(`checkout-${choice}.png`)});
   await dialog.getByRole('button',{name:'Запиши проблема и приключи'}).click();
  }else{
   await setShortViewport(page,320);
   const button=dialog.getByRole('button',{name:choice==='cash'?'Получих в брой · приключи':'Получих с карта · приключи'});await button.scrollIntoViewIfNeeded();await expect(button).toBeInViewport();
   await setShortViewport(page);await page.screenshot({path:testInfo.outputPath(`checkout-${choice}.png`)});await button.click();
  }
  await expect(dialog).toHaveCount(0);await expect(page.getByText('Курсът е приключен. Получената сума или проблемът с плащането са записани в отчета.')).toBeVisible();
  expect(writes).toBe(1);expect(patches).toBe(0);
  await page.reload();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toBe(1);
  expect(await page.evaluate(()=>localStorage.getItem('leski:ride-checkout:'+ '11111111-1111-4111-8111-111111111111'))).toBeNull();
  expect(state.errors).toEqual([]);
 });
}
test('restores an uncertain payment after reload even when the active ride has already disappeared',async({page})=>{
 const state=await setupUi(page,'DRIVER');let writes=0;
 const command={p_id:'55555555-5555-4555-8555-555555555555',p_request_id:rideId,p_actor:uiAccount,p_choice:'cash',p_partial_amount:null,p_note:''};
 await page.addInitScript(({command,driver})=>localStorage.setItem('leski:ride-checkout:'+command.p_actor,JSON.stringify({driverId:driver,command})),{command,driver:uiDriver});
 await page.route('**/rest/v1/rpc/complete_ride_payment',route=>{writes++;return route.abort();});
 await page.route('**/rest/v1/ride_payment_receipts*',route=>route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify({id:command.p_id,request_id:rideId,driver_id:uiDriver,driver_user_id:uiAccount,company_id:uiCompany,choice:'cash',partial_amount:null,note:'',expected_amount:12.34,received_amount:12.34,payment_method:'cash',entry_id:command.p_id})}));
 await page.route('**/rest/v1/taxi_requests*',route=>route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).searchParams.has('id')?{id:rideId,status:'completed',driver_id:uiDriver,company_id:uiCompany,final_price:12.34}:[])}));
 await page.goto('/driver/requests');const dialog=page.getByRole('dialog',{name:'Плащане и приключване на курс'});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Провери плащането'}).click();await expect(dialog).toHaveCount(0);expect(writes).toBe(0);expect(state.errors).toEqual([]);
});
