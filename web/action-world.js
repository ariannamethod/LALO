import { decodeJournal } from '../src/journal.js';
import { TOOL_BUDGET } from '../src/tools.js';
import { createActionReplay } from '../src/action-replay.js';

const element = (tag, text, className) => {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
};

// An original world is a separate read-only surface. It never opens the live store.
export function actionWorld(root, { receipt, journal }) {
  const ledger = decodeJournal(JSON.stringify(journal), TOOL_BUDGET), records = ledger.entries();
  const replay = createActionReplay(ledger, receipt.action);
  root.replaceChildren(); root.className = 'action-world'; root.dataset.sequence = receipt.sequence;
  root.append(element('p', `ORIGINAL WORLD / ACTION ${receipt.sequence}`, 'eyebrow'), element('h3', 'The world he read.'),
    element('p', `${records.length} receipts in the submitted journal. Select a source to inspect its clocks and lineage.`, 'small'));
  const count = element('p', '', 'small'), list = element('ol', '', 'action-receipts');
  const previous = element('button', 'Previous receipts'), next = element('button', 'More receipts ↗');
  previous.id = 'world-previous'; next.id = 'world-next';
  const inspector = element('section', '', 'world-inspector'); inspector.id = 'world-inspector';
  inspector.setAttribute('aria-label', 'Original observation');
  const pageButtons = element('div', '', 'world-buttons'); pageButtons.append(previous, next);
  root.append(count, list, pageButtons, inspector);
  let offset = 0, selected, report;
  function inspect(id) {
    const fact = records.find(f => f.id === id); if (!fact) return;
    selected = id; inspector.replaceChildren(element('h4', fact.id), element('pre', JSON.stringify(fact, null, 2)));
    inspector.append(element('p', `Lineage: ${ledger.lineage(id).map(f => f.id).join(' → ')}`, 'small'));
    for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.id === id));
  }
  function page() {
    list.replaceChildren(); count.textContent = `${records.length ? offset + 1 : 0}–${Math.min(offset + 16, records.length)} / ${records.length} snapshot receipts`;
    for (const fact of records.slice(offset, offset + 16)) {
      const li = element('li', ''), button = element('button', `${fact.id} · ${fact.subject} · ${fact.predicate}`);
      button.dataset.id = fact.id; button.setAttribute('aria-pressed', String(selected === fact.id));
      button.addEventListener('click', () => inspect(fact.id)); li.append(button); list.append(li);
    }
    previous.disabled = offset === 0; next.disabled = offset + 16 >= records.length;
  }
  previous.addEventListener('click', () => { offset = Math.max(0, offset - 16); page(); });
  next.addEventListener('click', () => { offset += 16; page(); }); page();
  if (records.length) inspect(records[0].id);
  const run = element('button', 'Reproduce saved call ↗'), more = element('button', 'Next reproduced page ↗');
  run.id = 'world-replay'; more.id = 'world-replay-next'; run.disabled = !replay.canReplay; more.hidden = true;
  const status = element('p', replay.canReplay ? 'The original tool and arguments are ready.' : 'This action has no selected tool call.', 'small');
  status.id = 'world-replay-status'; status.setAttribute('role', 'status');
  const summary = element('div', '', 'world-reading'), evidence = element('ol', '', 'action-receipts');
  evidence.id = 'world-replay-evidence';
  const raw = element('details', '', 'action-raw'), output = element('pre', ''); output.id = 'world-replay-result';
  raw.append(element('summary', 'Complete reproduced call / result'), output); raw.hidden = true;
  function reproduce(nextPage = false) {
    report = replay.read(nextPage ? report.result.data.nextOffset : undefined);
    root.dataset.comparison = report.comparison;
    status.textContent = report.comparison === 'match' ? 'Original result reproduced.'
      : report.comparison === 'changed' ? 'Current tool result differs from the saved result. Both remain available.'
      : 'Next evidence page from the same original world.';
    summary.replaceChildren(); evidence.replaceChildren();
    const result = report.result, data = result.ok ? result.data : null;
    if (data?.reading) summary.append(element('p', data.reading.state, 'state'),
      element('p', `${data.reading.premiseCount} total premises · ${data.reading.rule}`, 'small'));
    if (data?.items) {
      summary.append(element('p', `${data.offset + data.items.length} / ${data.total} evidence rows · ${data.complete ? 'complete' : 'more pages'}`, 'small'));
      for (const row of data.items) {
        const fact = row.fact || row, li = element('li', '');
        if (typeof fact.id === 'string') {
          const button = element('button', `${fact.id} · ${row.role || fact.predicate} · ${JSON.stringify(fact.value)}`);
          button.dataset.id = fact.id; button.addEventListener('click', () => inspect(fact.id));
          li.append(button, element('p', `${fact.source} · received ${fact.recordedAt}`, 'small'));
        } else li.append(element('p', `${row.subject} · ${row.receipts} receipts`, 'small'));
        evidence.append(li);
      }
    } else if (data) summary.append(element('p', `${data.records} receipts in the original journal.`, 'small'));
    else summary.append(element('p', `${result.error.code}: ${result.error.message}`, 'small'));
    raw.hidden = false; output.textContent = JSON.stringify(report, null, 2);
    more.hidden = !report.result.ok || !Number.isInteger(report.result.data?.nextOffset);
  }
  run.addEventListener('click', () => reproduce()); more.addEventListener('click', () => reproduce(true));
  root.append(run, status, summary, evidence, more, raw);
}
