import { useAuthContext } from '@/contexts/AuthContext';

export type { AppUser } from '@/contexts/AuthContext';

export function useAuth() {
  return useAuthContext();
}