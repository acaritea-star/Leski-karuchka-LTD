import {test,expect} from '@playwright/test';
import {setupUi,uiAccount,uiCompany,uiDriver,setShortViewport} from './helpers/uiFixture';
import {installStripeUiDouble} from './helpers/stripeFixture';
const id='48484848-4848-4484-8484-484848484848',cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS'};
const ride=()=>({id,company_id:uiCompany,driver_id:uiDriver,customer_id:uiAccount,status:'in_progress',estimated_price:2.95,final_price:2.95,trip_ended_at:new Date().toISOString(),online_payment_state:'none',payment_status:'pending',payment_method:'cash',payment_environment:'test',pickup_latitude:43.08,pickup_longitude:25.63,destination_latitude:43.09,destination_longitude:25.64,pickup_address:'Велико Търново, център',destination_address:'Велико Търново, Акация',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
const config={state:'open',environment:'test',ui_mode:'elements',request_id:id,session_id:'cs_test_inline',account_id:'acct_fixture',amount_minor:295,currency:'eur',publishable_key:'pk_test_fixture',client_secret:'cs_test_inline_secret_fixture'};
for(const eligible of [true,false])test(`an ongoing ${eligible?'eligible':'ineligible'} ride warms only the permitted SDK and creates no payment`,async({page})=>{
 const state=await setupUi(page,'CUSTOMER');await installStripeUiDouble(page,false,false,{scriptedLoader:true});
 const row={...ride(),trip_ended_at:null};state.rides=[row];let paymentCalls=0;
 await page.clock.install();
 await page.route('**/rest/v1/rpc/ride_payment_state',route=>route.fulfill({headers:cors,json:{request_id:id,eligible,inline_available:eligible,environment:'test',ended_at:null,amount:2.95,state:'none',payment_status:'pending',payment_method:'cash'}}));
 await page.route('**/functions/v1/ride-checkout',route=>{paymentCalls++;return route.fulfill({headers:cors,json:config});});
 await page.goto('/customer/home');await expect(page.getByRole('button',{name:'Спешна помощ на 112'})).toBeVisible();await page.clock.fastForward(2000);
 if(eligible)await expect.poll(()=>page.evaluate(()=>(window as unknown as {stripeUiDouble:{scriptDownloads:number}}).stripeUiDouble.scriptDownloads)).toBe(1);
 const sdk=await page.evaluate(()=>(window as unknown as {stripeUiDouble:{scriptDownloads:number;initialisations:number;confirms:number}}).stripeUiDouble);
 expect(sdk.scriptDownloads).toBe(eligible?1:0);expect(sdk.initialisations).toBe(0);expect(sdk.confirms).toBe(0);expect(paymentCalls).toBe(0);await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.errors).toEqual([]);
});
for(const initialization of ['stalled-first','error-first'] as const)test(`a ${initialization} Stripe initialization recovers the same Session without a second order`,async({page})=>{
 const state=await setupUi(page,'CUSTOMER');await installStripeUiDouble(page,false,false,{initialization});
 const row=ride();state.rides=[row];let sessions=0;
 await page.clock.install();
 await page.route('**/rest/v1/rpc/ride_payment_state',route=>route.fulfill({headers:cors,json:{request_id:id,eligible:true,inline_available:true,environment:'test',ended_at:row.trip_ended_at,amount:2.95,state:'open',payment_status:'pending',payment_method:'cash'}}));
 await page.route('**/functions/v1/ride-checkout',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  expect(route.request().postDataJSON().action).toBe('elements');sessions++;return route.fulfill({headers:cors,json:config});
 });
 await page.goto('/customer/home');
 const dialog=page.getByRole('dialog',{name:'Плащане на пътуването'});
 if(initialization==='stalled-first'){
  await expect(dialog.getByText('Подготвяме начините за плащане…')).toBeVisible();
  await page.clock.fastForward(12001);
 }
 await dialog.getByRole('button',{name:'Зареди плащането отново'}).click();
 await expect(dialog.getByRole('button',{name:'Тествай 2.95 €',exact:true})).toBeVisible();
 const sdk=await page.evaluate(()=>(window as unknown as {stripeUiDouble:{initialisations:number;confirms:number}}).stripeUiDouble);
 expect(sdk.initialisations).toBe(2);expect(sdk.confirms).toBe(0);expect(sessions).toBe(1);expect(state.errors).toEqual([]);
});
test('Stripe.js downloads while the payment Session is still loading',async({page})=>{
 const state=await setupUi(page,'CUSTOMER');await installStripeUiDouble(page,false,false,{scriptedLoader:true});
 const row=ride();state.rides=[row];let release=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;});let sessions=0;
 await page.route('**/rest/v1/rpc/ride_payment_state',route=>route.fulfill({headers:cors,json:{request_id:id,eligible:true,inline_available:true,environment:'test',ended_at:row.trip_ended_at,amount:2.95,state:'open',payment_status:'pending',payment_method:'cash'}}));
 await page.route('**/functions/v1/ride-checkout',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  expect(route.request().postDataJSON().action).toBe('elements');sessions++;await pending;return route.fulfill({headers:cors,json:config});
 });
 try{
  await page.goto('/customer/home');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {stripeUiDouble:{scriptDownloads:number}}).stripeUiDouble.scriptDownloads)).toBe(1);
  expect(await page.evaluate(()=>(window as unknown as {stripeUiDouble:{initialisations:number}}).stripeUiDouble.initialisations)).toBe(0);
  release();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Тествай 2.95 €',exact:true})).toBeVisible();
  expect(sessions).toBe(1);expect(state.errors).toEqual([]);
 }finally{release();}
});
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
 await expect(dialog.getByRole('button',{name:'Тествай 2.95 €',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Затвори плащането'}).click();await expect(page.getByRole('button',{name:'Продължи плащането',exact:true})).toBeFocused();expect(calls).toBe(2);expect(await page.evaluate(()=>(window as unknown as {stripeUiDouble:{instances:number}}).stripeUiDouble.instances)).toBe(1);expect(state.errors).toEqual([]);
});
test('a bank authentication overlay can receive focus and clicks above the payment dialog',async({page})=>{
 const state=await setupUi(page,'CUSTOMER');await installStripeUiDouble(page,false,true);const row=ride();state.rides=[row];
 await page.route('**/rest/v1/rpc/ride_payment_state',route=>route.fulfill({headers:cors,json:{request_id:id,eligible:row.payment_status!=='paid',inline_available:true,environment:'test',ended_at:row.trip_ended_at,amount:2.95,state:row.online_payment_state,payment_status:row.payment_status,payment_method:row.payment_method}}));
 await page.route('**/functions/v1/ride-checkout',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  if(route.request().postDataJSON().action==='elements')return route.fulfill({headers:cors,json:config});
  row.online_payment_state='paid';row.payment_status='paid';row.payment_method='online';return route.fulfill({headers:cors,json:{state:'paid',environment:'test'}});
 });
 await page.goto('/customer/home');await page.getByRole('button',{name:'Тествай 2.95 €',exact:true}).click();
 const bank=page.getByRole('dialog',{name:'Mock bank authentication'});await expect(bank).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Плащане на пътуването'})).not.toHaveAttribute('aria-modal','true');
 const approve=bank.getByRole('button',{name:'Потвърди тестовата банкова проверка'});await expect(approve).toBeFocused();await approve.click();
 await expect(page.getByText('Тестово плащане успешно',{exact:true})).toBeVisible();expect(state.errors).toEqual([]);
});

test('card mounts before slow actions and wallets, keeps input after the loading deadline and late wallet detection',async({page})=>{
 const state=await setupUi(page,'CUSTOMER');await installStripeUiDouble(page,true,false,{actionsDelayMs:15000,walletDelayMs:20000,paymentDelayMs:1000});
 const row=ride();state.rides=[row];let sessions=0;
 await page.clock.install();
 await page.route('**/rest/v1/rpc/ride_payment_state',route=>route.fulfill({headers:cors,json:{request_id:id,eligible:true,inline_available:true,environment:'test',ended_at:row.trip_ended_at,amount:2.95,state:'open',payment_status:'pending',payment_method:'cash'}}));
 await page.route('**/functions/v1/ride-checkout',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});sessions++;return route.fulfill({headers:cors,json:config});});
 await page.goto('/customer/home');const dialog=page.getByRole('dialog'),input=dialog.getByRole('textbox',{name:'Тестова карта'}),pay=dialog.getByRole('button',{name:'Тествай 2.95 €',exact:true});
 await expect(input).toBeVisible();await expect(pay).toBeDisabled();
 await input.fill('4242 test input');
 const before=await page.evaluate(()=>(window as unknown as {stripeUiDouble:{paymentMounts:number;actionsReady:boolean;confirms:number}}).stripeUiDouble);
 expect(before.paymentMounts).toBe(1);expect(before.actionsReady).toBe(false);expect(before.confirms).toBe(0);
 await page.clock.fastForward(12001);await expect(dialog.getByRole('button',{name:'Зареди плащането отново'})).toBeVisible();await expect(input).toHaveValue('4242 test input');
 await page.clock.fastForward(3001);await expect(pay).toBeEnabled();await expect(input).toHaveValue('4242 test input');
 await page.clock.fastForward(5001);await expect(dialog.getByRole('button',{name:'Mock Apple Pay'})).toBeVisible();await expect(input).toBeVisible();
 await dialog.getByRole('button',{name:'Скрий плащането с карта'}).click();await expect(input).toBeHidden();
 await dialog.getByRole('button',{name:'Плати с карта'}).click();await expect(input).toHaveValue('4242 test input');
 const after=await page.evaluate(()=>(window as unknown as {stripeUiDouble:{paymentMounts:number;paymentDestroys:number;confirms:number}}).stripeUiDouble);
 expect(after.paymentMounts).toBe(1);expect(after.paymentDestroys).toBe(0);expect(after.confirms).toBe(0);expect(sessions).toBe(1);expect(state.errors).toEqual([]);
});
