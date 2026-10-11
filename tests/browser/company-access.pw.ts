import { test, expect, type Page } from '@playwright/test';

const account = '11111111-1111-4111-8111-111111111111';
const ownCompany = '22222222-2222-4222-8222-222222222222';
const company = (id: string, name: string) => ({ id, name, is_active: true, currency: 'EUR',
  base_fare: 2, price_per_km: 1, price_per_minute: 0.2, dispatch_radius_km: 5,
  created_at: '2026-10-11T09:00:00Z', drivers: [{ count: 0 }] });

async function setup(page: Page, role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'CUSTOMER') {
  const user = { id: account, email: 'synthetic-admin@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'google' } };
  const state = { companies: [company(ownCompany, 'Първа фирма')], profileWrites: 0, companyWrites: 0, companyFilters: [] as (string | null)[], errors: [] as string[], google: 0 };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(user => {
    const token = [btoa(JSON.stringify({ alg: 'HS256' })), btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })), 'synthetic'].join('.');
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
    localStorage.setItem('i18nextLng', 'bg');
    const savedAt = Date.now(); localStorage.setItem('lk_cookie_consent_v3', JSON.stringify({ version: 3, savedAt, expiresAt: savedAt + 180 * 86400000, consent: { necessary: true, functional: true, analytics: false, marketing: false } }));
  }, user);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4100') return route.continue();
    if (url.origin !== 'http://127.0.0.1:54329') {
      if (/maps\.google|maps\.googleapis|places\.googleapis|routes\.googleapis/.test(url.hostname)) state.google++;
      return route.abort();
    }
    let data: unknown = [];
    if (url.pathname.endsWith('/auth/v1/user')) data = user;
    else if (url.pathname.endsWith('/profiles')) {
      if (request.method() !== 'GET') state.profileWrites++;
      data = { id: account, email: user.email, first_name: 'Тест', last_name: 'Админ', role, company_id: role === 'COMPANY_ADMIN' ? ownCompany : null, is_active: true };
    } else if (url.pathname.endsWith('/companies')) {
      if (request.method() === 'POST') {
        state.companyWrites++; const payload = request.postDataJSON();
        state.companies.unshift({ ...company(payload.id, payload.name), ...payload });
        data = { id: payload.id };
      } else {
        const filter = url.searchParams.get('id'); state.companyFilters.push(filter);
        data = filter ? state.companies.filter(c => 'eq.' + c.id === filter) : state.companies;
      }
    } else if (url.pathname.endsWith('/legal_acceptances')) data = { id: account };
    else if (url.pathname.endsWith('/company_dashboard')) data = {
      stats: { totalDrivers: 0, onlineDrivers: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, totalRevenue: 0 },
      days: Array.from({ length: 7 }, (_, i) => ({ day: '2026-10-' + String(i + 1).padStart(2, '0'), orders: 0, revenue: 0 })),
    };
    else if (url.pathname.endsWith('/operational_health')) data = { checked_at: new Date().toISOString(), stale_online_drivers: 0, flagged_rides_24h: 0, oldest_push_seconds: 0, metrics: [], route_budget: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
  });
  return state;
}

test('super admin creates a company without changing identity or the selected firm', async ({ page }) => {
  const state = await setup(page, 'SUPER_ADMIN');
  await page.goto('/app');
  await expect(page).toHaveURL(/\/admin\/companies$/);
  await expect(page.getByRole('heading', { name: 'Супер администратор' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Добави фирма', exact: true }).click();
  await page.getByPlaceholder('Напр. Лески Каручка').fill('Нова фирма');
  await page.getByPlaceholder('info@...').fill('synthetic-admin@example.invalid');
  await page.getByRole('button', { name: 'Добави фирма', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Управлявай Нова фирма' })).toBeEnabled();
  await expect(page.getByText('Управление на платформата', { exact: true })).toHaveCount(1);
  await expect(page).toHaveURL(/\/admin\/companies$/);
  await page.goto('/admin/dashboard');
  await expect(page.getByLabel('Управлявана фирма')).toHaveValue(ownCompany);
  const added = state.companies.find(c => c.name === 'Нова фирма')!;
  await page.getByLabel('Управлявана фирма').selectOption(added.id);
  await page.reload();
  await expect(page.getByLabel('Управлявана фирма')).toHaveValue(added.id);
  await expect(page.getByRole('heading', { name: 'Супер администратор' })).toHaveCount(1);
  await page.goto('/admin/companies');
  await page.getByRole('button', { name: 'Управлявай Първа фирма' }).click();
  await expect(page.getByLabel('Управлявана фирма')).toHaveValue(ownCompany);
  expect(state.companyWrites).toBe(1); expect(state.profileWrites).toBe(0);
  expect(state.errors).toEqual([]); expect(state.google).toBe(0);
});

test('company entry uses the assigned firm and shows only company navigation', async ({ page }) => {
  const state = await setup(page, 'COMPANY_ADMIN');
  await page.goto('/company/login');
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Фирмен панел' })).toHaveCount(1);
  await expect(page.getByLabel('Управлявана фирма')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Фирми', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Новини', exact: true })).toHaveCount(0);
  await page.goto('/admin/companies');
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goto('/');
  await expect(page.locator('a[href="/admin/dashboard"]').first()).toBeAttached();
  expect(state.companyFilters.length).toBeGreaterThan(0);
  expect(state.companyFilters.every(filter => filter === 'eq.' + ownCompany)).toBe(true);
  expect(state.profileWrites).toBe(0); expect(state.companyWrites).toBe(0);
  expect(state.errors).toEqual([]); expect(state.google).toBe(0);
});

test('company login does not turn an unassigned customer into a company administrator', async ({ page }) => {
  const state = await setup(page, 'CUSTOMER');
  await page.goto('/company/login');
  await expect(page).toHaveURL(/\/company$/);
  await expect(page.getByText(/За този профил още няма предоставен достъп до фирма/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Към моя профил' })).toHaveAttribute('href', '/customer/home');
  expect(state.companyFilters).toHaveLength(0);
  expect(state.profileWrites).toBe(0); expect(state.companyWrites).toBe(0);
  expect(state.errors).toEqual([]); expect(state.google).toBe(0);
});
