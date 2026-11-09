import { USGS_FEED } from './usgs.js';
import { fetchText } from './http.js';

export function fetchUSGS(options) {
  return fetchText(USGS_FEED, 'USGS', options);
}
