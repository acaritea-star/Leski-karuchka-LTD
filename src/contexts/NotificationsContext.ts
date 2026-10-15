import { createContext, useContext } from 'react';
import type { InboxItem } from '@/lib/notifications';
export type NotificationsContextValue = {
  unread: number; items: InboxItem[]; loading: boolean; loadError: boolean; writeError: boolean;
  marking: boolean; hasMore: boolean; scope: string;
  watchHistory: () => () => void; retry: () => void; loadMore: () => void; markRead: () => Promise<void>;
  refresh: () => void;
};
const empty: NotificationsContextValue = { unread: 0, items: [], loading: false, loadError: false, writeError: false,
  marking: false, hasMore: false, scope: '', watchHistory: () => () => {}, retry: () => {}, loadMore: () => {}, markRead: async () => {}, refresh: () => {} };
export const NotificationsContext = createContext(empty);
export const useNotifications = () => useContext(NotificationsContext);
