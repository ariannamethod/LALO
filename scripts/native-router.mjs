// Node owns process/file I/O. One bounded request in flight; the C field stays warm.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonLines } from './io.mjs';
import { ROUTE_BUDGET, selectorTools, routeRequest } from '../src/route.js';

export const ROUTER_BINARY = fileURLToPath(new URL('../build/lalo-router', import.meta.url));
const examples = fileURLToPath(new URL('../router/examples.jsonl', import.meta.url));
const failure = (code, message) => Object.assign(new Error(message), { code });

export async function createNativeRouter({ executable = ROUTER_BINARY, timeoutMs = ROUTE_BUDGET.timeoutMs } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > ROUTE_BUDGET.timeoutMs)
    throw new RangeError('Router deadline must be 1..5000 milliseconds');
  const directory = await mkdtemp(join(tmpdir(), 'lalo-router-'));
  const definitions = join(directory, 'tools.json');
  try { await writeFile(definitions, JSON.stringify(selectorTools()), { mode: 0o600 }); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  let child, exited, pending, stopped, closed = false, diagnostics = '';
  function stop(error) {
    stopped ||= error;
    child?.kill('SIGKILL');
    if (pending) { clearTimeout(pending.timer); pending.reject(stopped); pending = undefined; }
  }
  function start() {
    child = spawn(executable, ['--tools', definitions, '--examples', examples, '--batch', '--reasoning-compact'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    exited = new Promise(resolve => child.once('close', (code, signal) => {
      if (!closed) stop(failure('ROUTER_EXIT', `Router exited ${code ?? signal}. ${diagnostics}`.slice(0, 400)));
      resolve();
    }));
    child.on('error', error => stop(failure('ROUTER_START', `${error.message}. Run node scripts/build-router.mjs first.`)));
    child.stdin.on('error', error => stop(failure('ROUTER_IO', error.message)));
    child.stderr.on('data', chunk => {
      // Drain all stderr, retain only its first 4096 bytes for a failure report.
      diagnostics = Buffer.concat([Buffer.from(diagnostics), chunk]).subarray(0, 4096).toString('utf8');
    });
    void (async () => {
      try {
        for await (const frame of jsonLines(child.stdout, ROUTE_BUDGET.maxDecisionBytes)) {
          if (closed || stopped) break;
          if (frame.error) throw failure('ROUTER_PROTOCOL', frame.error);
          if (!pending) throw failure('ROUTER_PROTOCOL', 'Unsolicited router output');
          let decision;
          try { decision = JSON.parse(frame.text); }
          catch { throw failure('ROUTER_PROTOCOL', 'Router returned invalid JSON'); }
          const current = pending; pending = undefined; clearTimeout(current.timer); current.resolve(decision);
        }
      } catch (error) { stop(failure(error.code || 'ROUTER_IO', error.message)); }
    })();
  }
  return Object.freeze({
    async route(text) {
      routeRequest({ text, arguments: {} });
      if (closed) throw failure('ROUTER_CLOSED', 'Router is closed');
      if (stopped) throw stopped;
      if (pending) throw failure('ROUTER_BUSY', 'Router already has a request in flight');
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(() => stop(failure('ROUTER_TIMEOUT',
          `Router exceeded ${timeoutMs} milliseconds; session stopped`)), timeoutMs) };
        try {
          if (!child) start();
          child.stdin.write(JSON.stringify({ text }) + '\n', error => {
            if (error) stop(failure('ROUTER_IO', error.message));
          });
        } catch (error) { stop(failure('ROUTER_START', error.message)); }
      });
    },
    async close() {
      closed = true; stop(failure('ROUTER_CLOSED', 'Router is closed'));
      if (exited) await exited;
      await rm(directory, { recursive: true, force: true });
    },
  });
}
