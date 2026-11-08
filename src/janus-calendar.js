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

export async function receiptCalendar(fact, origin) {
  const assertion = { id: fact.id, subject: fact.subject, predicate: fact.predicate, source: fact.source, supersedes: fact.supersedes,
    validFrom: fact.validFrom, validTo: fact.validTo, recordedAt: fact.recordedAt };
  const reading = { assertion, originId: origin?.id ?? null };
  // A ledger accepts a wider timestamp range than AML's Gregorian years 1..9999.
  // Keep the source visible even when a coordinate cannot be calculated.
  try {
    const { api, split, calendar, wasmSha256 } = await loadCalendar();
    Object.assign(reading, { api, wasmSha256 });
    // Reject out-of-domain inputs before converting very large ledger integers.
    for (const at of [fact.validFrom, fact.recordedAt, origin?.validFrom ?? fact.validFrom])
      if (at < -62135596800000 || at > 253402300799999)
        throw new RangeError('Timestamp outside JANUS.CALENDAR years 1..9999');
    const event = split(fact.validFrom), receipt = split(fact.recordedAt);
    const occurred = await calendar.instant(event.unixDay, event.second, event.millisecond);
    const known = await calendar.instant(receipt.unixDay, receipt.second, receipt.millisecond);
    const civil = await calendar.local(event.unixDay, event.second, 0, -1);
    const lag = await calendar.duration(occurred, known);
    let perspective = null;
    if (origin) {
      const birth = split(origin.validFrom);
      const anchor = await calendar.local(birth.unixDay, birth.second, 0, -1);
      perspective = { originId: origin.id, source: origin.source, validFrom: origin.validFrom,
        recordedAt: origin.recordedAt, coordinates: await calendar.subject(anchor.utc_civil_day, civil.utc_civil_day) };
    }
    return { ...reading, occurred, known, civil, lag, perspective };
  } catch (error) {
    if (!(error instanceof RangeError) && error.code !== 'CALENDAR_UNAVAILABLE') throw error;
    return { ...reading, error: { code: error.code ?? 'CALENDAR_RANGE', message: error.message } };
  }
}
