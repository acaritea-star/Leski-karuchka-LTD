import type { Session } from '@supabase/supabase-js';
export const STAFF_MFA_REQUIRED_EVENT = 'leski:staff-mfa-required';

export const needsStaffMfa = (role?: string) => role === 'DRIVER' || role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';

// Presentation only. The server independently verifies the signed JWT, live role,
// Auth session and verified factor. A client-modified token grants no API access.
export function sessionHasMfa(session: Pick<Session, 'access_token'> | null): boolean {
  try {
    const part = session?.access_token.split('.')[1];
    if (!part) return false;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).aal === 'aal2';
  } catch { return false; }
}
