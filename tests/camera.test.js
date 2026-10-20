import test from 'node:test';
import assert from 'node:assert/strict';
import { FactLedger } from '../src/ledger.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { createToolHost } from '../src/tools.js';
import { createActionReplay } from '../src/action-replay.js';
import { appendCamera, cameraFrames, CAMERA_BUDGET, CAMERA_LIMITS } from '../src/sources/camera.js';
import { requestCamera, captureFrame } from '../web/camera-capture.js';

// Synthetic JPEG-framed bytes exercise storage, not image decoding. The browser
// gate captures and decodes a real JPEG from Chrome's synthetic video device.
const jpeg = (size = 9000) => Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(size - 4, 42), Buffer.from([255, 217])]).toString('base64');
const frame = (capturedAt = 1000, size) => ({ jpeg: jpeg(size), width: 640, height: 480, capturedAt });
const add = (ledger, id = 'synthetic', receivedAt = 2000, image = frame()) => appendCamera(ledger, image, { id, receivedAt });

test('camera bytes and both clocks survive journal, bounded tool pages and original-world replay', async () => {
  const original = new FactLedger(), image = frame(1000, CAMERA_LIMITS.jpegBytes), ledger = await add(original, 'large', 2000, image);
  assert.equal(original.size, 0);
  const restored = decodeJournal(encodeJournal(ledger, CAMERA_BUDGET), CAMERA_BUDGET);
  assert.deepEqual(await cameraFrames(restored), await cameraFrames(ledger));
  const host = createToolHost(restored), args = { knownAt: 2000, validAt: 1000 };
  assert.equal(host.call('lalo_facts', { ...args, knownAt: 1999 }).data.total, 0);
  assert.equal(host.call('lalo_facts', { ...args, validAt: 1001 }).data.total, 0);
  const call = { name: 'lalo_facts', arguments: args }, result = host.call(call.name, args);
  assert.equal(result.data.complete, false, 'full JPEG needs more than one bounded result page');
  const replay = createActionReplay(restored, { format: 'lalo/action', version: 1, call, result });
  let report = replay.read(); assert.equal(report.comparison, 'match');
  const rows = [...report.result.data.items];
  while (report.result.data.nextOffset !== null) {
    report = replay.read(report.result.data.nextOffset); rows.push(...report.result.data.items);
  }
  assert.equal(rows.filter(f => f.predicate.startsWith('camera.jpeg.')).map(f => f.value).join(''), image.jpeg);
  assert.ok(rows.every(f => f.source === 'browser:camera' && f.recordedAt === 2000 && f.validFrom === 1000));
});

test('late and repeated camera frames append without rewriting the past', async () => {
  let ledger = await add(new FactLedger());
  ledger = await add(ledger, 'late', 3000, frame(500));
  ledger = await add(ledger, 'repeat', 4000, frame(500));
  assert.deepEqual((await cameraFrames(ledger)).map(f => [f.capturedAt, f.receivedAt]), [[1000, 2000], [500, 3000], [500, 4000]]);
  assert.ok(ledger.entries().every(f => f.supersedes === null));
});

test('invalid camera observations fail atomically', async () => {
  const ledger = await add(new FactLedger()), before = encodeJournal(ledger);
  for (const patch of [{ jpeg: 'not base64' }, { jpeg: 'AAAA' }, { jpeg: jpeg(49153) },
    { width: 641 }, { height: 0 }, { width: 1.5 }, { capturedAt: -1 }, { capturedAt: 1.5 }, { capturedAt: Number.MAX_SAFE_INTEGER }])
    await assert.rejects(add(ledger, 'invalid', 3000, { ...frame(), ...patch }));
  await assert.rejects(add(ledger), /duplicate/);
  await assert.rejects(add(ledger, 'bad:id', 3000), /id/);
  await assert.rejects(add(ledger, 'backdated', 1999), /journal order/);
  await assert.rejects(add(ledger, 'fraction', 2000.5), /integer/);
  assert.equal(encodeJournal(ledger), before);
});

test('damaged hashes, missing chunks and inconsistent camera groups are rejected', async () => {
  const all = (await add(new FactLedger())).entries();
  for (const records of [all.slice(0, 3), all.slice(0, -1),
    all.map((f, i) => i === 2 ? { ...f, value: '0'.repeat(64) } : f),
    all.map((f, i) => i === 1 ? { ...f, source: 'other' } : f),
    all.map((f, i) => i === 3 ? { ...f, value: f.value.slice(0, -4) } : f)]) {
    const ledger = new FactLedger(); records.forEach(f => ledger.add(f));
    await assert.rejects(cameraFrames(ledger));
  }
});

test('camera count and total-byte exhaustion preserve every earlier frame', async () => {
  let small = new FactLedger(), large = new FactLedger();
  for (let i = 0; i < 32; i++) small = await add(small, `s${i}`, 2000 + i, frame(1000, 4));
  const before = encodeJournal(small);
  await assert.rejects(add(small, 'full', 3000), /frame budget/);
  assert.equal(encodeJournal(small), before);
  let exceeded = false;
  for (let i = 0; i < 32; i++) {
    const prior = encodeJournal(large);
    try { large = await add(large, `l${i}`, 2000 + i, frame(1000, 49152)); }
    catch (error) { assert.match(error.message, /byte budget/); assert.equal(encodeJournal(large), prior); exceeded = true; break; }
  }
  assert.ok(exceeded);
});

test('camera asks for video only; denial, missing devices and late permission cleanup are visible', async () => {
  let options, late, stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  assert.equal(await requestCamera({ getUserMedia(o) { options = o; return stream; } }), stream);
  assert.equal(options.audio, false); assert.equal(options.video.facingMode.ideal, 'environment');
  await assert.rejects(requestCamera(undefined), /unavailable/);
  await assert.rejects(requestCamera({ getUserMedia() { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } }), /denied/);
  const pending = requestCamera({ getUserMedia() { return new Promise(resolve => { late = resolve; }); } }, { timeout: 5 });
  await assert.rejects(pending, /timed out/); late(stream);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, 1);
});

test('capture bounds dimensions and bytes, timestamps the retained draw, and rejects unavailable frames', () => {
  const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080 };
  let draws = 0, clock = 1000;
  const canvas = { getContext: () => ({ drawImage() { draws++; } }),
    toDataURL: () => `data:image/jpeg;base64,${jpeg(draws === 1 ? 60000 : 1000)}` };
  const image = captureFrame(video, canvas, () => clock++);
  assert.equal(image.capturedAt, 1001); assert.equal(draws, 2);
  assert.equal(image.width, 480); assert.equal(image.height, 270);
  assert.throws(() => captureFrame({ ...video, readyState: 0 }, canvas), /no frame/);
  assert.throws(() => captureFrame(video, { getContext: () => null }), /unavailable/);
  canvas.toDataURL = () => 'data:image/png;base64,AAAA';
  assert.throws(() => captureFrame(video, canvas), /cannot encode/);
  canvas.toDataURL = () => `data:image/jpeg;base64,${jpeg(60000)}`;
  assert.throws(() => captureFrame(video, canvas), /budget/);
});
