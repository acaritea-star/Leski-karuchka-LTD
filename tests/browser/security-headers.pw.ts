import { test, expect } from '@playwright/test';
test('staging headers reach the browser without enforcing an unverified CSP', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(response.headers()['content-security-policy-report-only']).toContain("object-src 'none'");
  expect(response.headers()['content-security-policy']).toBeUndefined();
});
