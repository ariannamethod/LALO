// Explicit native gate: build-router.mjs, build-aml.mjs, then this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionMemory, AML_BINARY } from '../scripts/action-memory.mjs';
import { serve } from '../scripts/serve.mjs';
import { FactLedger } from '../src/ledger.js';
import { encodeJournal } from '../src/journal.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const world = new FactLedger();
world.add({ id: 'a1', subject: 'переправа:север', predicate: 'open', value: true,
  source: 'fixture:свидетель', validFrom: 1792268765001, validTo: null, recordedAt: 1792268765123 });
const journal = encodeJournal(world);
const action = { format: 'lalo/action', version: 1, status: 'executed',
  request: { text: 'read active facts', arguments: { validAt: 1792268765001, knownAt: 1792268765123 } },
  route: { activation: .9 }, call: { name: 'lalo_facts' }, result: { ok: true, data: { items: world.entries() } } };
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'lalo-memory-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test('real AML persists exact UTF-8 and both integer clocks; a fresh host verifies all receipts', async t => {
  const dir = await directory(t), memory = await actionMemory(dir);
  const large = { ...action, result: { text: 'é😅|строка\n'.repeat(3000), items: world.entries() } };
  const first = await memory.append(large, journal), second = await memory.append(action, journal);
  assert.equal(first.state, 'saved'); assert.equal(second.sequence, 2);
  const restored = await (await actionMemory(dir)).read({ expectedHead: second.head });
  assert.deepEqual(restored.receipts.map(r => r.action), [large, action]);
  assert.equal(restored.receipts[0].snapshot.sha256, digest(journal));
  assert.equal(restored.receipts[0].snapshot.records, 1);
  assert.ok(Number.isSafeInteger(restored.receipts[0].recordedAt));
  assert.equal(restored.head, second.head);
  const lines = await Promise.all(['000001.receipt', '000002.receipt'].map(f => readFile(join(dir, f), 'utf8')));
  assert.equal(lines[1].split('|')[1], digest(lines[0].slice(0, -1)));
});

test('tampering, torn writes, invalid UTF-8 and missing sequence block read and append without repairing history', async t => {
  const dir = await directory(t), memory = await actionMemory(dir), file = join(dir, '000001.receipt');
  await memory.append(action, journal); const original = await readFile(file);
  for (const damaged of [Buffer.from(original.toString().replace('read active facts', 'fake active facts')),
    original.subarray(0, -1), Buffer.concat([original.subarray(0, -2), Buffer.from([0xff, 0x0a])])]) {
    await writeFile(file, damaged);
    await assert.rejects(memory.read(), { code: 'MEMORY_AML' });
    await assert.rejects(memory.append(action, journal), { code: 'MEMORY_AML' });
    assert.deepEqual(await readFile(file), damaged);
  }
  await writeFile(file, original); await memory.append(action, journal); await rm(file);
  await assert.rejects(memory.read(), { code: 'MEMORY_CHAIN' });
  assert.deepEqual(await readdir(dir), ['000002.receipt']);
});

test('an acknowledged head detects lost tail; uncommitted staging never joins the chain', async t => {
  const dir = await directory(t), memory = await actionMemory(dir);
  const first = await memory.append(action, journal), second = await memory.append(action, journal);
  await mkdir(join(dir, '.pending-crashed')); await writeFile(join(dir, '.pending-crashed', 'receipt'), 'torn');
  assert.equal((await memory.read()).receipts.length, 2);
  await rm(join(dir, '000002.receipt'));
  await assert.rejects(memory.read({ expectedHead: second.head }), { code: 'MEMORY_HEAD' });
  assert.equal((await memory.read({ expectedHead: first.head })).receipts.length, 1);
});

test('count and byte exhaustion keep earlier receipts; unsupported or oversized payloads leave no files', async t => {
  const dir = await directory(t), memory = await actionMemory(dir, { capacity: 1 });
  await memory.append(action, journal); const before = await readFile(join(dir, '000001.receipt'));
  await assert.rejects(memory.append(action, journal), { code: 'MEMORY_FULL' });
  const byteLimited = await actionMemory(dir, { maxBytes: before.length });
  await assert.rejects(byteLimited.append(action, journal), { code: 'MEMORY_FULL' });
  assert.deepEqual(await readFile(join(dir, '000001.receipt')), before);
  const empty = await directory(t), fresh = await actionMemory(empty);
  await assert.rejects(fresh.append({ ...action, version: 2 }, journal), { code: 'MEMORY_FORMAT' });
  await assert.rejects(fresh.append({ ...action, result: 'x'.repeat(200000) }, journal), { code: 'MEMORY_FORMAT' });
  assert.deepEqual(await readdir(empty), []);
});

test('two writers publish distinct immutable slots and reread one valid chain', async t => {
  const dir = await directory(t), a = await actionMemory(dir), b = await actionMemory(dir);
  const other = { ...action, status: 'no_call', result: null };
  const saved = await Promise.all([a.append(action, journal), b.append(other, journal)]);
  assert.deepEqual(saved.map(r => r.sequence).sort(), [1, 2]);
  const readback = await a.read(); assert.equal(readback.receipts.length, 2);
  assert.deepEqual(readback.receipts.map(r => r.action.status).sort(), ['executed', 'no_call']);
  assert.deepEqual(await readdir(dir), ['000001.receipt', '000002.receipt']);
});

test('a completed AML write without confirmed sync is reported once and can be read back', async t => {
  const dir = await directory(t), executable = join(dir, 'aml-unsynced');
  await writeFile(executable, `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');
const fs=require('node:fs');const r=spawnSync(${JSON.stringify(AML_BINARY)},process.argv.slice(2),{input:fs.readFileSync(0),encoding:'utf8'});
process.stdout.write(process.argv[2].endsWith('action-write.aml')?r.stdout.replace(/^1\\|/,'2|'):r.stdout);
process.stderr.write(r.stderr);process.exit(r.status ?? 1);\n`, { mode: 0o700 });
  const memory = await actionMemory(dir, { executable }), receipt = await memory.append(action, journal);
  assert.equal(receipt.state, 'durability_unconfirmed'); assert.equal(receipt.sequence, 1);
  assert.equal((await (await actionMemory(dir)).read()).receipts.length, 1);
});

test('missing and stalled AML fail explicitly and never publish a receipt', async t => {
  const dir = await directory(t);
  await assert.rejects((await actionMemory(dir, { executable: join(dir, 'missing') })).append(action, journal), { code: 'MEMORY_AML' });
  const executable = join(dir, 'stalled');
  await writeFile(executable, `#!${process.execPath}\nprocess.stdin.resume();setInterval(()=>{},1000);\n`, { mode: 0o700 });
  await assert.rejects((await actionMemory(dir, { executable })).append(action, journal), { code: 'MEMORY_AML' });
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.receipt') || name.startsWith('.pending-')), []);
});

test('actual C → HTTP → AML survives host restart; recall executes nothing and failed saves preserve the action result', async t => {
  const dir = await directory(t); let server;
  async function stop() { if (server) { await server.closeActions(); await new Promise(r => server.close(r)); server = undefined; } }
  t.after(stop);
  server = await serve({ port: 0, router: true, memoryDirectory: dir });
  const post = async (path, input) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    return fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  };
  assert.equal((await (await post('/api/memory', {})).json()).receipt, null);
  const payload = { journal: JSON.parse(journal), request: { text: 'get the active observations please', arguments: action.request.arguments } };
  const saved = await (await post('/api/action', payload)).json();
  assert.equal(saved.status, 'executed'); assert.equal(saved.memory.state, 'saved');
  assert.deepEqual(saved.result.data.items.map(f => f.id), ['a1']);
  await stop(); let starts = 0;
  server = await serve({ port: 0, router: true, memoryDirectory: dir, routerFactory: () => { starts++; throw new Error('Recall must not route'); } });
  const recalled = await (await post('/api/memory', {})).json();
  const { memory, ...trace } = saved;
  assert.deepEqual(recalled.receipt.action, trace); assert.equal(recalled.receipt.head, memory.head); assert.equal(starts, 0);
  assert.equal((await post('/api/memory', { path: '/etc/passwd' })).status, 400);
  await stop(); server = await serve({ port: 0, router: true, memoryDirectory: dir });
  await writeFile(join(dir, '000003.receipt'), 'not a receipt');
  const failedSave = await (await post('/api/action', payload)).json();
  assert.equal(failedSave.status, 'executed'); assert.deepEqual(failedSave.result, trace.result);
  assert.equal(failedSave.memory.state, 'failed'); assert.equal(failedSave.memory.code, 'MEMORY_CHAIN');
  await stop(); await assert.rejects(serve({ port: 0, router: true, memoryDirectory: dir }), { code: 'MEMORY_CHAIN' });
});
