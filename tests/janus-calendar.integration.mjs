import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCalendar } from '../deps/aml/janus/calendar_native.mjs';
import { splitUnixMilliseconds } from '../deps/aml/janus/calendar.mjs';
import { receiptCalendar } from '../src/janus-calendar.js';

// Native libaml is a separate implementation path from the portable C/WASM transport.
test('Don returns the native AML bridge records for each clock, duration, civil day and personal origin', async () => {
  const native = nativeCalendar(), noon = Date.UTC(2024, 9, 3, 12);
  const origin = { id: 'synthetic:origin', source: 'fixture:origin', validFrom: noon, recordedAt: noon };
  const instant = ms => {
    const { unixDay, second, millisecond } = splitUnixMilliseconds(ms);
    return native.instant(unixDay, second, millisecond);
  };
  const local = ms => {
    const { unixDay, second } = splitUnixMilliseconds(ms);
    return native.local(unixDay, second, 0, -1);
  };
  const anchor = await local(origin.validFrom);
  for (const [validFrom, recordedAt] of [[-1, 0], [noon - 1, noon], [noon + 1, noon - 1], [noon, noon]]) {
    const fact = { ...origin, id: 'synthetic:event', validFrom, validTo: null, recordedAt, supersedes: null };
    const reading = await receiptCalendar(fact, origin);
    const [occurred, known, civil] = await Promise.all([instant(validFrom), instant(recordedAt), local(validFrom)]);
    assert.deepEqual(reading.occurred, occurred);
    assert.deepEqual(reading.known, known);
    assert.deepEqual(reading.civil, civil);
    assert.deepEqual(reading.lag, await native.duration(occurred, known));
    assert.deepEqual(reading.perspective.coordinates, await native.subject(anchor.utc_civil_day, civil.utc_civil_day));
  }
});

test('Gregorian boundaries and signed millisecond lags agree with integer arithmetic across the JANUS range', async () => {
  const native = nativeCalendar();
  const times = [-62135596800000, Date.UTC(1900, 2, 1) - 1, -1, 0, Date.UTC(2000, 1, 29),
    Date.UTC(2000, 2, 1) - 1, 253402300799999];
  for (const validFrom of times) {
    const date = new Date(validFrom);
    for (const recordedAt of times) {
      const fact = { id: 'synthetic:bounds', source: 'fixture:clock', validFrom, recordedAt };
      const { civil, occurred, known, lag } = await receiptCalendar(fact);
      assert.deepEqual([civil.gregorian_year, civil.gregorian_month, civil.gregorian_day],
        [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]);
      const elapsed = BigInt(lag.sign) * ((BigInt(lag.days) * 86400n + BigInt(lag.seconds)) * 1000n + BigInt(lag.milliseconds));
      assert.equal(elapsed, BigInt(recordedAt) - BigInt(validFrom));
      assert.deepEqual(lag, await native.duration(occurred, known));
    }
  }
});
