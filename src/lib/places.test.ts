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
