import { test, expect } from '@playwright/test';
import { setupUi, uiCompany } from './helpers/uiFixture';

const cors = { 'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-goog-api-key,x-goog-fieldmask',
  'access-control-allow-methods': 'GET, POST, OPTIONS' };
const locations = [
  { id: 'a', name: 'Начало', address: 'Левски, Иван Вазов 2', lat: 43.35, lng: 25.14 },
  { id: 'b', name: 'Край', address: 'Гара Левски', lat: 43.36, lng: 25.13 },
];

test('GPS coordinates unlock destination entry while the street address is still loading', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'CUSTOMER');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: PositionCallback) => setTimeout(() => success({ timestamp: Date.now(),
        coords: { latitude: 43.35, longitude: 25.14, accuracy: 15 } } as GeolocationPosition), 30),
      watchPosition: () => 1, clearWatch: () => {},
    } });
  });
  let geocoding = false;
  await page.route('**/functions/v1/google-geocode', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    geocoding = true;
    await new Promise(resolve => setTimeout(resolve, 2500));
    await route.fulfill({ headers: cors, json: { success: true, formatted_address: 'GPS улица' } });
  });
  await page.goto('/customer/home');
  const started = Date.now();
  await page.getByRole('button', { name: 'От моята локация' }).click();
  await expect(page.getByRole('heading', { name: 'Накъде отиваш?' })).toBeVisible({ timeout: 1200 });
  const elapsed = Date.now() - started;
  expect(geocoding).toBe(true);
  await page.getByRole('searchbox').fill('Горна Оряховица');
  await expect(page.getByRole('searchbox')).toHaveValue('Горна Оряховица');
  await expect(page.getByText(/Позицията е намерена/)).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveValue('Горна Оряховица');
  await testInfo.attach('gps-destination-entry.json', { body: JSON.stringify({ elapsedMs: elapsed, reverseDelayMs: 2500 }), contentType: 'application/json' });
  expect(state.errors).toEqual([]);
});

test('address typing is debounced and stale results cannot select a different destination', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER');
  await page.addInitScript(locations => localStorage.setItem('leski_recent_locations', JSON.stringify(locations)), locations);
  const searches: Record<string, unknown>[] = [];
  let details = 0;
  await page.route('https://places.googleapis.com/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (route.request().url().includes(':autocomplete')) {
      const body = route.request().postDataJSON(); searches.push(body);
      await new Promise(resolve => setTimeout(resolve, 1800));
      return route.fulfill({ headers: cors, json: { suggestions: [{ placePrediction: { placeId: body.input,
        text: { text: body.input + ' адрес' }, structuredFormat: { mainText: { text: body.input + ' адрес' } } } }] } });
    }
    details++;
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.fulfill({ headers: cors, json: { id: 'destination', formattedAddress: 'Стар избран адрес', location: { latitude: 43.36, longitude: 25.13 } } }).catch(() => {});
  });
  await page.goto('/customer/home');
  await page.getByRole('button', { name: /Начало.*Иван Вазов/ }).click();
  const input = page.getByRole('searchbox');
  await input.pressSequentially('Горна', { delay: 35 });
  await expect(page.getByRole('button', { name: 'Горна адрес' })).toBeEnabled();
  expect(searches).toHaveLength(1);
  expect(searches[0].locationBias).toEqual({ circle: { center: { latitude: 43.35, longitude: 25.14 }, radius: 30000 } });
  await input.fill('София');
  await expect(page.getByRole('button', { name: 'Горна адрес' })).toBeDisabled();
  await expect(page.getByRole('status', { name: 'Търсене на адреси...' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'София адрес' })).toBeEnabled();
  await page.getByRole('button', { name: 'София адрес' }).click();
  await expect(page.locator('.booking-place .booking-spinner')).toBeVisible();
  await input.fill('Плевен');
  await expect(page.getByRole('button', { name: 'Плевен адрес' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Накъде отиваш?' })).toBeVisible();
  expect(searches).toHaveLength(3); expect(details).toBe(1);
  expect(searches[0].sessionToken).toBe(searches[1].sessionToken);
  expect(searches[2].sessionToken).not.toBe(searches[1].sessionToken);
  expect(state.errors).toEqual([]);
});

test('changing a route aborts the old request and ignores its late cheaper offer', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER');
  await page.addInitScript(locations => localStorage.setItem('leski_recent_locations', JSON.stringify(locations)), locations);
  await page.route('**/rpc/marketplace_availability', route => route.fulfill({ headers: cors, json: {
    company_id: 'marketplace', sampled_at: new Date().toISOString(), categories: [{ id: 'standard', drivers: 1, configured: true }],
    carriers: [{ company_id: uiCompany, vehicle_type_id: 'type', service_class: 'standard' }],
  } }));
  let calls = 0, aborted = 0;
  page.on('requestfailed', request => { if (request.url().endsWith('/google-routes')) aborted++; });
  await page.route('**/functions/v1/google-routes', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const call = ++calls;
    if (call === 1) await new Promise(resolve => setTimeout(resolve, 2500));
    const quote = { company_id: uiCompany, company_name: 'ОРИОН', vehicle_type_id: 'type', service_class: 'standard', type_name: 'Стандарт',
      capacity: 4, quote_id: 'quote-' + call, quote_expires_at: new Date(Date.now() + 120000).toISOString(), price: call === 1 ? 3 : 7, breakdown: { total: call === 1 ? 3 : 7 } };
    await route.fulfill({ headers: cors, json: { success: true, ...quote, quotes: [quote], distance_km: 2, duration_min: 5,
      duration_sec: 300, polyline: '', legs: [], alternatives_count: 0 } }).catch(() => {});
  });
  await page.goto('/customer/home');
  await page.getByRole('button', { name: /Начало.*Иван Вазов/ }).click();
  await page.getByRole('button', { name: /Край.*Гара/ }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: 'Размени адресите' }).click();
  const order = page.getByRole('button', { name: /Поръчай каручка/ });
  await expect(order).toBeDisabled();
  await expect(order).toContainText('7.00'); await expect(order).toBeEnabled();
  await expect.poll(() => aborted).toBe(1);
  expect(calls).toBe(2); expect(state.errors).toEqual([]);
});

test('returning to the original addresses restores the valid offer without a third route request', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER');
  await page.addInitScript(locations => localStorage.setItem('leski_recent_locations', JSON.stringify(locations)), locations);
  await page.route('**/rpc/marketplace_availability', route => route.fulfill({ headers: cors, json: {
    company_id: 'marketplace', sampled_at: new Date().toISOString(), categories: [{ id: 'standard', drivers: 1, configured: true }],
    carriers: [{ company_id: uiCompany, vehicle_type_id: 'type', service_class: 'standard' }],
  } }));
  let calls = 0, aborted = 0;
  page.on('requestfailed', request => { if (request.url().endsWith('/google-routes')) aborted++; });
  await page.route('**/functions/v1/google-routes', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const call = ++calls;
    if (call === 2) await new Promise(resolve => setTimeout(resolve, 2500));
    const quote = { company_id: uiCompany, company_name: 'ОРИОН', vehicle_type_id: 'type', service_class: 'standard', type_name: 'Стандарт',
      capacity: 4, quote_id: 'quote-' + call, quote_expires_at: new Date(Date.now() + 120000).toISOString(), price: call === 1 ? 7 : 99, breakdown: { total: call === 1 ? 7 : 99 } };
    await route.fulfill({ headers: cors, json: { success: true, ...quote, quotes: [quote], distance_km: 2, duration_min: 5,
      duration_sec: 300, polyline: '', legs: [], alternatives_count: 0 } }).catch(() => {});
  });
  await page.goto('/customer/home');
  await page.getByRole('button', { name: /Начало.*Иван Вазов/ }).click();
  await page.getByRole('button', { name: /Край.*Гара/ }).click();
  const order = page.getByRole('button', { name: /Поръчай каручка/ });
  await expect(order).toBeEnabled(); await expect(order).toContainText('7.00');
  await page.getByRole('button', { name: 'Размени адресите' }).click();
  await expect.poll(() => calls).toBe(2); await expect(order).toBeDisabled();
  await page.getByRole('button', { name: 'Размени адресите' }).click();
  await expect(order).toBeEnabled(); await expect(order).toContainText('7.00');
  await expect.poll(() => aborted).toBe(1);
  expect(calls).toBe(2); expect(state.errors).toEqual([]);
});

test('a mobile viewport event burst applies only its final layout', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER');
  await page.goto('/customer/home');
  await expect(page.getByRole('button', { name: 'От моята локация' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('.customer-experience')!;
    let changes = 0;
    const observer = new MutationObserver(records => { changes += records.length; });
    observer.observe(root, { attributes: true, attributeFilter: ['style'] });
    for (let i = 0; i < 10; i++) {
      Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 429 - i });
      window.visualViewport!.dispatchEvent(new Event('resize'));
      window.visualViewport!.dispatchEvent(new Event('scroll'));
    }
    await new Promise(requestAnimationFrame);
    await Promise.resolve(); observer.disconnect();
    return { changes, height: root.getBoundingClientRect().height, short: root.dataset.shortViewport };
  });
  expect(result).toEqual({ changes: 1, height: 420, short: 'true' });
  expect(state.errors).toEqual([]);
});
