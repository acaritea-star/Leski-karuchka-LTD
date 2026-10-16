import { test, expect } from '@playwright/test';
import { setupUi, uiAccount, setShortViewport } from './helpers/uiFixture';
import { accountingFixture, addUnpaidRide, entryFixture, financeIds, outcomeFixture } from '../fixtures/accounting';

for (const role of ['DRIVER', 'COMPANY_ADMIN'] as const) {
  test(`${role} money actions stay reachable and a long history opens review in the viewport`, async ({ page }, testInfo) => {
    const state = await setupUi(page, role);
    const report = addUnpaidRide(accountingFixture('2026-10', role === 'DRIVER' ? financeIds.driver : null));
    report.entries = (['income', 'expense', 'handover'] as const).map((kind, i) => ({ ...entryFixture(),
      id: `55555555-5555-4555-8555-${String(i + 1).padStart(12, '0')}`, kind,
      actor_id: role === 'DRIVER' ? uiAccount : '77777777-7777-4777-8777-777777777777', request_id: null,
      amount: [50, 10, 20][i], signed_amount: [50, 10, 20][i], balance_delta: [50, -10, -20][i],
      note: ['Получени пари от външен курс', 'Гориво за работния ден', 'Предадена сума на фирмата'][i],
    }));
    report.entry_count = 3;
    report.finances = { income: 50, expenses: 10, handed_over: 20, net_income: 40, confirmed_income: 0, confirmed_handover: 0 };
    report.balance = { opening: 0, movement: 20, closing: 20, unconfirmed_income: 50, unconfirmed_handover: 20 };
    if (role === 'COMPANY_ADMIN') {
      report.entries = Array.from({ length: 25 }, (_, i) => ({ ...report.entries[0], id: `55555555-5555-4555-8555-${String(i + 1).padStart(12, '0')}`, note: `Външен приход ${i + 1}` }));
      report.entry_count = 25;
      report.finances = { ...report.finances, income: 1250, expenses: 0, handed_over: 0, net_income: 1250 };
      report.balance = { ...report.balance, movement: 1250, closing: 1250, unconfirmed_income: 1250, unconfirmed_handover: 0 };
    }
    await page.route('**/rest/v1/rpc/accounting_report', async route => {
      const input = route.request().postDataJSON(); report.period.from = input.p_from; report.period.until = input.p_until;
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(report) });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(role === 'DRIVER' ? '/driver/earnings' : '/admin/analytics');
    await expect(page.getByRole('heading', { name: 'Остатък по въведените сметки' })).toBeVisible();
    if (role === 'DRIVER') {
      await expect(page.getByRole('button', { name: '+ Получени', exact: true })).toBeInViewport();
      await page.getByRole('button', { name: '− Разход', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Разход', exact: true });
      await expect(dialog.getByLabel('Сума в евро')).toBeFocused();
      await dialog.getByRole('button', { name: 'Гориво', exact: true }).click();
      await expect(dialog.getByRole('textbox', { name: 'Описание', exact: true })).toHaveValue('Гориво');
      await setShortViewport(page, 320);
      const add = dialog.getByRole('button', { name: 'Добави запис', exact: true }); await add.scrollIntoViewIfNeeded();
      const bounds = await add.boundingBox(); expect(bounds && bounds.y + bounds.height).toBeLessThanOrEqual(320);
      await setShortViewport(page);
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: '− Разход', exact: true })).toBeFocused();
    }
    if (role === 'COMPANY_ADMIN') {
      const action = page.getByRole('button', { name: 'Свери приход', exact: true }).last(); await action.click();
      const dialog = page.getByRole('dialog', { name: 'Потвърдете сверения приход' });
      await expect(dialog.getByRole('heading')).toBeInViewport(); await expect(dialog.getByLabel('Основание')).toBeFocused();
      await dialog.getByLabel('Източник', { exact: true }).selectOption('receipt');
      await expect(dialog.getByLabel('Номер / референция')).toHaveAttribute('required', '');
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(action).toBeFocused();
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`accounting-${role.toLowerCase()}.png`) });
    for (const size of [{ width: 320, height: 568 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(state.errors).toEqual([]);
  });
}

test('company driver search and CSV keep both company and driver scope, with no driver write controls', async ({ page }) => {
  const state = await setupUi(page, 'COMPANY_ADMIN');
  const reads: Record<string, unknown>[] = [], exports: Record<string, unknown>[] = [], searches: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/rpc/*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const name = new URL(route.request().url()).pathname.split('/').at(-1), body = route.request().postDataJSON();
    if (name === 'company_driver_page') {
      searches.push(body); expect(body.p_company).toBe(financeIds.company);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ total: 1, rows: [{
        id: financeIds.driver, user_id: '77777777-7777-4777-8777-777777777777', company_id: financeIds.company,
        first_name: 'Иван', last_name: 'Петров', rating: 4.9, total_trips: 10, is_online: false, online_now: false,
        is_verified: true, document_verification_required: true, gps_received_at: null, gps_position_at: null,
      }] }) });
    }
    if (name === 'accounting_report' || name === 'accounting_export') {
      expect(body.p_company_id).toBe(financeIds.company);
      (name === 'accounting_report' ? reads : exports).push(body);
      const report = accountingFixture('2026-10', body.p_driver_id ?? null);
      report.period = { ...report.period, from: body.p_from, until: body.p_until };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(report) });
    }
    return route.fallback();
  });
  await page.goto('/admin/analytics'); await expect(page.getByRole('heading', { name: 'Остатък по въведените сметки' })).toBeVisible();
  expect(searches).toHaveLength(0);
  await page.getByRole('button', { name: 'Избери шофьор', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Избор на шофьор', exact: true });
  await picker.getByLabel('Име на шофьор').fill('Иван');
  await expect.poll(() => searches.some(search => search.p_search === 'Иван')).toBe(true);
  await picker.getByRole('button', { name: 'Иван Петров' }).click();
  await expect(picker).toHaveCount(0); await expect(page.getByText('Отчет за')).toContainText('Иван Петров');
  await expect.poll(() => reads.at(-1)?.p_driver_id).toBe(financeIds.driver);
  await expect(page.getByRole('button', { name: '+ Получени', exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Изтегли CSV', exact: true }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toContain('company-22222222-driver-33333333');
  const stream = await download.createReadStream(); if (!stream) throw Error('Missing CSV');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString('utf8'); expect(csv).toContain(financeIds.company); expect(csv).toContain(financeIds.driver);
  expect(exports).toHaveLength(1); expect(exports[0].p_driver_id).toBe(financeIds.driver);
  await page.getByRole('button', { name: 'Всички шофьори', exact: true }).click();
  await expect(page.getByText('Отчет за')).toHaveCount(0);
  // Returning to all drivers may use the fresh company cache. An explicit refresh must retain that scope.
  await page.getByRole('button', { name: 'Обнови', exact: true }).click();
  await expect.poll(() => reads.at(-1)?.p_driver_id ?? null).toBeNull();
  expect(state.errors).toEqual([]);
});

test('trip pagination cannot hide the first page of money movements', async ({ page }) => {
  const state = await setupUi(page, 'DRIVER'); const pages: number[] = [];
  await page.route('**/rest/v1/rpc/accounting_report', async route => {
    const input = route.request().postDataJSON(), pageNumber = input.p_page ?? 0; pages.push(pageNumber);
    const report = accountingFixture(); report.period.from = input.p_from; report.period.until = input.p_until;
    report.totals = { ...report.totals, completed: 26, booked: 320.84, unreported_completed: 26 };
    report.outcome_count = 26; report.entry_count = 1;
    report.outcomes = Array.from({ length: pageNumber ? 1 : 25 }, (_, index) => ({ ...outcomeFixture(), id: `trip-${pageNumber}-${index}`, request_id: `ride-${pageNumber}-${index}` }));
    report.reconciliation = report.outcomes.map(o => ({ request_id: o.request_id, estimated_amount: 12.34, declared_income: null, income_recorded_at: null, company_confirmed: false, difference: null }));
    report.entries = pageNumber ? [] : [{ ...entryFixture(), request_id: null, note: 'Единствен паричен запис' }];
    report.finances = { ...report.finances, income: 12.34, net_income: 12.34 };
    report.balance = { ...report.balance, closing: 12.34, movement: 12.34, unconfirmed_income: 12.34 };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(report) });
  });
  await page.goto('/driver/earnings'); await expect(page.getByText('Единствен паричен запис')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Напред', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Курсове', exact: true }).click();
  await page.getByRole('button', { name: 'Напред', exact: true }).click();
  await expect(page.getByText('Страница 2 от 2')).toBeVisible();
  await page.getByRole('button', { name: 'Движения', exact: true }).click();
  await expect(page.getByText('Единствен паричен запис')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Напред', exact: true })).toHaveCount(0);
  expect(pages).toContain(1); expect(state.errors).toEqual([]);
});

test('company review requires evidence, locks a delayed write and preserves the original on correction', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'COMPANY_ADMIN');
  const report = accountingFixture('2026-10', null);
  const original = { ...entryFixture(), actor_id: '77777777-7777-4777-8777-777777777777', request_id: null };
  report.entries = [original]; report.entry_count = 1;
  report.finances.income = report.finances.net_income = 12.34;
  report.balance.closing = report.balance.movement = report.balance.unconfirmed_income = 12.34;
  const writes: Record<string, unknown>[] = [];
  let releaseWrite!: () => void;
  const delayedWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
  await page.route('**/rest/v1/rpc/*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const name = new URL(route.request().url()).pathname.split('/').at(-1), body = route.request().postDataJSON();
    const reply = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (name === 'accounting_report') {
      expect(body.p_company_id).toBe(financeIds.company);
      report.period.from = body.p_from; report.period.until = body.p_until;
      return reply(report);
    }
    if (name !== 'record_driver_money_verified') return route.fallback();
    writes.push(body);
    expect(body.p_actor).toBe(uiAccount); expect(body.p_reference_id).toBe(original.id); expect(body.p_amount).toBe(12.34);
    if (body.p_kind === 'confirmation') {
      await delayedWrite;
      original.confirmed = true; original.confirmed_at = '2026-10-16T09:00:00Z';
      report.finances.confirmed_income = 12.34; report.balance.unconfirmed_income = 0;
    } else {
      expect(body.p_kind).toBe('reversal'); original.reversed = true; original.reversed_at = '2026-10-16T09:01:00Z';
      report.finances.income = report.finances.net_income = report.finances.confirmed_income = 0;
      report.balance.closing = report.balance.movement = 0;
    }
    report.entries.unshift({ ...entryFixture(), id: body.p_id, actor_id: uiAccount, kind: body.p_kind, note: body.p_note,
      request_id: null, reference_id: original.id, reference_kind: 'income', reference_recorded_at: original.recorded_at,
      signed_amount: body.p_kind === 'confirmation' ? 0 : -12.34, balance_delta: body.p_kind === 'confirmation' ? 0 : -12.34,
      evidence_source: body.p_source, evidence_reference: body.p_evidence_ref, recorded_at: '2026-10-16T09:01:00Z',
    });
    report.entry_count = report.entries.length;
    return reply(body.p_id);
  });
  await page.goto('/admin/analytics');
  await page.getByRole('button', { name: 'Свери приход', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Потвърдете сверения приход' });
  await review.getByLabel('Основание').fill('Сверено с разписката');
  await review.getByLabel('Източник', { exact: true }).selectOption('receipt');
  await review.getByRole('button', { name: 'Потвърди', exact: true }).click();
  expect(writes).toHaveLength(0);
  await expect(review.getByLabel('Номер / референция')).toBeFocused();
  await review.getByLabel('Номер / референция').fill('R-42');
  await page.screenshot({ path: testInfo.outputPath('accounting-company-review.png') });
  await review.getByRole('button', { name: 'Потвърди', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(review.getByLabel('Основание')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(review).toBeVisible();
  releaseWrite();
  await expect(review).toHaveCount(0); await expect(page.getByText('Записът е запазен.', { exact: true })).toBeVisible();
  const balance = page.getByRole('heading', { name: 'Остатък по въведените сметки' }).locator('..');
  await expect(balance.getByText('12.34 €', { exact: true })).toBeVisible();
  await expect(page.getByText('Сверена сума: 12.34 € · без ново движение на остатъка')).toBeVisible();
  expect(writes[0].p_source).toBe('receipt'); expect(writes[0].p_evidence_ref).toBe('R-42');
  await page.getByRole('button', { name: 'Коригирай сверения запис', exact: true }).click();
  const correction = page.getByRole('dialog', { name: 'Корекция на запис' });
  await correction.getByLabel('Основание').fill('Грешно въведена сума');
  await correction.getByLabel('Източник', { exact: true }).selectOption('cash_book');
  await correction.getByLabel('Номер / референция').fill('K-7');
  await correction.getByRole('button', { name: 'Потвърди', exact: true }).click();
  await expect(correction).toHaveCount(0);
  await expect(balance.getByText('0.00 €', { exact: true })).toBeVisible();
  await expect(page.getByText('Коригиран', { exact: true })).toBeVisible();
  await expect(page.getByText('-12.34 €', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2); expect(writes[1].p_evidence_ref).toBe('K-7');
  expect(report.entries.some(entry => entry.id === original.id)).toBe(true); expect(state.errors).toEqual([]);
});
