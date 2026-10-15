import { open } from 'node:fs/promises';

export async function boundedTextFile(path, maxBytes = 2_000_000) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('invalid file byte budget');
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('input must be a regular file');
    if (stat.size > maxBytes) throw new RangeError('input exceeds byte budget');
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const part = await handle.read(bytes, size, bytes.length - size, size);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size > maxBytes) throw new RangeError('input exceeds byte budget');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally { await handle.close(); }
}

// Bound an unterminated frame before allocating/parsing it; discard through its newline.
export async function* jsonLines(stream, maxBytes = 32_768) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('invalid frame byte budget');
  let pieces = [], size = 0, discarding = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    while (start < bytes.length) {
      const end = bytes.indexOf(10, start), stop = end < 0 ? bytes.length : end;
      if (!discarding) {
        const part = bytes.subarray(start, stop);
        if (size + part.length > maxBytes) {
          pieces = []; size = 0; discarding = true;
          yield { error: `JSON-RPC frame exceeds ${maxBytes} bytes` };
        } else { pieces.push(part); size += part.length; }
      }
      if (end >= 0) {
        if (!discarding) {
          try { yield { text: decoder.decode(Buffer.concat(pieces, size)) }; }
          catch { yield { error: 'JSON-RPC frame is not valid UTF-8' }; }
        }
        pieces = []; size = 0; discarding = false;
      }
      start = end < 0 ? bytes.length : end + 1;
    }
  }
  if (size) yield { error: 'JSON-RPC frame ended without a newline' };
}
