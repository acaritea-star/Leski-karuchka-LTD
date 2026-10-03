const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

// Client-controlled registration data must never become an arbitrary HTTP call.
export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (['fcm.googleapis.com', 'web.push.apple.com'].includes(url.hostname) ||
        url.hostname.endsWith('.push.services.mozilla.com') ||
        url.hostname.endsWith('.notify.windows.com'));
  } catch {
    return false;
  }
}

export function classifyPushFailure(error: unknown): 'expired' | 'retry' | 'permanent' {
  const status = typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number(error.statusCode) : 0;
  if (status === 404 || status === 410) return 'expired';
  if (!status || status === 408 || status === 429 || status >= 500) return 'retry';
  return 'permanent';
}

export function pushTtl(expiresAt: string, now = Date.now()): number {
  const seconds = Math.floor((Date.parse(expiresAt) - now) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, Math.min(300, seconds)) : 0;
}
