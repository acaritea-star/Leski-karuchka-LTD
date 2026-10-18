import { expect, test, type Page } from '@playwright/test';
import { setupUi, uiCompany } from './helpers/uiFixture';

const cityA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cityB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stamp = () => new Date().toISOString();
function company(id: string, name: string, parent: string | null, city: string | null, ready = true) {
  return { id, name, parent_company_id: parent, service_city: city, is_active: ready, setup_completed_at: ready ? stamp() : null,
    created_at: stamp(), updated_at: stamp(), currency: 'EUR', base_fare: 1.40, price_per_km: .70, price_per_minute: 0, min_fare: 0, dispatch_radius_km: 5,
    night_base_fare: null as number | null, night_price_per_km: null as number | null, night_price_per_minute: null as number | null, night_min_fare: null as number | null,
    service_latitude: parent ? 43.0757 : null, service_longitude: parent ? 25.6172 : null, service_radius_km: parent ? 5 : null,
    phone: '0888000000', email: 'synthetic@example.invalid', address: 'Synthetic test address', legal_name: '', registration_id: '', permit_number: '', permit_expires_on: '', document_checks_required: true, accepts_driver_applications: false };
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,range,range-unit' };
async function fixture(page: Page, local = false, ready = true) {
  const ui = await setupUi(page, 'COMPANY_ADMIN');
  const rows = [company(uiCompany, 'Лески Каручка', null, null, false), company(cityA, 'Лески Каручка — Търново', uiCompany, 'Велико Търново', ready), company(cityB, 'Лески Каручка — Левски', uiCompany, 'Левски')];
  if (local) ui.profile.company_id = cityA;
  const state = { rows, creates: [] as Record<string, unknown>[], updates: [] as { id: string | undefined; body: Record<string, unknown> }[], directories: 0, reports: 0, badReport: false, loseCreate: false, driverReads: [] as string[], setupWrites: 0 };
  await page.route('http://127.0.0.1:54329/rest/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (value: unknown, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(value) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname.endsWith('/companies')) {
      const id = url.searchParams.get('id')?.replace(/^eq\./, ''), parent = url.searchParams.get('parent_company_id')?.replace(/^eq\./, '');
      if (request.method() === 'PATCH') {
        const target = rows.find(row => row.id === id), body = request.postDataJSON(); state.updates.push({ id, body });
        if (!target || target.updated_at !== url.searchParams.get('updated_at')?.replace(/^eq\./, '')) return reply({ code: 'PGRST116', message: 'Changed' }, 406);
        Object.assign(target, body, { updated_at: stamp() }); return reply(target);
      }
      if (parent) state.directories++;
      const data = rows.filter(row => (!id || row.id === id) && (!parent || row.parent_company_id === parent));
      return reply(request.headers().accept?.includes('vnd.pgrst.object+json') ? data[0] ?? null : data);
    }
    if (url.pathname.endsWith('/rpc/create_company_division')) {
      const body = request.postDataJSON(); state.creates.push(body);
      let row = rows.find(row => row.id === body.p_id);
      if (!row) { row = { ...company(body.p_id, body.p_data.name, body.p_parent, body.p_data.service_city, false), ...body.p_data, base_fare: 0, price_per_km: 0 }; rows.push(row); }
      if (state.loseCreate) { state.loseCreate = false; return route.abort(); }
      return reply(row);
    }
    if (url.pathname.endsWith('/rpc/complete_company_setup')) {
      const body = request.postDataJSON(); state.setupWrites++;
      const row = rows.find(row => row.id === body.p_company)!; Object.assign(row, body.p_data, { setup_completed_at: stamp(), updated_at: stamp(), is_active: true }); return reply(row);
    }
    if (url.pathname.endsWith('/rpc/company_group_report')) {
      const body = request.postDataJSON(); state.reports++;
      const zero = { completed: 0, cancelled: 0, income: 0, expenses: 0, handed_over: 0, cash_income: 0, card_income: 0, unknown_income: 0, cash_closing: 0 };
      const a = { ...zero, completed: 1, income: 12.34, expenses: 2, cash_income: 12.34, cash_closing: 10.34 };
      const b = { ...zero, completed: 1, income: 20, card_income: 20 };
      return reply({ report_version: 1, currency: 'EUR', parent_company_id: state.badReport ? 'foreign' : body.p_parent,
        generated_at: stamp(), period: { from: body.p_from, until: body.p_until, timezone: 'Europe/Sofia' },
        companies: rows.map((row, index) => ({ id: row.id, parent_company_id: row.parent_company_id, name: row.name, service_city: row.service_city, is_active: row.is_active, summary: index === 0 ? zero : index === 1 ? a : b })),
        total: { ...zero, completed: 2, income: 32.34, expenses: 2, cash_income: 12.34, card_income: 20, cash_closing: 10.34 } });
    }
    if (url.pathname.endsWith('/rpc/open_notification')) return reply('/admin/drivers?company=' + cityA);
    if (url.pathname.endsWith('/rpc/company_driver_page')) state.driverReads.push(request.postDataJSON().p_company);
    return route.fallback();
  });
  return { ui, state };
}

test('parent sees city management from its draft headquarters and uncertain creation never duplicates a division', async ({ page }, testInfo) => {
  const { ui, state } = await fixture(page); state.loseCreate = true;
  await page.goto('/company/setup?company=' + uiCompany); await page.getByRole('link', { name: 'Отвори подразделенията' }).click();
  await expect(page.getByRole('heading', { name: 'Лески Каручка', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('city-divisions-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Добави подразделение', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добави градско подразделение' });
  await dialog.getByLabel('Град', { exact: true }).fill('Плевен'); await dialog.getByRole('button', { name: 'Плевен', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('city-division-editor-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Създай подразделение', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Провери списъка' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Провери списъка' }).click();
  await expect(page.getByRole('heading', { name: 'Лески Каручка — Плевен', exact: true })).toBeVisible();
  expect(state.creates).toHaveLength(1); expect(state.rows.filter(row => row.service_city === 'Плевен')).toHaveLength(1);
  const created = state.rows.find(row => row.service_city === 'Плевен')!; expect(created.is_active).toBe(false); expect(created.price_per_km).toBe(0);
  expect(ui.errors).toEqual([]); expect(ui.external.filter(url => /^(maps|places|routes)\.googleapis\.com$/.test(new URL(url).hostname))).toEqual([]);
});

test('a parent completes a child setup while headquarters stays a draft and opens the child dashboard', async ({ page }) => {
  const { ui, state } = await fixture(page, false, false);
  await page.goto('/admin/divisions');
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Лески Каручка — Търново', exact: true }) });
  await card.getByRole('button', { name: 'Довърши настройката' }).click();
  const form = page.getByRole('form', { name: 'Първоначална фирмена настройка' });
  await form.getByLabel('Юридическо наименование').fill('Synthetic carrier'); await form.getByLabel('ЕИК', { exact: true }).fill('123456789');
  await form.getByLabel('Удостоверение / разрешение за таксиметров превоз').fill('SYNTHETIC-ONLY'); await form.getByLabel('Валидно до').fill('2027-12-31');
  await form.getByLabel('Начална такса (EUR)', { exact: true }).fill('1.40'); await form.getByLabel('Минимална цена (EUR)').fill('0');
  await form.getByLabel('Цена на км (EUR)', { exact: true }).fill('0.70'); await form.getByLabel('Цена на минута от маршрута (EUR)').fill('0');
  await form.getByLabel('Радиус за заявки (км)').fill('5');
  await form.getByRole('button', { name: 'Запази фирмата и отвори панела' }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/); await expect(page.getByLabel('Управлявана фирма')).toHaveValue(cityA);
  expect(state.setupWrites).toBe(1); expect(state.rows[0].setup_completed_at).toBeNull(); expect(state.rows[1].is_active).toBe(true); expect(ui.errors).toEqual([]);
});

test('city prices save only to the selected child, persist after reload, and do not overwrite a sibling', async ({ page }) => {
  const { ui, state } = await fixture(page);
  await page.goto('/admin/divisions');
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Лески Каручка — Търново', exact: true }) });
  await card.getByRole('button', { name: 'Цени', exact: true }).click();
  await expect(page.getByLabel('Управлявана фирма')).toHaveValue(cityA);
  await page.getByLabel('Цена на км (EUR)', { exact: true }).fill('0.69');
  await page.getByRole('checkbox', { name: 'Отделни нощни цени · 22:00–06:00' }).check();
  await page.getByLabel('Цена на км — нощ (EUR)', { exact: true }).fill('0.79');
  await page.getByRole('button', { name: 'Запази', exact: true }).click(); await expect(page.getByText('Настройките са запазени успешно.')).toBeVisible();
  expect(state.updates).toHaveLength(1); expect(state.updates[0].id).toBe(cityA);
  expect(state.rows[1].night_price_per_km).toBe(.79); expect(state.rows[2].price_per_km).toBe(.70); expect(state.rows[0].price_per_km).toBe(.70);
  await page.reload(); await expect(page.getByLabel('Управлявана фирма')).toHaveValue(cityA); await expect(page.getByLabel('Цена на км — нощ (EUR)', { exact: true })).toHaveValue('0.79');
  expect(ui.errors).toEqual([]);
});

test('a local manager cannot open parent management even when public company metadata includes siblings', async ({ page }) => {
  const { ui, state } = await fixture(page, true);
  await page.goto('/admin/divisions'); await expect(page.getByRole('heading', { name: 'Нужен е централен фирмен достъп' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добави подразделение', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Общ отчет' })).toHaveCount(0); expect(state.directories).toBe(0); expect(state.reports).toBe(0); expect(ui.errors).toEqual([]);
});

test('the combined report keeps city totals separate and hides unverified responses instead of showing a false zero', async ({ page }) => {
  const { ui, state } = await fixture(page);
  await page.goto('/admin/divisions'); await page.getByRole('tab', { name: 'Общ отчет' }).click();
  await expect(page.getByText('32.34 €', { exact: true })).toBeVisible(); await expect(page.getByText('12.34 €', { exact: true })).toHaveCount(2);
  await expect(page.getByText('20.00 €', { exact: true })).toHaveCount(2);
  state.badReport = true; await page.getByRole('button', { name: 'Обнови отчета', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Общият отчет не е потвърден' })).toBeVisible();
  await expect(page.getByText('32.34 €', { exact: true })).toHaveCount(0); expect(ui.errors).toEqual([]);
});

test('a central notification opens the correct city before loading its drivers', async ({ page }) => {
  const { ui, state } = await fixture(page);
  await page.goto('/notifications/open?id=dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  await expect(page).toHaveURL(new RegExp('/admin/drivers\\?company=' + cityA));
  await expect(page.getByLabel('Управлявана фирма')).toHaveValue(cityA);
  await expect.poll(() => state.driverReads.length).toBeGreaterThan(0); expect(state.driverReads.every(id => id === cityA)).toBe(true); expect(ui.errors).toEqual([]);
});

test('a central owner returns to city management after login without being forced to configure headquarters as a taxi city', async ({ page }) => {
  const { ui } = await fixture(page);
  await page.goto('/company/login'); await expect(page).toHaveURL(/\/admin\/divisions$/);
  await expect(page.getByRole('heading', { name: 'Лески Каручка', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добави подразделение', exact: true })).toBeVisible(); expect(ui.errors).toEqual([]);
});
