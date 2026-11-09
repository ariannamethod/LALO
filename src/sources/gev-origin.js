export function gevOrigin(origin) {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/'
    || base.search || base.hash || base.origin.length > 240)
    throw new TypeError("expected an HTTP(S) origin for God's Eye View");
  return base.origin;
}
