// Deterministic context projection. It cannot fetch, append or start a worker.
import { readBackground, isAgent, isQuake } from './background.js';

export const BACKGROUND_POLICY = 'usgs-attention-receipt/v1';
export const CONTEXT_BUDGET = Object.freeze({ maxEvents: 8, maxBytes: 32_768 });
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

function requestFor(input) {
  const keys = ['agent', 'knownAt', 'stateAt', 'worldFrom', 'worldTo', 'subject', 'maxEvents', 'maxBytes'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !keys.includes(key))) throw new TypeError('invalid background selection request');
  const request = { ...input, maxEvents: input.maxEvents ?? CONTEXT_BUDGET.maxEvents,
    maxBytes: input.maxBytes ?? CONTEXT_BUDGET.maxBytes };
  if (!isAgent(request.agent)) throw new TypeError('agent must be agent:<identifier>');
  for (const key of ['knownAt', 'stateAt', 'worldFrom', 'worldTo'])
    if (!Number.isSafeInteger(request[key])) throw new TypeError(`${key} must be an integer timestamp`);
  if (request.worldTo <= request.worldFrom) throw new RangeError('worldTo must be after worldFrom');
  if (request.subject !== undefined && !isQuake(request.subject)) throw new TypeError('subject must name a USGS event');
  if (!Number.isSafeInteger(request.maxEvents) || request.maxEvents < 1 || request.maxEvents > 64
    || !Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1024 || request.maxBytes > 65_536)
    throw new RangeError('invalid context budget');
  return request;
}

export function selectBackground(journal, input) {
  const request = requestFor(input), { world, quakes } = readBackground(journal);
  const state = world.asOf({ subject: request.agent, validAt: request.stateAt, knownAt: request.knownAt });
  const attention = new Set(state.filter(f => f.predicate === 'attention_subject' && f.value !== null).map(f => f.value));
  const heads = new Map(), rows = quakes.entries();
  for (let i = 0; i < rows.length; i += 8) {
    const facts = rows.slice(i, i + 8);
    if (facts[0].recordedAt <= request.knownAt) heads.set(facts[0].subject, facts);
  }
  // Resolve revisions BEFORE the world-time filter: a corrected origin can
  // move an event out of the requested window without reviving its old version.
  const candidates = [...heads.values()].filter(([f]) => f.validFrom >= request.worldFrom && f.validFrom < request.worldTo
    && (request.subject === undefined || f.subject === request.subject));
  candidates.sort(([a], [b]) => Number(attention.has(b.subject)) - Number(attention.has(a.subject))
    || b.recordedAt - a.recordedAt || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
  const result = { format: 'lalo/background-context', version: 1, policy: BACKGROUND_POLICY,
    request, state, items: [], eligible: candidates.length, omitted: candidates.length,
    complete: candidates.length === 0, limitedBy: null };
  // Reserve the longest limit reason while fitting the complete envelope.
  const fits = () => bytes({ ...result, limitedBy: 'maxEvents', complete: false }) <= request.maxBytes;
  if (!fits()) throw new RangeError('agent state and request exceed the context byte budget');
  for (const facts of candidates) {
    if (result.items.length === request.maxEvents) { result.limitedBy = 'maxEvents'; break; }
    const f = facts[0];
    result.items.push({ subject: f.subject, reason: attention.has(f.subject) ? 'attention_subject' : 'receipt_order', facts });
    result.omitted--;
    if (!fits()) { result.items.pop(); result.omitted++; result.limitedBy = 'maxBytes'; break; }
  }
  result.complete = result.omitted === 0;
  return result;
}

// The original full journal can be kept by the existing AML world snapshots.
// Replay checks the recorded policy and compares the complete result.
export function replayBackground(journal, saved) {
  if (saved?.format !== 'lalo/background-context' || saved.version !== 1 || saved.policy !== BACKGROUND_POLICY)
    throw new TypeError('unsupported background context or policy');
  const result = selectBackground(journal, saved.request);
  return { format: 'lalo/background-replay', version: 1,
    comparison: canonical(result) === canonical(saved) ? 'match' : 'changed', result };
}
