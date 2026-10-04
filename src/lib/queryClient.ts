import { QueryClient } from '@tanstack/react-query';

/**
 * Single shared QueryClient for the whole app.
 *
 * Defaults are tuned for this taxi platform:
 * - staleTime 30s → fast reads don't refetch on every mount, but stay fresh.
 * - retry 2 → transient network blips recover automatically.
 * - refetchOnWindowFocus false → avoids surprise refetches while a driver/customer
 *   is actively looking at a screen with live map state.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // A timeout is not proof that a write failed. Confirm ambiguous writes
      // against the server; only opt into retries for explicitly safe actions.
      retry: false,
    },
  },
});
