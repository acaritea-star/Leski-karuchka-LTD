// One shared script/bootstrap attempt. Failure releases both the promise and
// polling timer so a recovered connection can retry without orphaned loaders.
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
    let interval: number | undefined;
    let settled = false;
    const started = Date.now();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (interval !== undefined) window.clearInterval(interval);
      script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async`;
    script.async = true;
    script.onerror = () => finish(new Error('Google Maps API failed to load'));
    // onload is not readiness: loading=async initializes Maps afterwards.
    interval = window.setInterval(() => {
      if (hasMaps()) finish();
      else if (Date.now() - started >= 20_000) finish(new Error('Google Maps API failed to initialise'));
    }, 50);
    try { document.head.appendChild(script); }
    catch (error) { finish(error instanceof Error ? error : new Error('Google Maps API failed to load')); }
  });
  loaderPromise = attempt;
  void attempt.catch(() => { if (loaderPromise === attempt) loaderPromise = null; });
  return attempt;
}
