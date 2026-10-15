import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useAuth } from '@/hooks/useAuth';
import { NotificationsContext } from '@/contexts/NotificationsContext';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { notificationAudience, readInboxPage, readInboxState, type InboxItem, type InboxState } from '@/lib/notifications';
import { registerPush, getPushPreference } from '@/lib/pushSubscription';
import { createRealtimePoll } from '@/lib/realtimePoll';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';

/** One role-scoped subscription; the closed bell reads only a small summary. */
export default function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const audience = notificationAudience(user?.role);
  const scope = user && audience ? `${user.id}:${audience}:${user.company_id ?? ''}` : '';
  return <InboxSession key={scope} userId={user?.id} audience={audience} scope={scope}>{children}</InboxSession>;
}

function InboxSession({ children, userId, audience, scope }: { children: ReactNode; userId?: string; audience: ReturnType<typeof notificationAudience>; scope: string }) {
  const [summary, setSummary] = useState<InboxState>({ unread: 0, latest_id: null });
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [stateError, setStateError] = useState(false);
  const [writeError, setWriteError] = useState(false);
  const [marking, setMarking] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const alive = useRef(true), viewers = useRef(0), dirty = useRef(true), pageBusy = useRef(false), writing = useRef(false);
  const generation = useRef(0), currentItems = useRef(items), more = useRef(false);
  const poll = useRef<ReturnType<typeof createRealtimePoll> | null>(null);
  const lastSummary = useRef('');
  const { playCustomerSound, unlockAudio } = useNotificationSound();
  currentItems.current = items;

  const load = useCallback(async (append = false): Promise<void> => {
    if (!userId || pageBusy.current || append && !more.current) return;
    pageBusy.current = true; const revision = generation.current;
    setLoading(true);
    try {
      const page = await readInboxPage(append ? currentItems.current.at(-1) : undefined);
      if (!alive.current || revision !== generation.current) return;
      setItems(previous => append ? [...previous, ...page.items.filter(n => !previous.some(old => old.id === n.id))] : page.items);
      more.current = page.has_more; setHasMore(page.has_more); dirty.current = false; setLoadError(false);
    } catch { if (alive.current && revision === generation.current) setLoadError(true); }
    finally {
      pageBusy.current = false;
      if (alive.current) {
        setLoading(false);
        // An event during a read requires one trailing read, not parallel reads.
        if (revision !== generation.current && viewers.current) void load();
      }
    }
  }, [userId]);
  const refresh = useCallback(() => { poll.current?.refresh(); }, []);
  useEffect(() => {
    alive.current = true;
    if (!userId || !audience) return () => { alive.current = false; };
    let channel: RealtimeChannel | undefined;
    const seen = new Set<string>();
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock, { once: true });
    const restorePush = () => { if (document.visibilityState !== 'hidden') void registerPush(userId).catch(() => {}); };
    restorePush();
    window.addEventListener('online', restorePush); window.addEventListener('pageshow', restorePush);
    poll.current = createRealtimePoll(async signal => {
      const revision = generation.current;
      try { return { revision, state: await readInboxState(signal) }; }
      catch (error) { if (alive.current) setStateError(true); throw error; }
    }, result => {
      if (!alive.current || result.revision !== generation.current) return;
      setStateError(false); setSummary(result.state);
      const version = `${result.state.latest_id}:${result.state.unread}`;
      if (lastSummary.current !== version) {
        lastSummary.current = version; generation.current++; dirty.current = true;
        if (viewers.current) void load();
      }
    }, { healthyMs: 120_000, fallbackMs: 15_000 });
    // The topic is private and personal. It never carries names, routes or files.
    void Promise.resolve(supabase.realtime.setAuth()).then(() => {
      if (!alive.current) return;
      channel = supabase.channel(`inbox:${userId}:${audience}`, { config: { private: true } })
        .on('broadcast', { event: 'inbox_changed' }, event => {
          if (!alive.current) return;
          const hint = event.payload;
          if (hint?.is_new && seen.has(hint.id)) return;
          generation.current++; dirty.current = true; refresh();
          if (viewers.current) void load();
          if (hint?.is_new && typeof hint.id === 'string' && !seen.has(hint.id)) {
            seen.add(hint.id);
            if (seen.size > 200) seen.delete(seen.values().next().value!);
            if (hint.priority !== 'silent' && hint.type !== 'new_request' && document.visibilityState === 'visible' && getPushPreference(userId) !== false) playCustomerSound();
          }
        }).subscribe(status => poll.current?.setStatus(status));
    }).catch(() => { /* Bounded fallback remains active when joining fails. */ });
    return () => {
      alive.current = false; poll.current?.stop(); poll.current = null;
      document.removeEventListener('pointerdown', unlock);
      window.removeEventListener('online', restorePush); window.removeEventListener('pageshow', restorePush);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, audience, load, refresh, playCustomerSound, unlockAudio]);

  const watchHistory = useCallback(() => {
    viewers.current++;
    if (dirty.current) void load();
    return () => { viewers.current = Math.max(0, viewers.current - 1); };
  }, [load]);
  const retry = useCallback(() => { refresh(); void load(); }, [refresh, load]);
  const loadMore = useCallback(() => { void load(true); }, [load]);
  const markRead = useCallback(async () => {
    if (!userId || writing.current) return;
    writing.current = true; setMarking(true); setWriteError(false);
    try {
      const { data, error } = await withRequestTimeout(signal => supabase.rpc('mark_notifications_read').abortSignal(signal));
      if (error || typeof data !== 'number') throw error || new Error('Unconfirmed update');
      if (!alive.current) return;
      generation.current++; dirty.current = true;
      setItems(rows => rows.map(n => ({ ...n, is_read: true })));
      refresh(); await load();
    } catch { if (alive.current) setWriteError(true); }
    finally { writing.current = false; if (alive.current) setMarking(false); }
  }, [userId, refresh, load]);
  const value = useMemo(() => ({ ...summary, items, loading, loadError: loadError || stateError, writeError, marking, hasMore, scope,
    watchHistory, retry, loadMore, markRead, refresh }), [summary, items, loading, loadError, stateError, writeError, marking, hasMore, scope, watchHistory, retry, loadMore, markRead, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
