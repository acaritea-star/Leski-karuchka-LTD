import { expect, it } from 'vitest';
import { hasServiceAuthorization } from './serviceAuthorization';
it('accepts the exact service bearer and denies missing, truncated and altered credentials', () => {
  expect(hasServiceAuthorization('Bearer synthetic-service', 'synthetic-service')).toBe(true);
  for (const value of [null, '', 'Bearer undefined', 'Bearer synthetic-servic', 'Bearer synthetic-servicf', 'Bearer synthetic-service-extra'])
    expect(hasServiceAuthorization(value, 'synthetic-service')).toBe(false);
  expect(hasServiceAuthorization('Bearer undefined', undefined)).toBe(false);
  expect(hasServiceAuthorization('Bearer ', '')).toBe(false);
});
