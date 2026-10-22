import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const readJson = async url => JSON.parse(await readFile(url, 'utf8'));
const require = createRequire(new URL('package.json', root));
const recovery = 'Run npm ci with the committed package-lock.json, then rebuild. Do not alias the legacy CheckoutProvider to CheckoutElementsProvider.';

async function installedPackage(name) {
  let directory = dirname(require.resolve(name));
  for (;;) {
    try {
      const candidate = await readJson(join(directory, 'package.json'));
      if (candidate.name === name) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    assert(parent !== directory, `Cannot locate installed ${name}. ${recovery}`);
    directory = parent;
  }
}

try {
  const [manifest, lock] = await Promise.all([
    readJson(new URL('package.json', root)),
    readJson(new URL('package-lock.json', root)),
  ]);
  const versions = [];
  for (const name of ['@stripe/react-stripe-js', '@stripe/stripe-js']) {
    const expected = manifest.dependencies?.[name];
    assert(typeof expected === 'string' && /^\d+\.\d+\.\d+$/.test(expected), `Pin ${name} to an exact runtime dependency. ${recovery}`);
    assert(lock.packages?.['']?.dependencies?.[name] === expected, `The manifest and lockfile disagree on ${name}. ${recovery}`);
    assert(lock.packages?.[`node_modules/${name}`]?.version === expected, `The lockfile resolves a different ${name} version. ${recovery}`);
    const installed = await installedPackage(name);
    assert(installed.version === expected, `Installed ${name}@${installed.version}; expected ${expected}. ${recovery}`);
    versions.push(`${name}@${installed.version}`);
  }

  // Inspect the executable checkout entry, rather than trusting type declarations.
  const checkout = await import(import.meta.resolve('@stripe/react-stripe-js/checkout'));
  for (const name of ['CheckoutElementsProvider', 'useCheckoutElements', 'ContactDetailsElement', 'PaymentElement', 'ExpressCheckoutElement']) {
    assert(typeof checkout[name] === 'function', `The installed checkout module does not export ${name}. ${recovery}`);
  }
  const loader = await import(pathToFileURL(require.resolve('@stripe/stripe-js')).href);
  assert(typeof loader.loadStripe === 'function', `The Stripe.js loader is unavailable. ${recovery}`);
  console.log(`Stripe runtime verified: ${versions.join(', ')}; Elements provider, hook, contact, card, wallet and loader exports are available.`);
} catch (error) {
  console.error(`Stripe runtime verification failed: ${error.message}`);
  process.exitCode = 1;
}
