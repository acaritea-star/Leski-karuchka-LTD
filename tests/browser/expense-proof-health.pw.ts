import {test,expect} from '@playwright/test';
import {setupUi,uiAccount} from './helpers/uiFixture';
import {accountingFixture,entryFixture,financeIds} from '../fixtures/accounting';
const headers={'access-control-allow-origin':'*'};
test('expense attachment retries only the same private file and never posts a second expense',async({page},testInfo)=>{
 const state=await setupUi(page,'DRIVER');const report=accountingFixture();const expense={...entryFixture(),kind:'expense' as const,request_id:null,amount:3,signed_amount:3,balance_delta:-3,note:'Паркинг',payment_method:'cash' as const};
 report.entries=[expense];report.entry_count=1;report.finances={...report.finances,expenses:3,net_income:-3};report.balance={...report.balance,movement:-3,closing:-3};
 await page.route('**/rest/v1/rpc/accounting_report',async route=>{const b=route.request().postDataJSON();report.period.from=b.p_from;report.period.until=b.p_until;return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(report)});});
 let record:Record<string,unknown>|null=null,finalized=false,moneyWrites=0,uploads=0,finalizes=0;const reservations:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/record_driver_money*',route=>{moneyWrites++;return route.abort();});
 await page.route('**/rest/v1/expense_receipts*',route=>route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(record?[record]:[])}));
 await page.route('**/rest/v1/rpc/reserve_expense_receipt',route=>{
  const b=route.request().postDataJSON();reservations.push(b);expect(b.p_entry_id).toBe(expense.id);expect(b.p_actor).toBe(uiAccount);
  record={id:b.p_id,entry_id:expense.id,company_id:financeIds.company,driver_id:financeIds.driver,driver_user_id:uiAccount,slot:1,file_name:b.p_file_name,mime_type:b.p_mime_type,byte_size:b.p_byte_size,digest:b.p_digest,path:`${financeIds.company}/${financeIds.driver}/${expense.id}/${b.p_id}.png`,created_at:new Date().toISOString(),uploaded_at:null};
  return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(record)});
 });
 await page.route('**/storage/v1/object/expense-receipts/**',route=>{uploads++;return uploads===1?route.abort():route.fulfill({status:200,headers,contentType:'application/json',body:'{"Key":"uploaded","Id":"synthetic"}'});});
 await page.route('**/rest/v1/rpc/finalize_expense_receipt',route=>{
  finalizes++;if(finalizes===1)return route.fulfill({status:400,headers,contentType:'application/json',body:'{"code":"P0001","message":"Receipt upload not confirmed"}'});
  finalized=true;record!.uploaded_at=new Date().toISOString();return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(record)});
 });
 await page.goto('/driver/earnings');await page.getByRole('button',{name:'Документи към разхода'}).click();
 const dialog=page.getByRole('dialog',{name:'Документи към разхода'});const file={name:'parking.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXYQAAAAASUVORK5CYII=','base64')};
 await dialog.getByLabel('Добави снимка или файл').setInputFiles(file);await expect(dialog.getByRole('alert')).toContainText('Разходът е записан.');
 expect(moneyWrites).toBe(0);await dialog.getByLabel('Добави снимка или файл').setInputFiles(file);await expect(dialog.getByText('Документът е качен',{exact:true})).toBeVisible();
 expect(finalized).toBe(true);expect(moneyWrites).toBe(0);expect(uploads).toBe(2);expect(reservations[0].p_id).toBe(reservations[1].p_id);
 await page.screenshot({path:testInfo.outputPath('expense-proof.png')});expect(state.errors).toEqual([]);
});
test('company health screen uses understandable actions and distinguishes past GPS failures from a current outage',async({page},testInfo)=>{
 const state=await setupUi(page,'COMPANY_ADMIN');await page.route('**/rest/v1/rpc/operational_health',route=>route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({checked_at:new Date().toISOString(),stale_online_drivers:1,flagged_rides_24h:2,oldest_push_seconds:0,route_budget:null,metrics:[{name:'gps.read',count:39,errors:20,avg_ms:1365,max_ms:8500}]})}));
 await page.goto('/admin/dashboard');const panel=page.getByRole('region',{name:'Състояние на услугата'});await expect(panel.getByText('1 онлайн шофьори не изпращат актуална локация')).toBeVisible();await expect(panel.getByRole('link',{name:'Отвори шофьорите'})).toBeVisible();
 await expect(panel).toContainText('не означава, че проблемът е активен в момента');await expect(panel).not.toContainText('gps.read');await expect(panel).not.toContainText('1365');
 await page.screenshot({path:testInfo.outputPath('company-health.png')});await page.setViewportSize({width:320,height:568});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(state.errors).toEqual([]);
});
