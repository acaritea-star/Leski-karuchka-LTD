import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { invitationUrl, parsePartnerAccess } from './partnerAccess';
describe('partner access responses', () => {
  it.each([null, [], {}, { status: 'ready', destination: 'https://evil.example' }, { status: 'ready', destination: '/admin/drivers' }, { status: 'preparation', destination: '/driver/access' }])('rejects an unconfirmed or unsupported result', result => {
    expect(() => parsePartnerAccess(result)).toThrow();
  });
  it('keeps a denied invitation as an explanation without a privileged destination', () => {
    expect(parsePartnerAccess({ status: 'denied', message: 'Exact invited email required' }).status).toBe('denied');
  });
  it('accepts the server-bound company for preparation', () => {
    expect(parsePartnerAccess({ status: 'preparation', destination: '/driver/access', company_id: 'company' }).company_id).toBe('company');
    expect(invitationUrl('driver', 'id')).toBe('https://leskikaruchka.com/driver/login?invite=id');
  });
});
