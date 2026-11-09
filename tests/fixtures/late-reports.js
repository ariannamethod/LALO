// Synthetic observations. Friday starts exactly when the correction is received.
import { FactLedger } from '../../src/ledger.js';

export const tuesday = Date.UTC(2026, 10, 3, 12), friday = Date.UTC(2026, 10, 6), saturday = Date.UTC(2026, 10, 7);
export const fridayQuery = { receivedFrom: friday, receivedTo: saturday, occurredBefore: friday, knownAt: saturday };
export function lateReports() {
  const world = new FactLedger();
  const note = { subject: 'fixture:crossing', predicate: 'open', validTo: null, value: true, source: 'fixture:observer' };
  world.add({ ...note, id: 'original', validFrom: tuesday, recordedAt: friday - 1 });
  world.add({ ...note, id: 'correction', value: false, supersedes: 'original', validFrom: tuesday, recordedAt: friday });
  world.add({ ...note, id: 'friday-event', validFrom: friday, recordedAt: friday });
  world.add({ ...note, id: 'other-report', subject: 'fixture:road', source: 'fixture:witness', validFrom: friday - 1, recordedAt: saturday - 1 });
  world.add({ ...note, id: 'saturday-update', value: true, supersedes: 'correction', validFrom: tuesday, recordedAt: saturday });
  return world;
}
