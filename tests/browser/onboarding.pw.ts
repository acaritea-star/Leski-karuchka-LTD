import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = readFileSync('src/config/driverPreparation.json', 'utf8'), document = JSON.parse(source), contentHash = createHash('sha256').update(source).digest('hex');
const company = '22222222-2222-4222-8222-222222222222', account = '11111111-1111-4111-8111-111111111111', application = '33333333-3333-4333-8333-333333333333', category = '44444444-4444-4444-8444-444444444444', driver = '55555555-5555-4555-8555-555555555555';
const app = () => ({ id: application, user_id: account, company_id: company, full_name: 'Тест Водач', phone: '+359000000000', email: 'synthetic@example.invalid', experience: '1–3', has_vehicle: true, message: '', status: 'pending', onboarding_required: true, onboarding_revision: 0, submitted_at: null as string | null, vehicle_details: null as Record<string, string> | null });
const receipt = () => ({ id: '66666666-6666-4666-8666-666666666666', application_id: application, user_id: account, company_id: company, terms_version: document.termsVersion, training_version: document.trainingVersion, content_hash: contentHash, accepted_at: '2026-10-10T16:00:00Z', training_completed_at: '2026-10-10T16:00:00Z' });
async function session(page: Page, id: string) {
  const user = { id, email: 'synthetic@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'google' } };
  await page.addInitScript(user => {
    const token = [btoa(JSON.stringify({ alg: 'HS256' })), btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })), 'synthetic'].join('.');
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
    localStorage.setItem('i18nextLng', 'bg');
    const savedAt = Date.now(); localStorage.setItem('lk_cookie_consent_v3', JSON.stringify({ version: 3, savedAt, expiresAt: savedAt + 180 * 86400000, consent: { necessary: true, functional: true, analytics: false, marketing: false } }));
  }, user);
  return user;
}
async function train(page: Page) {
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Продължи', exact: true }).click();
  await page.getByRole('button', { name: 'Към кратката проверка' }).click();
  await page.getByRole('radio', { name: 'Не. Държа приложението отворено и проверявам връзката и GPS.' }).check();
  await page.getByRole('radio', { name: 'Не. Записвам реалното плащане и го сверявам с документите.' }).check();
  await page.getByRole('radio', { name: 'Действителният превозвач и водачът; платформата има свои задължения по закон.' }).check();
  await page.getByRole('button', { name: 'Приеми условията и завърши подготовката' }).click();
}

test('invited candidate prepares a complete own-car package before any driver role, recovering a lost training reply', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const user = await session(page, account); let a: ReturnType<typeof app> | null = null, r: ReturnType<typeof receipt> | null = null;
  const docs: Record<string, unknown>[] = []; let accepts = 0, submits = 0, google = 0;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4100') return route.continue();
    if (url.origin !== 'http://127.0.0.1:54329') { if (/maps\.google|maps\.googleapis|places\.googleapis|routes\.googleapis/.test(url.hostname)) google++; return route.abort(); }
    let data: unknown = [];
    if (url.pathname.endsWith('/auth/v1/user')) data = user;
    else if (url.pathname.endsWith('/profiles')) data = { id: account, role: 'CUSTOMER', is_active: true, company_id: null, first_name: 'Тест', last_name: 'Водач', phone: '+359000000000', email: user.email };
    else if (url.pathname.endsWith('/companies')) data = [{ id: company, name: 'Поканилата фирма', is_active: true }, { id: category, name: 'Друга фирма', is_active: true }];
    else if (url.pathname.endsWith('/legal_acceptances')) data = { id: driver };
    else if (url.pathname.endsWith('/driver_applications')) data = a;
    else if (url.pathname.endsWith('/submit_driver_application')) { expect(route.request().postDataJSON().p_company).toBe(company); a = app(); data = application; }
    else if (url.pathname.endsWith('/driver_onboarding')) data = { application: a, company_name: 'Поканилата фирма', documents: docs, preparation: { document, content_hash: contentHash, receipt: r } };
    else if (url.pathname.endsWith('/accept_application_preparation')) { accepts++; r = receipt(); a!.onboarding_revision++; return route.abort(); }
    else if (url.pathname.endsWith('/save_application_vehicle')) { a!.vehicle_details = route.request().postDataJSON().p_details; a!.onboarding_revision++; data = application; }
    else if (url.pathname.endsWith('/register_application_document')) {
      const b = route.request().postDataJSON();
      expect(b.p_application).toBe(application);
      if (b.p_type === 'vehicle_registration') expect(b.p_expires).toBeNull();
      docs.push({ id: b.p_id, application_id: application, user_id: account, company_id: company, type: b.p_type, expires_at: b.p_expires, file_url: 'storage://driver-documents/' + b.p_path });
      a!.onboarding_revision++; data = b.p_id;
    } else if (url.pathname.endsWith('/submit_driver_onboarding')) { submits++; expect(docs).toHaveLength(3); expect(r).not.toBeNull(); a!.submitted_at = new Date().toISOString(); data = application; }
    else if (url.pathname.includes('/storage/v1/object/')) data = { Key: 'fixture', Id: driver };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('/driver-join?company=' + company);
  await expect(page.getByLabel('Фирма, към която кандидатстваш')).toHaveValue(company);
  await expect(page.getByRole('option', { name: 'Друга фирма' })).toHaveCount(0);
  await page.locator('select[name=experience]').selectOption('1–3'); await page.locator('select[name=vehicle]').selectOption('yes');
  await page.getByRole('button', { name: 'Продължи към правата и подготовката' }).click();
  await expect(page.getByRole('form', { name: 'Качване: Шофьорска книжка' })).toHaveCount(0);
  await train(page);
  await expect(page.getByRole('heading', { name: '2. Документи и автомобил' })).toBeVisible();
  await page.getByLabel('Марка', { exact: true }).fill('Тест'); await page.getByLabel('Модел', { exact: true }).fill('Автомобил');
  await page.getByLabel('Регистрационен номер', { exact: true }).fill('A1234BC');
  await page.getByLabel('Застраховка до', { exact: true }).fill('2099-01-01'); await page.getByLabel('Технически преглед до', { exact: true }).fill('2099-02-01');
  await page.getByRole('button', { name: 'Запази избора и данните' }).click();
  for (const name of ['Шофьорска книжка', 'Застраховка на автомобила', 'Свидетелство за регистрация на автомобила']) {
    const form = page.getByRole('form', { name: 'Качване: ' + name });
    if (name !== 'Свидетелство за регистрация на автомобила') await form.getByLabel('Валиден до').fill('2099-01-01');
    await form.getByLabel('Файл').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF synthetic') });
    await form.getByRole('button', { name: 'Качи документа', exact: true }).click();
    await expect(form).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Изпрати целия пакет за проверка' }).click();
  await expect(page.getByText('Пакетът е изпратен.', { exact: false })).toBeVisible();
  await page.reload(); await expect(page.getByText('Пакетът е изпратен.', { exact: false })).toBeVisible();
  expect(accepts).toBe(1); expect(submits).toBe(1); expect(google).toBe(0); expect(errors).toEqual([]);
});

test('company admin reviews files and verifies a complete package with one action and a lost-response recovery', async ({ page, context }) => {
  const adminId = '77777777-7777-4777-8777-777777777777', user = await session(page, adminId);
  const a = app(); a.submitted_at = '2026-10-10T16:00:00Z'; a.onboarding_revision = 5;
  a.vehicle_details = { make: 'Тест', model: 'Кола', registration_number: 'A1234BC', insurance_expiry_date: '2099-01-01', inspection_expiry_date: '2099-02-01' };
  const docs = ['license', 'insurance', 'vehicle_registration'].map((type, i) => ({ id: `88888888-8888-4888-8888-88888888888${i}`, application_id: application, company_id: company, user_id: account, type, expires_at: type === 'vehicle_registration' ? null : '2099-01-01', file_url: `storage://driver-documents/${account}/${application}/88888888-8888-4888-8888-88888888888${i}.pdf` }));
  let verified = false, writes = 0;
  await adminRoutes(context);
  async function adminRoutes(context: BrowserContext) {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4100') return route.continue();
      if (url.origin !== 'http://127.0.0.1:54329') return route.abort();
      let data: unknown = [];
      if (url.pathname.endsWith('/auth/v1/user')) data = user;
      else if (url.pathname.endsWith('/profiles')) data = url.searchParams.get('id')?.startsWith('in.') ? [{ id: account, first_name: 'Тест', last_name: 'Водач' }] : { id: adminId, role: 'COMPANY_ADMIN', is_active: true, company_id: company, first_name: 'Админ', last_name: 'Тест' };
      else if (url.pathname.endsWith('/companies')) data = [{ id: company, name: 'Тестова фирма', is_active: true }];
      else if (url.pathname.endsWith('/legal_acceptances')) data = { id: driver };
      else if (url.pathname.endsWith('/driver_applications')) data = verified ? [] : [a];
      else if (url.pathname.endsWith('/drivers')) data = verified ? [{ id: driver, user_id: account, company_id: company, is_verified: true, is_online: false, total_trips: 0, rating: 5, document_verification_required: true }] : [];
      else if (url.pathname.endsWith('/vehicle_types')) data = [{ id: category, name: 'Стандарт' }];
      else if (url.pathname.endsWith('/driver_onboarding')) data = { application: a, company_name: 'Тестова фирма', documents: docs, preparation: { document, content_hash: contentHash, receipt: receipt() } };
      else if (url.pathname.includes('/storage/v1/object/sign/')) data = { signedURL: '/object/sign/driver-documents/fixture.pdf?token=synthetic' };
      else if (url.pathname.endsWith('/verify_driver_application')) { writes++; const b = route.request().postDataJSON(); expect(b.p_revision).toBe(5); expect(b.p_category).toBe(category); expect(b.p_checks_confirmed).toBe(true); verified = true; a.status = 'approved'; return route.abort(); }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
    });
  }
  await page.goto('/admin/drivers');
  await page.getByRole('button', { name: 'Добави шофьор', exact: true }).click();
  await expect(page.getByLabel('Фирмен линк за присъединяване')).toHaveValue('http://127.0.0.1:4100/driver-join?company=' + company);
  await page.getByRole('button', { name: 'Прегледай целия пакет' }).click();
  const approve = page.getByRole('button', { name: 'Одобри и верифицирай наведнъж' });
  await expect(approve).toBeDisabled();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Прегледай', exact: true }).first().click();
  await page.getByRole('checkbox', { name: /Проверих четливостта/ }).check();
  await expect(approve).toBeEnabled(); await approve.click();
  await expect(page.getByText('Верифициран', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
});
