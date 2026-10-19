import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import worker from '../../public/sw.js?raw';
import manifest from '../../public/manifest.json';
it('ships actual square local install icons at their declared dimensions', () => {
  for (const icon of manifest.icons) {
    expect(icon.src.startsWith('/')).toBe(true);
    const bytes = readFileSync('public' + icon.src);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect(icon.sizes).toBe(bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20));
  }
});
it('ships the local Apple icon and push assets referenced by the worker', () => {
  for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['badge-72.png', 72]] as const) {
    const bytes = readFileSync('public/' + name);
    expect(bytes.readUInt32BE(16)).toBe(size); expect(bytes.readUInt32BE(20)).toBe(size);
  }
  expect(worker).toContain("const APP_ICON = '/icon-192.png'");
});
