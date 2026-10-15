import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { FactLedger } from '../src/ledger.js';
import { encodeJournal } from '../src/journal.js';
import { createToolHost, listTools } from '../src/tools.js';
import { createMCPSession, MCP_VERSION } from '../src/mcp.js';
import { jsonLines, boundedTextFile } from '../scripts/io.mjs';
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const init = request(1, 'initialize', { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: 'synthetic-test-client', version: '1' } });
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const fixture = () => {
  const world = new FactLedger();
  world.add({ id: 'a1', subject: 'synthetic:crossing', predicate: 'open', value: true, source: 'fixture:a', validFrom: 10, validTo: 20, recordedAt: 100 });
  world.add({ id: 'a2', subject: 'synthetic:crossing', predicate: 'open', value: false, source: 'fixture:a', validFrom: 10, validTo: 20, recordedAt: 200, supersedes: 'a1' });
  return world;
};

test('MCP negotiates a fixed tools capability and distinguishes protocol and tool failures', () => {
  const s = createMCPSession(createToolHost(fixture()));
  assert.equal(s.handle(request(0, 'tools/list')).error.code, -32002);
  const hello = s.handle(init);
  assert.equal(hello.result.protocolVersion, MCP_VERSION); assert.deepEqual(hello.result.capabilities, { tools: { listChanged: false } });
  assert.equal(s.handle(request(2, 'tools/list')).error.code, -32002);
  assert.equal(s.handle(initialized), null);
  assert.equal(s.handle(request(3, 'tools/list')).result.tools.length, 6);
  assert.equal(s.handle(request(4, 'tools/list', { cursor: 'invented' })).error.code, -32602);
  assert.equal(s.handle(request(5, 'tools/call', { name: 'not_registered' })).error.code, -32602);
  const invalid = s.handle(request(6, 'tools/call', { name: 'lalo_facts', arguments: { knownAt: '100', validAt: 10 } }));
  assert.equal(invalid.result.isError, true); assert.equal(invalid.result.structuredContent.error.code, 'INVALID_ARGUMENTS');
  const future = s.handle(request(7, 'tools/call', { name: 'lalo_lineage', arguments: { id: 'a2', knownAt: 100 } }));
  assert.equal(future.result.structuredContent.error.code, 'NOT_FOUND');
  const good = s.handle(request(8, 'tools/call', { name: 'lalo_facts', arguments: { knownAt: 100, validAt: 10 } }));
  assert.equal(good.result.isError, false);
  assert.deepEqual(JSON.parse(good.result.content[0].text), good.result.structuredContent);
  assert.equal(good.result.structuredContent.data.items[0].id, 'a1');
  assert.equal(s.handle(request(9, 'unknown')).error.code, -32601);
  assert.equal(s.handle(init).error.code, -32600);
  assert.equal(s.handle(request(10, 'ping', null)).error.code, -32602);
  assert.equal(s.handle([]).error.code, -32600);
  assert.equal(s.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 8 } }), null);
  assert.equal(s.handle({ jsonrpc: '2.0', id: 8, result: {} }), null);
  const other = createMCPSession(createToolHost(fixture()));
  assert.equal(other.handle({ ...init, params: { ...init.params, protocolVersion: 'older-client-version' } }).result.protocolVersion, MCP_VERSION);
});

test('bounded framing survives split UTF-8, multiple lines, malformed bytes and overlong frames', async () => {
  const utf8 = Buffer.from('"земля"\r\n{"ok":true}\n');
  const chunks = [utf8.subarray(0, 3), utf8.subarray(3, 8), utf8.subarray(8), Buffer.from([0xff, 10]), Buffer.from('x'.repeat(40)), Buffer.from('xxx\n{}\nunfinished')];
  const frames = []; for await (const frame of jsonLines(Readable.from(chunks), 32)) frames.push(frame);
  assert.equal(JSON.parse(frames[0].text), 'земля'); assert.deepEqual(JSON.parse(frames[1].text), { ok: true });
  assert.match(frames[2].error, /UTF-8/); assert.match(frames[3].error, /exceeds/);
  assert.equal(frames[4].text, '{}'); assert.match(frames[5].error, /without a newline/);
  assert.equal(frames.length, 6);
});

test('real stdio process serves discovery and two-clock calls, recovers from bad frames and exits on EOF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lalo-mcp-'));
  try {
    const file = join(dir, 'world.json'); await writeFile(file, encodeJournal(fixture()));
    const lines = [init, initialized, request(2, 'tools/list'), request(3, 'tools/call', { name: 'lalo_facts', arguments: { knownAt: 100, validAt: 10 } }),
      request(4, 'tools/call', { name: 'lalo_lineage', arguments: { id: 'a2', knownAt: 200 } })].map(JSON.stringify).join('\n');
    const input = lines + '\n' + 'x'.repeat(40_000) + '\n{bad json}\n' + JSON.stringify(request(5, 'ping')) + '\n';
    const child = spawnSync(process.execPath, ['scripts/mcp.mjs', '--journal', file], { input, encoding: 'utf8', timeout: 10000, maxBuffer: 1_000_000 });
    assert.equal(child.status, 0, child.stderr); assert.match(child.stderr, /2 receipts, fixed snapshot/);
    const messages = child.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(messages.length, 7); assert.equal(messages[1].result.tools.length, 6);
    assert.equal(messages[2].result.structuredContent.data.items[0].id, 'a1');
    assert.deepEqual(messages[3].result.structuredContent.data.items.map(f => f.id), ['a1', 'a2']);
    assert.equal(messages[4].error.code, -32700); assert.equal(messages[5].error.code, -32700);
    assert.deepEqual(messages[6], { jsonrpc: '2.0', id: 5, result: {} });
    assert.equal(await boundedTextFile(file), encodeJournal(fixture()));
    await writeFile(file, Buffer.from([0xff]));
    const broken = spawnSync(process.execPath, ['scripts/mcp.mjs', '--journal', file], { input: '', encoding: 'utf8', timeout: 10000 });
    assert.equal(broken.status, 1); assert.equal(broken.stdout, '');
    await writeFile(file, 'x'.repeat(100));
    await assert.rejects(boundedTextFile(file, 32), /byte budget/);
    const definitions = spawnSync(process.execPath, ['scripts/mcp.mjs', '--definitions'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(definitions.status, 0); assert.deepEqual(JSON.parse(definitions.stdout), listTools());
  } finally { await rm(dir, { recursive: true, force: true }); }
});
