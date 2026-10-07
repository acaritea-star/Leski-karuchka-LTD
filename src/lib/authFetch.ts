import { withRequestTimeout } from './requestTimeout';

/** Release the SDK auth queue even when headers or a response body never arrive.
 * Only Auth JSON traffic is buffered; database, storage and realtime are unchanged.
 */
export function createAuthFetch(projectUrl: string, fetcher: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  const base = new URL(projectUrl);
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== base.origin || !url.pathname.startsWith('/auth/v1/')) return fetcher(input, init);
    const parent = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return withRequestTimeout(async signal => {
      const response = await fetcher(input, { ...init, signal });
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    }, 20_000, parent ?? undefined);
  };
}
