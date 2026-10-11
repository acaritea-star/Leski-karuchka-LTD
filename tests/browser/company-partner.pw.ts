import { test, expect } from '@playwright/test';

test('public partner pricing stays clear on mobile and desktop, and the inquiry preserves its topic', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const external: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'bg');
    const savedAt = Date.now();
    localStorage.setItem('lk_cookie_consent_v3', JSON.stringify({ version: 3, savedAt, expiresAt: savedAt + 180 * 86400000, consent: { necessary: true, functional: true, analytics: false, marketing: false } }));
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4100') return route.continue();
    external.push(url.href); return route.abort();
  });
  await page.goto('/company-partner');
  await expect(page.getByRole('heading', { name: 'Стани фирма партньор', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Стани фирма партньор · Лески Каручка');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://leskikaruchka.com/company-partner');
  for (const width of [320, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('table').scrollIntoViewIfNeeded();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const ownTrips = page.locator('details').filter({ has: page.getByText('А собствените ни клиенти?', { exact: true }) });
  await ownTrips.locator('summary').click();
  await expect(ownTrips).toContainText('без тази такса за обслужване');
  await page.getByRole('link', { name: 'Да поговорим за партньорство', exact: true }).click();
  await expect(page).toHaveURL(/\/contact\?subject=partner$/);
  await expect(page.locator('select[name="subject"]')).toHaveValue('partner');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://leskikaruchka.com/');
  expect(external.some(url => /(?:maps|routes|places)\.googleapis\.com|readdy\.ai\/api\/form/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

test('partner information is reachable from the public menu, footer and pricing page', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'bg');
    const savedAt = Date.now();
    localStorage.setItem('lk_cookie_consent_v3', JSON.stringify({ version: 3, savedAt, expiresAt: savedAt + 180 * 86400000, consent: { necessary: true, functional: true, analytics: false, marketing: false } }));
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4100' ? route.continue() : route.abort());
  await page.goto('/pricing');
  await page.getByRole('button', { name: 'Отвори меню', exact: true }).click();
  await page.getByRole('navigation', { name: 'Мобилна навигация' }).getByRole('link', { name: 'Фирми', exact: true }).click();
  await expect(page).toHaveURL(/\/company-partner$/);
  await expect(page.locator('footer').getByRole('link', { name: 'Стани фирма партньор', exact: true })).toHaveAttribute('href', '/company-partner');
  await page.goto('/pricing');
  await page.getByRole('link', { name: 'Стани фирма партньор — виж условията', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Стани фирма партньор', exact: true })).toBeVisible();
});
