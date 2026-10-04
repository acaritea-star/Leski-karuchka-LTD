import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// No Google, Edge, maps or push HTTP calls. Each SQL workload must roll back.
const template = readFileSync(new URL('../supabase/tests/scale_smoke.sql', import.meta.url), 'utf8');
export function scaleSmokeSQL(worker = 0, drivers = 5, mode = 'lifecycle') {
  if (!Number.isInteger(worker) || worker < 0 || worker > 7 || !Number.isInteger(drivers) || drivers < 5 || drivers > 500
    || !['lifecycle', 'lookup'].includes(mode) || mode === 'lifecycle' && drivers !== 5) throw new Error('Unsafe workload size');
  return template.replaceAll('__WORKER__', String(worker)).replaceAll('__DRIVERS__', String(drivers)).replaceAll('__MODE__', mode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--sql')) process.stdout.write(scaleSmokeSQL());
  else if (process.argv.includes('--lookup-sql')) process.stdout.write(scaleSmokeSQL(0, 500, 'lookup'));
  else if (process.argv.includes('--run')) {
    if (!process.env.LESKI_TEST_DATABASE_URL) throw new Error('Set LESKI_TEST_DATABASE_URL for a test database; credentials are never printed');
    // Eight independent connections; no new package dependency. psql must be installed.
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, worker) => new Promise((resolve, reject) => {
      const child = spawn('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
        env: { ...process.env, PGDATABASE: process.env.LESKI_TEST_DATABASE_URL }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '', error = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve({ worker, output }) : reject(new Error(`Worker ${worker}: ${error}`)));
      child.stdin.end(scaleSmokeSQL(worker));
    })));
    for (const result of results) console.log(result.status === 'fulfilled' ? result.value : String(result.reason));
    if (results.some(result => result.status === 'rejected')) process.exitCode = 1;
  } else console.log('Generate: node scripts/scale-smoke.mjs --sql or --lookup-sql\nRun eight rollback-only SQL workers: LESKI_TEST_DATABASE_URL=... node scripts/scale-smoke.mjs --run');
}
