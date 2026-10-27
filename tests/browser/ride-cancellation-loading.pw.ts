import { test, expect } from '@playwright/test';
import { setupUi, uiAccount, uiCompany, uiDriver } from './helpers/uiFixture';
const id = '48484848-4848-4484-8484-484848484848';
const ride = (status = 'accepted') => ({ id, customer_id: uiAccount, company_id: uiCompany, driver_id: uiDriver, status,
  pickup_address: 'Начален адрес', destination_address: 'Краен адрес', pickup_latitude: 43.35, pickup_longitude: 25.14,
  destination_latitude: 43.3669, destination_longitude: 25.1335, estimated_price: 5, final_price: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), payment_method: 'cash', payment_status: 'pending' });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,prefer' };

for (const status of ['pending', 'accepted', 'arrived']) test(`orders can cancel ${status} with one write, including a lost reply`, async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); const row = ride(status); state.rides = [row]; let writes = 0;
  await page.route('**/rest/v1/taxi_requests*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(route.request().url());
    if (route.request().method() === 'PATCH') {
      writes++; expect(url.searchParams.get('id')).toBe(`eq.${id}`); expect(url.searchParams.get('status')).toBe(`eq.${status}`);
      expect(route.request().postDataJSON()).toEqual({ status: 'cancelled', cancel_reason: 'customer_requested' });
      row.status = 'cancelled';
      // The existing operation must reconcile a write whose response was lost.
      if (status === 'arrived') return route.abort();
      return route.fulfill({ headers: cors, json: row });
    }
    if (url.searchParams.has('id')) return route.fulfill({ headers: cors, json: row });
    return route.fallback();
  });
  await page.goto('/customer/orders');
  await page.getByRole('button', { name: 'Отмени заявката', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Запази заявката', exact: true }).click(); expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Отмени заявката', exact: true }).click();
  await dialog.getByRole('button', { name: 'Да, отмени', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: 'Отмени заявката', exact: true })).toHaveCount(0);
  expect(writes).toBe(1); expect(state.errors).toEqual([]);
});

test('tracking cancellation stays reachable with payment enabled on a short phone', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'CUSTOMER'); state.rides = [ride()];
  await page.route('**/rest/v1/rpc/ride_payment_state', route => route.fulfill({ headers: cors, json: {
    request_id: id, eligible: true, inline_available: true, environment: 'live', amount: 5, state: 'none', ended_at: null, payment_status: 'pending', payment_method: 'cash' } }));
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/customer/home');
  const cancel = page.getByRole('button', { name: 'Отмени заявката', exact: true });
  await expect(cancel).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Плати онлайн с карта', exact: true }).scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('tracking-actions-320.png') });
  await cancel.click(); await expect(page.getByRole('dialog')).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Запази заявката', exact: true }).click();
  expect(state.errors).toEqual([]);
});

test('an in-progress ride never offers cancellation', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); state.rides = [ride('in_progress')];
  await page.goto('/customer/orders'); await expect(page.getByText('Начален адрес', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отмени заявката', exact: true })).toHaveCount(0);
});

test('orders keep their header and navigation while data loads, with reduced-motion support', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'CUSTOMER');
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/taxi_requests*', async route => { await waiting; return route.fallback(); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/customer/orders');
  await expect(page.getByRole('status', { name: 'Зареждаме твоите поръчки…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Назад', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Поръчки', exact: true })).toBeVisible();
  expect(await page.locator('.content-skeleton-line').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.screenshot({ path: testInfo.outputPath('orders-loading.png') });
  release(); await expect(page.getByRole('status', { name: 'Зареждаме твоите поръчки…' })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('navigation intent loads page code without fetching orders before navigation', async ({ page }) => {
  await setupUi(page, 'CUSTOMER'); let modules = 0, reads = 0;
  page.on('request', request => {
    if (request.url().includes('/src/pages/customer/orders/page.tsx')) modules++;
    if (new URL(request.url()).pathname.endsWith('/rest/v1/taxi_requests')) reads++;
  });
  await page.goto('/customer/profile');
  const orders = page.getByRole('link', { name: /Поръчки/ }); await expect(orders).toBeVisible();
  expect(reads).toBe(0); await orders.focus();
  await expect.poll(() => modules).toBe(1); expect(reads).toBe(0);
  await expect(page).toHaveURL(/\/customer\/profile$/);
  await orders.click(); await expect(page).toHaveURL(/\/customer\/orders$/);
  await expect.poll(() => reads).toBe(1);
});

test('the initial document keeps a branded loading surface while the entry module is delayed', async ({ page }) => {
  await setupUi(page, 'visitor');
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/main.tsx', async route => { await waiting; return route.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByRole('status', { name: 'Подготвяме приложението…' })).toBeVisible();
  release(); await expect(page.getByRole('status', { name: 'Подготвяме приложението…' })).toHaveCount(0);
});
