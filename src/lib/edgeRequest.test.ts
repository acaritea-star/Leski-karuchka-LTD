import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: session } }, supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'public-key' }));
import { invokeEdge } from './edgeRequest';
beforeEach(() => { vi.useFakeTimers(); session.mockReset().mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null }); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('sends one authenticated JSON request and reads the result within the same deadline', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true })));
  await expect(invokeEdge('google-routes', { origin: { lat: 43, lng: 25 } }, 1000)).resolves.toMatchObject({ data: { success: true }, error: null });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith('https://project.supabase.co/functions/v1/google-routes', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer session-token', apikey: 'public-key' }), signal: expect.anything() }));
  expect(vi.getTimerCount()).toBe(0);
});
it('never starts a billable request after the session was held beyond the deadline', async () => {
  let release!: (value: unknown) => void;
  session.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const task = invokeEdge('google-routes', {}, 1000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await task).toMatchObject({ data: null, error: { name: 'TimeoutError' } });
  release({ data: { session: { access_token: 'session-token' } }, error: null });
  await Promise.resolve(); await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
});
it('times out a stalled response body rather than leaving geocoding pending', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as Response);
  const task = invokeEdge('google-geocode', {}, 1000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await task).toMatchObject({ data: null, error: { name: 'TimeoutError' } });
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(true);
});
it('does not retry a rejected edge request automatically', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('unavailable', { status: 429 }));
  expect(await invokeEdge('road-geometry', {}, 1000)).toMatchObject({ data: null, error: { message: 'Edge request failed (429)' } });
  expect(fetch).toHaveBeenCalledOnce();
});
