import { USGS_FEED } from './usgs.js';

// Browser and CLI share one on-demand, bounded transport. Ingestion owns no I/O.
export async function fetchUSGS({ fetchImpl = globalThis.fetch, maxBytes = 2_000_000, timeoutMs = 15_000 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new RangeError('invalid USGS transport budget');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader;
  try {
    const response = await fetchImpl(USGS_FEED, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`USGS HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw new RangeError('feed exceeds byte budget');
    if (!response.body) throw new Error('USGS response has no body');
    reader = response.body.getReader();
    const decoder = new TextDecoder(); let size = 0, text = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RangeError('feed exceeds byte budget');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    controller.abort();
    await reader?.cancel().catch(() => {});
    throw error;
  } finally { reader?.releaseLock(); clearTimeout(timer); }
}
