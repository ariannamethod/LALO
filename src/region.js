// Geographic bounding boxes use [west, south, east, north], with inclusive edges.
export function regionBounds(value) {
  if (!Array.isArray(value) || value.length !== 4 || !Array.from(value).every(Number.isFinite))
    throw new TypeError('bbox requires four finite coordinates [west,south,east,north]');
  const [west, south, east, north] = value;
  if (Math.abs(west) > 180 || Math.abs(east) > 180 || south < -90 || north > 90
    || south >= north || west === east || (west === 180 && east === -180)) throw new RangeError('invalid bbox extent');
  return [west, south, east, north];
}

export function containsPoint([west, south, east, north], lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < south || lat > north) return false;
  if (Math.abs(lon) === 180 && (west === -180 || east === 180)) return true;
  return west > east ? lon >= west || lon <= east : lon >= west && lon <= east;
}
