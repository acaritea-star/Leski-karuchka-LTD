// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginDriverApplicationLogin, consumeAuthReturn } from './authReturn';
afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); });
describe('application OAuth return', () => {
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
