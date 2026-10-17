// AML owns receipt formatting, byte reads and chain checks. Node owns atomic publication.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, realpath, readdir, lstat, mkdtemp, link, rm, open } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { ROUTE_BUDGET } from '../src/route.js';
const exec = promisify(execFile);
export const AML_BINARY = fileURLToPath(new URL('../deps/aml/runner/aml', import.meta.url));
export const MEMORY_BUDGET = Object.freeze({ capacity: 64, maxBytes: 8_388_608, maxRecordBytes: 201_000,
  maxPayloadBytes: 200_704, timeoutMs: 5000 });
const programs = fileURLToPath(new URL('../aml/', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
const emptyHead = hash('');
const fail = (code, message) => Object.assign(new Error(message), { code });
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function checkedPayload(value) {
  if (!value || value.format !== 'lalo/action-memory' || value.version !== 1
    || !Number.isSafeInteger(value.recordedAt) || !hex(value.snapshot?.sha256)
    || !Number.isSafeInteger(value.snapshot.records) || value.snapshot.records < 0 || value.snapshot.records > 1024
    || value.action?.format !== 'lalo/action' || value.action.version !== 1
    || typeof value.action.status !== 'string' || !Object.hasOwn(value.action, 'result')
    || Buffer.byteLength(JSON.stringify(value.action)) > ROUTE_BUDGET.maxTraceBytes)
    throw fail('MEMORY_FORMAT', 'Invalid action memory payload');
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MEMORY_BUDGET.maxPayloadBytes) throw fail('MEMORY_BUDGET', 'Action payload exceeds its byte budget');
  return text;
}

export async function actionMemory(directory, { executable = AML_BINARY, capacity = MEMORY_BUDGET.capacity,
  maxBytes = MEMORY_BUDGET.maxBytes } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MEMORY_BUDGET.capacity
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MEMORY_BUDGET.maxBytes)
    throw fail('MEMORY_BUDGET', 'Invalid memory budget');
  await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
  const root = await realpath(resolve(directory));
  if (/[\r\n\0]/.test(root)) throw fail('MEMORY_PATH', 'Memory path cannot contain line separators or NUL');
  async function run(program, lines, deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw fail('MEMORY_TIMEOUT', 'Action memory deadline exhausted');
    try {
      const child = exec(executable, [join(programs, program)], { timeout: remaining,
        killSignal: 'SIGKILL', maxBuffer: MEMORY_BUDGET.maxRecordBytes + 1024, encoding: 'utf8' });
      child.child.stdin.on('error', () => {}); child.child.stdin.end(lines.join('\n') + '\n');
      const { stdout } = await child;
      if (!stdout.endsWith('\n') || stdout.slice(0, -1).includes('\n')) throw new Error('Unexpected AML response framing');
      return stdout.slice(0, -1);
    } catch (error) {
      throw fail('MEMORY_AML', `AML memory failed: ${String(error.stderr || error.message).trim().slice(0, 300)}`);
    }
  }
  async function scan({ expectedHead } = {}, deadline = Date.now() + MEMORY_BUDGET.timeoutMs) {
    const entries = (await readdir(root, { withFileTypes: true })).filter(e => e.name.endsWith('.receipt'))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > capacity) throw fail('MEMORY_BUDGET', 'Stored action count exceeds the budget');
    let head = emptyHead, bytes = 0; const receipts = [];
    for (const [index, entry] of entries.entries()) {
      const sequence = index + 1;
      if (entry.name !== `${String(sequence).padStart(6, '0')}.receipt` || !entry.isFile())
        throw fail('MEMORY_CHAIN', 'Action receipt sequence has a gap or nonregular file');
      const path = join(root, entry.name), stat = await lstat(path);
      if (!stat.isFile()) throw fail('MEMORY_CHAIN', 'Action receipt is not a regular file');
      bytes += stat.size;
      if (stat.size > MEMORY_BUDGET.maxRecordBytes || bytes > maxBytes) throw fail('MEMORY_BUDGET', 'Stored action bytes exceed the budget');
      const output = await run('action-read.aml', [path, String(sequence), head], deadline);
      if (output[64] !== '|' || !hex(output.slice(0, 64))) throw fail('MEMORY_FORMAT', 'Invalid AML readback');
      const payload = JSON.parse(output.slice(65)); checkedPayload(payload);
      head = output.slice(0, 64); receipts.push({ ...payload, sequence, head });
    }
    if (expectedHead !== undefined && (!hex(expectedHead) || expectedHead !== head)) throw fail('MEMORY_HEAD', 'Saved head does not match the memory chain');
    return { receipts, head, bytes, capacity, maxBytes };
  }
  async function append(action, journal) {
    const deadline = Date.now() + MEMORY_BUDGET.timeoutMs;
    const payload = checkedPayload({ format: 'lalo/action-memory', version: 1, recordedAt: Date.now(),
      snapshot: { sha256: hash(journal), records: JSON.parse(journal).records.length }, action });
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await scan({}, deadline), sequence = before.receipts.length + 1;
      if (sequence > capacity) throw fail('MEMORY_FULL', `Action memory is full (${capacity} receipts)`);
      const projected = Buffer.byteLength(`${sequence}|${before.head}|${hash(payload)}|${payload}\n`);
      if (before.bytes + projected > maxBytes) throw fail('MEMORY_FULL', 'Action memory byte budget is full');
      const staging = await mkdtemp(join(root, '.pending-'));
      try {
        const path = join(staging, 'receipt'), result = await run('action-write.aml', [path, String(sequence), before.head, payload], deadline);
        if (!/^[12]\|[a-f0-9]{64}$/.test(result)) throw fail('MEMORY_FORMAT', 'Invalid AML append acknowledgment');
        const target = join(root, `${String(sequence).padStart(6, '0')}.receipt`);
        try { await link(path, target); }
        catch (error) { if (error.code === 'EEXIST') continue; throw error; }
        // A successful link is committed. A failed sync is reported, never appended again.
        let durable = result[0] === '1', handle;
        try { handle = await open(root, 'r'); await handle.sync(); }
        catch { durable = false; }
        finally { await handle?.close().catch(() => { durable = false; }); }
        return { state: durable ? 'saved' : 'durability_unconfirmed', sequence, head: result.slice(2),
          snapshot: JSON.parse(payload).snapshot };
      } finally { await rm(staging, { recursive: true, force: true }).catch(() => {}); }
    }
    throw fail('MEMORY_BUSY', 'Concurrent append won three slots; retry memory persistence explicitly');
  }
  return { read: scan, append };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, flag, expectedHead, ...extra] = process.argv.slice(2);
  if (!directory || extra.length || flag && (flag !== '--head' || !expectedHead))
    throw new Error('Usage: node scripts/action-memory.mjs DIRECTORY [--head SHA256]');
  const result = await (await actionMemory(directory)).read({ expectedHead });
  console.log(JSON.stringify(result));
}
