// Synthetic measurements only. Both external observations arrive before noon.
import { fire, feed, minute, noon } from './gev-firms.js';
import { collection, quake } from './usgs.js';

export function fix(id, longitude, observedAt, receivedAt, latitude = 40) {
  return { kind: 'location', id, receivedAt,
    position: { timestamp: observedAt, coords: { latitude, longitude, accuracy: 7 } } };
}

export const request = { agent: 'agent:route-model', nearDevice: { radiusMeters: 500, maxFixAgeMs: 15 * minute },
  worldFrom: noon - 30 * minute, worldTo: noon, stateAt: noon, knownAt: noon };

export function route() {
  return [
    fix('stop-a', 30, noon - 11 * minute, noon - 10 * minute),
    feed([fire({ lon: 30.001 })], noon - 4 * minute),
    { kind: 'usgs', receivedAt: noon - 3 * minute, feed: collection(quake({
      coordinates: [30.101, 40, 8], time: noon - 12 * minute, updated: noon - 6 * minute })) },
    { kind: 'signal', fact: { id: 'fixture:kv:1', subject: request.agent, predicate: 'kv_cache_used_tokens',
      value: 128, source: 'fixture:model-runtime', validFrom: noon, validTo: noon + 1, recordedAt: noon } },
    fix('stop-b', 30.1, noon - minute, noon + 7 * minute),
    fix('older', 31, noon - 8 * minute, noon + 8 * minute),
  ];
}
