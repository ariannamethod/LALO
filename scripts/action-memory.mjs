// AML verifies receipts and world files. Node publishes each complete action/world bundle.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, realpath, readdir, lstat, mkdtemp, link, rename, rm, open } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { ROUTE_BUDGET } from '../src/route.js';
import { TOOL_BUDGET } from '../src/tools.js';
import { decodeJournal, encodeJournal } from '../src/journal.js';
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
  if (!value || value.format !== 'lalo/action-memory' || ![1, 2].includes(value.version)
    || !Number.isSafeInteger(value.recordedAt) || !hex(value.snapshot?.sha256)
    || !Number.isSafeInteger(value.snapshot.records) || value.snapshot.records < 0 || value.snapshot.records > 1024
    || value.action?.format !== 'lalo/action' || value.action.version !== 1
    || value.version === 2 && (!Number.isSafeInteger(value.snapshot.bytes) || value.snapshot.bytes < 1 || value.snapshot.bytes > TOOL_BUDGET.maxBytes)
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
  const slot = sequence => String(sequence).padStart(6, '0');
  const worldPath = receipt => join(root, `${slot(receipt.sequence)}.action`, 'world.json');
  async function syncDirectory(path) {
    let handle, synced = true;
    try { handle = await open(path, 'r'); await handle.sync(); }
    catch { synced = false; }
    finally { await handle?.close().catch(() => { synced = false; }); }
    return synced;
  }
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
    const entries = (await readdir(root, { withFileTypes: true })).filter(e => /\.(receipt|action)$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > capacity) throw fail('MEMORY_BUDGET', 'Stored action count exceeds the budget');
    let head = emptyHead, bytes = 0, snapshotBytes = 0; const receipts = [], inodes = new Map();
    for (const [index, entry] of entries.entries()) {
      const sequence = index + 1;
      const bundled = entry.name.endsWith('.action');
      if (entry.name !== `${slot(sequence)}.${bundled ? 'action' : 'receipt'}`
        || (bundled ? !entry.isDirectory() : !entry.isFile()))
        throw fail('MEMORY_CHAIN', 'Action receipt sequence has a gap or nonregular file');
      const path = bundled ? join(root, entry.name, 'receipt') : join(root, entry.name), stat = await lstat(path);
      if (!stat.isFile()) throw fail('MEMORY_CHAIN', 'Action receipt is not a regular file');
      bytes += stat.size;
      if (stat.size > MEMORY_BUDGET.maxRecordBytes || bytes > maxBytes) throw fail('MEMORY_BUDGET', 'Stored action bytes exceed the budget');
      const output = await run('action-read.aml', [path, String(sequence), head], deadline);
      if (output[64] !== '|' || !hex(output.slice(0, 64))) throw fail('MEMORY_FORMAT', 'Invalid AML readback');
      const payload = JSON.parse(output.slice(65)); checkedPayload(payload);
      if (bundled !== (payload.version === 2)) throw fail('MEMORY_FORMAT', 'Receipt version does not match its storage');
      head = output.slice(0, 64); const receipt = { ...payload, sequence, head };
      if (bundled) {
        const file = worldPath(receipt), info = await lstat(file, { bigint: true }), inode = `${info.dev}:${info.ino}`;
        if (!info.isFile() || info.size !== BigInt(payload.snapshot.bytes)) throw fail('MEMORY_SNAPSHOT', 'Stored world size does not match its receipt');
        if (inodes.has(inode)) {
          if (inodes.get(inode) !== payload.snapshot.sha256) throw fail('MEMORY_SNAPSHOT', 'Shared world has conflicting digests');
        } else {
          bytes += Number(info.size); snapshotBytes += Number(info.size);
          if (bytes > maxBytes) throw fail('MEMORY_BUDGET', 'Stored actions and worlds exceed the byte budget');
          const verified = await run('world-verify.aml', [file, payload.snapshot.sha256], deadline);
          if (verified !== payload.snapshot.sha256) throw fail('MEMORY_SNAPSHOT', 'Invalid world verification');
          inodes.set(inode, verified);
        }
      }
      receipts.push(receipt);
    }
    if (expectedHead !== undefined && (!hex(expectedHead) || expectedHead !== head)) throw fail('MEMORY_HEAD', 'Saved head does not match the memory chain');
    return { receipts, head, bytes, snapshotBytes, capacity, maxBytes };
  }
  async function append(action, journal) {
    const deadline = Date.now() + MEMORY_BUDGET.timeoutMs;
    const ledger = decodeJournal(journal, TOOL_BUDGET);
    journal = encodeJournal(ledger, TOOL_BUDGET);
    const snapshot = { sha256: hash(journal), records: ledger.size, bytes: Buffer.byteLength(journal) };
    const payload = checkedPayload({ format: 'lalo/action-memory', version: 2, recordedAt: Date.now(), snapshot, action });
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await scan({}, deadline), sequence = before.receipts.length + 1;
      if (sequence > capacity) throw fail('MEMORY_FULL', `Action memory is full (${capacity} receipts)`);
      const projected = Buffer.byteLength(`${sequence}|${before.head}|${hash(payload)}|${payload}\n`);
      const shared = before.receipts.find(r => r.version === 2 && r.snapshot.sha256 === snapshot.sha256);
      if (before.bytes + projected + (shared ? 0 : snapshot.bytes) > maxBytes)
        throw fail('MEMORY_FULL', 'Action memory byte budget is full');
      const staging = await mkdtemp(join(root, '.pending-'));
      try {
        const world = join(staging, 'world.json');
        if (shared) await link(worldPath(shared), world);
        else {
          const handle = await open(world, 'wx', 0o600);
          try { await handle.writeFile(journal, 'utf8'); await handle.sync(); }
          finally { await handle.close(); }
        }
        if (await run('world-verify.aml', [world, snapshot.sha256], deadline) !== snapshot.sha256)
          throw fail('MEMORY_SNAPSHOT', 'Staged world failed verification');
        const path = join(staging, 'receipt'), result = await run('action-write.aml', [path, String(sequence), before.head, payload], deadline);
        if (!/^[12]\|[a-f0-9]{64}$/.test(result)) throw fail('MEMORY_FORMAT', 'Invalid AML append acknowledgment');
        // A committed directory always contains both files, so rename cannot replace it.
        const stagedSync = await syncDirectory(staging), target = join(root, `${slot(sequence)}.action`);
        try { await rename(staging, target); }
        catch (error) { if (['EEXIST', 'ENOTEMPTY'].includes(error.code)) continue; throw error; }
        const rootSync = await syncDirectory(root), durable = result[0] === '1' && stagedSync && rootSync;
        return { state: durable ? 'saved' : 'durability_unconfirmed', sequence, head: result.slice(2),
          snapshot };
      } finally { await rm(staging, { recursive: true, force: true }).catch(() => {}); }
    }
    throw fail('MEMORY_BUSY', 'Concurrent append won three slots; retry memory persistence explicitly');
  }
  async function recall(query = {}) {
    if (!query || typeof query !== 'object' || Array.isArray(query)
      || Object.keys(query).some(key => !['sequence', 'head', 'snapshot'].includes(key))
      || Object.hasOwn(query, 'sequence') && (!Number.isInteger(query.sequence) || query.sequence < 1 || query.sequence > capacity)
      || Object.hasOwn(query, 'head') && !hex(query.head)
      || Object.hasOwn(query, 'snapshot') && typeof query.snapshot !== 'boolean')
      throw fail('MEMORY_QUERY', 'Expected optional sequence, head and snapshot flag');
    const saved = await scan(), receipt = query.sequence === undefined ? saved.receipts.at(-1) : saved.receipts[query.sequence - 1];
    if (!receipt) {
      if (query.sequence !== undefined || query.head !== undefined) throw fail('MEMORY_NOT_FOUND', 'Saved action is unavailable');
      return { receipt: null };
    }
    if (query.head !== undefined && receipt.head !== query.head) throw fail('MEMORY_HEAD', 'Selected action head has changed');
    if (!query.snapshot) return { receipt };
    if (receipt.version === 1) throw fail('MEMORY_SNAPSHOT', 'This legacy receipt retains a fingerprint; its world was not stored');
    const handle = await open(worldPath(receipt), 'r'); let buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== receipt.snapshot.bytes) throw fail('MEMORY_SNAPSHOT', 'World size changed during readback');
      buffer = Buffer.alloc(info.size + 1); let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break; offset += bytesRead;
      }
      if (offset !== info.size) throw fail('MEMORY_SNAPSHOT', 'World changed during readback');
      buffer = buffer.subarray(0, offset);
    } finally { await handle.close(); }
    if (hash(buffer) !== receipt.snapshot.sha256) throw fail('MEMORY_SNAPSHOT', 'World digest changed during readback');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer), ledger = decodeJournal(text, TOOL_BUDGET);
    if (ledger.size !== receipt.snapshot.records || encodeJournal(ledger, TOOL_BUDGET) !== text)
      throw fail('MEMORY_SNAPSHOT', 'World does not match its canonical receipt');
    return { receipt, journal: JSON.parse(text) };
  }
  return { read: scan, append, recall };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, flag, value, ...extra] = process.argv.slice(2);
  if (!directory || extra.length || flag && (!['--head', '--snapshot'].includes(flag) || !value))
    throw new Error('Usage: node scripts/action-memory.mjs DIRECTORY [--head SHA256 | --snapshot SEQUENCE]');
  const memory = await actionMemory(directory);
  const result = flag === '--snapshot' ? await memory.recall({ sequence: Number(value), snapshot: true })
    : await memory.read({ expectedHead: value });
  console.log(JSON.stringify(result));
}
