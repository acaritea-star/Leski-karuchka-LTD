// Configure only the disposable CLI project created by the database CI job.
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2];
if (!file || !process.env.RUNNER_TEMP || !file.startsWith(process.env.RUNNER_TEMP + '/leski-db/')) throw Error('Disposable CI configuration only');
const source = readFileSync(file, 'utf8'), start = source.indexOf('[auth.mfa.totp]');
if (start < 0) throw Error('Missing local TOTP configuration');
const next = source.indexOf('\n[', start + 1), end = next < 0 ? source.length : next;
let block = source.slice(start, end);
for (const setting of ['enroll_enabled', 'verify_enabled']) {
 const pattern = new RegExp('(^|\\n)(' + setting + '\\s*=\\s*)(true|false)');
 if (!pattern.test(block)) throw Error('Missing TOTP setting: ' + setting);
 block = block.replace(pattern, '$1$2true');
}
writeFileSync(file, source.slice(0, start) + block + source.slice(end));
