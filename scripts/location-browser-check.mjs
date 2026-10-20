import assert from 'node:assert/strict';

export async function checkLocationField({ call, evaluate, shot, click, reload, navigate }) {
  // Browser geolocation uses an explicitly synthetic CDP position. The actual
  // browser permission API, IndexedDB, C router and AML memory execute below.
  await navigate('/web/location.html');
  const origin = await evaluate('location.origin');
  const readStore = `async()=>{const {worldStore}=await import('/web/storage.js');
    return worldStore(indexedDB,{key:'location-v1',maxBytes:512000}).load()}`;
  assert.equal(await evaluate(`(${readStore})()`), null);
  assert.equal(await evaluate('document.querySelectorAll("#points circle").length'), 0);
  await call('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin }, false);
  await click('locate');
  assert.match(await evaluate('document.getElementById("error").textContent'), /denied/);
  assert.equal(await evaluate(`(${readStore})()`), null);
  await call('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'granted', origin }, false);
  await call('Emulation.setGeolocationOverride', { latitude: 12.5, longitude: -34.25, accuracy: 7 });
  await click('locate');
  assert.equal(await evaluate('document.getElementById("error").hidden'), true);
  const first = await evaluate(`(${readStore})()`);
  const records = JSON.parse(first.journal).records;
  assert.deepEqual(records.map(f => f.value), [12.5, -34.25, 7]);
  assert.ok(records.every(f => f.source === 'browser:geolocation' && f.validTo === f.validFrom + 1));
  assert.ok(records[0].recordedAt >= records[0].validFrom);
  await call('Emulation.setGeolocationOverride', { latitude: 15, longitude: -30, accuracy: 11 });
  await click('locate');
  const second = await evaluate(`(${readStore})()`);
  assert.equal(JSON.parse(second.journal).records.length, 6);
  assert.deepEqual(JSON.parse(second.journal).records.slice(0, 3), records);
  await reload();
  assert.deepEqual(await evaluate(`(${readStore})()`), second, 'reload never requests another observation');
  assert.equal(await evaluate('document.querySelectorAll("#receipts button").length'), 2);
  await evaluate(`{const k=document.getElementById('knowledge');k.value=0;k.dispatchEvent(new Event('input'))}`);
  assert.equal(await evaluate('document.querySelectorAll("#receipts button").length'), 1);
  assert.match(await evaluate('document.getElementById("coordinates").textContent'), /12.500000/);
  await click('present');
  await evaluate('window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException("Synthetic location quota failure","QuotaExceededError")}');
  await click('locate');
  assert.match(await evaluate('document.getElementById("error").textContent'), /Synthetic location quota failure/);
  assert.deepEqual(await evaluate(`(${readStore})()`), second);
  assert.equal(await evaluate('document.querySelectorAll("#receipts button").length'), 2);
  await evaluate('IDBObjectStore.prototype.put=window.originalPut');
  await reload();

  async function idle() {
    for (let i = 0; i < 200; i++) {
      if (await evaluate('document.getElementById("actions").dataset.busy === "false"')) return;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Location action did not settle');
  }
  assert.equal(await evaluate('document.getElementById("action-preset").value'), 'facts');
  await click('action-fill'); await click('action-run'); await idle();
  const trace = await evaluate('JSON.parse(document.querySelector(".action-raw pre").textContent)');
  assert.equal(trace.status, 'executed'); assert.equal(trace.call.name, 'lalo_facts');
  assert.equal(trace.memory.state, 'saved');
  assert.deepEqual(trace.result.data.items.map(f => f.value), [15, -30, 11]);
  await evaluate('document.querySelectorAll(".action-receipts button")[2].click()');
  assert.match(await evaluate('document.getElementById("inspector").textContent'), /accuracy/);
  await reload(); await click('action-recall'); await idle();
  await click('action-world-open'); await idle(); await click('world-replay');
  assert.equal(await evaluate('document.getElementById("action-world").dataset.comparison'), 'match');
  const reproduced = await evaluate('JSON.parse(document.getElementById("world-replay-result").textContent)');
  assert.deepEqual(reproduced.result, trace.result);
  assert.deepEqual(await evaluate(`(${readStore})()`), second);
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await shot('location-desktop');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await shot('location-phone');
  await evaluate(`(async()=>{const {worldStore}=await import('/web/storage.js');const s=worldStore(indexedDB,{key:'location-v1',maxBytes:512000});const old=await s.load();await s.save('broken location journal',old.revision)})()`);
  await reload();
  assert.equal(await evaluate('document.getElementById("locate").disabled'), true);
  assert.equal(await evaluate(`(${readStore})().then(x=>x.journal)`), 'broken location journal');
  await call('Emulation.clearGeolocationOverride');
  console.log('PASS: device location permission denial, synthetic browser fixes, receipt clocks, atomic saves, rewind, reload, real C facts, AML recall/replay, corrupt storage and 390px layout');
}
