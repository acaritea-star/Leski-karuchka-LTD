import { afterEach, expect, it, vi } from 'vitest';
import { createAuthFetch } from './authFetch';
const base = 'https://project.supabase.co';
afterEach(() => vi.useRealTimers());
it('bounds a hung auth request, aborts its transport and permits a subsequent request', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(new Response('{"ok":true}'));
  const wrapped = createAuthFetch(base, fetcher);
  const pending = wrapped(`${base}/auth/v1/token`);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(20_000);
  await rejected;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(await (await wrapped(`${base}/auth/v1/token`)).json()).toEqual({ ok: true });
});
it('also bounds a hung body after headers have arrived', async () => {
  vi.useFakeTimers();
  let stream!: ReadableStreamDefaultController;
  const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const pending = createAuthFetch(base, fetcher)(`${base}/auth/v1/user`);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(20_000); await rejected;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  stream.close();
});
it('keeps status and headers including empty sign-out responses', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204, headers: { 'x-test': 'yes' } }));
  const response = await createAuthFetch(base, fetcher)(`${base}/auth/v1/logout`);
  expect(response.status).toBe(204); expect(response.headers.get('x-test')).toBe('yes');
});
it('passes storage and database requests through and honors an already aborted caller', async () => {
  const response = new Response('data');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const wrapped = createAuthFetch(base, fetcher);
  expect(await wrapped(`${base}/rest/v1/profiles`)).toBe(response);
  const controller = new AbortController(); controller.abort();
  await expect(wrapped(`${base}/auth/v1/token`, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
