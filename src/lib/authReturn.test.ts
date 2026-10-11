// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginCompanyLogin, beginDriverApplicationLogin, consumeAuthReturn, beginPartnerLogin, invitationId } from './authReturn';
afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); });
describe('application OAuth return', () => {
  it.each(['company', 'driver'] as const)('keeps a named %s invitation across OAuth exactly once', kind => {
    const id = '22222222-2222-4222-8222-222222222222';
    beginPartnerLogin(kind, id); expect(consumeAuthReturn()).toBe((kind === 'company' ? '/company' : '/driver/access') + '?invite=' + id);
    expect(consumeAuthReturn()).toBe('/app');
    expect(invitationId('?invite=https://evil.example')).toBeUndefined();
  });
  it('keeps the company entry through OAuth exactly once without accepting a tenant or role', () => {
    beginCompanyLogin();
    expect(consumeAuthReturn()).toBe('/company');
    expect(consumeAuthReturn()).toBe('/app');
  });
  it('expires the company entry', () => {
    vi.useFakeTimers(); beginCompanyLogin(); vi.advanceTimersByTime(31 * 60_000);
    expect(consumeAuthReturn()).toBe('/app');
  });
  it('returns to the application exactly once', () => { beginDriverApplicationLogin(); expect(consumeAuthReturn()).toBe('/driver-join'); expect(consumeAuthReturn()).toBe('/app'); });
  it('keeps the invited company through OAuth without accepting arbitrary destinations', () => {
    const company = '22222222-2222-4222-8222-222222222222';
    beginDriverApplicationLogin(company); expect(consumeAuthReturn()).toBe('/driver-join?company=' + company);
    beginDriverApplicationLogin('//evil.example'); expect(consumeAuthReturn()).toBe('/driver-join');
  });
  it('rejects an expired application intent', () => { vi.useFakeTimers(); beginDriverApplicationLogin(); vi.advanceTimersByTime(31 * 60_000); expect(consumeAuthReturn()).toBe('/app'); });
  it.each(['https://evil.example', '//evil.example', '/admin/drivers'])('rejects an arbitrary destination %s', path => {
    sessionStorage.setItem('leski:auth-return', JSON.stringify({ path, expires: Date.now() + 10_000 })); expect(consumeAuthReturn()).toBe('/app');
  });
});
