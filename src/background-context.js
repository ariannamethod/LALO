// Deterministic context projection. It cannot fetch, append or start a worker.
import { readBackground, isAgent, isQuake } from './background.js';

export const BACKGROUND_POLICY = 'usgs-attention-receipt/v2';
export const CONTEXT_BUDGET = Object.freeze({ maxEvents: 8, maxSignals: 8, maxBytes: 32_768 });
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function requestFor(input) {
  const keys = ['agent', 'knownAt', 'stateAt', 'worldFrom', 'worldTo', 'subject', 'maxEvents', 'maxSignals', 'maxBytes'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !keys.includes(key))) throw new TypeError('invalid background selection request');
  const request = { ...input };
  for (const key of ['maxEvents', 'maxSignals', 'maxBytes']) request[key] = input[key] ?? CONTEXT_BUDGET[key];
  if (!isAgent(request.agent)) throw new TypeError('agent must be agent:<identifier>');
  for (const key of ['knownAt', 'stateAt', 'worldFrom', 'worldTo'])
    if (!Number.isSafeInteger(request[key])) throw new TypeError(`${key} must be an integer timestamp`);
  if (request.worldTo <= request.worldFrom) throw new RangeError('worldTo must be after worldFrom');
  if (request.subject !== undefined && !isQuake(request.subject)) throw new TypeError('subject must name a USGS event');
  if (!Number.isSafeInteger(request.maxEvents) || request.maxEvents < 1 || request.maxEvents > 64
    || !Number.isSafeInteger(request.maxSignals) || request.maxSignals < 0 || request.maxSignals > 64
    || !Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1024 || request.maxBytes > 65_536)
    throw new RangeError('invalid context budget');
  return request;
}

export async function selectBackground(journal, input) {
  const request = requestFor(input), { world, parts, views } = await readBackground(journal);
  const inWindow = (observedAt, receivedAt) => receivedAt <= request.knownAt
    && observedAt >= request.worldFrom && observedAt < request.worldTo;
  // Newest agent receipts first; the context carries a bounded prefix of them.
  const active = world.asOf({ subject: request.agent, validAt: request.stateAt, knownAt: request.knownAt })
    .sort((a, b) => b.recordedAt - a.recordedAt || order(a.id, b.id));
  const heads = new Map(), rows = parts.usgs.entries();
  for (let i = 0; i < rows.length; i += 8) {
    const facts = rows.slice(i, i + 8);
    if (facts[0].recordedAt <= request.knownAt) heads.set(facts[0].subject, facts);
  }
  // Resolve revisions BEFORE the world-time filter: a corrected origin can
  // move an event out of the requested window without reviving its old version.
  const candidates = [...heads.values()].filter(([f]) => f.validFrom >= request.worldFrom && f.validFrom < request.worldTo
    && (request.subject === undefined || f.subject === request.subject));
  const result = { format: 'lalo/background-context', version: 2, policy: BACKGROUND_POLICY, request,
    state: [], stateEligible: active.length, stateOmitted: active.length,
    items: [], eligible: candidates.length, omitted: candidates.length, complete: false, limitedBy: [],
    // Instruments this policy does not select: observations inside the window, known at the cutoff.
    otherInstruments: {
      location: views.location.filter(s => inWindow(s.observedAt, s.receivedAt)).length,
      camera: views.camera.filter(f => inWindow(f.capturedAt, f.receivedAt)).length,
    } };
  // Reserve every limit reason while fitting the complete envelope.
  const fits = () => bytes({ ...result, limitedBy: ['maxSignals', 'maxEvents', 'maxBytes'], complete: false }) <= request.maxBytes;
  const limit = reason => { if (!result.limitedBy.includes(reason)) result.limitedBy.push(reason); };
  if (!fits()) throw new RangeError('request envelope exceeds the context byte budget');
  for (const fact of active) {
    if (result.state.length === request.maxSignals) { limit('maxSignals'); break; }
    result.state.push(fact); result.stateOmitted--;
    if (!fits()) { result.state.pop(); result.stateOmitted++; limit('maxBytes'); break; }
  }
  // Ranking reads only the state the context carries, so every reason has its receipt.
  const attention = new Set(result.state.filter(f => f.predicate === 'attention_subject' && f.value !== null).map(f => f.value));
  candidates.sort(([a], [b]) => Number(attention.has(b.subject)) - Number(attention.has(a.subject))
    || b.recordedAt - a.recordedAt || order(a.subject, b.subject));
  for (const facts of candidates) {
    if (result.items.length === request.maxEvents) { limit('maxEvents'); break; }
    const f = facts[0];
    result.items.push({ subject: f.subject, reason: attention.has(f.subject) ? 'attention_subject' : 'receipt_order', facts });
    result.omitted--;
    if (!fits()) { result.items.pop(); result.omitted++; limit('maxBytes'); break; }
  }
  result.complete = result.omitted === 0 && result.stateOmitted === 0;
  return result;
}

// The original full journal can be kept by the existing AML world snapshots.
// Replay checks the recorded policy and compares the complete result.
export async function replayBackground(journal, saved) {
  if (saved?.format !== 'lalo/background-context' || saved.version !== 2 || saved.policy !== BACKGROUND_POLICY)
    throw new TypeError('unsupported background context or policy');
  const result = await selectBackground(journal, saved.request);
  return { format: 'lalo/background-replay', version: 1,
    comparison: canonical(result) === canonical(saved) ? 'match' : 'changed', result };
}
