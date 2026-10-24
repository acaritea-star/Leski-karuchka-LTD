import { test, expect } from '@playwright/test';
import { setupUi } from './helpers/uiFixture';

test('essential customer navigation stays visible without external fonts or icon CDNs', async ({ page }, info) => {
  const state = await setupUi(page, 'CUSTOMER');
  // setupUi blocks external resources, including the optional Remix icon font.
  await page.goto('/customer/home');
  const menu = page.getByRole('button', { name: 'Отвори менюто', exact: true });
  await expect(menu.locator('svg')).toBeVisible();
  await expect(page.locator('.booking-search svg')).toBeVisible();
  await menu.click();
  const dialog = page.getByRole('dialog', { name: 'Отвори менюто' });
  await expect(dialog.getByRole('button', { name: 'Отказ', exact: true }).locator('svg')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Поръчки', exact: true }).locator('svg')).toBeVisible();
  await page.screenshot({ path: info.outputPath('menu-without-cdn.png') });
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused();
  expect(state.errors).toEqual([]);
});

test('the menu follows the keyboard viewport and keeps its close/logout controls reachable', async ({ page }, info) => {
  await setupUi(page, 'CUSTOMER'); await page.goto('/customer/profile');
  await page.getByRole('button', { name: 'Отвори менюто', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Отвори менюто' });
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, { height: { configurable: true, value: 340 }, offsetTop: { configurable: true, value: 45 } });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  for (const name of ['Отказ', 'Изход']) {
    const button = dialog.getByRole('button', { name, exact: true });
    await expect.poll(async () => (await button.boundingBox())!.y + (await button.boundingBox())!.height).toBeLessThanOrEqual(385);
    expect((await button.boundingBox())!.y).toBeGreaterThanOrEqual(45);
  }
  await dialog.getByRole('button', { name: 'Поръчки', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Отказ', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('menu-keyboard.png') });
  await dialog.getByRole('button', { name: 'Поръчки', exact: true }).click();
  await expect(page).toHaveURL(/\/customer\/orders$/); await expect(page.getByRole('heading', { name: 'Поръчки', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('an order read failure keeps navigation, emergency help and a working retry', async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); let fail = true;
  await page.route('**/rest/v1/taxi_requests*', route => fail ? route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, json: { message: 'synthetic internal details' } }) : route.fallback());
  await page.goto('/customer/orders');
  await expect(page.getByRole('alert').filter({ hasText: 'Поръчките не се заредиха.' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Назад', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Спешна помощ на 112', exact: true })).toBeVisible();
  await expect(page.getByText('synthetic internal details', { exact: true })).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: 'Опитай отново', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Поръчките не се заредиха.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад', exact: true }).click(); await expect(page).toHaveURL(/\/customer\/home$/);
  expect(state.errors).toEqual([]);
});
