// Synthetic source rows in the shape served by God's Eye View's FIRMS endpoint.
export const box = [29, 39, 31, 41];
export const noon = Date.UTC(2026, 9, 15, 12);
export const minute = 60_000;
export const origin = 'https://firms-simulation.invalid';
export function fire(overrides = {}) {
  return { lat: 40, lon: 30, instrument: 'VIIRS', satellite: 'N20', confidence: 'n', frp: 3.5,
    acqDate: '2026-10-15', acqTime: '1142', ...overrides };
}
export function feed(fires, receivedAt = noon, overrides = {}) {
  return { kind: 'gev-firms', origin, receivedAt, bbox: box, feed: {
    count: fires.length, fires, fetchedAt: receivedAt - minute, stale: false,
    sources: [{ source: 'VIIRS_NOAA20_NRT', ok: true, count: fires.filter(f => f.satellite === 'N20').length },
      { source: 'VIIRS_NOAA21_NRT', ok: true, count: fires.filter(f => f.satellite === 'N21').length },
      { source: 'MODIS_NRT', ok: true, count: fires.filter(f => f.instrument === 'MODIS').length }], ...overrides,
  } };
}
