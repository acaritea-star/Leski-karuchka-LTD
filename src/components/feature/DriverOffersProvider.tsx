import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { DriverOfferConnectionContext as Context } from '@/hooks/useDriverOfferConnection';

/** One account-scoped offer socket survives navigation between driver pages. */
export default function DriverOffersProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const uid = user?.role === 'DRIVER' ? user.id : null;
  const [socket, setSocket] = useState<{ owner: string | null; connected: boolean }>({ owner: null, connected: false });
  const removal = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!uid) return;
    let active = true;
    let channel: RealtimeChannel | undefined;
    const reconcile = () => {
      if (!active) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(uid) }, { cancelRefetch: false });
      void queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(uid) }, { cancelRefetch: false });
    };
    // Serialize teardown/rejoin for fast reauthentication and StrictMode.
    void removal.current.then(() => {
      if (!active) return;
      channel = supabase.channel('driver-offers:' + uid, { config: { private: true } })
        .on('broadcast', { event: 'offer_changed' }, reconcile)
        .subscribe(status => {
          if (!active) return;
          setSocket({ owner: uid, connected: status === 'SUBSCRIBED' });
          if (status === 'SUBSCRIBED') reconcile();
        });
    }).catch(() => { if (active) setSocket({ owner: uid, connected: false }); });
    return () => {
      active = false;
      if (channel) removal.current = Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
    };
  }, [uid, queryClient]);
  return <Context.Provider value={!!uid && socket.owner === uid && socket.connected}>{children}</Context.Provider>;
}
