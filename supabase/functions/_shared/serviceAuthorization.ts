import { createHash, timingSafeEqual } from 'node:crypto';
export function hasServiceAuthorization(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
