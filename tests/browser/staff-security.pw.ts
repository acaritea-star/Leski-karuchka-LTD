import { test, expect } from '@playwright/test';
import { setupUi, uiAccount } from './helpers/uiFixture';

const factorId = '88888888-8888-4888-8888-888888888888';
const challengeId = '99999999-9999-4999-8999-999999999999';
const verifiedFactor = { id: factorId, factor_type: 'totp', status: 'verified', friendly_name: 'Основно приложение', created_at: '2026-10-16T07:00:00Z', updated_at: '2026-10-16T07:00:00Z' };

for (const role of ['SUPER_ADMIN', 'COMPANY_ADMIN', 'DRIVER'] as const) test(`${role} cannot mount staff screens before a successful second factor`, async ({ page }) => {
  const state = await setupUi(page, role, 'aal1');
  let attempts = 0, protectedReads = 0;
  page.on('request', request => { if (/\/rpc\/accounting_report|\/companies\?/.test(request.url())) protectedReads++; });
  const user = { id: uiAccount, email: state.profile.email, aud: 'authenticated', role: 'authenticated', factors: [verifiedFactor], app_metadata: { provider: 'google' }, user_metadata: {} };
  await page.route('**/auth/v1/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    let data: unknown = user, status = 200;
    if (path.endsWith('/challenge')) data = { id: challengeId, expires_at: Math.floor(Date.now() / 1000) + 60 };
    if (path.endsWith('/verify')) {
      attempts++;
      if (attempts === 1) { status = 400; data = { code: 400, error_code: 'mfa_verification_failed', msg: 'Invalid code' }; }
      else {
        const token = [Buffer.from('{"alg":"HS256"}').toString('base64'), Buffer.from(JSON.stringify({ sub: uiAccount, role: 'authenticated', aal: 'aal2', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64'), 'synthetic'].join('.');
        data = { access_token: token, refresh_token: 'synthetic-mfa', expires_in: 3600, token_type: 'bearer', user };
      }
    }
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  });
  const path = role === 'DRIVER' ? '/driver/earnings' : '/admin/analytics';
  await page.goto(path); const code = page.getByRole('textbox', { name: 'Шестцифрен код', exact: true });
  await expect(code).toBeVisible(); expect(protectedReads).toBe(0);
  await code.fill('123456'); await page.getByRole('button', { name: 'Потвърди входа', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible(); expect(protectedReads).toBe(0);
  await code.fill('654321'); await page.getByRole('button', { name: 'Потвърди входа', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Остатък по въведените сметки' })).toBeVisible();
  expect(attempts).toBe(2); expect(protectedReads).toBeGreaterThan(0); expect(state.errors).toEqual([]);
});

test('first-time staff setup is explicit, supports the same phone and does not persist the secret', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'DRIVER', 'aal1'); let enrollments = 0;
  const user = { id: uiAccount, email: state.profile.email, aud: 'authenticated', role: 'authenticated', factors: [], user_metadata: {}, app_metadata: { provider: 'google' } };
  await page.route('**/auth/v1/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    let data: unknown = user;
    if (new URL(route.request().url()).pathname.endsWith('/factors')) {
      enrollments++; data = { id: factorId, type: 'totp', friendly_name: 'Test', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/></svg>', secret: 'ONLYSYNTHETICTESTKEY' } };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  });
  await page.goto('/driver/earnings'); await expect(page.getByRole('button', { name: 'Настрой двуфакторен вход', exact: true })).toBeVisible();
  expect(enrollments).toBe(0); await page.getByRole('button', { name: 'Настрой двуфакторен вход', exact: true }).click();
  await expect(page.getByRole('img', { name: 'QR код за приложението за удостоверяване' })).toBeVisible();
  await page.getByText('Покажи ключа за ръчно въвеждане', { exact: true }).click();
  await expect(page.getByText('ONLYSYNTHETICTESTKEY', { exact: true })).toBeVisible(); expect(enrollments).toBe(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage).includes('ONLYSYNTHETICTESTKEY'))).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('staff-mfa-setup.png') });
  expect(state.errors).toEqual([]);
});

test('customer keeps first-factor login and emergency access stays visible without dialing', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'CUSTOMER', 'aal1'); let mfaRequests = 0;
  page.on('request', request => { if (/\/auth\/v1\/(factors|user)/.test(request.url())) mfaRequests++; });
  for (const path of ['/customer/home', '/customer/orders', '/customer/profile', '/customer/settings']) {
    await page.goto(path); await page.setViewportSize({ width: 320, height: 568 });
    const help = page.getByRole('button', { name: 'Спешна помощ на 112', exact: true });
    await expect(help).toBeVisible(); await expect(help).toBeInViewport();
    const bounds = await help.boundingBox(); expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await help.click(); const dialog = page.getByRole('dialog', { name: 'Спешна помощ', exact: true });
    await expect(dialog.getByRole('link', { name: 'Обади се на 112', exact: true })).toHaveAttribute('href', 'tel:112');
    // Never activate a real emergency dialer in automated tests.
    await dialog.getByRole('button', { name: 'Назад към приложението', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(help).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('customer-emergency-access.png') });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Emergency help on 112', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Call 112', exact: true })).toHaveAttribute('href', 'tel:112');
  await page.getByRole('button', { name: 'Back to the app', exact: true }).click();
  expect(mfaRequests).toBe(0); expect(state.errors).toEqual([]);
});

test('customer emergency dialing stays reachable while the profile service is offline', async ({ page }) => {
  await setupUi(page, 'CUSTOMER', 'aal1');
  await page.route('**/rest/v1/profiles*', route => route.abort());
  await page.goto('/customer/home');
  const help = page.getByRole('button', { name: 'Спешна помощ на 112', exact: true });
  await expect(help).toBeVisible(); await help.click();
  await expect(page.getByRole('link', { name: 'Обади се на 112', exact: true })).toHaveAttribute('href', 'tel:112');
  await page.getByRole('button', { name: 'Назад към приложението', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Профилът не е достъпен');
  await expect(help).toBeVisible();
});
