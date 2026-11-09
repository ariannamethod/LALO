// GEV's /api/firms aggregates FIRMS rows. Acquisition is published at UTC minute precision.
import { containsPoint, regionBounds } from '../region.js';
import { gevOrigin } from './gev-origin.js';

const minute = 60_000;
const keys = ['thermal_detection', 'latitude', 'longitude', 'satellite', 'instrument', 'confidence',
  'frp_mw', 'proxy_fetched_at', 'proxy_stale', 'unavailable_products'];
const sensor = /^[A-Za-z0-9_-]{1,24}$/;
const product = /^[A-Z0-9_]{1,48}$/;
const coordinate = (n, max) => Number.isFinite(n) && Math.abs(n) <= max;
const subjectOf = (sat, instrument, at, lat, lon) => ['firms', sat, instrument, at, lat, lon].join(':');
export const firmsUrl = origin => gevOrigin(origin) + '/api/firms';

export function isFirmsSubject(value) {
  if (typeof value !== 'string' || !value.startsWith('firms:')) return false;
  const [, sat, instrument, time, y, x] = value.split(':');
  const at = Number(time), lat = Number(y), lon = Number(x);
  const year = new Date(at).getUTCFullYear();
  return sensor.test(sat) && sensor.test(instrument) && year >= 0 && year <= 9999 && at % minute === 0
    && coordinate(lon, 180) && coordinate(lat, 90) && value === subjectOf(sat, instrument, at, lat, lon);
}

function acquired(date, hhmm) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || (typeof hhmm !== 'string' && !Number.isInteger(hhmm))
    || !/^\d{1,4}$/.test(hhmm)) throw new Error('invalid FIRMS acquisition date or time');
  const digits = String(hhmm).padStart(4, '0');
  const iso = date + 'T' + digits.slice(0, 2) + ':' + digits.slice(2) + ':00.000Z';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== iso) throw new Error('invalid FIRMS acquisition minute');
  return ms;
}

function missingProducts(sources, servedCount) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 16) throw new Error('invalid FIRMS sources');
  const seen = new Set(), missing = [];
  let fetchedCount = 0;
  for (const s of sources) {
    if (typeof s?.source !== 'string' || !product.test(s.source) || seen.has(s.source) || typeof s.ok !== 'boolean'
      || !Number.isSafeInteger(s.count) || s.count < 0 || (!s.ok && s.count !== 0)) throw new Error('invalid FIRMS source status');
    seen.add(s.source);
    fetchedCount += s.count;
    if (!s.ok) missing.push(s.source);
  }
  if (missing.length === sources.length) throw new Error('all FIRMS products unavailable');
  if (servedCount > fetchedCount) throw new Error('FIRMS served count exceeds fetched source counts');
  return missing.sort();
}

function checkValues([detected, lat, lon, sat, instrument, confidence, frp, fetched, stale, missing]) {
  if (detected !== true || !coordinate(lat, 90) || !coordinate(lon, 180) || lon === 180
    || typeof sat !== 'string' || !sensor.test(sat) || typeof instrument !== 'string' || !sensor.test(instrument)
    || !(confidence === null || (typeof confidence === 'string' && confidence.length > 0 && confidence.length <= 24))
    || !(frp === null || (Number.isFinite(frp) && frp > 0)) || !Number.isSafeInteger(fetched)
    || typeof stale !== 'boolean' || typeof missing !== 'string') throw new Error('invalid FIRMS detection');
  const absent = missing ? missing.split(',') : [];
  if (absent.length > 15 || absent.some(p => !product.test(p))
    || [...new Set(absent)].sort().join(',') !== missing) throw new Error('invalid FIRMS product coverage');
}

function group(source, at, receivedAt, values) {
  checkValues(values);
  const [, lat, lon, sat, instrument] = values;
  const subject = subjectOf(sat, instrument, at, lat, lon);
  return keys.map((predicate, i) => ({ id: source + '#' + subject + '/' + predicate, subject, predicate, value: values[i],
    source, validFrom: at, validTo: at + minute, recordedAt: receivedAt, supersedes: null }));
}

// Scope the world feed before queueing. Only fresh, bounded arrays of scalar values reach the receiver.
export function scopeFirms({ origin, feed, bbox, receivedAt }, maxEvents) {
  const source = firmsUrl(origin), bounds = regionBounds(bbox);
  if (!Array.isArray(feed?.fires) || feed.count !== feed.fires.length || feed.count > 300_000
    || !Number.isSafeInteger(feed.fetchedAt) || typeof feed.stale !== 'boolean') throw new Error('invalid FIRMS envelope or row budget');
  const unavailable = missingProducts(feed.sources, feed.count);
  const detections = [];
  for (const row of feed.fires) {
    if (!coordinate(row?.lat, 90) || !coordinate(row?.lon, 180)) throw new Error('invalid FIRMS location');
    if (!containsPoint(bounds, row.lon, row.lat)) continue;
    if (detections.length >= maxEvents) throw new RangeError('FIRMS region exceeds event budget');
    const at = acquired(row.acqDate, row.acqTime);
    // GEV substitutes zero for a missing or malformed FRP. A positive value survives that conversion.
    const confidence = Number.isInteger(row.confidence) && row.confidence >= 0 && row.confidence <= 100
      ? String(row.confidence) : row.confidence;
    const longitude = row.lon === 180 ? -180 : row.lon;
    const values = [true, row.lat, longitude, row.satellite, row.instrument, confidence === '' ? null : confidence,
      row.frp === 0 ? null : row.frp, feed.fetchedAt, feed.stale, unavailable.join(',')];
    detections.push(group(source, at, receivedAt, values));
  }
  return { kind: 'gev-firms', receivedAt, detections, summary: { bbox: bounds, total: feed.count,
    outside: feed.count - detections.length, fetchedAt: feed.fetchedAt, stale: feed.stale, unavailable } };
}

export function receiveFirms(own, { detections, summary }) {
  const known = new Map(own.entries().map(f => [f.id, f.value])), facts = [];
  let added = 0, unchanged = 0;
  for (const rows of detections) {
    if (known.has(rows[0].id)) {
      // The proxy supplies no source revision ID. Never overwrite a conflicting measurement.
      for (const row of rows.slice(0, keys.indexOf('proxy_fetched_at'))) {
        if (known.get(row.id) !== row.value) throw new Error('conflicting FIRMS values for the same detection');
      }
      unchanged++;
    } else {
      for (const row of rows) known.set(row.id, row.value);
      facts.push(...rows); added++;
    }
  }
  return { facts, summary: { ...summary, added, unchanged } };
}

export function firmsGroups(ledger) {
  const rows = ledger.entries(), groups = [];
  if (rows.length % keys.length) throw new Error('incomplete FIRMS detection');
  for (let i = 0; i < rows.length; i += keys.length) {
    const facts = rows.slice(i, i + keys.length), f = facts[0];
    if (!isFirmsSubject(f.subject)) throw new Error('invalid FIRMS detection identity or time');
    const source = firmsUrl(new URL(f.source).origin);
    const expected = group(source, f.validFrom, f.recordedAt, facts.map(row => row.value));
    if (expected.some((e, n) => Object.keys(e).some(k => e[k] !== facts[n][k])))
      throw new Error('inconsistent FIRMS receipts');
    groups.push(facts);
  }
  return groups;
}
