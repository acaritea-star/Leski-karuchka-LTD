import { readFile } from 'node:fs/promises';

// Completeness check for a reviewed release, not a legal certification.
const operator = JSON.parse(await readFile(new URL('../src/config/legalOperator.json', import.meta.url), 'utf8'));
const reviewed = JSON.parse(await readFile(new URL('../deployment/legal-release.json', import.meta.url), 'utf8'));
const missing = [];
for (const field of ['legalName', 'registrationNumber', 'registeredAddress', 'email', 'phone']) {
  if (typeof operator[field] !== 'string' || !operator[field].trim()) missing.push(field);
}
if (!operator.identityVerified) missing.push('identityVerified');
if (!operator.contactsVerified) missing.push('contactsVerified');
if (!/^\d{9}(\d{4})?$/.test(operator.registrationNumber)) missing.push('valid Bulgarian registration number');
if (operator.termsVersion.includes('draft')) missing.push('final terms version');
if (operator.transportModel !== 'licensed-carrier-platform') missing.push('confirmed transport model');
for (const [field, value] of Object.entries(reviewed)) {
  if (value !== true) missing.push(field);
}
if (missing.length) {
  console.error('Legal release is still a draft. Complete and review: ' + missing.join(', '));
  process.exitCode = 1;
} else {
  console.log('Recorded release prerequisites are complete. This is not a compliance certification.');
}
