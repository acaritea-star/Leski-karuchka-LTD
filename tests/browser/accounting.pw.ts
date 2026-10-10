import { test, expect } from '@playwright/test';
import { accountingFixture, addUnpaidRide, entryFixture, financeIds } from '../fixtures/accounting';

test('driver records actual payment once after a lost response and downloads one complete financial snapshot', async ({ page }) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 const report = addUnpaidRide(accountingFixture()); let writes = 0, exports = 0;
 const user = { id: financeIds.account, email: 'synthetic@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'google' } };
 await page.addInitScript(user => {
  const token = [btoa(JSON.stringify({ alg: 'HS256' })), btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })), 'synthetic'].join('.');
  localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
  localStorage.setItem('i18nextLng', 'bg');
  const savedAt = Date.now(); localStorage.setItem('lk_cookie_consent_v3', JSON.stringify({ version: 3, savedAt, expiresAt: savedAt + 180 * 86400000, consent: { necessary: true, functional: true, analytics: false, marketing: false } }));
 }, user);
 await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === 'http://127.0.0.1:4100') return route.continue();
  if (url.origin !== 'http://127.0.0.1:54329') return route.abort(); // No Google or live backend.
  let data: unknown = [];
  if (url.pathname.endsWith('/auth/v1/user')) data = user;
  else if (url.pathname.endsWith('/profiles')) data = { id: user.id, role: 'DRIVER', company_id: financeIds.company, is_active: true, first_name: 'Тест', last_name: 'Водач', email: user.email };
  else if (url.pathname.endsWith('/drivers')) data = { id: financeIds.driver, user_id: user.id, company_id: financeIds.company, is_verified: true, is_online: false, vehicle_id: null };
  else if (url.pathname.endsWith('/accounting_report') || url.pathname.endsWith('/accounting_export')) {
   const body = route.request().postDataJSON();
   expect(body.p_driver_id).toBe(financeIds.driver);
   report.period.from = body.p_from; report.period.until = body.p_until;
   if (url.pathname.endsWith('/accounting_export')) exports++;
   data = report;
  } else if (url.pathname.endsWith('/record_driver_money_verified')) {
   writes++; const body = route.request().postDataJSON();
   expect(body.p_actor).toBe(user.id); expect(body.p_amount).toBe(11.11); expect(body.p_request_id).toBe(financeIds.request);
   report.entries = [{ ...entryFixture(), id: body.p_id, amount: 11.11, signed_amount: 11.11, balance_delta: 11.11, note: body.p_note }]; report.entry_count = 1;
   report.finances.income = 11.11; report.finances.net_income = 11.11;
   report.balance.movement = 11.11; report.balance.closing = 11.11; report.balance.unconfirmed_income = 11.11;
   report.totals.unreported_completed = 0;
   report.reconciliation[0] = { ...report.reconciliation[0], declared_income: 11.11, income_recorded_at: report.entries[0].recorded_at, difference: -1.23 };
   return route.abort(); // Commit succeeded; response was lost.
  } else if (url.pathname.endsWith('/driver_money_entries')) data = report.entries[0] ? { id: report.entries[0].id, actor_id: user.id } : null;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
 });
 await page.goto('/driver/earnings');
 await page.getByRole('button', { name: 'Отчети плащането', exact: true }).click();
 await expect(page.getByLabel('Сума в евро')).toHaveValue('12.34');
 expect(writes).toBe(0);
 await page.getByLabel('Сума в евро').fill('11,11');
 await page.getByRole('button', { name: 'Добави запис', exact: true }).click();
 await expect(page.getByText('Записът е запазен.', { exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Отчети плащането', exact: true })).toHaveCount(0);
 expect(writes).toBe(1);
 await expect(page.getByText(/Разлика спрямо заявката: -1.23/)).toBeVisible();
 for (const size of [{ width: 320, height: 568 }, { width: 720, height: 390 }]) {
  await page.setViewportSize(size);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 }
 const downloadPromise = page.waitForEvent('download');
 await page.getByRole('button', { name: 'Изтегли CSV', exact: true }).click();
 const download = await downloadPromise; expect(download.suggestedFilename()).toMatch(/^leski-report-\d{4}-\d{2}\.csv$/);
 const stream = await download.createReadStream(); const chunks: Buffer[] = [];
 if (!stream) throw Error('Missing financial download');
 for await (const chunk of stream) chunks.push(Buffer.from(chunk));
 const csv = Buffer.concat(chunks).toString('utf8');
 expect(csv).toContain('Краен остатък по записите'); expect(csv).toContain('11.11'); expect(csv).toContain('12.34');
 expect(csv).toContain('Движение на остатъка EUR'); expect(exports).toBe(1);
 await page.reload(); await expect(page.getByRole('heading', { name: 'Остатък по въведените сметки' })).toBeVisible();
 expect(writes).toBe(1); expect(errors).toEqual([]);
});
