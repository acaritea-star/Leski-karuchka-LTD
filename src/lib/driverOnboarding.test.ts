// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import document from '@/config/driverPreparation.json';
import { acceptApplicationPreparation, parseOnboarding, pendingApplicationUpload, prepareApplicationUpload, uploadApplicationDocument } from './driverOnboarding';
import { webcrypto } from 'node:crypto';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc: mock.rpc, storage: { from: () => ({ upload: mock.upload }) } } }));
const account = '11111111-1111-4111-8111-111111111111', company = '22222222-2222-4222-8222-222222222222', application = '33333333-3333-4333-8333-333333333333';
const base = () => ({ application: { id: application, user_id: account, company_id: company, status: 'pending', has_vehicle: true, onboarding_revision: 1, submitted_at: null }, company_name: 'Test', documents: [], preparation: { document, content_hash: 'a'.repeat(64), receipt: null } });
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe('onboarding identity and network recovery', () => {
  it('rejects another company’s personal receipt instead of treating training as complete', () => {
    const data = base();
    const receipt = { id: application, application_id: application, user_id: account, company_id: application, terms_version: document.termsVersion, training_version: document.trainingVersion, content_hash: 'a'.repeat(64), accepted_at: '2026-10-10T00:00:00Z', training_completed_at: '2026-10-10T00:00:00Z' };
    expect(() => parseOnboarding({ ...data, preparation: { ...data.preparation, receipt } }, application)).toThrow();
  });
  it('rejects another person’s file path even when other document fields match', () => {
    const data = base();
    expect(() => parseOnboarding({ ...data, documents: [{ id: application, application_id: application, company_id: company, user_id: account, type: 'license', expires_at: '2099-01-01', file_url: `storage://driver-documents/${company}/${application}/${application}.pdf` }] }, application)).toThrow();
  });
  it('does not accept an unconfirmed POST as legal success', async () => {
    mock.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: null, error: null }) });
    await expect(acceptApplicationPreparation(parseOnboarding(base(), application), {})).rejects.toThrow();
  });
  it('confirms the exact immutable document after an upload response is lost', async () => {
    const a = parseOnboarding(base(), application).application;
    const file = { type: 'application/pdf', size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as File;
    const command = await prepareApplicationUpload(a, 'vehicle_registration', null, file);
    expect(command.path).toMatch(new RegExp(`^${account}/${application}/`));
    mock.upload.mockRejectedValue(new Error('Lost response'));
    mock.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: command.id, error: null }) });
    await uploadApplicationDocument(a, command, file);
    expect(mock.rpc).toHaveBeenCalledWith('register_application_document', expect.objectContaining({ p_application: application, p_id: command.id, p_expires: null }));
    expect(pendingApplicationUpload(a, 'vehicle_registration')).toBeNull();
  });
  it('keeps an ambiguous upload recoverable and reuses its ID on retry', async () => {
    const a = parseOnboarding(base(), application).application;
    const file = { type: 'application/pdf', size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as File;
    const first = await prepareApplicationUpload(a, 'license', '2099-01-01', file);
    mock.upload.mockRejectedValue(new Error('No connection'));
    mock.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: null, error: new Error('No connection') }) });
    await expect(uploadApplicationDocument(a, first, file)).rejects.toThrow();
    expect((await prepareApplicationUpload(a, 'license', '2099-01-01', file)).id).toBe(first.id);
    expect(pendingApplicationUpload(a, 'license')?.id).toBe(first.id);
  });
});
