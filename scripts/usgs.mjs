// On-demand source adapter. JSON journal goes to stdout; poll details go to stderr.
import { FactLedger } from '../src/ledger.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { ingestUSGS, USGS_FEED } from '../src/sources/usgs.js';
import { fetchUSGS } from '../src/sources/usgs-http.js';
import { boundedTextFile } from './io.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--prior', '--input'].includes(args[i]) || !args[i + 1])
    throw new Error('usage: node scripts/usgs.mjs [--prior journal.json] [--input feed.geojson]');
  options[args[i]] = args[i + 1];
}
try {
  const previous = options['--prior'] ? decodeJournal(await boundedTextFile(options['--prior'])) : new FactLedger();
  const raw = options['--input'] ? await boundedTextFile(options['--input']) : await fetchUSGS();
  const receivedAt = Date.now();
  const result = ingestUSGS(previous, JSON.parse(raw), { receivedAt });
  const journal = encodeJournal(result.ledger);
  console.error(JSON.stringify({ source: options['--input'] || USGS_FEED, receivedAt, ...result.summary, records: result.ledger.size }));
  process.stdout.write(journal + '\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
