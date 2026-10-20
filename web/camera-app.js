import { FactLedger } from '../src/ledger.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { appendCamera, cameraFrames, CAMERA_BUDGET, CAMERA_SUBJECT } from '../src/sources/camera.js';
import { requestCamera, stopCamera, captureFrame } from './camera-capture.js';
import { worldStore } from './storage.js';
import { actionPanel } from './actions.js';

const $ = id => document.getElementById(id), preview = $('preview');
const store = worldStore(globalThis.indexedDB, { key: 'camera-v1', maxBytes: CAMERA_BUDGET.maxBytes });
const when = t => new Date(t).toISOString().replace('T', ' ').replace('Z', ' UTC');
const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
let ledger = new FactLedger(CAMERA_BUDGET), revision = 0, busy = true, blocked = false;
let frames = [], visible = [], times = [], selected, knownAt = 0, actions, stream, generation = 0, opening = false;
function selection() { return visible.find(f => f.records.some(r => r.id === selected)); }
function controls() {
  document.documentElement.dataset.busy = String(busy || opening);
  $('camera-start').disabled = busy || opening || blocked || Boolean(stream);
  $('camera-capture').disabled = busy || opening || blocked || !stream || preview.readyState < 2;
  $('camera-stop').disabled = !stream && !opening;
  $('export').disabled = busy || blocked || !ledger.size;
  $('knowledge').disabled = $('world').disabled = $('present').disabled = busy || !frames.length;
  actions?.refresh();
}
function stop() {
  generation++; stopCamera(stream); stream = undefined;
  preview.srcObject = null; preview.hidden = true; opening = false;
  $('empty').hidden = Boolean(selection()); controls();
}
function failure(error) { $('error').textContent = error.message; $('error').hidden = false; }
function select(id) {
  selected = id;
  const frame = selection();
  $('world').value = frame?.id ?? ''; $('frame').hidden = !frame; $('empty').hidden = Boolean(frame) || Boolean(stream);
  $('inspector').replaceChildren();
  if (frame) {
    $('photo').src = `data:image/jpeg;base64,${frame.jpeg}`;
    $('frame-caption').textContent = `${frame.width} × ${frame.height} · captured ${when(frame.capturedAt)}`;
    $('inspector').append(element('h2', 'This frame'), element('p', `Captured ${when(frame.capturedAt)}`),
      element('p', `Received ${when(frame.receivedAt)}`), element('p', 'Source: browser:camera'),
      element('p', `SHA-256: ${frame.hash}`), element('p', `Receipt: ${selected}`));
  } else $('photo').removeAttribute('src');
  for (const button of $('receipts').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.id === frame?.id));
  actions?.refresh();
}
function render(latest = false) {
  times = [...new Set(frames.map(f => f.receivedAt))];
  $('knowledge').max = Math.max(0, times.length - 1);
  if (latest) $('knowledge').value = $('knowledge').max;
  knownAt = times[Number($('knowledge').value)] ?? 0;
  visible = frames.filter(f => f.receivedAt <= knownAt);
  $('knowledge-time').textContent = times.length ? when(knownAt) : 'No receipts';
  $('knowledge').setAttribute('aria-valuetext', $('knowledge-time').textContent);
  $('receipts').replaceChildren(); $('world').replaceChildren();
  for (const frame of [...visible].reverse()) {
    const li = element('li', ''), button = element('button', `${frame.width} × ${frame.height} · ${when(frame.capturedAt)}`);
    button.className = 'receipt'; button.dataset.id = frame.id;
    button.append(element('small', `Received ${when(frame.receivedAt)}`));
    button.addEventListener('click', () => select(frame.id)); li.append(button); $('receipts').append(li);
    const option = element('option', when(frame.capturedAt)); option.value = frame.id; $('world').append(option);
  }
  if (latest || !selection()) selected = visible.at(-1)?.id;
  $('receipt-count').textContent = `${visible.length} known`;
  $('budget').textContent = `${frames.length} / 32 frames · ${ledger.size} receipts · 1.5 MB total · 48 KiB per JPEG`;
  select(selected); controls();
}
actions = actionPanel({
  presets: ['facts', 'history', 'lineage', 'subjects', 'status'],
  getContext: () => busy || blocked || !selection() ? null : ({ journal: encodeJournal(ledger, CAMERA_BUDGET),
    subject: CAMERA_SUBJECT, knownAt, validAt: selection().capturedAt, selected,
    visibleIDs: visible.flatMap(f => f.records.map(r => r.id)) }),
  select,
  highlight(ids) {
    $('frame').dataset.actionIds = JSON.stringify(ids);
    $('frame').classList.toggle('marked', Boolean(selection()?.records.some(f => ids.includes(f.id))));
  },
});
$('camera-start').addEventListener('click', async () => {
  if (busy || opening || blocked || stream) return;
  const current = ++generation; opening = true; controls(); $('error').hidden = true;
  $('source-status').textContent = 'Waiting for camera permission…';
  try {
    const opened = await requestCamera(navigator.mediaDevices);
    if (current !== generation) { stopCamera(opened); return; }
    stream = opened;
    for (const track of stream.getTracks()) track.addEventListener('ended', () => {
      if (current === generation) { stop(); $('source-status').textContent = 'Camera ended.'; }
    });
    preview.srcObject = stream; preview.hidden = false; $('empty').hidden = true;
    let timer;
    try { await Promise.race([preview.play(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Camera preview timed out.')), 5000);
    })]); } finally { clearTimeout(timer); }
    if (current === generation) $('source-status').textContent = 'Camera open. Choose the frame to keep.';
  } catch (error) {
    if (current === generation) { failure(error); stop(); $('source-status').textContent = 'No frame captured.'; }
  } finally { if (current === generation) { opening = false; controls(); } }
});
preview.addEventListener('loadeddata', controls);
$('camera-stop').addEventListener('click', () => { stop(); $('source-status').textContent = 'Camera stopped.'; });
$('camera-capture').addEventListener('click', async () => {
  if (busy || opening || blocked || !stream) return;
  busy = true; controls(); $('error').hidden = true;
  try {
    let frame;
    try { frame = captureFrame(preview, document.createElement('canvas')); } finally { stop(); }
    const receivedAt = Date.now();
    const candidate = await appendCamera(ledger, frame, { id: crypto.randomUUID(), receivedAt });
    const validated = await cameraFrames(candidate);
    const saved = await store.save(encodeJournal(candidate, CAMERA_BUDGET), revision);
    ledger = candidate; frames = validated; revision = saved.revision;
    $('source-status').textContent = 'Frame saved. Camera stopped.'; render(true);
  } catch (error) { failure(error); $('source-status').textContent = 'No frame saved. Camera stopped.'; }
  finally { busy = false; controls(); }
});
$('knowledge').addEventListener('input', () => render());
$('world').addEventListener('change', () => select($('world').value));
$('present').addEventListener('click', () => render(true));
$('export').addEventListener('click', () => {
  try {
    const url = URL.createObjectURL(new Blob([encodeJournal(ledger, CAMERA_BUDGET)], { type: 'application/json' }));
    const a = element('a', ''); a.href = url; a.download = 'lalo-camera.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { failure(error); }
});
addEventListener('pagehide', stop);
document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); $('source-status').textContent = 'Camera stopped while the page was hidden.'; } });
async function start() {
  try {
    const saved = await store.load();
    if (saved) {
      const candidate = decodeJournal(saved.journal, CAMERA_BUDGET), validated = await cameraFrames(candidate);
      ledger = candidate; frames = validated; revision = saved.revision;
    }
    $('source-status').textContent = frames.length ? 'Saved frames restored.' : 'Camera starts only when you ask.';
    render(true);
  } catch (error) { blocked = true; failure(error); }
  finally { busy = false; controls(); document.documentElement.dataset.ready = 'true'; }
}
void start();
