import { useCallback, useSyncExternalStore } from 'react';
import { getLocationEnabled, subscribeLocationPreference } from '@/lib/locationPreference';
export function useLocationPreference(userId?: string) {
  const subscribe = useCallback((fn: () => void) => subscribeLocationPreference(fn, userId), [userId]);
  return useSyncExternalStore(subscribe, () => getLocationEnabled(userId), () => null);
}
