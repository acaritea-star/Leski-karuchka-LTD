// Measure only the current import graph, excluding retained historical assets.
// Google Maps and other external resources are not part of these JS totals.
import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'out');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const entry = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
if (!entry) throw Error('Built entry script is missing');
const sources = new Map();
const staticImports = path => imports(path, /(?:from|import)\s*["'](\.[^"']+\.js)["']/g);
function source(path) {
  if (!sources.has(path)) sources.set(path, readFileSync(path, 'utf8'));
  return sources.get(path);
}
function imports(path, pattern) {
  return [...source(path).matchAll(pattern)].map(match => resolve(dirname(path), match[1]));
}
function graph(entries, dynamic = false) {
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    for (const child of staticImports(path)) visit(child);
    if (dynamic) for (const child of imports(path, /import\(["'`](\.[^"'`]+\.js)["'`]\)/g)) visit(child);
  }
  entries.forEach(visit);
  return seen;
}
const entryPath = resolve(root, entry.replace(/^\//, ''));
const initial = graph([entryPath]);
const all = graph([entryPath], true);
const booking = [...all].filter(path => source(path).includes('marketplace-availability'));
if (booking.length !== 1) throw Error(`Expected one reachable booking module; found ${booking.length}`);
const bookingGraph = graph([entryPath, booking[0]]);
function measure(paths) {
  return { files: paths.size, bytes: [...paths].reduce((sum, path) => sum + Buffer.byteLength(source(path)), 0),
    gzipBytes: [...paths].reduce((sum, path) => sum + gzipSync(source(path), { level: 9 }).length, 0) };
}
console.log(JSON.stringify({ initial: measure(initial), bookingWithInitial: measure(bookingGraph),
  bookingModule: relative(root, booking[0]) }, null, 2));
