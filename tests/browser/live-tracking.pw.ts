import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { setupUi, uiAccount, uiCompany, uiDriver } from './helpers/uiFixture';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,range,range-unit' };
const ride = () => ({ id: '55555555-5555-4555-8555-555555555555', customer_id: uiAccount,
  company_id: uiCompany, driver_id: uiDriver, status: 'in_progress', pickup_address: 'Начало', destination_address: 'Край',
  pickup_latitude: 43.35, pickup_longitude: 25.14, destination_latitude: 43.36, destination_longitude: 25.13,
  estimated_price: 9, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

// Only the external renderer/native device are synthetic. Hooks, SDK socket
// decoding, RLS-filtered HTTP reads, timers and rendered app are the real code.
async function installDevice(page: Page) {
  await page.addInitScript(() => {
    class Point { constructor(public lat = 0, public lng = 0) {} }
    class Bounds {
      extend() { return this; }
      getNorthEast() { return { lat: () => 44, lng: () => 26 }; }
      getSouthWest() { return { lat: () => 42, lng: () => 24 }; }
    }
    class MapView {
      constructor(public el: HTMLElement) { el.style.background = '#e5ece8'; }
      fitBounds() {} panTo() {} setCenter() {} setZoom() {} getZoom() { return 15; } getBounds() { return new Bounds(); }
    }
    class Marker {
      node: HTMLElement;
      constructor(options: { map: MapView; position: Point; title?: string }) {
        this.node = document.createElement('span'); this.node.textContent = options.title ?? '';
        if (options.title === 'Шофьор') this.node.dataset.testid = 'tracked-car';
        Object.assign(this.node.style, { position: 'absolute', top: '110px', left: '100px' });
        this.setPosition(options.position); this.setMap(options.map);
      }
      setPosition(point: Point) { this.node.dataset.lat = String(point.lat); this.node.dataset.lng = String(point.lng); }
      setIcon() {} setMap(map: MapView | null) { if (map) map.el.append(this.node); else this.node.remove(); }
    }
    Object.assign(window, { google: { maps: { Map: MapView, Marker, LatLngBounds: Bounds, Point, Size: Point,
      event: { clearInstanceListeners() {} } } } });
    let permission = 'prompt', latitude = 43.35, serial = 0;
    const watches = new Map<number, PositionCallback>();
    const position = () => ({ timestamp: Date.now(), coords: { latitude, longitude: 25.14, heading: 0,
      speed: 7, accuracy: 10, altitude: null, altitudeAccuracy: null } }) as GeolocationPosition;
    const count = () => { document.documentElement.dataset.gpsWatches = String(watches.size); };
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () =>
      Object.assign(new EventTarget(), { state: permission }) } });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: PositionCallback) => { permission = 'granted'; success(position()); },
      watchPosition: (success: PositionCallback) => { watches.set(++serial, success); count(); success(position()); return serial; },
      clearWatch: (id: number) => { watches.delete(id); count(); },
    } });
    window.addEventListener('synthetic-gps', event => {
      latitude = (event as CustomEvent<number>).detail; watches.forEach(callback => callback(position()));
    });
  });
}

async function socketHarness(page: Page) {
  const listeners: Array<{ ws: WebSocketRoute; topic: string; id: number; table: string }> = [];
  let id = 0;
  await page.routeWebSocket('**/realtime/v1/websocket*', ws => {
    ws.onMessage(message => {
      const packet = JSON.parse(String(message));
      if (packet.event === 'phx_join') {
        const changes = (packet.payload.config?.postgres_changes ?? []).map((filter: Record<string, string>) => {
          const subscription = { ...filter, id: ++id };
          listeners.push({ ws, topic: packet.topic, id, table: filter.table });
          return subscription;
        });
        ws.send(JSON.stringify({ ...packet, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: changes } } }));
      } else if (packet.event === 'heartbeat' || packet.event === 'phx_leave') {
        ws.send(JSON.stringify({ ...packet, event: 'phx_reply', payload: { status: 'ok', response: {} } }));
      }
    });
  });
  const send = (table: string, row: Record<string, unknown>) => listeners.filter(listener => listener.table === table)
    .forEach(({ ws, topic, id }) => ws.send(JSON.stringify({ topic, event: 'postgres_changes', payload: { ids: [id],
      data: { schema: 'public', table, type: 'UPDATE', commit_timestamp: row.updated_at, columns: [], record: row, old_record: {}, errors: null } } })));
  return {
    count: () => listeners.filter(listener => listener.table === 'driver_locations').length,
    requestCount: () => listeners.filter(listener => listener.table === 'taxi_requests').length,
    system: (status: string) => listeners.filter(listener => listener.table === 'driver_locations').forEach(({ ws, topic }) => ws.send(JSON.stringify({ topic, event: 'system',
      payload: { extension: 'postgres_changes', status } }))),
    fix: (row: Record<string, unknown>) => send('driver_locations', row),
    request: (row: Record<string, unknown>) => send('taxi_requests', row),
  };
}

test('customer tracks real socket fixes, survives route failure, reconciles lost events and expires stale GPS', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); state.rides = [ride()];
  await installDevice(page); const socket = await socketHarness(page); await page.clock.setFixedTime(Date.now());
  let row: Record<string, unknown> | null = null, reads = 0;
  await page.route('**/rest/v1/driver_locations?*', route => {
    reads++; return route.fulfill({ headers: cors, json: row ? [row] : [] });
  });
  await page.route('**/functions/v1/google-routes', route => route.fulfill({ headers: cors, status: 503, json: { error: 'synthetic route outage' } }));
  await page.route('**/roads/*.json', route => route.fulfill({ status: 503, body: '' }));
  await page.goto('/customer/home');
  await expect.poll(socket.count).toBeGreaterThan(0);
  const fix = async (lat: number) => ({ latitude: lat, longitude: 25.14, speed: 7, heading: 0, accuracy: 10,
    position_at: await page.evaluate(() => new Date().toISOString()), updated_at: await page.evaluate(() => new Date().toISOString()) });
  row = await fix(43.35); socket.fix(row);
  const car = page.getByTestId('tracked-car'); await expect(car).toBeVisible(); await expect(car).toHaveAttribute('data-lat', '43.35');
  await page.clock.setFixedTime(await page.evaluate(() => Date.now()) + 5000); row = await fix(43.351); socket.fix(row);
  await expect(car).toHaveAttribute('data-lat', '43.351');
  // The socket remains joined but its Postgres extension fails. HTTP must
  // resume at five seconds, not wait for a channel disconnect.
  socket.system('error'); await expect.poll(() => reads).toBeGreaterThan(1);
  await page.clock.setFixedTime(await page.evaluate(() => Date.now()) + 5000); row = await fix(43.352);
  await expect(car).toHaveAttribute('data-lat', '43.352', { timeout: 7500 });
  socket.system('ok'); await page.clock.setFixedTime(await page.evaluate(() => Date.now()) + 46_000);
  await expect(page.getByText('Позицията не се обновява', { exact: true })).toBeVisible();
  row = await fix(43.353); socket.fix(row); await expect(car).toHaveAttribute('data-lat', '43.353');
  await expect(page.getByText('Позицията не се обновява', { exact: true })).toHaveCount(0);
  row = null; await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(car).toHaveCount(0);
  expect(reads).toBeLessThan(18); expect(state.errors).toEqual([]);
});

test('Online grants GPS once, unavailable active ride keeps sharing, completion releases the watch', async ({ page }) => {
  const state = await setupUi(page, 'DRIVER'); await installDevice(page); const socket = await socketHarness(page);
  await page.addInitScript(id => localStorage.setItem('leski:auto-location:' + id, 'on'), uiAccount);
  await page.clock.setFixedTime(Date.now());
  let online = false, writes = 0;
  await page.route('**/rest/v1/drivers?*', async route => {
    if (route.request().method() === 'PATCH') online = route.request().postDataJSON().is_online;
    const row = { id: uiDriver, user_id: uiAccount, company_id: uiCompany, is_online: online, is_verified: true, status: online ? 'online' : 'offline', vehicle_id: null };
    return route.fulfill({ headers: cors, json: route.request().method() === 'PATCH' || new URL(route.request().url()).searchParams.has('user_id') ? row : [row] });
  });
  await page.route('**/rest/v1/driver_locations?*', async route => {
    if (route.request().method() === 'POST') writes++;
    return route.fulfill({ headers: cors, json: { updated_at: await page.evaluate(() => new Date().toISOString()) } });
  });
  await page.goto('/driver/home');
  await expect(page.getByRole('button', { name: 'Включи онлайн', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Настройки за бисквитки' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Включи онлайн', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-gps-watches', '1');
  await expect.poll(socket.requestCount).toBeGreaterThan(0);
  state.rides = [ride()]; socket.request(state.rides[0]);
  await expect(page.getByText('В курс', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Излез офлайн', exact: true }).click();
  await expect(page.getByText('Не приемаш нови заявки. GPS остава включен за текущия курс до приключването му.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-gps-watches', '1');
  const before = writes; await page.clock.setFixedTime(await page.evaluate(() => Date.now()) + 5100);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('synthetic-gps', { detail: 43.351 })));
  await expect.poll(() => writes).toBeGreaterThan(before);
  state.rides[0].status = 'completed'; socket.request(state.rides[0]);
  await expect(page.locator('html')).toHaveAttribute('data-gps-watches', '0');
  const stopped = writes; await page.clock.setFixedTime(await page.evaluate(() => Date.now()) + 30_000);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('synthetic-gps', { detail: 43.352 }))); expect(writes).toBe(stopped);
  expect(state.errors).toEqual([]);
});

test('a completed trip aborts its pending customer context route', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); state.rides = [ride()];
  await installDevice(page); const socket = await socketHarness(page);
  let calls = 0, aborted = 0, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  page.on('requestfailed', request => { if (request.url().endsWith('/google-routes')) aborted++; });
  await page.route('**/functions/v1/google-routes', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers: cors, status: 204 });
    calls++; await waiting;
    await route.fulfill({ headers: cors, json: { success: false } }).catch(() => {});
  });
  try {
    await page.goto('/customer/home');
    await expect.poll(() => calls).toBe(1); await expect.poll(socket.requestCount).toBeGreaterThan(0);
    state.rides[0].status = 'completed'; socket.request(state.rides[0]);
    await expect.poll(() => aborted).toBe(1);
    expect(state.errors).toEqual([]);
  } finally { release(); }
});

test('a remembered driver restores GPS without a permission query, across reloads, until Settings turns it off',async({page})=>{
 const state=await setupUi(page,'DRIVER','aal2','on');await installDevice(page);await socketHarness(page);
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>{throw new Error('Synthetic unsupported permission query');}}});
 });
 let online=true,writes=0,availabilityWrites=0;
 await page.route('**/rest/v1/drivers?*',async route=>{
  if(route.request().method()==='PATCH'){availabilityWrites++;online=route.request().postDataJSON().is_online;}
  const row={id:uiDriver,user_id:uiAccount,company_id:uiCompany,is_online:online,is_verified:true,status:online?'online':'offline',vehicle_id:null};
  await route.fulfill({headers:cors,json:route.request().method()==='PATCH'||new URL(route.request().url()).searchParams.has('user_id')?row:[row]});
 });
 await page.route('**/rest/v1/driver_locations?*',async route=>{
  if(route.request().method()==='POST')writes++;
  await route.fulfill({headers:cors,json:{updated_at:await page.evaluate(()=>new Date().toISOString())}});
 });
 await page.goto('/driver/home');await expect(page.locator('html')).toHaveAttribute('data-gps-watches','1');
 await expect.poll(()=>writes).toBeGreaterThan(0);
 const first=writes;await page.reload();await expect(page.locator('html')).toHaveAttribute('data-gps-watches','1');
 await expect.poll(()=>writes).toBeGreaterThan(first);expect(availabilityWrites).toBe(0);
 await page.goto('/driver/profile');const toggle=page.getByRole('switch',{name:'Използвай местоположението автоматично',exact:true});
 await expect(toggle).toBeChecked();await toggle.click();await expect(toggle).not.toBeChecked();
 await expect(page.locator('html')).toHaveAttribute('data-gps-watches','0');await expect.poll(()=>availabilityWrites).toBe(1);
 const stopped=writes;await page.reload();await expect(toggle).not.toBeChecked();
 expect(writes).toBe(stopped);expect(state.errors).toEqual([]);
});
