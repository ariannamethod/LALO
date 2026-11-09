// Deterministic context projection. It cannot fetch, append or start a worker.
import { readBackground, isAgent, isQuake } from './background.js';
import { knownReceipt, receiptCalendar } from './janus-calendar.js';
import { isWeatherSubject } from './sources/gev-weather.js';
import { isFirmsSubject } from './sources/gev-firms.js';
import { containsPoint, regionBounds } from './region.js';
import { greatCircleMeters } from './vendor/gods-eye-view/geoDistance.js';

const policies = new Map([[2, 'usgs-attention-receipt/v2'], [3, 'usgs-attention-janus/v3'], [4, 'usgs-attention-janus/v4'],
  [5, 'usgs-nowcoast-attention-janus/v5'], [6, 'regional-events-janus/v6'], [7, 'device-region-janus/v7']]);
export const BACKGROUND_POLICY = policies.get(7);
export const CONTEXT_BUDGET = Object.freeze({ maxEvents: 8, maxSignals: 8, maxBytes: 32_768 });
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function requestFor(input, version) {
  const keys = ['agent', 'knownAt', 'stateAt', 'worldFrom', 'worldTo', 'subject', 'maxEvents', 'maxSignals', 'maxBytes'];
  if (version >= 3) keys.push('originId');
  if (version >= 6) keys.push('bbox');
  if (version >= 7) keys.push('nearDevice');
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !keys.includes(key))) throw new TypeError('invalid background selection request');
  const request = { ...input };
  if (request.bbox !== undefined) request.bbox = regionBounds(request.bbox);
  if ('nearDevice' in request) {
    if (request.bbox !== undefined) throw new TypeError('choose either bbox or nearDevice');
    const near = request.nearDevice;
    if (!near || typeof near !== 'object' || Array.isArray(near)
      || Object.keys(near).some(k => k !== 'radiusMeters' && k !== 'maxFixAgeMs')
      || !Number.isSafeInteger(near.radiusMeters) || near.radiusMeters <= 0
      || !Number.isSafeInteger(near.maxFixAgeMs) || near.maxFixAgeMs < 0)
      throw new TypeError('nearDevice requires positive integer radiusMeters and nonnegative integer maxFixAgeMs');
    request.nearDevice = { radiusMeters: near.radiusMeters, maxFixAgeMs: near.maxFixAgeMs };
  }
  for (const key of ['maxEvents', 'maxSignals', 'maxBytes']) request[key] = input[key] ?? CONTEXT_BUDGET[key];
  if (!isAgent(request.agent)) throw new TypeError('agent must be agent:<identifier>');
  if (request.originId !== undefined && (typeof request.originId !== 'string'
    || !request.originId.trim() || request.originId.length > 512)) throw new TypeError('invalid calendar origin receipt ID');
  for (const key of ['knownAt', 'stateAt', 'worldFrom', 'worldTo'])
    if (!Number.isSafeInteger(request[key])) throw new TypeError(`${key} must be an integer timestamp`);
  if (request.worldTo <= request.worldFrom) throw new RangeError('worldTo must be after worldFrom');
  if (request.subject !== undefined && !(isQuake(request.subject) || (version >= 5 && isWeatherSubject(request.subject))
    || (version >= 6 && isFirmsSubject(request.subject)))) throw new TypeError('invalid background event subject');
  if (!Number.isSafeInteger(request.maxEvents) || request.maxEvents < 1 || request.maxEvents > 64
    || !Number.isSafeInteger(request.maxSignals) || request.maxSignals < 0 || request.maxSignals > 64
    || !Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1024 || request.maxBytes > 65_536)
    throw new RangeError('invalid context budget');
  return request;
}

export function selectBackground(journal, input) { return projectBackground(journal, input, 7); }

function locate(samples, request) {
  const [fix] = samples.filter(s => s.observedAt <= request.stateAt && s.receivedAt <= request.knownAt)
    .sort((a, b) => b.observedAt - a.observedAt || b.receivedAt - a.receivedAt || order(a.id, b.id));
  if (!fix) throw Object.assign(new Error('No device fix at these observation and receipt cutoffs'), { code: 'LOCATION_UNAVAILABLE' });
  if (request.stateAt - fix.observedAt > request.nearDevice.maxFixAgeMs)
    throw Object.assign(new Error('Last known device fix exceeds maxFixAgeMs'), { code: 'LOCATION_STALE' });
  return fix;
}

async function projectBackground(journal, input, version) {
  const request = requestFor(input, version), { world, parts, views, origins } = await readBackground(journal);
  const explicit = request.originId === undefined ? null : knownReceipt(world.entries(), request.originId, request.knownAt);
  const saved = version >= 4 && !explicit ? origins.get(request.agent) : undefined;
  const choice = saved && saved.choice.recordedAt <= request.knownAt && saved.choice.validFrom <= request.stateAt
    ? saved.choice : undefined;
  const anchor = choice ? saved.anchor : explicit;
  const fix = request.nearDevice ? locate(views.location, request) : null;
  const center = fix && { lat: fix.latitude, lon: fix.longitude };
  const distanceTo = (lon, lat) => Math.round(greatCircleMeters(center, { lat, lon }));
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
  const groups = [...heads.values()];
  if (version >= 5) groups.push(...views['gev-weather']);
  if (version >= 6) groups.push(...views['gev-firms']);
  const candidates = [];
  for (const facts of groups) {
    const f = facts[0];
    if (!inWindow(f.validFrom, f.recordedAt) || (request.subject !== undefined && f.subject !== request.subject)) continue;
    let distanceMeters;
    if (request.bbox || fix) {
      const lon = facts.find(r => r.predicate === 'longitude')?.value;
      const lat = facts.find(r => r.predicate === 'latitude')?.value;
      if (request.bbox && !containsPoint(request.bbox, lon, lat)) continue;
      if (fix) {
        distanceMeters = distanceTo(lon, lat);
        if (distanceMeters > request.nearDevice.radiusMeters) continue;
      }
    }
    candidates.push({ facts, distanceMeters });
  }
  const result = { format: 'lalo/background-context', version, policy: policies.get(version), request,
    state: [], stateEligible: active.length, stateOmitted: active.length,
    items: [], eligible: candidates.length, omitted: candidates.length, complete: false, limitedBy: [],
    // Instruments this policy does not select: observations inside the window, known at the cutoff.
    otherInstruments: {
      location: views.location.filter(s => s !== fix && inWindow(s.observedAt, s.receivedAt)
        && (!request.bbox || containsPoint(request.bbox, s.longitude, s.latitude))
        && (!fix || distanceTo(s.longitude, s.latitude) <= request.nearDevice.radiusMeters)).length,
      camera: request.bbox || fix ? 0 : views.camera.filter(f => inWindow(f.capturedAt, f.receivedAt)).length,
    } };
  if (fix) result.locationAnchor = { facts: fix.records, ageMs: request.stateAt - fix.observedAt,
    calendar: await receiptCalendar(fix.records[0], anchor, choice) };
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
  candidates.sort(({ facts: [a] }, { facts: [b] }) => Number(attention.has(b.subject)) - Number(attention.has(a.subject))
    || b.recordedAt - a.recordedAt || order(a.subject, b.subject) || b.validFrom - a.validFrom || order(a.id, b.id));
  for (const { facts, distanceMeters } of candidates) {
    if (result.items.length === request.maxEvents) { limit('maxEvents'); break; }
    const f = facts[0];
    const item = { subject: f.subject, reason: attention.has(f.subject) ? 'attention_subject' : 'receipt_order', facts };
    if (fix) item.distanceMeters = distanceMeters;
    // Each group shares one observation instant and one receipt time.
    if (version >= 3) item.calendar = await receiptCalendar(f, anchor, choice);
    result.items.push(item);
    result.omitted--;
    if (!fits()) { result.items.pop(); result.omitted++; limit('maxBytes'); break; }
  }
  result.complete = result.omitted === 0 && result.stateOmitted === 0;
  return result;
}

// The original full journal can be kept by the existing AML world snapshots.
// Replay checks the recorded policy and compares the complete result.
export async function replayBackground(journal, saved) {
  if (saved?.format !== 'lalo/background-context' || !policies.has(saved.version) || saved.policy !== policies.get(saved.version))
    throw new TypeError('unsupported background context or policy');
  const result = await projectBackground(journal, saved.request, saved.version);
  return { format: 'lalo/background-replay', version: 1,
    comparison: canonical(result) === canonical(saved) ? 'match' : 'changed', result };
}
