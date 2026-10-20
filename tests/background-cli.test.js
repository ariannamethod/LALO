import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { collection, quake, QUAKETIME as t } from './fixtures/usgs.js';

const script = new URL('../scripts/background.mjs', import.meta.url);
function launch(args) {
  const child = spawn(process.execPath, [script.pathname, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
  return { child, done };
}
async function run(args, input = '') {
  const process = launch(args); process.child.stdin.end(input); return process.done;
}
const frame = (feature = quake(), receivedAt = t + 2000) => JSON.stringify({ kind: 'usgs', receivedAt, feed: collection(feature) }) + '\n';

test('a running event receiver persists before EOF; independent readers select and replay across restart', async tcase => {
  const dir = await mkdtemp(join(tmpdir(), 'lalo-background-'));
  tcase.after(() => rm(dir, { recursive: true, force: true }));
  const journal = join(dir, 'world.json'), req = join(dir, 'request.json'), saved = join(dir, 'context.json');
  await writeFile(req, JSON.stringify({ agent: 'agent:don-eduardo', knownAt: t + 3000,
    stateAt: t + 3000, worldFrom: t, worldTo: t + 10 }));
  const receiver = launch(['ingest', '--journal', journal]);
  tcase.after(() => receiver.child.kill());
  const acknowledgment = once(receiver.child.stdout, 'data');
  receiver.child.stdin.write(frame());
  assert.equal(JSON.parse(String((await acknowledgment)[0])).state, 'saved');
  const original = await readFile(journal, 'utf8');
  const selected = await run(['select', '--journal', journal, '--request', req]);
  assert.equal(selected.code, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout).items[0].facts[0].value, 2.9);
  await writeFile(saved, selected.stdout);
  const locked = await run(['ingest', '--journal', journal], frame());
  assert.equal(locked.code, 1); assert.match(locked.stderr, /EEXIST/);
  receiver.child.stdin.end();
  assert.equal((await receiver.done).code, 0);
  const revised = await run(['ingest', '--journal', journal], frame(quake({ mag: 3.4, updated: t + 4000 }), t + 5000));
  assert.equal(revised.code, 0, revised.stderr);
  const replay = await run(['replay', '--journal', journal, '--context', saved]);
  assert.equal(replay.code, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).comparison, 'match');
  assert.notEqual(await readFile(journal, 'utf8'), original);
  assert.deepEqual((await readdir(dir)).sort(), ['context.json', 'request.json', 'world.json']);
});

test('bad or torn frames fail visibly, preserving the last accepted journal', async tcase => {
  const dir = await mkdtemp(join(tmpdir(), 'lalo-background-errors-'));
  tcase.after(() => rm(dir, { recursive: true, force: true }));
  const journal = join(dir, 'world.json');
  assert.equal((await run(['ingest', '--journal', journal], frame())).code, 0);
  const before = await readFile(journal, 'utf8');
  for (const input of ['{bad}\n', frame().trim(), JSON.stringify({ kind: 'unknown' }) + '\n', 'x'.repeat(2_000_001) + '\n']) {
    const result = await run(['ingest', '--journal', journal], input);
    assert.equal(result.code, 1); assert.equal(JSON.parse(result.stderr).ok, false);
    assert.equal(await readFile(journal, 'utf8'), before);
  }
  assert.deepEqual(await readdir(dir), ['world.json']);
});

test('explicit signal frames share the world; failed persistence is visible and stale staging is retained', async tcase => {
  const dir = await mkdtemp(join(tmpdir(), 'lalo-background-signal-'));
  tcase.after(() => rm(dir, { recursive: true, force: true }));
  const journal = join(dir, 'world.json'), req = join(dir, 'request.json');
  const fact = { id: 'don:mode:1', subject: 'agent:don-eduardo', predicate: 'task_mode', value: 'observe',
    source: 'fixture:host-input', validFrom: t, validTo: null, recordedAt: t + 3000 };
  const ingested = await run(['ingest', '--journal', journal], frame() + JSON.stringify({ kind: 'signal', fact }) + '\n');
  assert.equal(ingested.code, 0, ingested.stderr);
  const request = { agent: fact.subject, knownAt: t + 3000, stateAt: t, worldFrom: t, worldTo: t + 10 };
  await writeFile(req, JSON.stringify(request));
  // Existing regular file cannot be used as an AML memory directory.
  const selected = await run(['select', '--journal', journal, '--request', req, '--memory', journal]);
  assert.equal(selected.code, 1);
  const failed = JSON.parse(selected.stdout);
  assert.equal(failed.context.state[0].id, fact.id);
  assert.equal(failed.memory.state, 'failed');
  const before = await readFile(journal, 'utf8');
  await writeFile(journal + '.pending', 'interrupted write');
  const blocked = await run(['ingest', '--journal', journal], frame(quake({ updated: t + 4000 }), t + 5000));
  assert.equal(blocked.code, 1); assert.match(blocked.stderr, /EEXIST/);
  assert.equal(await readFile(journal, 'utf8'), before);
  assert.equal(await readFile(journal + '.pending', 'utf8'), 'interrupted write');
});
