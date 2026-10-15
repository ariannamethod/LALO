import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUSGS } from '../src/sources/usgs-http.js';
import { USGS_FEED } from '../src/sources/usgs.js';

test('shared transport reads split UTF-8 within its byte budget and uses the fixed source', async () => {
  const bytes = new TextEncoder().encode('{"place":"земля"}');
  const fetchImpl = async (url, options) => {
    assert.equal(url, USGS_FEED); assert.equal(options.credentials, 'omit');
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 12)); controller.enqueue(bytes.slice(12)); controller.close();
    } }));
  };
  assert.equal(await fetchUSGS({ fetchImpl, maxBytes: bytes.length }), '{"place":"земля"}');
});

test('transport rejects declared and streamed oversize, HTTP errors and timeouts', async () => {
  await assert.rejects(fetchUSGS({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': '10' } }), maxBytes: 5 }), /byte budget/);
  let cancelled = false;
  await assert.rejects(fetchUSGS({ fetchImpl: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(6)); }, cancel() { cancelled = true; },
  })), maxBytes: 5 }), /byte budget/);
  assert.equal(cancelled, true);
  await assert.rejects(fetchUSGS({ fetchImpl: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(fetchUSGS({ timeoutMs: 5, fetchImpl: (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) }), { name: 'AbortError' });
  await assert.rejects(fetchUSGS({ maxBytes: 0 }), /invalid/);
});
