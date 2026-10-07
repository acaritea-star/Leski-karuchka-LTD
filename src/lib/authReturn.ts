const key = 'leski:auth-return';
// An allowlisted same-origin destination, never a URL supplied by a provider.
export function beginDriverApplicationLogin(): void {
  try { sessionStorage.setItem(key, JSON.stringify({ path: '/driver-join', expires: Date.now() + 30 * 60_000 })); } catch { /* The form remains reachable from the public menu. */ }
}
export function consumeAuthReturn(): '/driver-join' | '/app' {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const value = raw ? JSON.parse(raw) : null;
    if (value?.path === '/driver-join' && Number.isFinite(value.expires) && value.expires > Date.now() && value.expires <= Date.now() + 30 * 60_000) return '/driver-join';
  } catch { /* Unavailable or invalid storage is not an authentication failure. */ }
  return '/app';
}
