import { encodeJournal, decodeJournal } from '../journal.js';

export const CAMERA_BUDGET = Object.freeze({ capacity: 1024, maxBytes: 1_500_000 });
export const CAMERA_LIMITS = Object.freeze({ frames: 32, jpegBytes: 49_152, edge: 640, chunk: 4096 });
export const CAMERA_SOURCE = 'browser:camera';
export const CAMERA_SUBJECT = 'device:this-browser';

async function digest(jpeg) {
  if (typeof jpeg !== 'string' || !jpeg.length || jpeg.length > CAMERA_LIMITS.jpegBytes / 3 * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(jpeg))
    throw new TypeError('Camera JPEG exceeds its byte budget or has invalid base64');
  const raw = atob(jpeg);
  if (btoa(raw) !== jpeg || raw.length < 4 || raw.charCodeAt(0) !== 255 || raw.charCodeAt(1) !== 216
    || raw.charCodeAt(raw.length - 2) !== 255 || raw.charCodeAt(raw.length - 1) !== 217)
    throw new TypeError('Camera frame must contain JPEG bytes');
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function dimensions(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= CAMERA_LIMITS.edge))
    throw new TypeError('Camera frame dimensions must be integers between 1 and 640');
}

// Bounded scalar chunks preserve the actual JPEG through the existing journal
// and AML world snapshots; no separate attachment store or dangling file link.
export async function appendCamera(ledger, frame, { id, receivedAt } = {}) {
  const { jpeg, width, height, capturedAt } = frame || {};
  dimensions(width, height);
  if (!Number.isSafeInteger(capturedAt) || capturedAt < 0 || capturedAt >= Number.MAX_SAFE_INTEGER)
    throw new TypeError('Camera capture time must be integer Unix milliseconds');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(id)) throw new TypeError('Invalid camera observation id');
  const hash = await digest(jpeg);
  const next = decodeJournal(encodeJournal(ledger, CAMERA_BUDGET), CAMERA_BUDGET);
  if ((await cameraFrames(next)).length >= CAMERA_LIMITS.frames) throw new RangeError('Camera frame budget reached');
  const values = [['camera.width', width], ['camera.height', height], ['camera.sha256', hash]];
  for (let offset = 0; offset < jpeg.length; offset += CAMERA_LIMITS.chunk)
    values.push([`camera.jpeg.${offset / CAMERA_LIMITS.chunk}`, jpeg.slice(offset, offset + CAMERA_LIMITS.chunk)]);
  for (const [predicate, value] of values) next.add({
    id: `camera:${id}:${predicate}`, subject: CAMERA_SUBJECT, predicate, value, source: CAMERA_SOURCE,
    validFrom: capturedAt, validTo: capturedAt + 1, recordedAt: receivedAt,
  });
  encodeJournal(next, CAMERA_BUDGET);
  return next;
}

export async function cameraFrames(ledger) {
  const all = ledger.entries(), frames = [];
  for (let i = 0; i < all.length;) {
    const first = all[i], id = first.id.match(/^camera:([A-Za-z0-9_-]{1,96}):camera.width$/)?.[1];
    if (!id) throw new Error('Invalid camera receipt group');
    const records = all.slice(i, i + 3);
    let j = i + 3;
    while (j < all.length && all[j].predicate.startsWith('camera.jpeg.')) records.push(all[j++]);
    if (records.length < 4 || records.length > 3 + CAMERA_LIMITS.jpegBytes / 3 * 4 / CAMERA_LIMITS.chunk)
      throw new Error('Incomplete or oversized camera receipt group');
    const predicates = ['camera.width', 'camera.height', 'camera.sha256', ...records.slice(3).map((_, n) => `camera.jpeg.${n}`)];
    if (records.some((f, n) => f.id !== `camera:${id}:${predicates[n]}` || f.predicate !== predicates[n]
      || f.source !== CAMERA_SOURCE || f.subject !== CAMERA_SUBJECT || f.validFrom !== first.validFrom
      || f.validTo !== first.validFrom + 1 || f.recordedAt !== first.recordedAt || f.supersedes !== null)
      || !Number.isSafeInteger(first.validFrom) || first.validFrom < 0 || first.validFrom >= Number.MAX_SAFE_INTEGER)
      throw new Error('Inconsistent camera receipts');
    const [width, height, hash] = records.slice(0, 3).map(f => f.value);
    dimensions(width, height);
    const chunks = records.slice(3).map(f => f.value);
    if (chunks.some((v, n) => typeof v !== 'string' || !v.length || v.length > CAMERA_LIMITS.chunk
      || n < chunks.length - 1 && v.length !== CAMERA_LIMITS.chunk)) throw new Error('Invalid camera image chunks');
    const jpeg = chunks.join('');
    if (await digest(jpeg) !== hash) throw new Error('Camera image digest mismatch');
    frames.push({ id: first.id, width, height, hash, jpeg, capturedAt: first.validFrom,
      receivedAt: first.recordedAt, records });
    if (frames.length > CAMERA_LIMITS.frames) throw new RangeError('Camera frame budget reached');
    i = j;
  }
  return frames;
}
