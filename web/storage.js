// A compare-and-swap transaction prevents two tabs from replacing each other's receipts.
export function worldStore(factory, { name = 'lalo-worlds-v1', key = 'crossing-v1' } = {}) {
  function connect() {
    return new Promise((resolve, reject) => {
      if (!factory) { reject(new Error('Local storage is unavailable')); return; }
      const request = factory.open(name, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore('worlds');
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('Close other LALO tabs to open local storage')); };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async function transact(mode, update) {
    const db = await connect();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('worlds', mode), store = tx.objectStore('worlds');
        let result, failure;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error('Local save aborted'));
        tx.onerror = () => { failure ||= tx.error; };
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const current = request.result ?? null;
            if (current !== null && (!Number.isSafeInteger(current.revision) || current.revision < 1
              || typeof current.journal !== 'string')) throw new Error('Saved world is malformed; it has not been replaced');
            result = update ? update(current, store) : current;
          } catch (error) { failure = error; tx.abort(); }
        };
      });
    } finally { db.close(); }
  }
  return {
    load: () => transact('readonly'),
    save(journal, expectedRevision) {
      if (typeof journal !== 'string' || journal.length > 128_000)
        return Promise.reject(new RangeError('saved world exceeds its text budget'));
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER)
        return Promise.reject(new RangeError('invalid saved-world revision'));
      return transact('readwrite', (current, store) => {
        if ((current?.revision ?? 0) !== expectedRevision)
          throw new Error('Another tab changed this world. Reload to continue; your saved history is intact.');
        const result = { revision: expectedRevision + 1, journal };
        store.put(result, key);
        return result;
      });
    },
  };
}
