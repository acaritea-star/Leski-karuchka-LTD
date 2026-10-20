import { test, expect } from '@playwright/test';
import { setupUi } from './helpers/uiFixture';

test('a new customer sees route, company, tracking and 112 guidance only once across reloads and storage resets', async ({ page }) => {
 const state = await setupUi(page, 'CUSTOMER'); state.welcomeFirst = true;
 await page.setViewportSize({ width: 360, height: 640 });
 await page.goto('/customer/home');
 const welcome = page.getByRole('dialog', { name: 'Добре дошъл', exact: true });
 await expect(welcome).toBeVisible();
 await expect(welcome.getByText('Избери откъде и докъде')).toBeVisible();
 await expect(welcome.getByText('Сравни фирмите и цените')).toBeVisible();
 await expect(welcome.getByText('Поръчай и следи шофьора')).toBeVisible();
 await welcome.getByRole('heading', { name: 'При спешен случай', exact: true }).scrollIntoViewIfNeeded();
 await expect(welcome).toContainText('горе вдясно');
 expect(await welcome.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
 await expect(welcome.getByRole('button', { name: 'Ясно, започваме' })).toBeInViewport();
 await page.screenshot({ path: test.info().outputPath('customer-welcome-mobile.png') });
 await welcome.getByRole('button', { name: 'Ясно, започваме' }).click();
 await expect(welcome).toHaveCount(0);
 await page.getByRole('button', { name: /112/ }).first().click();
 await expect(page.getByRole('link', { name: /112/ })).toHaveAttribute('href', 'tel:112');
 await page.keyboard.press('Escape');
 await page.reload(); await expect(page.getByRole('button', { name: 'Известия', exact: true })).toBeVisible();
 await expect(welcome).toHaveCount(0);
 await page.evaluate(() => localStorage.clear());
 await page.reload(); await expect(page.getByRole('button', { name: 'Известия', exact: true })).toBeVisible();
 await expect(welcome).toHaveCount(0); expect(state.welcomeClaims).toBeGreaterThanOrEqual(3);
 expect(state.errors).toEqual([]);
});

test('an existing customer goes straight to booking without a welcome', async ({ page }) => {
 const state = await setupUi(page, 'CUSTOMER');
 await page.goto('/customer/home');
 await expect(page.getByRole('button', { name: 'Известия', exact: true })).toBeVisible();
 await expect.poll(() => state.welcomeClaims).toBe(1);
 await expect(page.getByRole('dialog', { name: 'Добре дошъл', exact: true })).toHaveCount(0);
 expect(state.errors).toEqual([]);
});


test('an unavailable welcome module never prevents booking or emergency help', async ({ page }) => {
 const state = await setupUi(page, 'CUSTOMER'); state.welcomeFirst = true;
 let blocked = false;
 await page.route('**/src/pages/customer/components/WelcomeOnboarding.tsx*', route => { blocked = true; return route.abort('failed'); });
 await page.goto('/customer/home');
 await expect.poll(() => blocked).toBe(true);
 await expect.poll(() => state.welcomeClaims).toBe(1);
 await expect(page.getByRole('button', { name: 'Известия', exact: true })).toBeVisible();
 await expect(page.getByText('Не успяхме да заредим този екран')).toHaveCount(0);
 await page.getByRole('button', { name: /112/ }).first().click();
 await expect(page.getByRole('link', { name: /112/ })).toHaveAttribute('href', 'tel:112');
});
