import { withRequestTimeout } from './requestTimeout';
import { STAFF_MFA_REQUIRED_EVENT } from './staffMfa';

/** Release the SDK auth queue even when headers or a response body never arrive.
 * Only Auth JSON traffic is buffered; database, storage and realtime are unchanged.
 */
export function createAuthFetch(projectUrl: string, fetcher: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  const base = new URL(projectUrl);
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== base.origin || !url.pathname.startsWith('/auth/v1/')) return fetcher(input, init).then(response => {
      if (url.origin === base.origin && response.status === 403 && typeof window !== 'undefined') {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const token = headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
        void response.clone().text().then(body => {
          if (token && body.includes('MFA_REQUIRED')) window.dispatchEvent(new CustomEvent(STAFF_MFA_REQUIRED_EVENT, { detail: token }));
        }).catch(() => {});
      }
      return response;
    });
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
