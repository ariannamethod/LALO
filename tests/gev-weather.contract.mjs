// Run against a pinned God's Eye View checkout. Only the upstream NOAA reply is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeJournal } from '../src/journal.js';

const run = promisify(execFile);
const plugin = pathToFileURL(resolve(process.env.GEV_ROOT ?? 'build/gods-eye-view', 'server/providers/weather.js'));
const { weatherProxy } = await import(plugin);
test('the GEV weather provider feeds the durable Don receiver across cache hits, a stale result and an outage', async t => {
  const at = Date.UTC(2026, 9, 15, 12), iso = new Date(at).toISOString();
  let now = at, outage = false, calls = 0;
  const productLayers = ['conus_base_reflectivity_mosaic', 'ldn_lightning_strike_density',
    'global_longwave_imagery_mosaic', 'goes_longwave_imagery'];
  const xml = '<WMS_Capabilities>' + productLayers.map(name => '<Layer><Name>' + name
    + '</Name><EX_GeographicBoundingBox><westBoundLongitude>-130</westBoundLongitude><eastBoundLongitude>-60</eastBoundLongitude>'
    + '<southBoundLatitude>20</southBoundLatitude><northBoundLatitude>55</northBoundLatitude></EX_GeographicBoundingBox>'
    + '<Dimension name="time" units="ISO8601" default="' + iso + '">' + iso + '</Dimension></Layer>').join('') + '</WMS_Capabilities>';
  const proxy = weatherProxy({ now: () => now, fetchImpl(url) {
    assert.equal(new URL(url).hostname, 'nowcoast.noaa.gov'); calls++;
    return Promise.resolve(outage ? new Response('', { status: 503 }) : new Response(xml));
  } });
  let server;
  proxy.configureServer({ middlewares: { use(mount, handler) {
    server = createServer((req, res) => {
      if (!req.url.startsWith(mount + '/')) { res.writeHead(404); res.end(); return; }
      req.url = req.url.slice(mount.length); handler(req, res);
    });
  } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(done => server.close(done)));
  const dir = await mkdtemp(join(tmpdir(), 'lalo-gev-contract-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = join(dir, 'journal.json'), origin = 'http://127.0.0.1:' + server.address().port;
  const poll = async product => JSON.parse((await run(process.execPath, ['scripts/background.mjs', 'poll-weather',
    '--journal', journal, '--gev-origin', origin, '--product', product])).stdout);
  for (const product of ['radar', 'clouds', 'clouds-regional', 'lightning']) {
    const first = await poll(product);
    assert.equal(first.receipts, 3); assert.equal(first.product, product); assert.equal(first.fetchedAt, at);
  }
  assert.equal(calls, 4);
  const text = await readFile(journal, 'utf8');
  assert.equal(decodeJournal(text).size, 12);
  assert.equal((await poll('radar')).unchanged, 1); assert.equal(calls, 4);
  outage = true; now += 3 * 60_000;
  const stale = await poll('radar');
  assert.equal(stale.stale, true); assert.equal(stale.receipts, 0); assert.equal(calls, 5);
  now += 2 * 3600_000;
  await assert.rejects(poll('radar'), /imagery metadata unavailable/);
  assert.equal(calls, 6);
  assert.equal(await readFile(journal, 'utf8'), text);
});
