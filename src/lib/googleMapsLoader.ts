// Singleton loader for the Google Maps JavaScript API.
// Injects the script once and resolves when `google.maps` is actually ready.
//
// IMPORTANT: the script is loaded with `loading=async`, which bootstraps the API
// asynchronously. The <script> element's `onload` fires BEFORE `window.google.maps`
// is fully initialised, so we must NOT resolve on `onload` — we poll until the
// real `google.maps.Map` object exists. Resolving on `onload` causes a race that
// leaves the map as a blank/white screen (intermittent, depending on network speed).

let loaderPromise: Promise<void> | null = null;
let scriptElement: HTMLScriptElement | null = null;

function hasMaps(): boolean {
  const g = (window as unknown as { google?: { maps?: { Map?: unknown } } }).google;
  return typeof g?.maps?.Map === 'function';
}

export function loadGoogleMaps(): Promise<void> {
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    // Already loaded by an earlier call / another chunk
    if (hasMaps()) {
      resolve();
      return;
    }

    const key = (import.meta.env.VITE_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) || '';
    if (!key) {
      reject(new Error('Google Maps API key is missing'));
      return;
    }

    // Inject the script exactly once. A previous failed attempt may have already
    // added it — in that case we simply keep polling for the API to become ready.
    if (!scriptElement) {
      scriptElement = document.createElement('script');
      scriptElement.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        key,
      )}&v=weekly&loading=async`;
      scriptElement.async = true;
      scriptElement.onerror = () => {
        scriptElement = null;
        reject(new Error('Google Maps API failed to load'));
      };
      document.head.appendChild(scriptElement);
    }

    // Poll until the Maps API has finished bootstrapping.
    const started = Date.now();
    const timeoutMs = 20000;
    const interval = window.setInterval(() => {
      if (hasMaps()) {
        window.clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        window.clearInterval(interval);
        reject(new Error('Google Maps API failed to initialise'));
      }
    }, 50);
  });

  // Allow a clean retry if the first attempt failed (transient network error)
  loaderPromise.catch(() => {
    loaderPromise = null;
  });

  return loaderPromise;
}