import { describe, expect, it } from 'vitest';
import document from '@/config/driverPreparation.json';
import { parseDriverPreparation, parsePreparationReceipt, preparationCopy } from './driverPreparation';
const id = '11111111-1111-4111-8111-111111111111';
const receipt = { id, driver_id: id, user_id: id, company_id: id, terms_version: document.termsVersion, training_version: document.trainingVersion, content_hash: 'a'.repeat(64), accepted_at: '2026-10-09T19:00:00Z', training_completed_at: '2026-10-09T19:00:00Z' };
const materials = { driver_id: id, document, content_hash: receipt.content_hash, receipt };
describe('driver acceptance evidence', () => {
  it('rejects another driver or a receipt for a different document instead of showing success', () => {
    expect(() => parseDriverPreparation(materials, '22222222-2222-4222-8222-222222222222')).toThrow();
    expect(() => parseDriverPreparation({ ...materials, receipt: { ...receipt, terms_version: 'older' } })).toThrow();
    expect(() => parseDriverPreparation({ ...materials, receipt: { ...receipt, content_hash: 'b'.repeat(64) } })).toThrow();
  });
  it('rejects incomplete training or missing timestamps', () => {
    expect(() => parseDriverPreparation({ ...materials, document: { ...document, questions: [] } })).toThrow();
    expect(() => parsePreparationReceipt({ ...receipt, training_completed_at: null }, id, document.termsVersion, document.trainingVersion, receipt.content_hash)).toThrow();
    expect(() => parseDriverPreparation({ ...materials, receipt: undefined })).toThrow();
  });
  it('provides a durable plain-text copy containing the accepted version, receipt and lawful limits', () => {
    const parsed = parseDriverPreparation(materials);
    const copy = preparationCopy(parsed);
    expect(copy).toContain(receipt.id); expect(copy).toContain(receipt.accepted_at);
    expect(copy).toContain('Обучение завършено'); expect(copy).toContain('умисъл, груба небрежност');
    expect(copy).toContain(document.termsVersion); expect(copy).toContain(receipt.content_hash);
  });
});
