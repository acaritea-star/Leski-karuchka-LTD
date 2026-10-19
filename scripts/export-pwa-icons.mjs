// Export code-native SVG marks. No production dependency or external image request.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch(process.env.LESKI_PWA_CHROMIUM
  ? { executablePath: process.env.LESKI_PWA_CHROMIUM } : {});
try {
  const page = await browser.newPage();
  for (const [source, size, target] of [
    ['pwa-icon.svg', 192, 'icon-192.png'], ['pwa-icon.svg', 512, 'icon-512.png'],
    ['pwa-icon.svg', 180, 'apple-touch-icon.png'], ['push-badge.svg', 72, 'badge-72.png'],
  ]) {
    const svg = (await readFile('public/' + source, 'utf8')).replace(/width="\d+" height="\d+"/, 'width="' + size + '" height="' + size + '"');
    await page.setContent('<style>body{margin:0}svg{display:block}</style>' + svg);
    await page.locator('svg').screenshot({ path: 'public/' + target, omitBackground: true });
  }
} finally { await browser.close(); }
