// One bounded world, independent of model calls. No ambient clocks or I/O.
import { FactLedger } from './ledger.js';
import { encodeJournal, decodeJournal } from './journal.js';
import { ingestUSGS, validateUSGSJournal } from './sources/usgs.js';
import { appendLocation, locationSamples, LOCATION_SOURCE } from './sources/geolocation.js';
import { appendCamera, cameraFrames, CAMERA_SOURCE } from './sources/camera.js';

export const BACKGROUND_BUDGET = Object.freeze({ capacity: 1024, maxBytes: 2_000_000, maxEvents: 64 });
export const isAgent = value => typeof value === 'string' && /^agent:[a-zA-Z0-9_-]{1,100}$/.test(value);
export const isQuake = value => typeof value === 'string' && /^usgs:[a-zA-Z0-9_-]{1,100}$/.test(value);

function checkSignals(ledger) {
  for (const fact of ledger.entries())
    if (fact.predicate === 'attention_subject' && fact.value !== null && !isQuake(fact.value))
      throw new TypeError('attention_subject must name a USGS subject or explicit null');
  return ledger.entries();
}
const appended = (own, next) => next.entries().slice(own.size);

// Each instrument owns its receipts, checks its own projection with the source
// adapter's validator, and turns one arrival into appended receipts. Location
// and camera keep the budgets of their adapters inside the shared world budget.
export const INSTRUMENTS = Object.freeze({
  usgs: { owns: f => isQuake(f.subject), check: validateUSGSJournal,
    async receive(own, frame, budget) {
      const { ledger, summary } = ingestUSGS(own, frame.feed,
        { receivedAt: frame.receivedAt, capacity: budget.capacity, maxEvents: budget.maxEvents });
      return { facts: appended(own, ledger), summary };
    } },
  location: { owns: f => f.source === LOCATION_SOURCE, check: locationSamples,
    async receive(own, frame) {
      return { facts: appended(own, appendLocation(own, frame.position, { id: frame.id, receivedAt: frame.receivedAt })) };
    } },
  camera: { owns: f => f.source === CAMERA_SOURCE, check: cameraFrames,
    async receive(own, frame) {
      return { facts: appended(own, await appendCamera(own, frame.image, { id: frame.id, receivedAt: frame.receivedAt })) };
    } },
  // Host-supplied observation of the agent: source, both clocks and optional
  // predecessor are mandatory parts of the ordinary fact contract.
  signal: { owns: f => isAgent(f.subject), check: checkSignals,
    async receive(own, frame) {
      if (!isAgent(frame.fact?.subject)) throw new TypeError('signal subject must be agent:<identifier>');
      const next = decodeJournal(encodeJournal(own)); next.add(frame.fact); checkSignals(next);
      return { facts: appended(own, next), summary: { signal: frame.fact.id } };
    } },
});
const kinds = Object.keys(INSTRUMENTS);

// The agent's own executed read is an act LALO observes. It is the one agent
// state channel available today; model-internal state has no channel here.
function actionFact(signals, { agent, id, receivedAt, trace }) {
  if (!isAgent(agent)) throw new TypeError('agent must be agent:<identifier>');
  if (trace?.format !== 'lalo/action' || trace.version !== 1) throw new TypeError('expected a LALO action trace');
  const subject = trace.call?.arguments?.subject;
  if (trace.status !== 'executed' || !isQuake(subject)) return null;
  if (!/^lalo_[a-z]{1,32}$/.test(trace.call.name)) throw new TypeError('action names an unknown tool');
  const all = signals.entries(), replaced = new Set(all.map(f => f.supersedes));
  const head = all.filter(f => f.subject === agent && f.predicate === 'attention_subject'
    && f.source.startsWith('lalo:action/') && !replaced.has(f.id)).at(-1);
  return { id, subject: agent, predicate: 'attention_subject', value: subject, source: `lalo:action/${trace.call.name}`,
    validFrom: receivedAt, validTo: null, recordedAt: receivedAt, supersedes: head?.id ?? null };
}

// Every receipt belongs to exactly one instrument; each projection keeps the
// shared receipt order and passes its own validator.
export async function readBackground(journal, budget = BACKGROUND_BUDGET) {
  const world = decodeJournal(journal, budget), parts = {}, views = {};
  for (const kind of kinds) parts[kind] = new FactLedger({ capacity: budget.capacity });
  for (const fact of world.entries()) {
    const owners = kinds.filter(kind => INSTRUMENTS[kind].owns(fact));
    if (owners.length !== 1) throw new TypeError(`receipt ${fact.id} belongs to ${owners.length ? 'several instruments' : 'no instrument'}`);
    parts[owners[0]].add(fact);
  }
  for (const kind of kinds) views[kind] = await INSTRUMENTS[kind].check(parts[kind]);
  return { world, parts, views };
}

const receiptOf = frame => frame?.kind === 'signal' ? frame.fact?.recordedAt : frame?.receivedAt;

export async function createBackground(journal = encodeJournal(new FactLedger()), options = {}) {
  const budget = { ...BACKGROUND_BUDGET, ...options };
  for (const [key, value] of Object.entries(budget)) {
    if (!Object.hasOwn(BACKGROUND_BUDGET, key) || !Number.isSafeInteger(value)
      || value < 1 || value > BACKGROUND_BUDGET[key]) throw new RangeError(`invalid background budget: ${key}`);
  }
  let { world } = await readBackground(journal, budget);
  async function arrive(frame) {
    if (frame?.kind === 'action') {
      const { parts } = await readBackground(encodeJournal(world, budget), budget);
      const fact = actionFact(parts.signal, frame);
      if (!fact) return { kind: 'action', receipts: 0, signal: null, records: world.size };
      return { ...await arrive({ kind: 'signal', fact }), kind: 'action' };
    }
    if (!Object.hasOwn(INSTRUMENTS, frame?.kind)) throw new TypeError('unknown instrument');
    const receivedAt = receiptOf(frame);
    if (!Number.isSafeInteger(receivedAt)) throw new TypeError('receipt time must be an integer timestamp');
    if (world.entries().at(-1)?.recordedAt > receivedAt) throw new RangeError('receipt time precedes the world journal');
    const { parts } = await readBackground(encodeJournal(world, budget), budget);
    const { facts, summary } = await INSTRUMENTS[frame.kind].receive(parts[frame.kind], frame, budget);
    // Validate the complete candidate and its UTF-8 bytes before replacing the world.
    const candidate = decodeJournal(encodeJournal(world, budget), budget);
    for (const fact of facts) candidate.add(fact);
    const text = encodeJournal(candidate, budget);
    await readBackground(text, budget);
    world = candidate;
    return { kind: frame.kind, receipts: facts.length, ...summary, records: world.size };
  }
  // Arrivals are serialized: an overlapping receive never commits a stale world.
  let queue = Promise.resolve();
  return Object.freeze({
    journal: () => encodeJournal(world, budget),
    receive(frame) {
      const run = queue.then(() => arrive(frame));
      queue = run.catch(() => {});
      return run;
    },
  });
}
