import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { enablePush, getPushOwner, registerPush, subscribePush, unregisterPush } from '@/lib/pushSubscription';

export function usePushNotifications() {
  const { user } = useAuth();
  const owner = useSyncExternalStore(subscribePush, getPushOwner);
  const [permission, setPermission] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const register = useCallback(async (userId: string) => {
    try { return await registerPush(userId); }
    catch { return false; }
  }, []);
  const enable = useCallback(async (userId: string) => {
    setEnabling(true);
    try { return await enablePush(userId); }
    catch { return false; }
    finally {
      if ('Notification' in window) setPermission(Notification.permission);
      setEnabling(false);
    }
  }, []);
  const unregister = useCallback(async (userId: string) => {
    setEnabling(true);
    try { await unregisterPush(userId); return true; }
    catch { return false; }
    finally { setEnabling(false); }
  }, []);
  useEffect(() => {
    if ('Notification' in window) setPermission(Notification.permission);
    if (user?.id) void register(user.id);
  }, [user?.id, register]);
  return { register, unregister, enable, permission, enabling, enabled: !!user && owner === user.id };
}
