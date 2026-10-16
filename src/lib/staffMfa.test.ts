import { expect, it } from 'vitest';
import { needsStaffMfa, sessionHasMfa } from './staffMfa';
it('requires MFA for staff roles while customers and visitors keep their existing login', () => {
  for (const role of ['DRIVER', 'COMPANY_ADMIN', 'SUPER_ADMIN']) expect(needsStaffMfa(role)).toBe(true);
  for (const role of ['CUSTOMER', undefined]) expect(needsStaffMfa(role)).toBe(false);
});
it('fails closed for missing, malformed and first-factor session claims', () => {
  for (const access_token of ['invalid', 'x.bad-json.x', `x.${btoa('{"aal":"aal1"}')}.x`, `x.${btoa('{}')}.x`]) expect(sessionHasMfa({ access_token })).toBe(false);
  expect(sessionHasMfa(null)).toBe(false);
  expect(sessionHasMfa({ access_token: `x.${btoa('{"aal":"aal2"}')}.x` })).toBe(true);
});
