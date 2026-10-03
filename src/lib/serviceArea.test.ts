import { expect, it } from 'vitest';
import { isInBulgaria } from './serviceArea';
it('allows Bulgarian service locations across the country', () => {
  for (const [lat,lng] of [[42.6977,23.3219],[43.3592,25.1358],[43.417,24.617],[43.214,27.914],[42.505,27.462],[43.8356,25.9657],[41.398,23.207]]) expect(isInBulgaria(lat,lng)).toBe(true);
});
it('rejects other countries including places inside the Bulgaria bounding rectangle', () => {
  for (const [lat,lng] of [[51.507,-.128],[40.64,22.94],[44.1598,28.6348],[41.734,22.195],[43.318,21.896],[NaN,25],[43,Infinity]]) expect(isInBulgaria(lat,lng)).toBe(false);
});
