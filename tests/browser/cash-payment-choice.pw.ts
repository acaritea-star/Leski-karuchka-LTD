import { test, expect } from '@playwright/test';
import { setupUi, uiAccount, uiCompany, uiDriver } from './helpers/uiFixture';
const id = '48484848-4848-4484-8484-484848484848';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info', 'access-control-allow-methods': 'POST,OPTIONS' };
for (const environment of ['live']) test(`${environment}: the customer sees cash and card without reserving an online payment`, async ({ page }, info) => {
 const state = await setupUi(page, 'CUSTOMER');
 const ended = new Date().toISOString();
 state.rides = [{ id, company_id: uiCompany, driver_id: uiDriver, customer_id: uiAccount, status: 'in_progress', estimated_price: 2.97, final_price: 2.97, trip_ended_at: ended, online_payment_state: 'none', payment_status: 'pending', payment_method: 'cash', payment_environment: 'live', pickup_latitude: 43.08, pickup_longitude: 25.63, destination_latitude: 43.09, destination_longitude: 25.64, pickup_address: 'Велико Търново, център', destination_address: 'Велико Търново, Акация', created_at: ended, updated_at: ended }];
 let paymentCalls = 0;
 await page.clock.install();
 await page.route('**/rest/v1/rpc/ride_payment_state', route => route.fulfill({ headers: cors, json: { request_id: id, eligible: true, inline_available: true, environment, ended_at: ended, amount: 2.97, state: 'none', payment_status: 'pending', payment_method: 'cash' } }));
 await page.route('**/functions/v1/ride-checkout', route => {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  paymentCalls++; expect(route.request().postDataJSON()).toMatchObject({ action: 'cancel', request_id: id });
  return route.fulfill({ headers: cors, json: { state: 'none' } });
 });
 await page.setViewportSize({ width: 320, height: 640 }); await page.goto('/customer/home');
 const payment = page.getByLabel('Плащане по пътуването');
 const cash = payment.getByRole('button', { name: 'Плащане в брой' });
 await expect(cash).toBeEnabled();
 await expect(payment.getByRole('button', { name: 'Плати онлайн с карта' })).toBeEnabled();
 await page.clock.fastForward(3000); expect(paymentCalls).toBe(0);
 await cash.scrollIntoViewIfNeeded(); await expect(cash).toBeInViewport(); await cash.click();
 await expect(payment.getByText('Плати в брой на шофьора. Той ще потвърди получената сума.')).toBeVisible();
 expect(paymentCalls).toBe(1); await expect(payment.getByText('Платено в брой', { exact: true })).toHaveCount(0);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: info.outputPath(`cash-card-choice-${environment}-320.png`) });
 expect(state.errors).toEqual([]);
});
