// Optional loopback bridge. Each call owns its submitted journal; only the selector stays warm.
import { decodeJournal } from '../src/journal.js';
import { createToolHost, TOOL_BUDGET } from '../src/tools.js';
import { createRouteSession, routeRequest, ROUTE_BUDGET } from '../src/route.js';
import { createNativeRouter } from './native-router.mjs';

export const ACTION_HTTP_BUDGET = Object.freeze({ maxBytes: 2_100_000, bodyMs: 5000 });
const failure = (status, message) => Object.assign(new Error(message), { status });
function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    const timer = setTimeout(() => finish(failure(408, 'Action upload timed out')), ACTION_HTTP_BUDGET.bodyMs);
    function finish(error, value) {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', aborted);
      error ? reject(error) : resolve(value);
    }
    function data(chunk) {
      size += chunk.length;
      if (size > ACTION_HTTP_BUDGET.maxBytes) { req.pause(); finish(failure(413, 'Action exceeds the upload budget')); }
      else chunks.push(chunk);
    }
    function end() {
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)))); }
      catch { finish(failure(400, 'Action must be UTF-8 JSON')); }
    }
    function aborted() { finish(failure(400, 'Action upload interrupted')); }
    req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', aborted);
  });
}
export function actionHandler({ enabled = false, routerFactory = createNativeRouter } = {}) {
  let router, busy = false, closed = false;
  function reply(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      ...(status === 200 ? {} : { Connection: 'close' }) });
    res.end(JSON.stringify(value));
  }
  return {
    async handle(req, res) {
      let ownsSlot = false;
      try {
        if (!enabled || closed) throw failure(503, 'Local router unavailable. Start the host with --router after building its C body.');
        if (req.method !== 'POST') throw failure(405, 'Actions require POST');
        const host = `127.0.0.1:${req.socket.localPort}`;
        if (req.headers.host !== host || req.headers.origin !== `http://${host}`)
          throw failure(403, 'Actions require the local field origin');
        if (req.headers['content-type'] !== 'application/json') throw failure(415, 'Actions require application/json');
        if (busy) throw failure(429, 'Another action is in flight');
        if (Number(req.headers['content-length']) > ACTION_HTTP_BUDGET.maxBytes)
          throw failure(413, 'Action exceeds the upload budget');
        busy = true; ownsSlot = true;
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'journal') || !Object.hasOwn(input, 'request'))
          throw failure(400, 'Expected journal and request');
        const request = routeRequest(input.request);
        const hostSession = createToolHost(decodeJournal(JSON.stringify(input.journal), TOOL_BUDGET));
        if (closed || res.destroyed) throw failure(503, 'Action connection closed');
        router ||= Promise.resolve().then(routerFactory);
        const trace = await createRouteSession(hostSession, await router).call(request);
        if (Buffer.byteLength(JSON.stringify(trace)) > ROUTE_BUDGET.maxTraceBytes)
          throw failure(500, 'Action exceeds the response budget');
        reply(res, 200, trace);
      } catch (error) {
        if (!res.destroyed) reply(res, error.status || 400, { error: String(error.message).slice(0, 400) });
      } finally { if (ownsSlot) busy = false; }
    },
    async close() { closed = true; if (router) await (await router).close(); },
  };
}
