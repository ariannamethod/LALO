import { FactLedger } from '../src/ledger.js';
import { encodeJournal, decodeJournal } from '../src/journal.js';
import { appendLocation, locationSamples, LOCATION_BUDGET, LOCATION_SUBJECT } from '../src/sources/geolocation.js';
import { worldStore } from './storage.js';
import { requestLocation } from './location-request.js';
import { actionPanel } from './actions.js';

const $ = id => document.getElementById(id);
const store = worldStore(globalThis.indexedDB, { key: 'location-v1', maxBytes: LOCATION_BUDGET.maxBytes });
const when = t => new Date(t).toISOString().replace('T', ' ').replace('Z', ' UTC');
const element = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e; };
let ledger = new FactLedger(LOCATION_BUDGET), revision = 0, busy = true, blocked = false;
let samples = [], visible = [], times = [], knownAt = 0, selected, actions, marked = [];
function controls() {
  document.documentElement.dataset.busy = String(busy);
  $('locate').disabled = busy || blocked;
  $('export').disabled = busy || blocked || !ledger.size;
  $('knowledge').disabled = $('world').disabled = $('present').disabled = busy || !samples.length;
  actions?.refresh();
}
function failure(error) { $('error').textContent = error.message; $('error').hidden = false; }
function selection() { return visible.find(s => s.records.some(f => f.id === selected)); }
function draw() {
  $('points').replaceChildren();
  for (const sample of visible) {
    const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    point.setAttribute('cx', (sample.longitude + 180) * 2);
    point.setAttribute('cy', (90 - sample.latitude) * 2);
    point.setAttribute('r', sample === selection() ? 6 : 3);
    point.setAttribute('fill', sample === selection() ? 'var(--amber)' : 'var(--oxide)');
    if (sample.records.some(f => marked.includes(f.id))) {
      point.setAttribute('stroke', 'var(--bone)'); point.setAttribute('stroke-width', '3');
    }
    $('points').append(point);
  }
  $('field').dataset.actionIds = JSON.stringify(marked);
}
function select(id) {
  selected = id;
  const sample = selection();
  $('inspector').replaceChildren();
  $('world').value = sample?.id ?? '';
  for (const button of $('receipts').querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.dataset.id === sample?.id));
  $('coordinates').textContent = sample ? `${sample.latitude.toFixed(6)}°, ${sample.longitude.toFixed(6)}°` : 'Waiting for an observation.';
  $('accuracy').textContent = sample ? `Reported horizontal accuracy: ${sample.accuracy} m` : '';
  if (sample) {
    const raw = element('pre', JSON.stringify(sample.records, null, 2));
    $('inspector').append(element('h2', 'This observation'),
      element('p', `Observed ${when(sample.observedAt)}`), element('p', `Received ${when(sample.receivedAt)}`),
      element('p', 'Source: browser:geolocation · subject: device:this-browser'), raw);
  }
  draw(); actions?.refresh();
}
function render(latest = false) {
  samples = locationSamples(ledger);
  times = [...new Set(samples.map(s => s.receivedAt))];
  $('knowledge').max = Math.max(0, times.length - 1);
  if (latest) $('knowledge').value = $('knowledge').max;
  knownAt = times[Number($('knowledge').value)] ?? 0;
  visible = samples.filter(s => s.receivedAt <= knownAt);
  $('knowledge-time').textContent = times.length ? when(knownAt) : 'No receipts';
  $('knowledge').setAttribute('aria-valuetext', $('knowledge-time').textContent);
  $('receipts').replaceChildren(); $('world').replaceChildren();
  for (const sample of [...visible].reverse()) {
    const li = element('li', ''), button = element('button', `${sample.latitude.toFixed(5)}°, ${sample.longitude.toFixed(5)}°`);
    button.className = 'receipt'; button.dataset.id = sample.id;
    button.append(element('small', `± ${sample.accuracy} m · received ${when(sample.receivedAt)}`));
    button.addEventListener('click', () => select(sample.id)); li.append(button); $('receipts').append(li);
    const option = element('option', when(sample.observedAt)); option.value = sample.id; $('world').append(option);
  }
  if (latest || !selection()) selected = visible.at(-1)?.id;
  $('receipt-count').textContent = `${visible.length} known`;
  $('budget').textContent = `${samples.length} / 256 observations · ${ledger.size} receipts · 512 kB limit · saved locally`;
  select(selected); controls();
}
actions = actionPanel({
  presets: ['facts', 'history', 'lineage', 'subjects', 'status'],
  getContext: () => busy || blocked || !selection() ? null : ({ journal: encodeJournal(ledger, LOCATION_BUDGET),
    subject: LOCATION_SUBJECT, knownAt, validAt: selection().observedAt, selected,
    visibleIDs: visible.flatMap(s => s.records.map(f => f.id)) }),
  select,
  highlight(ids) { marked = ids; draw(); },
});
$('locate').addEventListener('click', async () => {
  if (busy || blocked) return;
  busy = true; controls(); $('error').hidden = true; $('source-status').textContent = 'Waiting for a location…';
  try {
    const { position, receivedAt } = await requestLocation(navigator.geolocation);
    const candidate = appendLocation(ledger, position, { id: crypto.randomUUID(), receivedAt });
    const saved = await store.save(encodeJournal(candidate, LOCATION_BUDGET), revision);
    ledger = candidate; revision = saved.revision;
    $('source-status').textContent = `Observation saved · received ${when(receivedAt)}`;
    render(true);
  } catch (error) { failure(error); $('source-status').textContent = 'No observation saved.'; }
  finally { busy = false; controls(); }
});
$('knowledge').addEventListener('input', () => render());
$('world').addEventListener('change', () => select($('world').value));
$('present').addEventListener('click', () => render(true));
$('export').addEventListener('click', () => {
  try {
    const url = URL.createObjectURL(new Blob([encodeJournal(ledger, LOCATION_BUDGET)], { type: 'application/json' }));
    const a = element('a', ''); a.href = url; a.download = 'lalo-location.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { failure(error); }
});
async function start() {
  try {
    const saved = await store.load();
    if (saved) {
      const candidate = decodeJournal(saved.journal, LOCATION_BUDGET);
      locationSamples(candidate); ledger = candidate; revision = saved.revision;
    }
    $('source-status').textContent = ledger.size ? 'Saved observations restored.' : 'Location starts only when you ask.';
    render(true);
  } catch (error) { blocked = true; failure(error); }
  finally { busy = false; controls(); document.documentElement.dataset.ready = 'true'; }
}
void start();
