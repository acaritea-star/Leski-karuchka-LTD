import { test, expect } from '@playwright/test';
import { setupUi } from './helpers/uiFixture';

test('the customer menu retains local fade/slide effects without the optional Tailwind plugin', async ({ page }) => {
  await setupUi(page, 'CUSTOMER');
  await page.goto('/customer/home');
  await page.getByRole('button', { name: 'Отвори менюто', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Отвори менюто', exact: true });
  await expect(menu).toBeVisible();
  const styles = await menu.evaluate(el => {
    const backdrop = getComputedStyle(el.querySelector('.animate-in.fade-in')!);
    const drawer = getComputedStyle(el.querySelector('aside')!);
    return { backdrop: [backdrop.animationName, backdrop.animationDuration, backdrop.getPropertyValue('--leski-enter-opacity').trim()], drawer: [drawer.animationName, drawer.animationDuration, drawer.getPropertyValue('--leski-enter-x').trim()] };
  });
  expect(styles.backdrop).toEqual(['leski-enter', '0.2s', '0']);
  expect(styles.drawer).toEqual(['leski-enter', '0.3s', '1.5rem']);
  await page.getByRole('button', { name: 'Отказ', exact: true }).click();
  await expect(menu).toHaveCount(0);
});
