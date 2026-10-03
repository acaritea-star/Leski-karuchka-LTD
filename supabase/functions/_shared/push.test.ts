import { describe, expect, it } from 'vitest';
import { classifyPushFailure, isAllowedPushEndpoint, isUuid, pushTtl } from './push';

describe('push delivery boundaries', () => {
  it('accepts known providers and rejects arbitrary hosts, credentials and deceptive suffixes', () => {
    for (const endpoint of ['https://fcm.googleapis.com/push/token', 'https://web.push.apple.com/token',
      'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://wns.notify.windows.com/token']) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(true);
    }
    for (const endpoint of ['https://127.0.0.1/token', 'http://fcm.googleapis.com/token',
      'https://fcm.googleapis.com.attacker.test/token', 'https://attacker@fcm.googleapis.com/token',
      'https://fcm.googleapis.com:8443/token', 'https://evilpush.services.mozilla.com/token', 'not a URL']) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    }
  });
  it('retries rate limits/network/server failures and removes only expired devices', () => {
    for (const statusCode of [404, 410]) expect(classifyPushFailure({ statusCode })).toBe('expired');
    for (const statusCode of [408, 429, 500, 503]) expect(classifyPushFailure({ statusCode })).toBe('retry');
    expect(classifyPushFailure(new Error('network interrupted'))).toBe('retry');
    for (const statusCode of [400, 401, 403]) expect(classifyPushFailure({ statusCode })).toBe('permanent');
  });
  it('caps provider TTL at the event deadline and rejects expired/invalid times', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(pushTtl('2026-10-03T12:02:00Z', now)).toBe(120);
    expect(pushTtl('2026-10-03T12:10:00Z', now)).toBe(300);
    expect(pushTtl('2026-10-03T11:59:00Z', now)).toBe(0);
    expect(pushTtl('invalid', now)).toBe(0);
  });
  it('requires both capability identifiers to be UUIDs', () => {
    expect(isUuid(crypto.randomUUID())).toBe(true);
    expect(isUuid('')).toBe(false); expect(isUuid(null)).toBe(false); expect(isUuid({})).toBe(false);
  });
});
