// Synthetic source observations shared by the offline core and browser gates.
export const QUAKETIME = Date.UTC(2026, 9, 15, 12);
export function quake({ id = 'synthetic1', coordinates = [30, 40, 8], ...properties } = {}) {
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates },
    properties: { mag: 2.9, magType: 'ml', time: QUAKETIME, updated: QUAKETIME + 1000,
      place: 'Synthetic crossing', type: 'earthquake', ...properties } };
}
export const collection = (...features) => ({ type: 'FeatureCollection', features });
