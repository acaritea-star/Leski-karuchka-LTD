import { test, expect } from '@playwright/test';
import { setupUi, setShortViewport, uiAccount, uiCompany, uiDriver, type UiRole } from './helpers/uiFixture';

const routes: Record<UiRole, string[]> = {
  visitor: ['/', '/about', '/pricing', '/company-partner', '/driver-join', '/contact', '/novini', '/novini/missing-article', '/terms', '/privacy', '/cookies', '/auth/login', '/auth/register', '/company/login', '/driver/login', '/not-a-route'],
  CUSTOMER: ['/customer/home', '/customer/orders', '/customer/profile', '/customer/settings'],
  DRIVER: ['/driver/home', '/driver/requests', '/driver/history', '/driver/earnings', '/driver/profile', '/driver/preparation'],
  COMPANY_ADMIN: ['/company', '/company/setup', '/admin/dashboard', '/admin/map', '/admin/drivers', '/admin/vehicles', '/admin/customers', '/admin/orders', '/admin/pricing', '/admin/analytics', '/admin/settings'],
  SUPER_ADMIN: ['/admin/companies', '/admin/dashboard', '/admin/news', '/admin/news/new'],
};

for (const role of Object.keys(routes) as UiRole[]) test(`${role} screens fit narrow phones and desktops with named buttons and fields`, async ({ page }, testInfo) => {
  test.setTimeout(90_000); const state = await setupUi(page, role);
  for (const path of routes[role]) for (const size of [{ width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size); await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role} ${path} ${size.width}px`).toBe(true);
    const unnamed = await page.evaluate(() => {
      const visible = (element: Element) => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
      return [...document.querySelectorAll('button')].filter(visible).filter(element => !element.textContent?.trim() && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.title).map(element => element.outerHTML);
    });
    expect(unnamed, path).toEqual([]);
    const unlabelled = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type=hidden]),select,textarea')]
      .filter(element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && !element.closest('.form-trap') && element.getAttribute('aria-hidden') !== 'true')
      .filter(element => !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).map(element => element.outerHTML));
    expect(unlabelled, path).toEqual([]);
    if (path === '/admin/dashboard') {
      for (const link of await page.getByLabel('Бързи действия').getByRole('link').all()) {
        expect(await link.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
    }
    if (size.width === 320 && (path.endsWith('/profile') || role === 'SUPER_ADMIN' && path === '/admin/dashboard')) {
      await page.screenshot({ path: testInfo.outputPath(role.toLowerCase() + '-320.png') });
    }
  }
  expect(state.errors).toEqual([]); expect(state.profileWrites).toHaveLength(0); expect(state.vehicleWrites).toHaveLength(0);
});

test('profile edits survive a failed save, cancel discards changes and navigation remains usable', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); state.failProfile = true; state.writeDelay = 500;
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/customer/profile');
  await page.getByRole('button', { name: 'Редактирай профила', exact: true }).click();
  await page.getByLabel('Име', { exact: true }).fill('Незапазено'); await page.getByRole('button', { name: 'Отказ', exact: true }).click();
  await page.getByRole('button', { name: 'Редактирай профила', exact: true }).click();
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Александър-Владимир');
  await page.getByLabel('Телефон', { exact: true }).fill('0899123456');
  await page.getByLabel('Телефон', { exact: true }).press('Enter');
  await expect(page.getByLabel('Телефон', { exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Промяната не е потвърдена');
  await expect(page.getByLabel('Телефон', { exact: true })).toHaveValue('0899123456');
  state.failProfile = false; await page.getByRole('button', { name: 'Запази', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Профилът е запазен.');
  expect(state.profileWrites).toHaveLength(2);
  await page.getByRole('link', { name: /Поръчки/ }).click(); await expect(page).toHaveURL(/\/customer\/orders$/);
  await page.getByRole('button', { name: 'Назад', exact: true }).click(); await expect(page).toHaveURL(/\/customer\/home$/);
  expect(state.errors).toEqual([]);
});

test('language controls disclose an unconfirmed profile preference and can retry it', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); state.failPreferences = true;
  await page.goto('/customer/settings'); await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toContainText('The language changed on this device');
  state.failPreferences = false; await page.getByRole('alert').getByRole('button').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(state.profileWrites.map(write => write.language)).toEqual(['en', 'en']);
  expect(state.errors).toEqual([]);
});

test('notifications fit the viewport, recover read failures and prevent duplicate mark-all requests', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'CUSTOMER'); state.failNotificationReads = true;
  state.notices = Array.from({ length: 15 }, (_, index) => ({ id: `notice-${index}`, title: 'Промяна по пътуването с по-дълго заглавие', message: 'Съобщение с всички подробности за клиента.', is_read: false, type: 'trip_status', created_at: new Date().toISOString() }));
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/customer/home');
  const bell = page.getByRole('button', { name: 'Известия', exact: true }); await bell.click();
  const panel = page.getByRole('dialog', { name: 'Известия', exact: true });
  await expect(panel.getByRole('alert')).toContainText('Известията не се заредиха');
  await expect(panel.getByText('Няма известия', { exact: true })).toHaveCount(0);
  state.failNotificationReads = false; await panel.getByRole('button', { name: 'Опитай отново', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(15);
  await page.screenshot({ path: testInfo.outputPath('notifications-320.png') });
  for (const size of [{ width: 320, height: 568 }, { width: 720, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size); await expect(panel).toBeInViewport({ ratio: 1 });
  }
  state.failNotificationWrites = true; state.writeDelay = 500;
  const mark = panel.getByRole('button', { name: /прочетени/ });
  await mark.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(mark).toBeDisabled(); await expect(panel.getByRole('alert')).toContainText('Прочитането не е потвърдено');
  expect(state.notificationWrites).toBe(1);
  state.failNotificationWrites = false; await mark.click(); await expect(mark).toHaveCount(0);
  expect(state.notificationWrites).toBe(2);
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(bell).toBeFocused();
  expect(state.errors).toEqual([]);
});

test('rating dialog supports radio keyboard selection, short viewports, failure and safe retry', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'CUSTOMER'); const requestId = '55555555-5555-4555-8555-555555555555';
  state.rides = [{ id: requestId, customer_id: uiAccount, driver_id: uiDriver, company_id: uiCompany, status: 'completed', pickup_address: 'Велико Търново, център', destination_address: 'Горна Оряховица, гара', final_price: 9, estimated_price: 9, created_at: new Date().toISOString(), completed_at: new Date().toISOString() }];
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/customer/orders');
  await page.getByRole('button', { name: 'История', exact: true }).click();
  const rate = page.getByRole('button', { name: 'Оцени шофьора', exact: true }); await rate.click();
  const dialog = page.getByRole('dialog', { name: 'Оцени шофьора', exact: true });
  await page.getByRole('radio', { name: 'Оценка 4 от 5', exact: true }).check();
  await page.keyboard.press('ArrowRight'); await expect(page.getByRole('radio', { name: 'Оценка 5 от 5', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  const feedback = dialog.getByRole('textbox'); await feedback.fill('Точно и приятно пътуване');
  await setShortViewport(page, 340); await expect(dialog).toBeInViewport({ ratio: 1 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('rating-short-viewport.png'), clip: { x: 0, y: 0, width: 320, height: 340 } });
  const shortSubmit = dialog.getByRole('button', { name: 'Изпрати оценка', exact: true }); await shortSubmit.scrollIntoViewIfNeeded();
  expect((await shortSubmit.boundingBox())!.y + (await shortSubmit.boundingBox())!.height).toBeLessThanOrEqual(340);
  await setShortViewport(page);
  state.failRating = true; state.writeDelay = 600;
  const submit = dialog.getByRole('button', { name: 'Изпрати оценка', exact: true });
  await submit.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(dialog).toHaveAttribute('aria-busy', 'true'); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Оценката не е записана');
  await expect(feedback).toHaveValue('Точно и приятно пътуване'); await expect(page.getByRole('radio', { name: 'Оценка 4 от 5', exact: true })).toBeChecked();
  expect(state.ratingWrites).toHaveLength(1);
  state.failRating = false; await submit.click(); await expect(dialog).toHaveCount(0); await expect(rate).toHaveCount(0);
  expect(state.ratingWrites).toHaveLength(2); expect(state.ratingWrites[1]).toMatchObject({ request_id: requestId, score: 4, feedback: 'Точно и приятно пътуване' });
  expect(state.errors).toEqual([]);
});

test('nested vehicle dialogs restore focus, keep scrolling and freeze controls during save', async ({ page }, testInfo) => {
  const state = await setupUi(page, 'COMPANY_ADMIN');
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/admin/vehicles');
  const add = page.getByRole('button', { name: 'Добави автомобил', exact: true }); await expect(add).toBeEnabled(); await add.click();
  const dialog = page.getByRole('dialog', { name: 'Добави автомобил', exact: true });
  await dialog.getByLabel('Марка', { exact: true }).fill('Тойота'); await dialog.getByLabel('Модел', { exact: true }).fill('Приус');
  await dialog.getByLabel('Рег. номер', { exact: true }).fill('ВТ1234АА');
  const category = dialog.getByRole('button', { name: 'Добави нова категория', exact: true }); await category.click();
  await expect(page.locator('dialog[open]')).toHaveCount(2); await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(1); await expect(category).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await setShortViewport(page, 340); await expect(dialog).toBeInViewport({ ratio: 1 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('vehicle-short-viewport.png'), clip: { x: 0, y: 0, width: 320, height: 340 } });
  const shortSave = dialog.getByRole('button', { name: 'Запази', exact: true }); await shortSave.scrollIntoViewIfNeeded();
  expect((await shortSave.boundingBox())!.y + (await shortSave.boundingBox())!.height).toBeLessThanOrEqual(340);
  await setShortViewport(page); state.writeDelay = 650;
  const save = dialog.getByRole('button', { name: 'Запази', exact: true }); await save.click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true'); await expect(dialog.getByLabel('Марка', { exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCount(0); await expect(page.getByText('ВТ1234АА', { exact: true })).toBeVisible();
  expect(state.vehicleWrites).toHaveLength(1); expect(state.vehicleWrites[0].p_company).toBe(uiCompany);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(''); expect(state.errors).toEqual([]);
});

test('a committed rating with a lost response is confirmed without another insert', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); state.loseRatingResponse = true;
  state.rides = [{ id: '55555555-5555-4555-8555-555555555555', customer_id: uiAccount, driver_id: uiDriver, company_id: uiCompany, status: 'completed', pickup_address: 'Търново', destination_address: 'Горна Оряховица', final_price: 9, created_at: new Date().toISOString() }];
  await page.goto('/customer/orders'); await page.getByRole('button', { name: 'История', exact: true }).click();
  const rate = page.getByRole('button', { name: 'Оцени шофьора', exact: true }); await rate.click();
  const dialog = page.getByRole('dialog', { name: 'Оцени шофьора', exact: true });
  await dialog.getByRole('button', { name: 'Изпрати оценка', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(rate).toHaveCount(0);
  expect(state.ratingWrites).toHaveLength(1); expect(state.ratings).toHaveLength(1); expect(state.errors).toEqual([]);
});

test('contact form validates, preserves failed submissions and focuses the final result', async ({ page }) => {
  const state = await setupUi(page, 'visitor'); state.failContact = true; state.writeDelay = 500;
  await page.goto('/contact'); const form = page.getByRole('form');
  await form.getByLabel('Име', { exact: true }).fill('Владимир'); await form.getByLabel('Имейл', { exact: true }).fill('invalid');
  await form.locator('select[name=subject]').selectOption('question'); await form.locator('textarea').fill('Тестово запитване');
  const send = form.locator('button[type=submit]'); await send.click(); expect(state.contactWrites).toHaveLength(0);
  await form.getByLabel('Имейл', { exact: true }).fill('synthetic@example.invalid');
  await form.evaluate((element: HTMLFormElement) => { element.requestSubmit(); element.requestSubmit(); });
  await expect(form.getByLabel('Име', { exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveText('Временен проблем. Опитай отново.'); await expect(page.getByRole('alert')).toBeFocused();
  await expect(form.locator('textarea')).toHaveValue('Тестово запитване'); expect(state.contactWrites).toHaveLength(1);
  state.failContact = false; await send.click(); await expect(page.getByRole('status')).toContainText('Съобщението ти е изпратено');
  await expect(form.getByLabel('Име', { exact: true })).toHaveValue(''); expect(state.contactWrites).toHaveLength(2); expect(state.errors).toEqual([]);
});

test('article deletion failures stay inside each confirmation dialog and allow one retry', async ({ page }) => {
  const state = await setupUi(page, 'SUPER_ADMIN'); state.writeDelay = 500;
  const id = '66666666-6666-4666-8666-666666666666';
  const article = { id, title: 'Тестова статия', slug: 'synthetic-article', excerpt: 'Тестово описание', content: 'Тестово съдържание', category: 'Тест', author_name: 'Тест', status: 'published', is_featured: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), published_at: new Date().toISOString() };
  for (const path of ['/admin/news', '/admin/news/' + id]) {
    state.articles = [{ ...article }]; state.failArticleDelete = true;
    await page.goto(path); await page.getByRole('button', { name: path === '/admin/news' ? 'Изтрий' : 'Изтрий статията', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Изтриване на статия', exact: true });
    const remove = dialog.getByRole('button', { name: 'Изтрий', exact: true });
    const before = state.articleDeletes;
    await remove.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('alert')).toContainText('Изтриването не е потвърдено');
    expect(state.articleDeletes).toBe(before + 1);
    state.failArticleDelete = false; await remove.click(); await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin\/news$/); await page.waitForLoadState('networkidle');
    expect(state.articleDeletes).toBe(before + 2);
  }
  expect(state.errors).toEqual([]);
});
