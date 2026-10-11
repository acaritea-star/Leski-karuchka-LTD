import { test, expect, type Page } from '@playwright/test';

const account = '11111111-1111-4111-8111-111111111111';
const ownCompany = '22222222-2222-4222-8222-222222222222';
const company = (id: string, name: string) => ({ id, name, is_active: true, currency: 'EUR',
  base_fare: 2, price_per_km: 1, price_per_minute: 0.2, dispatch_radius_km: 5,
  updated_at: '2026-10-11T09:00:00Z', created_at: '2026-10-11T09:00:00Z', setup_completed_at: '2026-10-11T09:00:00Z', drivers: [{ count: 0 }] });

async function setup(page: Page, role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'CUSTOMER') {
  const user = { id: account, email: 'synthetic-admin@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'google' } };
  const state = { companies: [company(ownCompany, 'Първа фирма')], profileWrites: 0, companyWrites: 0, companyFilters: [] as (string | null)[], invitations: [] as Record<string, unknown>[], errors: [] as string[], google: 0 };
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
    } else if (url.pathname.endsWith('/resolve_partner_access')) data = role === 'CUSTOMER' ? { status: 'denied', reason: 'invitation_required', message: 'Няма валидна покана за този акаунт. Влезте с точния поканен имейл или поискайте нова покана.' } : { status: 'ready', role, company_id: role === 'COMPANY_ADMIN' ? ownCompany : null, destination: role === 'SUPER_ADMIN' ? '/admin/companies' : '/admin/dashboard' };
    else if (url.pathname.endsWith('/create_partner_invitation')) { const body = request.postDataJSON(); expect(body.p_kind).toBe('company'); expect(body.p_company).toBeUndefined(); state.invitations.push({ id: body.p_id, email: body.p_email, kind: 'company', status: 'pending', email_status: 'sent', expires_at: new Date(Date.now()+14*86400000).toISOString() }); data = body.p_id; }
    else if (url.pathname.endsWith('/partner_invitations')) data = state.invitations;
    else if (url.pathname.endsWith('/partner-invitation-email')) data = { status: 'sent' };
    else if (url.pathname.endsWith('/legal_acceptances')) data = { id: account };
    else if (url.pathname.endsWith('/company_dashboard')) data = {
      stats: { totalDrivers: 0, onlineDrivers: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, totalRevenue: 0 },
      days: Array.from({ length: 7 }, (_, i) => ({ day: '2026-10-' + String(i + 1).padStart(2, '0'), orders: 0, revenue: 0 })),
    };
    else if (url.pathname.endsWith('/operational_health')) data = { checked_at: new Date().toISOString(), stale_online_drivers: 0, flagged_rides_24h: 0, oldest_push_seconds: 0, metrics: [], route_budget: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
  });
  return state;
}

test('super admin invites by email only and keeps global rights and the selected firm', async ({ page }) => {
  const state = await setup(page, 'SUPER_ADMIN');
  await page.goto('/app'); await expect(page).toHaveURL(/\/admin\/companies$/);
  await expect(page.getByRole('heading', { name: 'Супер администратор' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Добави фирма', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Покана за фирма' });
  await expect(dialog.getByRole('textbox')).toHaveCount(1);
  await dialog.getByLabel('Имейл на представителя').fill('synthetic-representative@example.invalid');
  await dialog.getByRole('button', { name: 'Изпрати покана', exact: true }).click();
  await expect(dialog.getByText('Поканата е изпратена по имейл. Очаква вход с поканения акаунт.')).toBeVisible();
  await expect(dialog.getByText(/Очаква вход · Имейлът е изпратен/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Затвори' }).click();
  await page.goto('/admin/dashboard'); await expect(page.getByLabel('Управлявана фирма')).toHaveValue(ownCompany);
  await expect(page.getByRole('heading', { name: 'Супер администратор' })).toHaveCount(1);
  expect(state.invitations).toHaveLength(1); expect(state.companyWrites).toBe(0); expect(state.profileWrites).toBe(0);
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
  await expect(page.getByText(/Няма валидна покана за този акаунт/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Към твоя профил' })).toHaveAttribute('href', '/app');
  expect(state.companyFilters).toHaveLength(0);
  expect(state.profileWrites).toBe(0); expect(state.companyWrites).toBe(0);
  expect(state.errors).toEqual([]); expect(state.google).toBe(0);
});

test('customer login keeps partner entry collapsed behind a discreet link', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('i18nextLng', 'bg'); });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4100' ? route.continue() : route.abort());
  await page.goto('/auth/login');
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Facebook/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Вход за фирми' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Вход за шофьори' })).toBeHidden();
  await page.getByRole('button', { name: 'Само необходимите' }).click();
  await page.getByText('За фирми и шофьори', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Вход за фирми' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Вход за шофьори' })).toBeVisible();
});

test('invited company binds after login, finishes setup and keeps its own prices after reload', async ({ page, context }) => {
  const invite = '33333333-3333-4333-8333-333333333333';
  const authUser = { id: account, email: 'synthetic-owner@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'google' } };
  let role = 'CUSTOMER', setupAt: string | null = null, binds = 0, setups = 0, google = 0;
  const errors: string[] = [];
  const values: Record<string, unknown> = { ...company(ownCompany, 'Нова фирма'), setup_completed_at: null, email: authUser.email, address: null, phone: null, legal_name: null, registration_id: null, service_city: null, permit_number: null, permit_expires_on: null };
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(user => {
    const token = [btoa(JSON.stringify({ alg: 'HS256' })), btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })), 'synthetic'].join('.');
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, user }));
    localStorage.setItem('i18nextLng', 'bg');
    const savedAt=Date.now(); localStorage.setItem('lk_cookie_consent_v3', JSON.stringify({ version: 3, savedAt, expiresAt: savedAt+180*86400000, consent: { necessary: true, functional: true, analytics: false, marketing: false } }));
  }, authUser);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4100') return route.continue();
    if (url.origin !== 'http://127.0.0.1:54329') { if (/maps\.google|maps\.googleapis|places\.googleapis|routes\.googleapis/.test(url.hostname)) google++; return route.abort(); }
    let data: unknown = [];
    if (url.pathname.endsWith('/auth/v1/user')) data = authUser;
    else if (url.pathname.endsWith('/profiles')) data = { id: account, email: authUser.email, role, company_id: role === 'COMPANY_ADMIN' ? ownCompany : null, is_active: true, first_name: 'Тест', last_name: 'Фирма' };
    else if (url.pathname.endsWith('/resolve_partner_access')) {
      if (role === 'CUSTOMER') { expect(request.postDataJSON().p_invitation).toBe(invite); role = 'COMPANY_ADMIN'; binds++; }
      data = { status: 'ready', role, company_id: ownCompany, destination: setupAt ? '/admin/dashboard' : '/company/setup' };
    } else if (url.pathname.endsWith('/companies')) {
      expect(url.searchParams.get('id')).toBe('eq.' + ownCompany);
      if (request.method() === 'PATCH') {
        if (url.searchParams.get('updated_at') !== 'eq.' + values.updated_at) return route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'No matching tariff version' }), headers: { 'access-control-allow-origin': '*' } });
        Object.assign(values, request.postDataJSON(), { updated_at: new Date().toISOString() });
      }
      data = request.headers().accept?.includes('vnd.pgrst.object') ? values : [values];
    } else if (url.pathname.endsWith('/complete_company_setup')) {
      const body = request.postDataJSON(); expect(body.p_company).toBe(ownCompany); setups++;
      setupAt = new Date().toISOString(); Object.assign(values, body.p_data, { setup_completed_at: setupAt }); data = values;
    } else if (url.pathname.endsWith('/legal_acceptances')) data = { id: account };
    else if (url.pathname.endsWith('/company_dashboard')) data = { stats: { totalDrivers: 0, onlineDrivers: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, totalRevenue: 0 }, days: [] };
    else if (url.pathname.endsWith('/operational_health')) data = { checked_at: new Date().toISOString(), stale_online_drivers: 0, flagged_rides_24h: 0, oldest_push_seconds: 0, metrics: [], route_budget: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/company/login?invite=' + invite);
  await expect(page).toHaveURL(/\/company\/setup$/);
  const form = page.getByRole('form', { name: 'Първоначална фирмена настройка' });
  for (const [label, value] of [
    ['Име за клиентите', 'Фирма Тест'], ['Юридическо наименование', 'Фирма Тест ЕООД'], ['ЕИК', '123456789'], ['Телефон', '+359000000000'], ['Фирмен адрес', 'Левски, тестов адрес 1'],
    ['Основен град на обслужване', 'Левски'], ['Удостоверение / разрешение за таксиметров превоз', 'TEST-1'], ['Валидно до', '2099-01-01'],
    ['Начална такса (EUR)', '2.15'], ['Минимална цена (EUR)', '0'], ['Цена на км (EUR)', '1.23'], ['Цена на минута от маршрута (EUR)', '0.17'],
  ]) await form.getByLabel(label, { exact: true }).fill(value);
  await form.getByRole('button', { name: 'Запази фирмата и отвори панела' }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goto('/admin/pricing');
  await expect(page.getByRole('spinbutton').nth(0)).toHaveValue('2.15');
  await expect(page.getByRole('spinbutton').nth(1)).toHaveValue('1.23');
  await page.getByRole('spinbutton').nth(1).fill('1.41');
  await page.getByRole('button', { name: 'Запази', exact: true }).click();
  await expect(page.getByText('Настройките са запазени успешно.')).toBeVisible();
  await page.reload(); await expect(page.getByRole('spinbutton').nth(1)).toHaveValue('1.41');
  const otherPanel = await context.newPage();
  await otherPanel.goto('/admin/pricing'); await expect(otherPanel.getByRole('spinbutton').nth(1)).toHaveValue('1.41');
  await otherPanel.getByRole('spinbutton').nth(1).fill('1.70');
  await otherPanel.getByRole('button', { name: 'Запази', exact: true }).click();
  await expect(otherPanel.getByText('Настройките са запазени успешно.')).toBeVisible();
  await page.getByRole('spinbutton').nth(1).fill('1.90');
  await page.getByRole('button', { name: 'Запази', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Обнови тарифите' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запази', exact: true })).toBeDisabled();
  expect(values.price_per_km).toBe(1.7);
  await page.getByRole('button', { name: 'Обнови тарифите' }).click();
  await expect(page.getByRole('spinbutton').nth(1)).toHaveValue('1.7');
  await otherPanel.close();
  await page.goto('/company/login'); await expect(page).toHaveURL(/\/admin\/dashboard$/);
  expect(binds).toBe(1); expect(setups).toBe(1); expect(google).toBe(0); expect(errors).toEqual([]);
});
