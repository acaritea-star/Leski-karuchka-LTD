import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { setupUi, uiAccount, uiCompany } from './helpers/uiFixture';

const noticeId = (n: number) => '60000000-0000-4000-8000-' + String(n).padStart(12, '0');
async function realtime(page: Page) {
  const joined: string[] = [];
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket('**/realtime/v1/websocket**', ws => {
    sockets.push(ws);
    ws.onMessage(message => {
      const input = JSON.parse(String(message));
      if (input.event === 'phx_join') joined.push(input.topic);
      ws.send(JSON.stringify({ topic: input.topic, event: 'phx_reply', ref: input.ref, join_ref: input.join_ref,
        payload: { status: 'ok', response: { postgres_changes: (input.payload?.config?.postgres_changes ?? []).map((x: object, i: number) => ({ ...x, id: i + 1 })) } } }));
    });
  });
  return { joined, hint: (audience: string, id: string) => sockets.forEach(ws => ws.send(JSON.stringify({ topic: `realtime:inbox:${uiAccount}:${audience}`, event: 'broadcast', payload: { event: 'inbox_changed', payload: { id, is_new: true, type: 'arrived', priority: 'urgent' } } }))) };
}

for (const role of ['CUSTOMER', 'DRIVER', 'COMPANY_ADMIN'] as const) {
  test(`${role} inbox loads history only on demand, paginates and opens its own destination`, async ({ page }) => {
    const state = await setupUi(page, role); const socket = await realtime(page);
    const audience = role === 'CUSTOMER' ? 'customer' : role === 'DRIVER' ? 'driver' : 'company';
    const target = role === 'CUSTOMER' ? '/customer/orders' : role === 'DRIVER' ? '/driver/profile' : '/admin/drivers';
    state.notices = Array.from({ length: 25 }, (_, i) => ({ id: noticeId(i), user_id: uiAccount, company_id: uiCompany, audience,
      type: 'document_approved', title: `${audience} известие ${i}`, message: 'Синтетично известие', is_read: false,
      created_at: new Date(Date.now() - i * 1000).toISOString(), priority: 'normal', expires_at: null, target }));
    await page.goto(role === 'CUSTOMER' ? '/customer/home' : role === 'DRIVER' ? '/driver/home' : '/admin/dashboard');
    const bell = page.getByRole('button', { name: 'Известия', exact: true }); await expect(bell).toBeVisible();
    await expect.poll(() => socket.joined.some(topic => topic.endsWith(`inbox:${uiAccount}:${audience}`))).toBe(true);
    expect(state.notificationPageReads).toBe(0);
    await bell.click(); const panel = page.getByRole('dialog', { name: 'Известия', exact: true });
    await expect(panel.getByRole('listitem')).toHaveCount(20);
    await panel.getByRole('button', { name: 'По-стари известия' }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(25);
    await panel.getByRole('button', { name: new RegExp(`${audience} известие 0`) }).first().click();
    await expect(page).toHaveURL(new RegExp(target + '$'));
    expect(state.notificationOpens).toEqual([noticeId(0)]);
    expect(state.notices[0].is_read).toBe(true); expect(state.errors).toEqual([]);
  });
}

test('a closed inbox pauses hidden checks and recovers missed events without loading history', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); const socket = await realtime(page);
  await page.goto('/customer/home');
  await expect(page.getByRole('button', { name: 'Известия', exact: true })).toBeVisible();
  await expect.poll(() => socket.joined.some(x => x.endsWith(':customer'))).toBe(true);
  await expect.poll(() => state.notificationStateReads).toBeGreaterThanOrEqual(2);
  expect(state.notificationPageReads).toBe(0);
  await page.clock.install();
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  const beforeHidden = state.notificationStateReads;
  await page.clock.runFor(300_000); expect(state.notificationStateReads).toBe(beforeHidden);
  state.notices = [{ id: noticeId(99), title: 'Възстановено известие', message: 'Synthetic', is_read: false, audience: 'customer', created_at: new Date().toISOString() }];
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.resume();
  await expect(page.getByRole('button', { name: 'Известия', exact: true })).toContainText('1');
  socket.hint('customer', noticeId(99));
  await expect(page.getByRole('button', { name: 'Известия', exact: true })).toContainText('1');
  await page.getByRole('button', { name: 'Известия', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Възстановено известие')).toBeVisible();
  expect(state.notificationPageReads).toBe(1); expect(state.errors).toEqual([]);
});

test('notification opt-in survives ten reloads and logout; a settings opt-out stays off', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); await realtime(page);
  await page.addInitScript(() => {
    const store = localStorage;
    const subscription = { endpoint: 'https://fcm.googleapis.com/synthetic-device',
      unsubscribe: async () => { store.removeItem('test:subscription'); return true; },
      toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: 'synthetic', auth: 'synthetic' } }) };
    const registration = { pushManager: {
      getSubscription: async () => store.getItem('test:subscription') ? subscription : null,
      subscribe: async () => { store.setItem('test:subscription', 'true'); return subscription; },
    } };
    const notifications = { get permission() { return store.getItem('test:permission') ?? 'default'; }, requestPermission: async () => {
      store.setItem('test:permission-calls', String(Number(store.getItem('test:permission-calls') ?? 0) + 1));
      store.setItem('test:permission', 'granted'); return 'granted';
    } };
    Object.defineProperty(window, 'Notification', { configurable: true, value: notifications });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: {} });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      register: async () => registration, ready: Promise.resolve(registration), getRegistration: async () => registration,
    } });
  });
  await page.goto('/customer/settings');
  const toggle = page.getByRole('switch', { name: 'Известия', exact: true }); await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('test:permission-calls'))).toBeNull();
  await toggle.click(); await expect(toggle).toBeChecked();
  for (let i = 0; i < 10; i++) { await page.reload(); await expect(toggle).toBeChecked(); }
  expect(await page.evaluate(() => localStorage.getItem('test:permission-calls'))).toBe('1');
  await page.goto('/customer/home');
  await page.getByRole('button', { name: /меню/i }).click();
  const landingRead = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/news_articles') && response.request().method() === 'GET')
    .then(async response => { expect(response.ok()).toBe(true); expect(await response.finished()).toBeNull(); });
  await page.getByRole('button', { name: 'Изход', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  // Finish WebKit's synthetic cross-origin response before replacing the document.
  await landingRead;
  expect(await page.evaluate(() => localStorage.getItem('sb-127-auth-token'))).toBeNull();
  expect(await page.evaluate(id => localStorage.getItem('leski_push_enabled:' + id), uiAccount)).toBe('true');
  // The fixture restores a fresh authenticated session on the next navigation.
  await page.goto('/customer/settings'); await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('test:permission-calls'))).toBe('1');
  await toggle.click(); await expect(toggle).not.toBeChecked(); await page.reload(); await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(id => localStorage.getItem('leski_push_enabled:' + id), uiAccount)).toBe('false');
  expect(await page.evaluate(() => localStorage.getItem('test:permission-calls'))).toBe('1');
  expect(state.pushDeletes).toBe(2); expect(state.errors).toEqual([]);
});

test('an account cannot open another account notification or follow its supplied destination', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); await realtime(page);
  await page.goto('/notifications/open?id=' + noticeId(404));
  await expect(page.getByRole('alert')).toContainText('Известието не е достъпно');
  expect(page.url()).toContain('/notifications/open'); expect(state.errors).toEqual([]);
});
