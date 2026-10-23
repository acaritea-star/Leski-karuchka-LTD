import { test, expect } from '@playwright/test';
import { setupUi, uiAccount, uiCompany, uiDriver } from './helpers/uiFixture';
import { installStripeUiDouble } from './helpers/stripeFixture';

const id = '48484848-4848-4484-8484-484848484848';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info', 'access-control-allow-methods': 'POST,OPTIONS' };
const ride = () => ({ id, company_id: uiCompany, driver_id: uiDriver, customer_id: uiAccount, status: 'in_progress',
  estimated_price: 2.95, final_price: 2.95, trip_ended_at: new Date().toISOString(), online_payment_state: 'none', payment_status: 'pending', payment_method: 'cash',
  pickup_latitude: 43.0800, pickup_longitude: 25.6337, destination_latitude: 43.0831, destination_longitude: 25.6227,
  pickup_address: 'Велико Търново, начало', destination_address: 'Велико Търново, край', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
const config = { state: 'open', environment: 'test', ui_mode: 'elements', request_id: id, session_id: 'cs_test_inline', account_id: 'acct_fixture',
  amount_minor: 295, currency: 'eur', publishable_key: 'pk_test_fixture', client_secret: 'cs_test_inline_secret_fixture' };

// Exercises standalone signals and suspended-app recovery in both engines.
// This is not a physical iPhone installation or a hardware wallet test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    const match = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = match(query);
      if (query.includes('display-mode')) Object.defineProperty(result, 'matches', { configurable: true, value: true });
      return result;
    };
  });
});

test('a standalone customer sees the card form without a device wallet and reuses it after a resume', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); await installStripeUiDouble(page, false);
  const row = ride(); state.rides = [row]; let sessions = 0;
  await page.route('**/rest/v1/rpc/ride_payment_state', route => route.fulfill({ headers: cors, json: { request_id: id, eligible: true, inline_available: true,
    environment: 'test', ended_at: row.trip_ended_at, amount: 2.95, state: 'open', payment_status: 'pending', payment_method: 'cash' } }));
  await page.route('**/functions/v1/ride-checkout', route => { if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors }); sessions++; return route.fulfill({ headers: cors, json: config }); });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/customer/home');
  const pay = page.getByRole('button', { name: 'Тествай плащане с карта', exact: true });
  await expect(pay).toBeEnabled(); await pay.click();
  const input = page.getByRole('textbox', { name: 'Тестова карта' }); await expect(input).toBeVisible(); await input.fill('4242 test value');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(input).toHaveValue('4242 test value'); expect(sessions).toBe(1);
  expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true); expect(state.errors).toEqual([]);
});

test('a standalone resume reloads eligibility after a test profile is enabled without changing its ride', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); state.rides = [ride()]; let eligible = false, reads = 0, payments = 0;
  await page.route('**/rest/v1/rpc/ride_payment_state', route => { reads++; return route.fulfill({ headers: cors, json: { request_id: id, eligible,
    environment: eligible ? 'test' : 'live', ended_at: state.rides[0].trip_ended_at, amount: 2.95, state: 'none', payment_status: 'pending', payment_method: 'cash' } }); });
  await page.route('**/functions/v1/ride-checkout', route => { payments++; return route.abort(); });
  await page.goto('/customer/home'); await expect(page.getByText(/Онлайн плащането не е включено/)).toBeVisible();
  const previous = reads; eligible = true;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('button', { name: 'Тествай плащане с карта', exact: true })).toBeEnabled();
  expect(reads).toBeGreaterThan(previous); expect(payments).toBe(0); expect(state.errors).toEqual([]);
});

test('slow eligibility does not falsely tell a standalone customer that online payment is unavailable', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); const row = ride(); state.rides = [row];
  let release = () => {}; const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/rpc/ride_payment_state', async route => { await pending; return route.fulfill({ headers: cors, json: { request_id: id, eligible: true,
    environment: 'test', ended_at: row.trip_ended_at, amount: 2.95, state: 'none', payment_status: 'pending', payment_method: 'cash' } }); });
  try {
    await page.goto('/customer/home'); await expect(page.getByText('Проверяваме начините за плащане…')).toBeVisible();
    await expect(page.getByText(/Онлайн плащането не е включено/)).toHaveCount(0);
    release(); await expect(page.getByRole('button', { name: 'Тествай плащане с карта', exact: true })).toBeEnabled(); expect(state.errors).toEqual([]);
  } finally { release(); }
});
