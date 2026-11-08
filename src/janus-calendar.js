// Temporal readings of immutable LALO receipts. AML owns the calendar arithmetic.
let runtime;
function loadCalendar() {
  runtime ??= import('../deps/aml/janus/calendar_browser.mjs').then(async module => {
    const bytes = module.bundledBytes();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const wasmSha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    return { api: module.API, split: module.splitUnixMilliseconds, calendar: await module.wasmCalendar(bytes), wasmSha256 };
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
    const { api, split, calendar, wasmSha256 } = await loadCalendar();
    Object.assign(reading, { api, wasmSha256 });
    function parts(at) {
      if (!calendarTimestampSupported(at)) throw new RangeError('Timestamp outside JANUS.CALENDAR years 1..9999');
      return split(at);
    }
    const instant = ({ unixDay, second, millisecond }) => calendar.instant(unixDay, second, millisecond);
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
