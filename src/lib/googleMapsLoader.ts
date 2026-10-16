// One shared script/bootstrap attempt. Failure releases both the promise and
// deadline so a recovered connection can retry without orphaned loaders.
let loaderPromise: Promise<void> | null = null;
function hasMaps(): boolean {
  const g = (window as unknown as { google?: { maps?: { Map?: unknown } } }).google;
  return typeof g?.maps?.Map === 'function';
}

export function loadGoogleMaps(): Promise<void> {
  if (hasMaps()) return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  const attempt = new Promise<void>((resolve, reject) => {
    const key = (import.meta.env.VITE_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) || '';
    if (!key) { reject(new Error('Google Maps API key is missing')); return; }
    const script = document.createElement('script');
    const callbacks = window as Window & { __leskiMapsReady?: () => void };
    let timer: number | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      script.onerror = null; script.onload = null;
      // A script already in flight can call back after a timeout/removal.
      // Keep one inert callback instead of leaving a global reference error.
      callbacks.__leskiMapsReady = () => {};
      if (error) { script.remove(); reject(error); } else resolve();
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__leskiMapsReady`;
    script.async = true;
    script.onerror = () => finish(new Error('Google Maps API failed to load'));
    // Google's readiness callback replaces repeated 50ms readiness polling.
    const ready = () => { if (hasMaps()) finish(); };
    callbacks.__leskiMapsReady = ready;
    script.onload = ready;
    timer = window.setTimeout(() => finish(new Error('Google Maps API failed to initialise')), 20_000);
    try { document.head.appendChild(script); }
    catch (error) { finish(error instanceof Error ? error : new Error('Google Maps API failed to load')); }
  });
  loaderPromise = attempt;
  void attempt.catch(() => { if (loaderPromise === attempt) loaderPromise = null; });
  return attempt;
}
