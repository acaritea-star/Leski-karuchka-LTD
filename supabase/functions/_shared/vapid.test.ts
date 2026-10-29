import { expect, it, vi } from 'vitest';
import { createVapidHandler, readVapidKeys } from './vapid';
const request = () => new Request('https://example.invalid/key', { method: 'POST' });
it('returns only the public key after successful authorization', async () => {
  const authorize = vi.fn(async () => undefined);
  const handler = createVapidHandler(authorize, async () => ({ publicKey: 'stable-public', privateKey: 'never-expose' }));
  const response = await handler(request());
  expect(authorize).toHaveBeenCalledOnce();
  expect(await response.text()).not.toContain('never-expose');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it('preserves authentication, MFA and rate-limit rejection without reading keys', async () => {
  for (const status of [401,403,429]) {
    const read = vi.fn();
    const handler = createVapidHandler(async () => { throw new Response('Denied', { status }); }, read);
    expect((await handler(request())).status).toBe(status); expect(read).not.toHaveBeenCalled();
  }
});
it('hides backend errors and never creates keys on a failed read', async () => {
  const rpc = vi.fn(async () => ({ data: null, error: { message: 'private-token' } }));
  const handler = createVapidHandler(async () => undefined, () => readVapidKeys({ rpc }));
  const response = await handler(request());
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-token');
  expect(rpc.mock.calls).toEqual([['read_push_vapid_keys']]);
});
it('keeps the pair from the server intact and rejects partial configuration', async () => {
  const pair = { publicKey: 'public', privateKey: 'private' };
  expect(await readVapidKeys({ rpc: async () => ({ data: pair, error: null }) })).toEqual(pair);
  await expect(readVapidKeys({ rpc: async () => ({ data: { publicKey: 'public' }, error: null }) })).rejects.toThrow();
});
