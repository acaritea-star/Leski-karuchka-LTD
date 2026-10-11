import type { AppUser } from '@/hooks/useAuth';

/** Navigation only. Permissions continue to come from the profile and database. */
export function roleHomePath(role?: AppUser['role']): string {
  switch (role) {
    case 'SUPER_ADMIN': return '/admin/companies';
    case 'COMPANY_ADMIN': return '/admin/dashboard';
    case 'DRIVER': return '/driver/home';
    case 'CUSTOMER': return '/customer/home';
    default: return '/auth/login';
  }
}
