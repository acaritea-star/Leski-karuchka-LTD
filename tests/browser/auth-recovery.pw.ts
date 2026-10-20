import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setupUi, uiAccount } from './helpers/uiFixture';
const legalOperator = JSON.parse(readFileSync(new URL('../../src/config/legalOperator.json', import.meta.url), 'utf8'));

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer' };

for (const temporary of [true, false]) test(`first OAuth login recovers ${temporary ? 'automatically after a 401' : 'in place after an unavailable service'}`, async ({ page }) => {
  const state = await setupUi(page, 'CUSTOMER'); state.welcomeFirst = true;
  await page.addInitScript(versions => {
    // Start with no signed-in session. The callback must exchange PKCE once.
    localStorage.removeItem('sb-127-auth-token');
    localStorage.setItem('sb-127-auth-token-code-verifier', 'synthetic-verifier');
    sessionStorage.setItem('leski:oauth-legal-intent', JSON.stringify({ ...versions, method: 'google', created: Date.now() }));
  }, { terms: legalOperator.termsVersion, privacy: legalOperator.privacyVersion });
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: uiAccount, role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'synthetic'].join('.');
  let exchanges = 0, acceptances = 0, logouts = 0, available = temporary;
  page.on('request', request => { if (request.url().includes('/auth/v1/logout')) logouts++; });
  await page.route('**/auth/v1/token*', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    exchanges++;
    return route.fulfill({ headers: cors, json: { access_token: token, refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer',
      user: { id: uiAccount, email: state.profile.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: {} } } });
  });
  await page.route('**/rpc/accept_legal_versions', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    acceptances++;
    if (!available || acceptances === 1) return route.fulfill({ status: temporary ? 401 : 503, headers: cors, json: { code: 'PGRST301', message: 'Temporarily unavailable' } });
    return route.fulfill({ headers: cors, json: 'confirmed-receipt' });
  });
  await page.route('**/rpc/resolve_partner_access', route => route.fulfill({ headers: cors,
    json: { status: 'ready', role: 'CUSTOMER', destination: '/customer/home' } }));
  await page.goto('/auth/callback?code=one-use-code');
  if (!temporary) {
    await expect(page.getByRole('alert')).toBeVisible();
    expect(acceptances).toBe(3); available = true;
    await page.getByRole('button', { name: 'Опитай отново', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/customer\/home$/);
  const welcome = page.getByRole('dialog', { name: 'Добре дошъл', exact: true });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Ясно, започваме' }).click();
  await expect(page.getByRole('button', { name: 'От моята локация' })).toBeVisible();
  expect(exchanges).toBe(1); expect(logouts).toBe(0);
  expect(acceptances).toBe(temporary ? 2 : 4); expect(state.welcomeClaims).toBe(1);
  expect(state.errors).toEqual([]);
});
