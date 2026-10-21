import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setupUi, uiCompany, uiDriver } from './helpers/uiFixture';
const candidate = '55555555-5555-4555-8555-555555555555';
const application = '66666666-6666-4666-8666-666666666666';
const car = '77777777-7777-4777-8777-777777777777';
const category = '44444444-4444-4444-8444-444444444444';
const source = readFileSync('src/config/driverPreparation.json', 'utf8'), document = JSON.parse(source), contentHash = createHash('sha256').update(source).digest('hex');
const doc = (type: string, id: string) => ({ id, application_id: application, company_id: uiCompany, user_id: candidate, type, expires_at: '2099-01-01', file_url: `storage://driver-documents/${candidate}/${application}/${id}.pdf` });

async function setupReview(page: Page) {
  const ui = await setupUi(page, 'COMPANY_ADMIN');
  const a = { id: application, company_id: uiCompany, user_id: candidate, full_name: 'Синтетичен Кандидат', phone: '+359000000000', email: 'candidate@example.invalid', experience: '1', message: '', status: 'pending', has_vehicle: false, onboarding_required: true, onboarding_revision: 3, submitted_at: '2026-10-21T10:00:00Z', vehicle_details: null };
  const docs = [doc('license', '88888888-8888-4888-8888-888888888881')];
  const state = { ui, a, docs, verificationWrites: 0, failSignedUrl: false, permit: '2099-01-01', loseVerificationReply: false };
  await page.context().route('**/storage/v1/object/sign/**', route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'Synthetic private document, no personal data' }));
  await page.route('**/storage/v1/**', async route => {
    if (new URL(route.request().url()).pathname.includes('/object/sign/')) return route.fulfill({ status: state.failSignedUrl ? 503 : 200, contentType: 'application/json', body: JSON.stringify(state.failSignedUrl ? { message: 'Файлът не се отвори. Опитайте отново.' } : { signedURL: '/object/sign/driver-documents/fixture.pdf?token=synthetic' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'fixture' }) });
  });
  await page.route('**/rest/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path.endsWith('/companies')) data = [{ id: uiCompany, name: 'Синтетична фирма', is_active: true, setup_completed_at: '2026-10-21T10:00:00Z', permit_expires_on: state.permit }];
    else if (path.endsWith('/driver_applications')) data = a.status === 'pending' ? [a] : [];
    else if (path.endsWith('/vehicles')) data = [{ id: car, company_id: uiCompany, is_active: true, vehicle_type_id: category, make: 'Тест', model: 'Кола', registration_number: 'TEST-001', insurance_expiry_date: '2099-01-01', inspection_expiry_date: '2099-02-01' }];
    else if (path.endsWith('/drivers')) data = [];
    else if (path.endsWith('/vehicle_types')) data = [{ id: category, company_id: uiCompany, is_active: true, name: 'Стандарт' }];
    else if (path.endsWith('/company_driver_page')) data = { total: a.status === 'approved' ? 1 : 0, rows: a.status === 'approved' ? [{ id: uiDriver, company_id: uiCompany, user_id: candidate, first_name: 'Синтетичен', last_name: 'Кандидат', is_verified: true, is_online: false, online_now: false, gps_received_at: null, gps_position_at: null, rating: 5, total_trips: 0, document_verification_required: true }] : [] };
    else if (path.endsWith('/driver_onboarding')) data = { application: a, company_name: 'Синтетична фирма', documents: docs, preparation: { document, content_hash: contentHash, receipt: { id: uiDriver, application_id: application, company_id: uiCompany, user_id: candidate, terms_version: document.termsVersion, training_version: document.trainingVersion, content_hash: contentHash, accepted_at: '2026-10-21T10:00:00Z', training_completed_at: '2026-10-21T10:00:00Z' } } };
    else if (path.endsWith('/register_application_document')) {
      const b = route.request().postDataJSON(); expect(b.p_application).toBe(application); expect(b.p_expires).toBe('2099-01-01');
      docs.push(doc('insurance', b.p_id)); a.onboarding_revision++; data = b.p_id;
    } else if (path.endsWith('/verify_driver_application')) {
      state.verificationWrites++; const b = route.request().postDataJSON(); expect(b.p_revision).toBe(a.onboarding_revision); expect(b.p_vehicle).toBe(car); expect(b.p_category).toBeNull(); expect(b.p_checks_confirmed).toBe(true);
      a.status = 'approved'; data = uiDriver; if (state.loseVerificationReply) return route.abort();
    } else return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/admin/drivers');
  await page.getByRole('button', { name: 'Кандидатури за одобрение', exact: true }).click();
  await expect(page.getByLabel('Имейл на шофьора')).toHaveCount(0);
  await page.getByRole('button', { name: 'Прегледай целия пакет', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Общ преглед: Синтетичен Кандидат' })).toBeVisible();
  return state;
}
async function openAll(page: Page) {
  const buttons = page.getByRole('button', { name: 'Прегледай', exact: true });
  while (await buttons.count()) {
    const before = await buttons.count();
    await buttons.first().click(); await expect(buttons).toHaveCount(before - 1);
    for (const popup of page.context().pages()) if (popup !== page) await popup.close();
  }
}

for (const lost of [false, true]) test(`company-car review preserves selection and reviewed files after upload; verification reply lost=${lost}`, async ({ page }, testInfo) => {
  const state = await setupReview(page); state.loseVerificationReply = lost;
  const review = page.getByRole('region', { name: 'Верификация на кандидат', exact: true });
  const approve = page.getByRole('button', { name: 'Одобри шофьора' });
  await expect(approve).toBeDisabled();
  await expect(page.getByLabel('Остава за верификация')).toContainText('Изберете свободен фирмен автомобил');
  await page.getByLabel('Назначете свободен фирмен автомобил').selectOption(car);
  await openAll(page);
  await expect(page.getByRole('region', { name: 'Верификация на кандидат', exact: true }).getByRole('checkbox')).toHaveCount(0);
  const form = page.getByRole('form', { name: 'Качване: Застраховка на автомобила' });
  await expect(form.getByLabel('Валиден до')).toHaveValue('2099-01-01');
  await form.getByLabel('Файл').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF synthetic') });
  await form.getByRole('button', { name: 'Качи документа', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByLabel('Назначете свободен фирмен автомобил')).toHaveValue(car);
  await expect(review.getByText('Прегледани документи: 1 от 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Одобри шофьора' })).toBeDisabled();
  await openAll(page); await expect(page.getByRole('region', { name: 'Верификация на кандидат', exact: true }).getByRole('checkbox')).toHaveCount(0);
  await expect(approve).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('driver-review-ready.png'), fullPage: true });
  await approve.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
  await expect(page.getByText('Верифициран', { exact: true })).toHaveCount(1);
  expect(state.verificationWrites).toBe(1); expect(state.ui.errors).toEqual([]);
});

test('a replaced document requires review and confirmation again while keeping the vehicle', async ({ page }) => {
  const state = await setupReview(page); state.docs.push(doc('insurance', '88888888-8888-4888-8888-888888888882'));
  await page.getByRole('button', { name: 'Обнови пакета', exact: true }).click();
  await page.getByLabel('Назначете свободен фирмен автомобил').selectOption(car);
  await openAll(page); await expect(page.getByRole('region', { name: 'Верификация на кандидат', exact: true }).getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Одобри шофьора' })).toBeEnabled();
  state.docs[0] = doc('license', '88888888-8888-4888-8888-888888888883'); state.a.onboarding_revision++;
  await page.getByRole('button', { name: 'Обнови пакета', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Верификация на кандидат', exact: true }).getByText('Прегледани документи: 1 от 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Одобри шофьора' })).toBeDisabled();
  await expect(page.getByLabel('Назначете свободен фирмен автомобил')).toHaveValue(car);
  await expect(page.getByRole('button', { name: 'Одобри шофьора' })).toBeDisabled(); expect(state.verificationWrites).toBe(0);
});

test('a failed document preview and expired company permit explain the blocked approval', async ({ page }) => {
  const state = await setupReview(page); state.failSignedUrl = true;
  await page.getByRole('button', { name: 'Прегледай', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Файлът не се отвори');
  await expect(page.getByRole('button', { name: 'Одобри шофьора' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Прегледай', exact: true })).toHaveCount(1);
  state.failSignedUrl = false; state.permit = '2020-01-01';
  await page.getByRole('button', { name: 'Обнови автомобилите и изискванията' }).click();
  await expect(page.getByLabel('Остава за верификация')).toContainText('Попълнете валидния срок на разрешението');
  expect(state.verificationWrites).toBe(0);
});

test('blocked popup keeps the document unreviewed and tells the administrator how to continue', async ({ page }) => {
  const state = await setupReview(page);
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: 'Прегледай', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Разрешете отварянето на документите');
  await expect(page.getByRole('button', { name: 'Одобри шофьора' })).toBeDisabled();
  expect(state.verificationWrites).toBe(0);
});

for (const lost of [false, true]) test(`existing driver can verify inside document details after approval; reply lost=${lost}`, async ({ page }) => {
  const ui = await setupUi(page, 'COMPANY_ADMIN');
  let verified = false, approved = false, writes = 0;
  const license = '88888888-8888-4888-8888-888888888881';
  const row = () => ({ id: uiDriver, company_id: uiCompany, user_id: candidate, first_name: 'Вече добавен', last_name: 'Шофьор', is_verified: verified, is_online: false, online_now: false, rating: 5, total_trips: 0, document_verification_required: true, gps_received_at: null, gps_position_at: null });
  await page.route('**/rest/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname; let data: unknown;
    if (path.endsWith('/company_driver_page')) data = { total: 1, rows: [row()] };
    else if (path.endsWith('/driver_verification_status')) data = { driver_id: uiDriver, is_verified: verified, can_verify: approved, blockers: approved ? [] : [{ code: 'license', message: 'Шофьорска книжка: чака одобрение от фирмата.' }], warnings: [], documents: { license: { state: approved ? 'approved' : 'pending', expires_at: '2099-01-01' }, insurance: { state: 'approved', expires_at: '2099-01-01' } } };
    else if (path.endsWith('/driver_documents')) {
      if (req.method() === 'PATCH') { expect(req.postDataJSON().status).toBe('approved'); approved = true; data = { id: license }; }
      else data = [{ id: license, driver_id: uiDriver, company_id: uiCompany, type: 'license', file_url: `storage://driver-documents/${candidate}/${license}.pdf`, expires_at: '2099-01-01', status: approved ? 'approved' : 'pending', created_at: '2026-10-21T10:00:00Z' }];
    } else if (path.endsWith('/drivers')) {
      if (req.method() === 'PATCH') {
        writes++; expect(req.postDataJSON()).toEqual({ is_verified: true }); expect(new URL(req.url()).searchParams.get('company_id')).toBe('eq.' + uiCompany);
        verified = true; if (lost) return route.abort(); data = { id: uiDriver };
      } else data = { is_verified: verified };
    } else return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/admin/drivers');
  await page.getByRole('button', { name: 'Верифицирай', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Документи на шофьора' });
  const verify = modal.getByRole('button', { name: 'Верифицирай шофьора' });
  await expect(verify).toBeDisabled(); await expect(modal).toContainText('чака одобрение');
  await modal.getByRole('button', { name: 'Одобри', exact: true }).click();
  await expect(verify).toBeEnabled();
  await verify.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
  await expect(modal.getByText('✓ Шофьорът е верифициран.', { exact: true })).toBeVisible();
  await expect(verify).toHaveCount(0);
  expect(writes).toBe(1); expect(ui.errors).toEqual([]);
});
