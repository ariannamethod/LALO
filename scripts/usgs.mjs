// On-demand source adapter. JSON journal goes to stdout; poll details go to stderr.
import { FactLedger } from '../src/ledger.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { ingestUSGS, USGS_FEED } from '../src/sources/usgs.js';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--prior', '--input'].includes(args[i]) || !args[i + 1])
    throw new Error('usage: node scripts/usgs.mjs [--prior journal.json] [--input feed.geojson]');
  options[args[i]] = args[i + 1];
}
const MAX_BYTES = 2_000_000;
async function boundedFile(path) {
  // Read through a handle so a large input cannot be allocated before its size check.
  const { open } = await import('node:fs/promises');
  const handle = await open(path, 'r');
  try {
    if ((await handle.stat()).size > MAX_BYTES) throw new RangeError('input exceeds byte budget');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const part = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!part.bytesRead) break;
      bytesRead += part.bytesRead;
    }
    if (bytesRead > MAX_BYTES) throw new RangeError('input exceeds byte budget');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
async function fetchFeed() {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(USGS_FEED, { signal: controller.signal });
    if (!response.ok) throw new Error(`USGS HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new RangeError('feed exceeds byte budget');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) { controller.abort(); throw new RangeError('feed exceeds byte budget'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timer); }
}
try {
  const previous = options['--prior'] ? decodeJournal(await boundedFile(options['--prior'])) : new FactLedger();
  const raw = options['--input'] ? await boundedFile(options['--input']) : await fetchFeed();
  const receivedAt = Date.now();
  const result = ingestUSGS(previous, JSON.parse(raw), { receivedAt });
  const journal = encodeJournal(result.ledger);
  console.error(JSON.stringify({ source: options['--input'] || USGS_FEED, receivedAt, ...result.summary, records: result.ledger.size }));
  process.stdout.write(journal + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
