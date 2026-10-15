import { FactLedger } from '../src/ledger.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { ingestUSGS, validateUSGSJournal } from '../src/sources/usgs.js';
import { fetchUSGS } from '../src/sources/usgs-http.js';
import { QUAKE_BUDGET, extendQuakeJournal, quakeCatalog, quakeVersions, quakeView } from '../src/quake-view.js';
import { worldStore } from './storage.js';
import { paint } from './paint.js';

const $ = id => document.getElementById(id);
const canvas = $('field'), ctx = canvas.getContext('2d'), knowledge = $('knowledge'), world = $('world');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const store = worldStore(globalThis.indexedDB, { key: 'usgs-v1', maxBytes: QUAKE_BUDGET.maxBytes });
let ledger = new FactLedger(QUAKE_BUDGET), revision = 0, busy = true, blocked = false;
let times = [], subject, selected, view, versions = [], nodes = [], width = 1, height = 1, animation = 0;
const when = value => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? `${value} ms` : date.toISOString().replace('T', ' ').replace('Z', ' UTC');
};
function element(tag, text, className) {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
}
function controls() {
  document.documentElement.dataset.busy = String(busy);
  $('poll').disabled = $('import').disabled = busy || blocked;
  $('export').disabled = busy || blocked || !ledger.size;
  knowledge.disabled = $('present').disabled = busy || !times.length;
  $('event').disabled = world.disabled = busy || !versions.length;
}
function failure(error) { $('error').textContent = error.message; $('error').hidden = false; }
function draw(pulse = 0, previous, progress = 1) {
  if (view) nodes = paint(ctx, { width, height, view, selected, pulse, previous, progress });
}
function resize() {
  const box = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  width = box.width; height = box.height;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
}
function inspect() {
  const target = $('inspector'); target.replaceChildren();
  const record = view.records.find(r => r.fact.id === selected);
  const version = versions.find(v => v.magnitudeID === selected);
  if (!record || !version) return;
  const f = record.fact, link = element('a', `USGS / ${version.id}`);
  link.href = version.source; link.target = '_blank'; link.rel = 'noopener noreferrer';
  target.append(element('p', `SELECTED VERSION · ${record.state}`, 'eyebrow'), link,
    element('p', `Magnitude ${version.magnitude ?? 'unknown'} · ${version.magnitudeType ?? 'type unknown'}`),
    element('p', version.place ?? 'Place unknown'),
    element('p', `${version.latitude}°, ${version.longitude}° · depth ${version.depth} km · ${version.type ?? 'type unknown'}`),
    element('p', `Origin ${when(version.time)}`, 'trace'),
    element('p', `USGS updated ${when(version.updatedAt)}`, 'trace'),
    element('p', `Received ${when(version.receivedAt)}`, 'trace'),
    element('p', `Lineage: ${ledger.lineage(f.id).map(r => `M ${r.value ?? '?'} @ ${when(r.recordedAt)}`).join(' → ')}`, 'trace'),
    element('p', `Receipt: ${f.id}`, 'trace'), element('p', `Rule: ${view.current.rule}`, 'trace'));
}
function select(id) {
  selected = id;
  for (const button of $('receipts').querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.dataset.id === id));
  inspect(); draw();
}
function receipts() {
  const list = $('receipts'); list.replaceChildren();
  for (const { fact, state, label } of [...view.records].reverse()) {
    const li = element('li', ''), button = element('button', '', 'receipt');
    button.dataset.id = fact.id; button.dataset.state = state;
    const description = element('span', label);
    description.append(element('small', `${when(fact.recordedAt)} · ${state}`));
    button.append(element('span', state === 'opposing' ? '╱' : state === 'supporting' ? '●' : '◌', 'mark'), description);
    button.addEventListener('click', () => select(fact.id));
    li.append(button); list.append(li);
  }
  select(selected);
}
function render({ latest = false, followOrigin = false, animate = false } = {}) {
  cancelAnimationFrame(animation);
  const previous = view;
  times = [...new Set(ledger.entries().map(f => f.recordedAt))];
  knowledge.max = Math.max(0, times.length - 1);
  if (latest) knowledge.value = knowledge.max;
  const knownAt = times[Number(knowledge.value)] ?? 0;
  const catalog = quakeCatalog(ledger, { knownAt });
  if (!catalog.some(e => e.subject === subject)) { subject = catalog[0]?.subject; followOrigin = true; }
  $('event').replaceChildren(...catalog.map(e => {
    const option = element('option', `${e.id} · ${e.place ?? 'Place unknown'}`);
    option.value = e.subject; return option;
  }));
  $('event').value = subject ?? '';
  versions = subject ? quakeVersions(ledger, { knownAt, subject }) : [];
  const head = versions.at(-1);
  const instants = [...new Set(versions.flatMap(v => [v.time, v.time + 1]))].sort((a, b) => a - b);
  const priorWorld = world.value;
  world.replaceChildren(...instants.map(t => {
    const origin = versions.some(v => v.time === t);
    const option = element('option', `${when(t)} · ${origin ? 'origin' : 'interval end'}`);
    option.value = t; return option;
  }));
  world.value = followOrigin || !instants.includes(Number(priorWorld)) || !priorWorld
    ? String(head?.time ?? '') : priorWorld;
  view = quakeView(ledger, { subject, knownAt, validAt: Number(world.value) });
  if (!view.records.some(r => r.fact.id === selected)) selected = view.records.at(-1)?.fact.id;
  const c = view.current;
  $('state').textContent = c.state; $('state').dataset.state = c.state;
  $('basis').textContent = `${c.supporting.length} at or above 3 · ${c.opposing.length} below · ${c.unknown.length} unknown. ${c.premises.length} active magnitude premises.`;
  $('event-summary').textContent = head ? `${head.id} · ${head.place ?? 'Place unknown'}` : 'Waiting for the first observation.';
  $('knowledge-time').textContent = times.length ? when(knownAt) : 'No receipts';
  knowledge.setAttribute('aria-valuetext', $('knowledge-time').textContent);
  $('receipt-count').textContent = `${view.records.length} known`;
  $('field-count').textContent = `${view.records.length} magnitude receipts · ${view.corrections.length} revisions`;
  $('budget').textContent = `${ledger.size} / ${QUAKE_BUDGET.capacity} receipts · 2 MB limit · saved locally`;
  receipts(); controls(); draw();
  if (animate && !motion.matches) {
    const start = performance.now();
    function frame(now) {
      const p = Math.min(1, (now - start) / 800); draw(1 - p, previous, p);
      if (p < 1) animation = requestAnimationFrame(frame);
    }
    animation = requestAnimationFrame(frame);
  }
}
async function update(action) {
  if (busy || blocked) return;
  busy = true; controls();
  try {
    const result = await action();
    // The displayed world advances only after the complete candidate is saved.
    if (result.ledger.size !== ledger.size) {
      const saved = await store.save(encodeJournal(result.ledger, QUAKE_BUDGET), revision);
      revision = saved.revision; ledger = result.ledger;
    }
    selected = undefined; $('error').hidden = true; $('source-status').textContent = result.note;
    render({ latest: true, followOrigin: true, animate: true });
  } catch (error) { failure(error); }
  finally { busy = false; controls(); }
}
$('poll').addEventListener('click', () => update(async () => {
  const raw = await fetchUSGS(), receivedAt = Date.now();
  const result = ingestUSGS(ledger, JSON.parse(raw), { receivedAt, capacity: QUAKE_BUDGET.capacity });
  const s = result.summary;
  return { ledger: result.ledger, note: `Read ${when(receivedAt)}: ${s.added} new, ${s.revised} revised, ${s.unchanged} unchanged, ${s.stale} older. ${s.events} events in this feed.` };
}));
$('import').addEventListener('change', async () => {
  const file = $('import').files[0]; if (!file) return;
  await update(async () => {
    if (file.size > QUAKE_BUDGET.maxBytes) throw new RangeError('Import exceeds the 2 MB byte budget');
    const candidate = extendQuakeJournal(ledger, await file.text());
    return { ledger: candidate, note: `Imported ${candidate.size - ledger.size} receipts. Original receipt times preserved.` };
  });
  $('import').value = '';
});
$('export').addEventListener('click', () => {
  try {
    const url = URL.createObjectURL(new Blob([encodeJournal(ledger, QUAKE_BUDGET)], { type: 'application/json' }));
    const a = element('a', ''); a.href = url; a.download = 'lalo-usgs.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { failure(error); }
});
$('event').addEventListener('change', () => { subject = $('event').value; selected = undefined; render({ followOrigin: true }); });
knowledge.addEventListener('input', () => render());
world.addEventListener('change', () => render());
$('present').addEventListener('click', () => render({ latest: true, followOrigin: true }));
canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect();
  const closest = nodes.map(n => ({ n, distance: Math.hypot(n.x - event.clientX + rect.left, n.y - event.clientY + rect.top) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (closest?.distance <= 24) select(closest.n.fact.id);
});
motion.addEventListener('change', () => render());
new ResizeObserver(resize).observe(canvas);
async function start() {
  controls();
  try {
    const saved = await store.load();
    if (saved) { ledger = validateUSGSJournal(decodeJournal(saved.journal, QUAKE_BUDGET)); revision = saved.revision; }
    render({ latest: true, followOrigin: true });
  } catch (error) { blocked = true; failure(error); }
  finally { busy = false; controls(); resize(); document.documentElement.dataset.ready = 'true'; }
}
start();
