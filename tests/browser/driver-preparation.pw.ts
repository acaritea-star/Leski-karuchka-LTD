import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const documentSource = readFileSync('src/config/driverPreparation.json', 'utf8');
const document = JSON.parse(documentSource);
const contentHash = createHash('sha256').update(documentSource).digest('hex');
const driver = '33333333-3333-4333-8333-333333333333', account = '11111111-1111-4111-8111-111111111111', company = '22222222-2222-4222-8222-222222222222';

test('driver completes training with one explicit acceptance and recovers a lost response without a duplicate receipt', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let receipt: Record<string, string> | null = null, attempts = 0;
  const user = { id: account, email: 'synthetic@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'google' } };
  await page.addInitScript(user => {
    const token = [btoa(JSON.stringify({ alg: 'HS256' })), btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })), 'synthetic'].join('.');
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
    localStorage.setItem('i18nextLng', 'bg');
    const savedAt = Date.now(); localStorage.setItem('lk_cookie_consent_v3', JSON.stringify({ version: 3, savedAt, expiresAt: savedAt + 180 * 86400000, consent: { necessary: true, functional: true, analytics: false, marketing: false } }));
  }, user);
  // This test cannot issue requests to Google or any real backend.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4100') return route.continue();
    if (url.origin !== 'http://127.0.0.1:54329') return route.abort();
    let data: unknown = [];
    if (url.pathname.endsWith('/auth/v1/user')) data = user;
    else if (url.pathname.endsWith('/profiles')) data = { id: account, role: 'DRIVER', company_id: company, is_active: true, first_name: 'Тест', last_name: 'Водач', email: user.email };
    else if (url.pathname.endsWith('/drivers')) data = { id: driver, user_id: account, company_id: company, is_verified: false, is_online: false, vehicle_id: null };
    else if (url.pathname.endsWith('/companies')) data = [{ id: company, is_active: true, name: 'Тестова фирма' }];
    else if (url.pathname.endsWith('/driver_preparation_materials')) data = { driver_id: driver, document, content_hash: contentHash, receipt };
    else if (url.pathname.endsWith('/accept_driver_preparation')) {
      attempts++;
      const body = route.request().postDataJSON();
      expect(body.p_driver).toBe(driver); expect(body.p_hash).toBe(contentHash);
      expect(body.p_general_terms).toBe('2026-10-08-draft.3'); expect(body.p_general_privacy).toBe('2026-10-08.1');
      if (body.p_answers.cash !== 'reconcile') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '22023', message: 'Прегледай обучението и трите отговора. Не всички са верни.' }), headers: { 'access-control-allow-origin': '*' } });
      receipt = { id: '44444444-4444-4444-8444-444444444444', driver_id: driver, user_id: account, company_id: company, terms_version: document.termsVersion, training_version: document.trainingVersion, content_hash: contentHash, accepted_at: '2026-10-09T19:00:00Z', training_completed_at: '2026-10-09T19:00:00Z' };
      // Simulates a committed write whose response was lost. The subsequent
      // authoritative GET must discover the same receipt, with no second POST.
      return route.abort();
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/driver/preparation');
  await expect(page.getByRole('heading', { name: 'Подготовка за шофьори' })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Продължи', exact: true }).click();
  await page.getByRole('button', { name: 'Към кратката проверка' }).click();
  const accept = page.getByRole('button', { name: 'Приеми условията и завърши подготовката' });
  await expect(accept).toBeDisabled();
  await page.getByRole('radio', { name: 'Не. Държа приложението отворено и проверявам връзката и GPS.' }).check();
  await page.getByRole('radio', { name: 'Да, отчетът е доказана каса.' }).check();
  await page.getByRole('radio', { name: 'Действителният превозвач и водачът; платформата има свои задължения по закон.' }).check();
  await accept.click();
  await expect(page.getByRole('alert')).toContainText('Не всички са верни.');
  await expect(page.getByRole('radio', { name: 'Не. Държа приложението отворено и проверявам връзката и GPS.' })).toBeChecked();
  await page.getByRole('radio', { name: 'Не. Записвам реалното плащане и го сверявам с документите.' }).check();
  for (const size of [{ width: 320, height: 568 }, { width: 720, height: 390 }]) {
    await page.setViewportSize(size); await accept.scrollIntoViewIfNeeded(); await expect(accept).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await accept.click();
  await expect(page.getByRole('heading', { name: 'Подготовката е завършена' })).toBeVisible();
  expect(attempts).toBe(2);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Изтегли условията и записа за приемане' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('leski-driver-' + document.termsVersion + '.txt');
  await page.reload(); await expect(page.getByRole('heading', { name: 'Подготовката е завършена' })).toBeVisible();
  expect(attempts).toBe(2); expect(errors).toEqual([]);
});

test('an unauthenticated visitor cannot open the driver training or request its materials', async ({ page }) => {
  let materials = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/driver_preparation_materials')) materials++;
    if (url.origin === 'http://127.0.0.1:4100') return route.continue();
    return route.abort();
  });
  await page.goto('/driver/preparation');
  await expect(page).toHaveURL('http://127.0.0.1:4100/');
  expect(materials).toBe(0);
  await expect(page.getByRole('heading', { name: 'Подготовка за шофьори' })).toHaveCount(0);
});
