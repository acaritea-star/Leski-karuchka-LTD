import {test,expect,type Page,type WebSocketRoute} from '@playwright/test';
import {setupUi,uiAccount,uiCompany,uiDriver} from './helpers/uiFixture';
import {installStripeUiDouble} from './helpers/stripeFixture';
const id='48484848-4848-4484-8484-484848484848';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS'};
const ride=()=>({id,company_id:uiCompany,driver_id:uiDriver,customer_id:uiAccount,status:'in_progress',estimated_price:2.95,final_price:2.95,trip_ended_at:new Date().toISOString(),online_payment_state:'open',payment_status:'pending',payment_method:'cash',payment_environment:'live',pickup_latitude:43.08,pickup_longitude:25.63,destination_latitude:43.09,destination_longitude:25.64,pickup_address:'Велико Търново, център',destination_address:'Велико Търново, Акация',created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
async function serverEvents(page:Page){
 const listeners:Array<{ws:WebSocketRoute;topic:string;id:number}>=[];let next=0;
 await page.routeWebSocket('**/realtime/v1/websocket*',ws=>ws.onMessage(message=>{
  const packet=JSON.parse(String(message));
  if(packet.event==='phx_join'){
   const changes=(packet.payload.config?.postgres_changes??[]).map((filter:Record<string,string>)=>{const sub={...filter,id:++next};if(filter.table==='taxi_requests')listeners.push({ws,topic:packet.topic,id:sub.id});return sub;});
   ws.send(JSON.stringify({...packet,event:'phx_reply',payload:{status:'ok',response:{postgres_changes:changes}}}));
  }else if(['heartbeat','phx_leave'].includes(packet.event))ws.send(JSON.stringify({...packet,event:'phx_reply',payload:{status:'ok',response:{}}}));
 }));
 return {count:()=>listeners.length,send:(row:Record<string,unknown>)=>listeners.forEach(({ws,topic,id})=>ws.send(JSON.stringify({topic,event:'postgres_changes',payload:{ids:[id],data:{schema:'public',table:'taxi_requests',type:'UPDATE',commit_timestamp:row.updated_at,columns:[],record:row,old_record:{},errors:null}}})))};
}
for(const path of ['/driver/home','/driver/requests'])test(`${path} receives the paid event without another receipt read and never carries it to the next ride`,async({page})=>{
 const state=await setupUi(page,'DRIVER'),events=await serverEvents(page),row=ride();state.rides=[row];let receiptReads=0;
 await page.route('**/rest/v1/taxi_requests*',route=>{const url=new URL(route.request().url());if(url.searchParams.get('id')===`eq.${id}`)receiptReads++;return route.fallback();});
 await page.goto(path);await expect.poll(events.count).toBeGreaterThan(0);await expect(page.getByText('Платено онлайн',{exact:true})).toHaveCount(0);
 Object.assign(row,{status:'completed',payment_status:'paid',payment_method:'online',online_payment_state:'paid',updated_at:new Date(Date.now()+1000).toISOString()});events.send(row);
 await expect(page.getByText('Платено онлайн',{exact:true})).toBeVisible();expect(receiptReads).toBe(0);
 const nextRide={...ride(),id:'59595959-5959-4595-8595-595959595959',updated_at:new Date(Date.now()+2000).toISOString()};state.rides=[row,nextRide];events.send(nextRide);
 await expect(page.getByText('Платено онлайн',{exact:true})).toHaveCount(0);
 if(path==='/driver/requests'){
  await page.getByRole('button',{name:'Плащане по курса',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  events.send(row);await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByText('Платено онлайн',{exact:true})).toHaveCount(0);
 }
 expect(state.errors).toEqual([]);
});
test('uses an already settled webhook result after card confirmation without a redundant checkout call',async({page})=>{
 const state=await setupUi(page,'CUSTOMER');await installStripeUiDouble(page);const row={...ride(),payment_environment:'test'};state.rides=[row];let sessions=0,reconciles=0;
 await page.route('**/rest/v1/rpc/ride_payment_state',async route=>{
  const confirmed=await page.evaluate(()=>(window as unknown as {stripeUiDouble?:{confirms:number}}).stripeUiDouble?.confirms??0);
  if(confirmed)Object.assign(row,{payment_status:'paid',payment_method:'online',online_payment_state:'paid'});
  return route.fulfill({headers:cors,json:{request_id:id,eligible:row.payment_status!=='paid',inline_available:true,environment:'test',ended_at:row.trip_ended_at,amount:2.95,state:row.online_payment_state,payment_status:row.payment_status,payment_method:row.payment_method}});
 });
 await page.route('**/functions/v1/ride-checkout',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  if(route.request().postDataJSON().action!=='elements'){reconciles++;return route.abort();}
  sessions++;return route.fulfill({headers:cors,json:{state:'open',environment:'test',ui_mode:'elements',request_id:id,session_id:'cs_test_inline',account_id:'acct_fixture',amount_minor:295,currency:'eur',publishable_key:'pk_test_fixture',client_secret:'cs_test_inline_secret_fixture'}});
 });
 await page.goto('/customer/home');await page.getByRole('button',{name:'Тествай плащане с карта',exact:true}).click();await page.getByRole('button',{name:'Тествай 2.95 €',exact:true}).click();
 await expect(page.getByText('Тестово плащане успешно',{exact:true})).toBeVisible();expect(sessions).toBe(1);expect(reconciles).toBe(0);expect(state.errors).toEqual([]);
});

for(const path of ['/driver/home','/driver/requests'])test(`${path} keeps the wallet pinned and refreshes once for a verified payment`,async({page},info)=>{
 const state=await setupUi(page,'DRIVER'),events=await serverEvents(page),row={...ride(),final_price:4.23,estimated_price:4.23};state.rides=[row];let reads=0,online=4.23;
 await page.route('**/rest/v1/rpc/driver_day_summary',route=>{reads++;return route.fulfill({headers:cors,json:{trips:7,earnings:50,received:{cash:10,card:5,online,total:15+online}}});});
 await page.setViewportSize({width:320,height:568});await page.goto(path);
 const wallet=page.getByRole('button',{name:'Портфейл — получени по днешните курсове'});
 await expect(wallet).toContainText('19,23');await expect.poll(events.count).toBeGreaterThan(0);expect(reads).toBe(1);
 await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await expect(wallet).toBeInViewport();
 online=8.46;Object.assign(row,{status:'completed',payment_status:'paid',payment_method:'online',online_payment_state:'paid',updated_at:new Date(Date.now()+1000).toISOString()});events.send(row);
 await expect(page.getByText('+4,23 €',{exact:true})).toBeVisible();await expect(wallet).toContainText('23,46');expect(reads).toBe(2);
 events.send(row);events.send(row);await expect(wallet).toContainText('23,46');expect(reads).toBe(2);
 const credit=page.locator('.driver-wallet-receipt');await expect(credit).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(path==='/driver/home'){const banner=page.getByLabel('Настройка на известията');await expect(banner).toBeVisible();expect((await banner.locator('p').boundingBox())!.height).toBeLessThan(220);}
 await page.screenshot({path:info.outputPath(path.includes('home')?'driver-home-wallet.png':'driver-requests-wallet.png')});
 await wallet.click();const dialog=page.getByRole('dialog',{name:'Портфейл — днешни курсове'});await expect(dialog.getByText('Онлайн към фирмата')).toBeVisible();
 await dialog.getByRole('button',{name:'Затвори портфейла'}).click();await expect(wallet).toBeFocused();expect(state.errors).toEqual([]);
});

for(const path of ['/driver/home','/driver/requests'])test(`${path} keeps historical tests out of the wallet after reload and gives the dialog room on phones`,async({page},info)=>{
 const state=await setupUi(page,'DRIVER'),events=await serverEvents(page),row={...ride(),final_price:2.97,estimated_price:2.97,payment_environment:'test'};state.rides=[row];let paid=false,reads=0;
 await page.route('**/rest/v1/rpc/driver_day_summary',route=>{reads++;return route.fulfill({headers:cors,json:{trips:0,earnings:0,received:{cash:0,card:0,online:0,total:0},test_payments:{total:paid?2.97:0,count:paid?1:0,refunded_count:0}}});});
 await page.setViewportSize({width:390,height:844});await page.goto(path);await expect.poll(events.count).toBeGreaterThan(0);
 const wallet=page.getByRole('button',{name:'Портфейл — получени по днешните курсове'});
 await expect(wallet.locator('.driver-wallet-value')).toContainText('0,00');expect(reads).toBe(1);
 paid=true;Object.assign(row,{status:'completed',payment_status:'paid',payment_method:'online',online_payment_state:'paid',updated_at:new Date(Date.now()+1000).toISOString()});events.send(row);
 await expect(page.getByText('Тестово плащане успешно',{exact:true})).toBeVisible();await expect.poll(()=>reads).toBe(2);
 await expect(wallet.locator('.driver-wallet-test-summary')).toHaveCount(0);await expect(wallet.locator('.driver-wallet-value')).toContainText('0,00');expect(reads).toBe(2);
 events.send(row);await expect(wallet.locator('.driver-wallet-test-summary')).toHaveCount(0);expect(reads).toBe(2);
 await page.reload();await expect(wallet.locator('.driver-wallet-value')).toContainText('0,00');await expect(wallet.locator('.driver-wallet-test-summary')).toHaveCount(0);expect(reads).toBe(3);
 for(const width of [390,320]){
  await page.setViewportSize({width,height:width===320?568:844});await wallet.click();const dialog=page.getByRole('dialog',{name:'Портфейл — днешни курсове'});
  await expect(dialog.getByRole('region',{name:'Тестови плащания за днес'})).toHaveCount(0);await expect(dialog.locator('.driver-wallet-total')).toContainText('0,00');
  const geometry=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),body=el.querySelector('.driver-wallet-dialog-body')!;return{left:r.left,right:r.right,width:innerWidth,padding:parseFloat(getComputedStyle(body).paddingLeft),overflow:el.scrollWidth>el.clientWidth};});
  expect(geometry.left).toBeGreaterThanOrEqual(15);expect(geometry.right).toBeLessThanOrEqual(geometry.width-15);expect(geometry.padding).toBeGreaterThanOrEqual(18);expect(geometry.overflow).toBe(false);
  await dialog.evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:info.outputPath(`${path.includes('home')?'home':'requests'}-test-wallet-${width}.png`)});
  await dialog.getByRole('button',{name:'Обнови',exact:true}).click();await expect(dialog.getByRole('region',{name:'Тестови плащания за днес'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Затвори портфейла'}).click();await expect(wallet).toBeFocused();
 }
 expect(state.errors).toEqual([]);
});
