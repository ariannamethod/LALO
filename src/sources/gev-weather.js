// God's Eye View NOAA nowCOAST manifest v1. Each listed time identifies an imagery frame.
const products = ['radar', 'lightning', 'clouds', 'clouds-regional'];
const predicates = ['frame_listed', 'manifest_fetched_at', 'manifest_stale'];
export const isWeatherSubject = value => products.some(product => value === 'nowcoast:' + product);

export function manifestUrl(origin, product) {
  if (!products.includes(product)) throw new TypeError('unknown nowCOAST product');
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/'
    || base.search || base.hash || base.origin.length > 240)
    throw new TypeError('expected an HTTP(S) origin for God\'s Eye View');
  return base.origin + '/api/weather/manifest?product=' + product;
}

function observedTime(iso) {
  const ms = Date.parse(iso);
  if (typeof iso !== 'string' || !/^\d{4}-/.test(iso) || !Number.isFinite(ms) || new Date(ms).toISOString() !== iso)
    throw new TypeError('invalid nowCOAST observation time');
  return ms;
}

function factsFor(source, product, at, fetchedAt, stale, receivedAt) {
  const values = [true, fetchedAt, stale];
  return predicates.map((predicate, i) => ({
    id: source + '#' + at + '/' + predicate, subject: 'nowcoast:' + product, predicate, value: values[i],
    source, validFrom: at, validTo: at + 1, recordedAt: receivedAt, supersedes: null,
  }));
}

// Validate the first manifest that witnessed each frame, also when reopening a mixed world.
export function weatherFrames(ledger) {
  const rows = ledger.entries(), groups = [];
  if (rows.length % predicates.length) throw new Error('incomplete weather frame');
  for (let i = 0; i < rows.length; i += predicates.length) {
    const group = rows.slice(i, i + predicates.length), [listed, fetched, stale] = group;
    const product = listed.subject.slice('nowcoast:'.length);
    const source = manifestUrl(new URL(listed.source).origin, product);
    const date = new Date(listed.validFrom);
    if (!Number.isFinite(date.valueOf()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999
      || !Number.isSafeInteger(fetched.value) || typeof stale.value !== 'boolean')
      throw new Error('invalid weather frame clocks or cache state');
    const expected = factsFor(source, product, listed.validFrom, fetched.value, stale.value, listed.recordedAt);
    if (expected.some((f, j) => Object.keys(f).some(key => f[key] !== group[j][key])))
      throw new Error('inconsistent weather frame receipts');
    groups.push(group);
  }
  return groups;
}

export function receiveWeather(own, { origin, manifest, receivedAt }, budget) {
  const product = manifest?.product, source = manifestUrl(origin, product);
  if (manifest.schemaVersion !== 1 || manifest.source !== 'NOAA nowCOAST' || typeof manifest.stale !== 'boolean'
    || typeof manifest.unavailable !== 'boolean') throw new TypeError('invalid weather manifest');
  if (manifest.unavailable) throw new Error('weather imagery metadata unavailable for ' + product);
  if (!Number.isSafeInteger(manifest.fetchedAt) || !Array.isArray(manifest.times) || !manifest.times.length
    || manifest.times.length > 13 || manifest.times.length > budget.maxEvents)
    throw new RangeError('invalid weather manifest times, cache clock or batch budget');
  const times = manifest.times.map(observedTime), latest = manifest.times.at(-1);
  if ([manifest.time, manifest.latest, manifest.observedAt].some(t => t !== latest)
    || times.some((at, i) => i && at <= times[i - 1])) throw new Error('inconsistent weather manifest times');
  const known = new Set(own.entries().map(f => f.id)), facts = [];
  let unchanged = 0;
  for (const at of times) {
    const group = factsFor(source, product, at, manifest.fetchedAt, manifest.stale, receivedAt);
    if (known.has(group[0].id)) unchanged++;
    else facts.push(...group);
  }
  return { facts, summary: { product, fetchedAt: manifest.fetchedAt, stale: manifest.stale,
    added: times.length - unchanged, unchanged } };
}
