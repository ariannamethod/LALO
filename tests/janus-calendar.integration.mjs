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
