import { stopSharedGps } from './sharedGps';
const PREFIX = 'leski:auto-location:';
const memory = new Map<string, boolean>();
const subscribers = new Set<() => void>();
export function getLocationEnabled(userId?: string): boolean | null {
  if (!userId) return null;
  try {
    const value = localStorage.getItem(PREFIX + userId);
    return value === 'on' ? true : value === 'off' ? false : null;
  } catch { return memory.get(userId) ?? null; }
}
export function setLocationEnabled(userId: string, enabled: boolean) {
  memory.set(userId, enabled);
  try { localStorage.setItem(PREFIX + userId, enabled ? 'on' : 'off'); memory.delete(userId); } catch { /* Session fallback. */ }
  if (!enabled) stopSharedGps();
  subscribers.forEach(fn => fn());
}
export function subscribeLocationPreference(fn: () => void, userId?: string) {
  subscribers.add(fn);
  const storage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PREFIX + userId) return;
    if (userId) memory.delete(userId);
    if (event.key === null || event.newValue === 'off') stopSharedGps();
    subscribers.forEach(listener => listener());
  };
  window.addEventListener('storage', storage);
  return () => { subscribers.delete(fn); window.removeEventListener('storage', storage); };
}
