// Synthetic God's Eye View manifest fields consumed by LALO. No imagery or live fetch.
export const simulationOrigin = 'https://gev-simulation.invalid';
export function weatherFrame(product, observed, fetchedAt, receivedAt, stale = false) {
  const times = observed.map(ms => new Date(ms).toISOString()), latest = times.at(-1);
  return { kind: 'gev-weather', origin: simulationOrigin, receivedAt, manifest: {
    schemaVersion: 1, product, source: 'NOAA nowCOAST', times, observedAt: latest, latest, time: latest,
    fetchedAt, stale, unavailable: false,
  } };
}
