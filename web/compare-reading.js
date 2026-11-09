import { stepHeading, evidenceSource } from './reading-timeline.js';

// Capture the current journal and receipt clock on click. Every subsequent page
// uses that capture even if the live view moves while the read is in flight.
export function compareReadingPanel(root, receipt, getContext, askHost) {
  const section = document.createElement('section');
  section.innerHTML = `
    <h3>What changed since this answer?</h3>
    <button type="button" id="world-compare">Compare with current view ↗</button>
    <p role="status" class="small"></p><ol class="action-receipts"></ol>
    <button type="button" hidden>Next comparison page ↗</button>`;
  const [compare, more] = section.querySelectorAll('button');
  const status = section.querySelector('p'), list = section.querySelector('ol');
  let capture, nextOffset;
  async function show(nextPage) {
    compare.disabled = more.disabled = true;
    try {
      if (!nextPage) {
        const view = getContext();
        if (!view) throw new Error('The current journal is unavailable');
        capture = { journal: JSON.parse(view.journal), arguments: { sequence: receipt.sequence,
          head: receipt.head, knownAt: view.knownAt } };
      }
      const args = { ...capture.arguments, ...(nextPage ? { offset: nextOffset } : {}) };
      list.replaceChildren(); more.hidden = true;
      status.textContent = 'Comparing the saved reading…';
      const result = await askHost('/api/memory/compare', { journal: capture.journal, arguments: args }, AbortSignal.timeout(20000));
      if (!result.ok) throw new Error(`${result.error.code} · ${result.error.message}`);
      const { savedReading, reading, timeline, comparison, items } = result.data;
      const premises = comparison.samePremises ? 'same final premises' : 'different final premises';
      status.textContent = `Saved ${savedReading.state} at ${new Date(savedReading.knownAt).toISOString()} · `
        + `current ${reading.state} at ${new Date(reading.knownAt).toISOString()} · ${premises} · `
        + `changes: ${timeline.changeCount} · verdict changes: ${comparison.verdictChanges}`;
      let step;
      for (const row of items) {
        const li = document.createElement('li');
        if (row.step !== step) {
          const heading = document.createElement('strong'); heading.textContent = stepHeading(row); li.append(heading);
        }
        step = row.step;
        const details = document.createElement('details'), label = document.createElement('summary');
        const raw = document.createElement('pre'); raw.textContent = JSON.stringify(row.fact, null, 2);
        const origin = row.origin === 'appended' ? 'new receipt' : 'already in saved journal, now visible';
        label.textContent = `${row.fact.id} · ${row.role ?? 'withdrawal'} · ${origin} · ${evidenceSource(row, row.fact)}`;
        details.append(label, raw); li.append(details); list.append(li);
      }
      nextOffset = result.data.nextOffset; more.hidden = nextOffset === null;
    } catch (error) {
      list.replaceChildren(); more.hidden = true;
      status.textContent = `Comparison unavailable · ${error.message}`;
    } finally { compare.disabled = more.disabled = false; }
  }
  compare.addEventListener('click', () => show(false)); more.addEventListener('click', () => show(true));
  section.id = 'world-comparison'; root.append(section);
}
