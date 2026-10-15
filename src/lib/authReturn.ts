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
export function beginCompanyLogin(): void {
  try { sessionStorage.setItem(key, JSON.stringify({ path: '/company', expires: Date.now() + 30 * 60_000 })); } catch { /* The normal role redirect still handles assigned company administrators. */ }
}
export function consumeAuthReturn(): string {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const value = raw ? JSON.parse(raw) : null;
    if (Number.isFinite(value?.expires) && value.expires > Date.now() && value.expires <= Date.now() + 30 * 60_000) {
      if (value.path === '/company' || value.path === '/driver/access') return partnerEntryPath(value.path === '/company' ? 'company' : 'driver', value.invite);
      if (value.path === '/driver-join') return typeof value.company === 'string' && companyPattern.test(value.company) ? '/driver-join?company=' + value.company : '/driver-join';
      if (value.path === '/notifications/open' && typeof value.id === 'string' && companyPattern.test(value.id)) return '/notifications/open?id=' + value.id;
    }
  } catch { /* Unavailable or invalid storage is not an authentication failure. */ }
  return '/app';
}
export function beginNotificationLogin(id: string): void {
  if (!companyPattern.test(id)) return;
  try { sessionStorage.setItem(key, JSON.stringify({ path: '/notifications/open', id, expires: Date.now() + 30 * 60_000 })); } catch { /* The inbox stays available after login. */ }
}
export function invitationId(search: string): string | undefined {
  const value = new URLSearchParams(search).get('invite');
  return value && companyPattern.test(value) ? value : undefined;
}
export function partnerEntryPath(kind: 'company' | 'driver', invite?: string): string {
  const path = kind === 'company' ? '/company' : '/driver/access';
  return invite && companyPattern.test(invite) ? path + '?invite=' + invite : path;
}
export function beginPartnerLogin(kind: 'company' | 'driver', invite?: string): void {
  try { sessionStorage.setItem(key, JSON.stringify({ path: kind === 'company' ? '/company' : '/driver/access', invite: invite && companyPattern.test(invite) ? invite : undefined, expires: Date.now() + 30 * 60_000 })); } catch { /* Server resolves invitations again on /app. */ }
}
