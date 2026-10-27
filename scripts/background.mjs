// Explicit event input, durable bounded journal, independent context reads.
import { open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createBackground, BACKGROUND_BUDGET } from '../src/background.js';
import { selectBackground, replayBackground } from '../src/background-context.js';
import { fetchUSGS } from '../src/sources/usgs-http.js';
import { boundedTextFile, jsonLines } from './io.mjs';

const usage = 'background.mjs ingest|poll|select|replay --journal FILE [--request FILE] [--context FILE] [--memory DIR] [--sequence N] [--head SHA256]';
const [mode, ...args] = process.argv.slice(2), options = {};
const allowed = { ingest: ['--journal'], poll: ['--journal'], select: ['--journal', '--request', '--memory'],
  replay: ['--journal', '--context', '--memory', '--sequence', '--head'] };
const emit = value => new Promise((done, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : done()));

async function readWorld(path, allowMissing = false) {
  try { return (await createBackground(await boundedTextFile(path))).journal(); }
  catch (error) { if (allowMissing && error.code === 'ENOENT') return (await createBackground()).journal(); throw error; }
}

async function writer(path, run) {
  path = resolve(path);
  // One host owns receipt ordering. A crash leaves a visible lock for inspection.
  const lock = await open(path + '.lock', 'wx', 0o600);
  const temporary = path + '.pending';
  let ownsTemporary = false;
  try {
    let journal = await readWorld(path, true);
    await run(async frame => {
      // The producer may stamp its own receipt, never one ahead of this receiver.
      if ((frame?.kind === 'signal' ? frame.fact?.recordedAt : frame?.receivedAt) > Date.now())
        throw new RangeError('receipt time is ahead of the receiver clock');
      const next = await createBackground(journal), summary = await next.receive(frame);
      const text = next.journal();
      const handle = await open(temporary, 'wx', 0o600);
      ownsTemporary = true;
      try { await handle.writeFile(text); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, path);
      ownsTemporary = false;
      journal = text;
      let directory, state = 'saved';
      try { directory = await open(dirname(path), 'r'); await directory.sync(); }
      catch { state = 'durability_unconfirmed'; }
      finally { await directory?.close(); }
      await emit({ ok: true, state, ...summary });
    });
  } finally {
    if (ownsTemporary) await rm(temporary, { force: true });
    await lock.close();
    await rm(path + '.lock');
  }
}

try {
  if (!Object.hasOwn(allowed, mode)) throw new Error(usage);
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed[mode].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw new Error(usage);
    options[args[i]] = args[i + 1];
  }
  if (mode !== 'replay' && !options['--journal']) throw new Error(usage);
  if (mode === 'select' && !options['--request']) throw new Error(usage);
  if (mode === 'ingest' || mode === 'poll') {
    await writer(options['--journal'], async append => {
      if (mode === 'poll') {
        const feed = JSON.parse(await fetchUSGS());
        await append({ kind: 'usgs', feed, receivedAt: Date.now() });
      } else {
        for await (const frame of jsonLines(process.stdin, BACKGROUND_BUDGET.maxBytes)) {
          if (frame.error) throw new Error(frame.error);
          await append(JSON.parse(frame.text));
        }
      }
    });
  } else if (mode === 'select') {
    const journal = await readWorld(options['--journal']);
    const request = JSON.parse(await boundedTextFile(options['--request'], 8192));
    const context = await selectBackground(journal, request);
    if (!options['--memory']) await emit(context);
    else {
      const { actionMemory } = await import('./action-memory.mjs');
      // An explicit local projection action; no native routing decision is invented.
      const action = { format: 'lalo/action', version: 1, status: 'executed',
        request: { kind: 'background-context', arguments: context.request }, route: null, call: null, result: context };
      let acknowledgment;
      try { acknowledgment = await (await actionMemory(options['--memory'])).append(action, journal); }
      catch (error) { acknowledgment = { state: 'failed', code: error.code, message: error.message }; process.exitCode = 1; }
      await emit({ context, memory: acknowledgment });
    }
  } else {
    if (options['--memory']) {
      if (options['--journal'] || options['--context']) throw new Error(usage);
      const { actionMemory } = await import('./action-memory.mjs');
      const memory = await actionMemory(options['--memory']);
      const query = { snapshot: true };
      if (options['--sequence']) query.sequence = Number(options['--sequence']);
      if (options['--head']) query.head = options['--head'];
      const { receipt, journal } = await memory.recall(query);
      if (!receipt || receipt.action.request?.kind !== 'background-context') throw new Error('selected receipt is not a background selection');
      await emit(await replayBackground(JSON.stringify(journal), receipt.action.result));
    } else {
      if (!options['--journal'] || !options['--context'] || options['--sequence'] || options['--head']) throw new Error(usage);
      const saved = JSON.parse(await boundedTextFile(options['--context'], 65_536));
      await emit(await replayBackground(await readWorld(options['--journal']), saved));
    }
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.code || 'BACKGROUND_ERROR', message: error.message }));
  process.exitCode = 1;
}
