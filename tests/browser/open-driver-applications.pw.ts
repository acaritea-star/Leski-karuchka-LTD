import { test, expect } from '@playwright/test';
import { setupUi, uiAccount, uiCompany } from './helpers/uiFixture';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = readFileSync('src/config/driverPreparation.json', 'utf8');
const preparation = { document: JSON.parse(source), content_hash: createHash('sha256').update(source).digest('hex'), receipt: null };

for (const closes of ['never', 'selection', 'submission'] as const) test(`open candidacy ${closes === 'never' ? 'keeps the candidate unprivileged and resumes preparation' : 'rechecks a firm closed at ' + closes}`, async ({ page }, testInfo) => {
  const state = await setupUi(page, 'CUSTOMER');
  const application = '33333333-3333-4333-8333-333333333333';
  let a: Record<string, unknown> | null = null, starts = 0, selections = 0, profileWrites = 0, companyReads = 0;
  const firm = { id: uiCompany, name: 'Лески Каручка', service_city: 'Левски', currency: 'EUR', base_fare: 2, min_fare: 4, price_per_km: 1.2, price_per_minute: 0.2 };
  const access = () => ({ status: 'preparation', destination: '/driver/access', role: 'CUSTOMER', company_id: uiCompany, company_name: firm.name, application_id: a?.id });
  await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url()); let data: unknown;
    if (route.request().method() === 'OPTIONS') return route.fallback();
    if (url.pathname.endsWith('/resolve_partner_access')) data = a ? access() : { status: 'denied', reason: 'invitation_required', message: 'Няма валидна покана за този акаунт.' };
    else if (url.pathname.endsWith('/companies') && url.searchParams.has('accepts_driver_applications')) {
      companyReads++; expect(url.searchParams.get('is_active')).toBe('eq.true'); expect(url.searchParams.get('limit')).toBe('50'); data = closes === 'selection' && selections > 0 || closes === 'submission' && starts > 0 ? [] : [firm];
    } else if (url.pathname.endsWith('/open_driver_access')) {
      selections++; expect(route.request().postDataJSON().p_company).toBe(uiCompany);
      if (closes === 'selection') return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: '42501', message: 'Фирмата в момента не приема отворени кандидатури.' }) });
      data = access();
    } else if (url.pathname.endsWith('/begin_driver_onboarding')) {
      starts++; const command = route.request().postDataJSON(); expect(command.p_company).toBe(uiCompany);
      if (closes === 'submission') return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: '42501', message: 'Фирмата в момента не приема отворени кандидатури.' }) });
      a = { id: application, user_id: uiAccount, company_id: uiCompany, full_name: command.p_full_name, phone: command.p_phone, experience: command.p_experience, has_vehicle: false, onboarding_required: true, onboarding_revision: 1, status: 'pending', submitted_at: null };
      data = application;
    } else if (url.pathname.endsWith('/driver_onboarding')) data = { application: a, company_name: firm.name, documents: [], preparation };
    else { if (url.pathname.endsWith('/profiles') && route.request().method() !== 'GET') profileWrites++; return route.fallback(); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  });
  await page.goto('/driver/access');
  await expect(page.getByRole('button', { name: 'Кандидатствай към Лески Каручка' })).toBeVisible();
  expect(starts).toBe(0); expect(profileWrites).toBe(0);
  if (closes === 'never') {
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('open-candidacy-320.png'), fullPage: true });
  }
  await page.getByRole('button', { name: 'Кандидатствай към Лески Каручка' }).click();
  if (closes === 'selection') {
    await expect(page.getByText('В момента няма фирми с отворено кандидатстване.', { exact: false })).toBeVisible();
    expect(starts).toBe(0);
  } else {
    await expect(page.getByRole('heading', { name: 'Добре дошъл!' })).toBeVisible();
    await page.locator('select[name=experience]').selectOption('1–3');
    await page.getByRole('button', { name: 'Запази и продължи към обучението' }).click();
    await expect.poll(() => starts).toBe(1);
    if (closes === 'submission') {
      await expect(page.getByRole('alert')).toContainText('не приема');
      await page.getByRole('button', { name: 'Към избора на фирма' }).click();
      await expect(page.getByText('В момента няма фирми с отворено кандидатстване.', { exact: false })).toBeVisible();
    } else {
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Твоят шофьорски профил' })).toBeVisible();
    }
    expect(selections).toBe(1);
  }
  expect(profileWrites).toBe(0); expect(state.errors).toEqual([]);
  expect(companyReads).toBeGreaterThan(0);
});
