// Temporal readings of immutable LALO receipts. AML owns the calendar arithmetic.
let runtime;
function loadCalendar() {
  runtime ??= import('../deps/aml/janus/calendar_browser.mjs').then(async module => {
    const bytes = module.bundledBytes();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const wasmSha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    const calendar = await module.wasmCalendar(bytes);
    const parts = at => {
      if (!calendarTimestampSupported(at))
        throw Object.assign(new RangeError('Timestamp outside JANUS.CALENDAR years 1..9999'), { code: 'CALENDAR_RANGE' });
      return module.splitUnixMilliseconds(at);
    };
    const instant = ({ unixDay, second, millisecond }) => calendar.instant(unixDay, second, millisecond);
    return { api: module.API, parts, instant, calendar, wasmSha256 };
  }).catch(cause => {
    runtime = undefined;
    throw Object.assign(new Error('JANUS.CALENDAR unavailable. Initialize deps/aml and enable WebAssembly and Web Crypto.',
      { cause }), { code: 'CALENDAR_UNAVAILABLE' });
  });
  return runtime;
}

export function knownReceipt(records, id, knownAt) {
  const fact = records.find(row => row.id === id && row.recordedAt <= knownAt);
  if (!fact) throw Object.assign(new Error('Receipt is not known at this cutoff'), { code: 'NOT_FOUND' });
  return fact;
}

// UTC Gregorian years 1..9999 are representable by AML.
export const calendarTimestampSupported = at => at >= -62135596800000 && at <= 253402300799999;

function assertionOf(fact) {
  return { id: fact.id, subject: fact.subject, predicate: fact.predicate, source: fact.source, supersedes: fact.supersedes,
    validFrom: fact.validFrom, validTo: fact.validTo, recordedAt: fact.recordedAt };
}

async function clockOrder(calendar, left, right) {
  return { order: await calendar.compare(left, right), delta: await calendar.duration(left, right) };
}

export async function receiptCalendar(fact, origin, choice, compareTo) {
  const reading = { assertion: assertionOf(fact), originId: origin?.id ?? null };
  if (choice) reading.originChoice = choice;
  // A ledger accepts a wider timestamp range than AML's Gregorian years 1..9999.
  // Keep the source visible even when a coordinate cannot be calculated.
  try {
    const { api, parts, instant, calendar, wasmSha256 } = await loadCalendar();
    Object.assign(reading, { api, wasmSha256 });
    const event = parts(fact.validFrom);
    const occurred = await instant(event), known = await instant(parts(fact.recordedAt));
    const civil = await calendar.local(event.unixDay, event.second, 0, -1);
    const lag = await calendar.duration(occurred, known);
    let perspective = null;
    if (origin) {
      const birth = parts(origin.validFrom);
      const anchor = await calendar.local(birth.unixDay, birth.second, 0, -1);
      perspective = { originId: origin.id, source: origin.source, validFrom: origin.validFrom,
        recordedAt: origin.recordedAt, coordinates: await calendar.subject(anchor.utc_civil_day, civil.utc_civil_day) };
    }
    if (compareTo) {
      const otherEvent = await instant(parts(compareTo.validFrom)), otherReceipt = await instant(parts(compareTo.recordedAt));
      reading.comparison = { assertion: assertionOf(compareTo),
        occurrence: await clockOrder(calendar, occurred, otherEvent), receipt: await clockOrder(calendar, known, otherReceipt) };
    }
    return { ...reading, occurred, known, civil, lag, perspective };
  } catch (error) {
    if (!(error instanceof RangeError) && error.code !== 'CALENDAR_UNAVAILABLE') throw error;
    return { ...reading, error: { code: error.code ?? 'CALENDAR_RANGE', message: error.message } };
  }
}

export async function historyWindow(records, { receivedFrom, receivedTo, occurredBefore }) {
  const { parts, instant, calendar, api, wasmSha256 } = await loadCalendar();
  const at = ms => instant(parts(ms));
  const start = receivedFrom === undefined ? null : await at(receivedFrom);
  const end = receivedTo === undefined ? null : await at(receivedTo);
  const before = occurredBefore === undefined ? null : await at(occurredBefore);
  const rows = [], window = { receivedFrom, receivedTo, occurredBefore, api, wasmSha256 };
  let acceptsReceipt;
  if (start && end) {
    const order = await calendar.compare(start, end);
    if (order > 0) throw Object.assign(new RangeError('receivedTo precedes receivedFrom'), { code: 'INVALID_ARGUMENTS' });
    if (order === 0) return { rows, window };
    const span = await calendar.span(start, end);
    acceptsReceipt = receipt => calendar.contains(span, receipt);
  } else if (start) {
    acceptsReceipt = async receipt => (await calendar.compare(receipt, start)) >= 0;
  } else if (end) {
    acceptsReceipt = async receipt => (await calendar.compare(receipt, end)) < 0;
  }
  for (const fact of records) {
    if (acceptsReceipt && !await acceptsReceipt(await at(fact.recordedAt))) continue;
    if (before && await calendar.compare(await at(fact.validFrom), before) >= 0) continue;
    rows.push(fact);
  }
  return { rows, window };
}

// A saved snapshot can lack receipts stamped at or before its own cutoff.
export async function readingBatches(records, sinceKnownAt, knownAt, savedIDs) {
  const { parts, instant, calendar, api, wasmSha256 } = await loadCalendar();
  const start = await instant(parts(sinceKnownAt)), end = await instant(parts(knownAt));
  const order = await calendar.compare(start, end);
  if (order > 0) throw Object.assign(new RangeError('sinceKnownAt exceeds knownAt'), { code: 'INVALID_ARGUMENTS' });
  const batches = new Map();
  if (order === 0 && !savedIDs) return { batches, api, wasmSha256 };
  let previous, afterStart;
  for (const fact of records) {
    const time = fact.recordedAt;
    if (!calendarTimestampSupported(time)) {
      if (time > knownAt) break;
      if (!savedIDs || savedIDs.has(fact.id)) continue;
      // An unseen receipt below the range goes through the checked conversion below.
    }
    if (time !== previous) {
      previous = time;
      const at = await instant(parts(time));
      if (await calendar.compare(at, end) > 0) break;
      afterStart = await calendar.compare(at, start) > 0;
    }
    if (!afterStart && (!savedIDs || savedIDs.has(fact.id))) continue;
    if (!batches.has(time)) batches.set(time, []);
    batches.get(time).push(fact);
  }
  return { batches, api, wasmSha256 };
}
