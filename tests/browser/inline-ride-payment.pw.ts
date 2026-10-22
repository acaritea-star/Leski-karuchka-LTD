import {test,expect} from '@playwright/test';
import {setupUi,uiAccount,uiCompany,uiDriver,setShortViewport} from './helpers/uiFixture';
import {installStripeUiDouble} from './helpers/stripeFixture';
const id='48484848-4848-4484-8484-484848484848',cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS'};
const ride=()=>({id,company_id:uiCompany,driver_id:uiDriver,customer_id:uiAccount,status:'in_progress',estimated_price:2.95,final_price:2.95,trip_ended_at:new Date().toISOString(),online_payment_state:'none',payment_status:'pending',payment_method:'cash',payment_environment:'test',pickup_latitude:43.08,pickup_longitude:25.63,destination_latitude:43.09,destination_longitude:25.64,pickup_address:'Велико Търново, център',destination_address:'Велико Търново, Акация',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
const config={state:'open',environment:'test',ui_mode:'elements',request_id:id,session_id:'cs_test_inline',account_id:'acct_fixture',amount_minor:295,currency:'eur',publishable_key:'pk_test_fixture',client_secret:'cs_test_inline_secret_fixture'};
for(const wallet of [true,false])test(`inline ${wallet?'wallet':'card'} stays within 320px and waits for server confirmation`,async({page},info)=>{
 const state=await setupUi(page,'CUSTOMER');await installStripeUiDouble(page,wallet);const row=ride();state.rides=[row];let initialisations=0,reconciles=0;
 await page.route('**/rest/v1/rpc/ride_payment_state',route=>route.fulfill({headers:cors,json:{request_id:id,eligible:row.payment_status!=='paid',inline_available:true,environment:'test',ended_at:row.trip_ended_at,amount:2.95,state:row.online_payment_state,payment_status:row.payment_status,payment_method:row.payment_method}}));
 await page.route('**/functions/v1/ride-checkout',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  const body=route.request().postDataJSON();expect(body.request_id).toBe(id);
  if(body.action==='elements'){initialisations++;row.online_payment_state='open';return route.fulfill({headers:cors,json:config});}
  expect(body.action).toBe('reconcile');reconciles++;
  if(reconciles===1)return route.fulfill({status:503,headers:cors,json:{code:'PAYMENT_CHECK_PENDING'}});
  row.online_payment_state='paid';row.payment_status='paid';row.payment_method='online';return route.fulfill({headers:cors,json:{state:'paid',environment:'test'}});
 });
 await page.setViewportSize({width:320,height:640});await page.goto('/customer/home');
 const dialog=page.getByRole('dialog',{name:'Плащане на пътуването'});await expect(dialog).toBeVisible();await expect(dialog.getByText('2.95 €',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Затвори плащането'})).toBeInViewport();
 const pay=wallet?dialog.getByRole('button',{name:'Mock Apple Pay'}):dialog.getByRole('button',{name:'Тествай 2.95 €',exact:true});await expect(pay).toBeVisible();await pay.scrollIntoViewIfNeeded();await expect(pay).toBeInViewport();
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 if(!wallet){const colours=await pay.evaluate(el=>({background:getComputedStyle(el).backgroundColor,colour:getComputedStyle(el).color}));expect(colours.background).not.toBe('rgba(0, 0, 0, 0)');expect(colours.background).not.toBe(colours.colour);}
 await page.screenshot({path:info.outputPath(wallet?'inline-wallet-320.png':'inline-card-320.png')});
 await setShortViewport(page,360);await pay.scrollIntoViewIfNeeded();await expect(pay).toBeInViewport();await expect(dialog.getByRole('button',{name:'Затвори плащането'})).toBeInViewport();
 await pay.click();await expect(dialog.getByText('Потвърждаваме плащането…',{exact:true})).toBeVisible();await expect(page.getByText('Тестово плащане успешно',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Провери плащането',exact:true}).click();await expect(page.getByText('Тестово плащане успешно',{exact:true})).toBeVisible();
 expect(initialisations).toBe(1);expect(await page.evaluate(()=> (window as unknown as {stripeUiDouble:{confirms:number}}).stripeUiDouble.confirms)).toBe(1);expect(state.errors).toEqual([]);
});
test('inline dialog opens once, restores focus, and reuses the Session when reopened',async({page})=>{
 const state=await setupUi(page,'CUSTOMER');await installStripeUiDouble(page);const row=ride();state.rides=[row];let calls=0;
 await page.route('**/rest/v1/rpc/ride_payment_state',route=>route.fulfill({headers:cors,json:{request_id:id,eligible:true,inline_available:true,environment:'test',ended_at:row.trip_ended_at,amount:2.95,state:'open',payment_status:'pending',payment_method:'cash'}}));
 await page.route('**/functions/v1/ride-checkout',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});calls++;return route.fulfill({headers:cors,json:config});});
 await page.goto('/customer/home');const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Тествай 2.95 €',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Затвори плащането'}).click();await expect(dialog).toHaveCount(0);await page.getByRole('button',{name:'Продължи плащането',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Тествай 2.95 €',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Затвори плащането'}).click();await expect(page.getByRole('button',{name:'Продължи плащането',exact:true})).toBeFocused();expect(calls).toBe(2);expect(state.errors).toEqual([]);
});
