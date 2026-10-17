import { routeRequest, ROUTE_BUDGET } from '../src/route.js';

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

// One visible action, owned by its submitted snapshot. The next page reuses that snapshot.
export function actionPanel({ getContext, select, highlight }) {
  const root = document.createElement('section'); root.className = 'action-panel'; root.id = 'actions';
  root.setAttribute('aria-label', 'LALO action field');
  root.innerHTML = `
    <div class="action-heading"><p class="eyebrow">LALO / INTENT → CALL → RECEIPTS</p><h2>Ask. Follow the marks.</h2>
    <p class="small">Calls read a snapshot of this journal on the local host. The latest action stays here until the next call or reload.</p></div>
    <form id="action-form">
      <label for="action-preset">START FROM THIS VIEW</label>
      <div class="action-seed"><select id="action-preset"></select><button id="action-fill" type="button">Use current view ↗</button></div>
      <label for="action-intent">INTENT</label><input id="action-intent" required maxlength="2047" autocomplete="off" placeholder="please check the conflicting evidence">
      <details class="action-arguments" open><summary>Explicit arguments · review before calling</summary>
      <label for="action-args" class="small">Clocks are integer Unix milliseconds. These values stay as you entered them.</label>
      <textarea id="action-args" rows="7" spellcheck="false" maxlength="32768">{}</textarea></details>
      <button id="action-run" class="primary" type="submit">Call LALO ↗</button>
    </form>
    <div class="action-output"><p id="action-status" role="status">Choose a starting point, then call.</p>
      <p id="action-scope" class="small"></p><div id="action-trace"></div>
      <button id="action-next" type="button" hidden>Next evidence page ↗</button></div>`;
  document.querySelector('main').append(root);
  const $ = id => root.querySelector(`#${id}`);
  for (const [value, [label]] of Object.entries(intents)) {
    const option = element('option', label); option.value = value; $('action-preset').append(option);
  }
  let busy = false, submitted, trace, receiptButtons = [], marked = '';
  function refresh() {
    const context = getContext();
    $('action-fill').disabled = $('action-run').disabled = busy || !context;
    $('action-next').disabled = busy;
    root.dataset.busy = String(busy);
    const same = context && submitted && key(context) === submitted.key;
    const args = trace?.call?.arguments;
    const aligned = same && args && (args.knownAt === undefined || args.knownAt === context.knownAt)
      && (args.validAt === undefined || args.validAt === context.validAt)
      && (args.subject === undefined || args.subject === context.subject);
    $('action-scope').textContent = submitted
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
    $('action-next').hidden = true;
    if (!trace) return;
    root.dataset.status = trace.status;
    const error = trace.error || trace.result?.error;
    $('action-status').textContent = `${trace.status.replaceAll('_', ' ')}${error ? ` · ${error.code}: ${error.message}` : ''}`;
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
          const button = element('button', `${fact.id} · ${row.role || fact.predicate} · ${JSON.stringify(fact.value)}`);
          button.dataset.id = fact.id; button.addEventListener('click', () => select(fact.id));
          receiptButtons.push(button); li.append(button, element('p', `${fact.source} · received ${fact.recordedAt}`, 'small'));
        } else li.append(element('p', `${row.subject} · ${row.receipts} receipts`));
        list.append(li);
      }
      target.append(list);
      $('action-next').hidden = data.nextOffset === null;
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
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journal: JSON.parse(capture.journal), request }), signal: controller.signal, credentials: 'omit' });
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '', size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > ROUTE_BUDGET.maxTraceBytes) throw new Error('Action response exceeds its byte budget');
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel(); reader.releaseLock(); }
      const result = JSON.parse(text);
      if (!response.ok) throw new Error(result.error || `Local host returned HTTP ${response.status}`);
      if (result.format !== 'lalo/action' || result.version !== 1) throw new Error('Unrecognized action format');
      trace = result; show();
    } catch (error) {
      root.dataset.status = 'unavailable'; $('action-status').textContent = `Action unavailable · ${error.name === 'AbortError' ? 'Local call timed out' : error.message}`;
    } finally { clearTimeout(timer); busy = false; refresh(); }
  }
  $('action-fill').addEventListener('click', fill);
  $('action-form').addEventListener('submit', event => { event.preventDefault(); void execute(); });
  $('action-next').addEventListener('click', () => void execute(true));
  refresh();
  return { refresh };
}
