import { afterEach, expect, it, vi } from 'vitest';
import { deliverInvitation, invitationEmail } from './partnerInvitationEmail';
const mail = { id: '22222222-2222-4222-8222-222222222222', kind: 'driver' as const, email: 'synthetic@example.invalid', company_name: '<img src=x onerror=alert(1)>', attempt: 1 };
afterEach(() => vi.useRealTimers());
it('escapes company data and includes the same exact-account instructions in HTML and text', () => {
  const result = invitationEmail(mail);
  expect(result.html).not.toContain('<img src=x'); expect(result.html).toContain('&lt;img');
  expect(result.html).toContain(mail.email); expect(result.text).toContain(mail.email);
  expect(result.url).toBe('https://leskikaruchka.com/driver/login?invite=' + mail.id);
  expect(result.key).toBe('partner-invitation/' + mail.id + '/1');
});
it('retries transient errors with the same key and payload', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{"id":"message"}', { status: 200 }));
  const send = deliverInvitation(mail, 'synthetic-test-key', 'pokani@example.invalid', 'support@example.invalid', fetcher);
  await vi.runAllTimersAsync(); expect(await send).toBe('message');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const first = fetcher.mock.calls[0][1], second = fetcher.mock.calls[1][1];
  expect(first.headers['Idempotency-Key']).toBe(second.headers['Idempotency-Key']); expect(first.body).toBe(second.body);
});
it('does not retry a permanent sending error or report success', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
  await expect(deliverInvitation(mail, 'synthetic-test-key', 'from', 'reply', fetcher)).rejects.toThrow('email_delivery_failed');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
