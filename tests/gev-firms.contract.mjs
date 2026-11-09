// Run the pinned GEV server and CSV parser. Its archived NOAA-20 sample supplies the NASA response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { decodeJournal } from '../src/journal.js';
import { selectBackground } from '../src/background-context.js';

const run = promisify(execFile);
const root = resolve(process.env.GEV_ROOT ?? 'build/gods-eye-view');
const { firmsProxy } = await import(pathToFileURL(join(root, 'server/providers/firms.js')));
const sample = await readFile(join(root, 'src/data/fixtures/firms-viirs-noaa20-sample.csv'), 'utf8');

test('GEV serves its 45 archived NOAA-20 rows to the real regional poller, including cache and source failures', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lalo-firms-contract-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = process.cwd();
  let proxy;
  try { process.chdir(dir); proxy = firmsProxy(); } finally { process.chdir(cwd); }
  let now = Date.UTC(2026, 6, 16, 23), outage = false, upstreamCalls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async url => {
    const u = new URL(url); assert.equal(u.hostname, 'firms.modaps.eosdis.nasa.gov');
    const product = u.pathname.split('/').at(-3); upstreamCalls++;
    if (outage || product === 'VIIRS_NOAA21_NRT') return new Response('', { status: 503 });
    assert.ok(['VIIRS_NOAA20_NRT', 'MODIS_NRT'].includes(product));
    return new Response(product === 'MODIS_NRT' ? sample.split('\n')[0] + '\n' : sample);
  });
  let server;
  proxy.configureServer({ middlewares: { use(prefix, handler) {
    server = createServer((req, res) => {
      if (req.url !== prefix) { res.writeHead(404); res.end(); return; }
      req.url = '/'; handler(req, res);
    });
  } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(done => server.close(done)));
  const journal = join(dir, 'world.json');
  const args = ['scripts/background.mjs', 'poll-firms', '--journal', journal, '--gev-origin',
    'http://127.0.0.1:' + server.address().port, '--bbox', '-122,38,-119,40'];
  const poll = async () => JSON.parse((await run(process.execPath, args)).stdout);
  const previousKey = process.env.FIRMS_MAP_KEY;
  t.after(() => { if (previousKey === undefined) delete process.env.FIRMS_MAP_KEY; else process.env.FIRMS_MAP_KEY = previousKey; });
  delete process.env.FIRMS_MAP_KEY;
  await assert.rejects(poll(), /HTTP 503/); assert.equal(upstreamCalls, 0);
  process.env.FIRMS_MAP_KEY = 'offline-test';
  const first = await poll();
  assert.deepEqual([first.total, first.added, first.outside, first.receipts], [45, 11, 34, 110]);
  assert.deepEqual(first.unavailable, ['VIIRS_NOAA21_NRT']);
  const text = await readFile(journal, 'utf8'), ledger = decodeJournal(text);
  const receivedAt = ledger.entries()[0].recordedAt, noon = Date.UTC(2026, 6, 16, 12);
  const context = await selectBackground(text, { agent: 'agent:don-eduardo', knownAt: receivedAt, stateAt: receivedAt,
    bbox: [-122,38,-119,40], worldFrom: noon - 3 * 3600_000, worldTo: noon, maxEvents: 16, maxBytes: 65536 });
  assert.ok(context.items.some(i => i.facts[0].validFrom === Date.UTC(2026, 6, 16, 10, 6)
    && i.facts.some(f => f.predicate === 'frp_mw' && f.value === 0.53)));
  assert.equal((await poll()).unchanged, 11); assert.equal(upstreamCalls, 3);
  outage = true; now += 31 * 60_000;
  const stale = await poll();
  assert.equal(stale.stale, true); assert.equal(stale.unchanged, 11); assert.equal(upstreamCalls, 6);
  assert.equal(await readFile(journal, 'utf8'), text);
});
