const key = 'leski:auth-return';
// An allowlisted same-origin destination, never a URL supplied by a provider.
const companyPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function invitationCompany(search: string): string | undefined {
  const value = new URLSearchParams(search).get('company');
  return value && companyPattern.test(value) ? value : undefined;
}
export function beginDriverApplicationLogin(companyId?: string): void {
  try { sessionStorage.setItem(key, JSON.stringify({ path: '/driver-join', company: companyId && companyPattern.test(companyId) ? companyId : undefined, expires: Date.now() + 30 * 60_000 })); } catch { /* The form remains reachable from the public menu. */ }
}
export function consumeAuthReturn(): string {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const value = raw ? JSON.parse(raw) : null;
    if (value?.path === '/driver-join' && Number.isFinite(value.expires) && value.expires > Date.now() && value.expires <= Date.now() + 30 * 60_000) return typeof value.company === 'string' && companyPattern.test(value.company) ? '/driver-join?company=' + value.company : '/driver-join';
  } catch { /* Unavailable or invalid storage is not an authentication failure. */ }
  return '/app';
}
