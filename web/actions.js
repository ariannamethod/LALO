import { routeRequest, ROUTE_BUDGET } from '../src/route.js';
import { TOOL_BUDGET } from '../src/tools.js';
import { actionWorld } from './action-world.js';

const intents = {
  reading: ['Read this hypothesis', 'please check the conflicting evidence'],
  facts: ['Read active facts', 'get the active observations please'],
  history: ['Read receipt history', 'please inspect earlier observations'],
  lineage: ['Follow selected revision', 'follow the correction chain please'],
  subjects: ['Discover known subjects', 'show the known subjects please'],
  status: ['Inspect journal limits', 'please inspect the journal limits'],
};
const element = (tag, text, className) => {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
};
const key = context => JSON.stringify([context.journal, context.subject, context.knownAt, context.validAt]);
const facts = trace => (trace?.result?.data?.items || []).map(row => row.fact || row).filter(row => typeof row.id === 'string');
async function askHost(path, payload, signal, maxBytes = ROUTE_BUDGET.maxTraceBytes + 4096) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal, credentials: 'omit' });
  const length = response.headers.get('content-length');
  // A complete action plus its bounded memory envelope; retain exact native body framing.
  if (!length || !/^\d+$/.test(length) || Number(length) > maxBytes
    || response.headers.has('content-encoding')) throw new Error('Action response has invalid byte framing');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== Number(length)) throw new Error('Action response length mismatch');
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  if (!response.ok) throw new Error(result.error || `Local host returned HTTP ${response.status}`);
  return result;
}

// One visible action, owned by its submitted snapshot. The next page reuses that snapshot.
export function actionPanel({ getContext, select, highlight, presets = Object.keys(intents) }) {
  const root = document.createElement('section'); root.className = 'action-panel'; root.id = 'actions';
  root.setAttribute('aria-label', 'LALO action field');
  root.innerHTML = `
    <div class="action-heading"><p class="eyebrow">LALO / INTENT → CALL → RECEIPTS</p><h2>Ask. Follow the marks.</h2>
    <p class="small">Calls read a snapshot of this journal on the local host. With host memory enabled, their receipts survive a restart.</p></div>
    <form id="action-form">
      <label for="action-preset">START FROM THIS VIEW</label>
      <div class="action-seed"><select id="action-preset"></select><button id="action-fill" type="button">Use current view ↗</button></div>
      <label for="action-intent">INTENT</label><input id="action-intent" required maxlength="2047" autocomplete="off" placeholder="please check the conflicting evidence">
      <details class="action-arguments" open><summary>Explicit arguments · review before calling</summary>
      <label for="action-args" class="small">Clocks are integer Unix milliseconds. These values stay as you entered them.</label>
      <textarea id="action-args" rows="7" spellcheck="false" maxlength="32768">{}</textarea></details>
      <button id="action-run" class="primary" type="submit">Call LALO ↗</button>
      <button id="action-recall" type="button">Recall last saved action ↗</button>
    </form>
    <div class="action-output"><p id="action-status" role="status">Choose a starting point, then call.</p>
      <p id="action-scope" class="small"></p><div id="action-trace"></div>
      <button id="action-next" type="button" hidden>Next evidence page ↗</button>
      <button id="action-world-open" type="button" hidden>Open original world ↗</button>
      <p id="action-world-status" class="small" role="status"></p></div>
    <section id="action-world" hidden aria-label="Original world and reproduced call"></section>`;
  document.querySelector('main').append(root);
  const $ = id => root.querySelector(`#${id}`);
  for (const [value, [label]] of Object.entries(intents)) {
    if (!presets.includes(value)) continue;
    const option = element('option', label); option.value = value; $('action-preset').append(option);
  }
  let busy = false, submitted, trace, receiptButtons = [], marked = '';
  function refresh() {
    const context = getContext();
    $('action-fill').disabled = $('action-run').disabled = busy || !context;
    $('action-next').disabled = $('action-recall').disabled = busy;
    $('action-world-open').disabled = busy;
    root.dataset.busy = String(busy);
    const same = context && submitted && key(context) === submitted.key;
    const args = trace?.call?.arguments;
    const aligned = same && args && (args.knownAt === undefined || args.knownAt === context.knownAt)
      && (args.validAt === undefined || args.validAt === context.validAt)
      && (args.subject === undefined || args.subject === context.subject);
    $('action-scope').textContent = submitted?.restored
      ? `Restored action #${submitted.sequence} · ${submitted.count} receipts in its original snapshot. This readback adds no observations and does not rerun the call.`
      : submitted
      ? `${submitted.count} receipts at submission. ${same ? 'Snapshot matches the current view.' : 'View changed — this action keeps its submitted snapshot.'}` : '';
    const visible = new Set(context?.visibleIDs || []);
    const ids = aligned ? facts(trace).map(f => f.id).filter(id => visible.has(id)) : [];
    for (const button of receiptButtons) button.disabled = !ids.includes(button.dataset.id);
    const signature = JSON.stringify(ids);
    if (signature !== marked) { marked = signature; highlight(ids); }
  }
  function fill() {
    const c = getContext(); if (!c) return;
    const preset = $('action-preset').value;
    const args = preset === 'status' ? {} : { knownAt: c.knownAt };
    if (['reading', 'facts'].includes(preset)) args.validAt = c.validAt;
    if (['reading', 'facts', 'history'].includes(preset) && c.subject) {
      args.subject = c.subject; args.predicate = c.predicate;
    }
    if (preset === 'reading') { args.rule = c.rule; Object.assign(args, c.ruleArguments); }
    if (preset === 'lineage' && c.selected) args.id = c.selected;
    $('action-intent').value = intents[preset][1];
    $('action-args').value = JSON.stringify(args, null, 2);
  }
  function show() {
    const target = $('action-trace'); target.replaceChildren(); receiptButtons = [];
    $('action-world-open').hidden = !trace?.memory?.snapshot?.bytes;
    $('action-world').replaceChildren(); $('action-world').hidden = true; $('action-world-status').textContent = '';
    $('action-next').hidden = true;
    if (!trace) return;
    root.dataset.status = trace.status;
    const error = trace.error || trace.result?.error;
    $('action-status').textContent = `${trace.status.replaceAll('_', ' ')}${error ? ` · ${error.code}: ${error.message}` : ''}`;
    const memory = trace.memory;
    target.append(element('p', !memory ? 'Action memory is off · this trace lasts until reload.'
      : memory.state === 'saved' ? `Saved in host memory · action #${memory.sequence}`
      : memory.state === 'recalled' ? `Read back from host memory · action #${memory.sequence}`
      : memory.state === 'durability_unconfirmed' ? `Action #${memory.sequence} was written; durable storage was not confirmed. Do not repeat the call to save it.`
      : `Action was not saved · ${memory.code}: ${memory.message}`, 'small'));
    if (trace.route) target.append(element('p', `Routing activation ${trace.route.activation.toFixed(4)} · ${trace.route.status}`, 'small'));
    if (trace.call) {
      target.append(element('h3', trace.call.name), element('pre', JSON.stringify(trace.call.arguments, null, 2), 'action-call'));
    }
    const data = trace.result?.ok ? trace.result.data : null;
    if (data?.reading) {
      target.append(element('p', data.reading.state, 'state'),
        element('p', `${data.reading.premiseCount} total premises · ${data.reading.rule}`, 'small'));
    }
    if (data?.items) {
      target.append(element('p', `${data.offset + data.items.length} / ${data.total} evidence rows · ${data.complete ? 'complete' : 'more pages'}`, 'small'));
      const list = element('ol', '', 'action-receipts');
      for (const row of data.items) {
        const fact = row.fact || row, li = element('li', '');
        if (typeof fact.id === 'string') {
          const button = element('button', `${fact.id} · ${row.role || fact.predicate} · ${fact.predicate.startsWith('camera.jpeg.') ? 'Image data' : JSON.stringify(fact.value)}`);
          button.dataset.id = fact.id; button.addEventListener('click', () => {
            select(fact.id); document.getElementById('inspector').scrollIntoView({ block: 'center',
              behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
          });
          receiptButtons.push(button); li.append(button, element('p', `${fact.source} · received ${fact.recordedAt}`, 'small'));
        } else li.append(element('p', `${row.subject} · ${row.receipts} receipts`));
        list.append(li);
      }
      target.append(list);
      $('action-next').hidden = submitted?.restored || data.nextOffset === null;
    } else if (data) target.append(element('p', `${data.records} receipts in the submitted journal.`, 'small'));
    const raw = element('details', '', 'action-raw');
    raw.append(element('summary', 'Complete action / decision / receipts'), element('pre', JSON.stringify(trace, null, 2)));
    target.append(raw);
  }
  async function execute(next = false) {
    if (busy) return;
    const c = getContext(); if (!c) return;
    let request, capture;
    try {
      request = next
        ? { text: submitted.request.text, arguments: { ...submitted.request.arguments, offset: trace.result.data.nextOffset } }
        : { text: $('action-intent').value, arguments: JSON.parse($('action-args').value) };
      request = routeRequest(request);
      capture = next ? submitted : { journal: c.journal, key: key(c), count: JSON.parse(c.journal).records.length, request };
    } catch (error) { $('action-status').textContent = `Request rejected · ${error.message}`; return; }
    busy = true; submitted = capture; trace = undefined; show(); refresh();
    root.dataset.status = 'pending'; $('action-status').textContent = 'LALO is reading…';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await askHost('/api/action', { journal: JSON.parse(capture.journal), request }, controller.signal);
      if (result.format !== 'lalo/action' || result.version !== 1) throw new Error('Unrecognized action format');
      trace = result; show();
    } catch (error) {
      controller.abort();
      root.dataset.status = 'unavailable'; $('action-status').textContent = `Action unavailable · ${error.name === 'AbortError' ? 'Local call timed out' : error.message}`;
    } finally { clearTimeout(timer); busy = false; refresh(); }
  }
  async function recall() {
    if (busy) return;
    busy = true; submitted = undefined; trace = undefined; show(); refresh();
    root.dataset.status = 'pending'; $('action-status').textContent = 'Reading host memory…';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await askHost('/api/memory', {}, controller.signal);
      if (result.format !== 'lalo/action-recall' || result.version !== 1) throw new Error('Unrecognized recall format');
      const receipt = result.receipt;
      if (!receipt) { root.dataset.status = 'empty'; $('action-status').textContent = 'Host memory has no saved actions.'; return; }
      const { action, ...memory } = receipt;
      if (action.format !== 'lalo/action' || action.version !== 1) throw new Error('Unrecognized saved action');
      submitted = { restored: true, sequence: receipt.sequence, count: receipt.snapshot.records };
      trace = { ...action, memory: { ...memory, state: 'recalled' } }; show();
    } catch (error) {
      controller.abort(); root.dataset.status = 'unavailable';
      $('action-status').textContent = `Memory unavailable · ${error.name === 'AbortError' ? 'Readback timed out' : error.message}`;
    } finally { clearTimeout(timer); busy = false; refresh(); }
  }
  async function openWorld() {
    if (busy || !trace?.memory?.snapshot?.bytes) return;
    $('action-world').replaceChildren(); $('action-world').hidden = true;
    busy = true; refresh(); $('action-world-status').textContent = 'Opening the original world…';
    const { sequence, head } = trace.memory;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await askHost('/api/memory', { sequence, head, snapshot: true }, controller.signal,
        TOOL_BUDGET.maxBytes + ROUTE_BUDGET.maxTraceBytes + 8192);
      if (result.format !== 'lalo/action-recall' || result.version !== 1 || !result.journal
        || result.receipt?.sequence !== sequence || result.receipt.head !== head) throw new Error('Unrecognized original world');
      await actionWorld($('action-world'), result); $('action-world').hidden = false;
      $('action-world-status').textContent = `Original world opened · action #${sequence}`;
    } catch (error) {
      controller.abort(); $('action-world-status').textContent = `Original world unavailable · ${error.name === 'AbortError' ? 'Readback timed out' : error.message}`;
    } finally { clearTimeout(timer); busy = false; refresh(); }
  }
  $('action-fill').addEventListener('click', fill);
  $('action-form').addEventListener('submit', event => { event.preventDefault(); void execute(); });
  $('action-next').addEventListener('click', () => void execute(true));
  $('action-recall').addEventListener('click', () => void recall());
  $('action-world-open').addEventListener('click', () => void openWorld());
  refresh();
  return { refresh };
}
