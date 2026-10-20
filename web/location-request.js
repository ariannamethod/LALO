// Request only from a user action. No watcher, polling or permission query.
export function requestLocation(geolocation, { clock = Date.now, timeout = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!geolocation?.getCurrentPosition) { reject(new Error('Location is unavailable in this browser')); return; }
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Location request timed out. Try again when ready.')), timeout);
    try {
      geolocation.getCurrentPosition(position => {
        if (!settled) finish(null, { position, receivedAt: clock() });
      }, error => {
        const message = error.code === 1 ? 'Location permission was denied.'
          : error.code === 3 ? 'Location request timed out.' : 'The device could not determine its location.';
        finish(new Error(message));
      }, { enableHighAccuracy: true, maximumAge: 0, timeout });
    } catch (error) { finish(error); }
  });
}
