import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); vi.stubEnv('VITE_PUBLIC_GOOGLE_MAPS_API_KEY','test-key'); vi.stubGlobal('fetch',vi.fn()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('ends a hanging address selection after eight seconds, including response body reads', async () => {
  const {getPlaceDetails}=await import('./places');
  vi.mocked(fetch).mockResolvedValue({ok:true,json:()=>new Promise(()=>{})} as Response);
  const pending=getPlaceDetails('place');
  await vi.advanceTimersByTimeAsync(8001);
  expect(await pending).toBeNull();
  expect((vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
});
it('aborts superseded details and bounds autocomplete even if fetch ignores abort', async () => {
  const {getPlaceDetails,searchPlaces}=await import('./places');
  vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));
  const controller=new AbortController();
  const details=getPlaceDetails('place','session','bg',controller.signal);controller.abort();
  expect(await details).toBeNull();
  const search=searchPlaces('Левски');const assertion=expect(search).rejects.toThrow('забави');
  await vi.advanceTimersByTimeAsync(8001);await assertion;
});
it('biases destination suggestions near the pickup while retaining Bulgaria-wide coverage and minimal fields', async () => {
  const { searchPlaces } = await import('./places');
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ suggestions: [] }) } as Response);
  await searchPlaces('Горна', 'session', 'bg', undefined, { lat: 43.08, lng: 25.63 });
  const options = vi.mocked(fetch).mock.calls[0][1]!;
  expect(JSON.parse(options.body as string)).toMatchObject({ includedRegionCodes: ['bg'], sessionToken: 'session',
    locationBias: { circle: { center: { latitude: 43.08, longitude: 25.63 }, radius: 30000 } } });
  expect(JSON.parse(options.body as string).locationRestriction).toBeUndefined();
  expect(options.headers).toMatchObject({ 'X-Goog-FieldMask': expect.not.stringContaining('*') });
  await searchPlaces('София', 'session', 'bg', undefined, { lat: 0, lng: 0 });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).locationBias.rectangle).toBeTruthy();
});
