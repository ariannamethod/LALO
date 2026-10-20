import assert from 'node:assert/strict';

export async function checkCameraField({ call, evaluate, shot, click, reload, navigate }) {
  // Chrome's fake video device supplies synthetic pixels. Permissions, JPEG
  // encoding/decoding, IndexedDB, native routing and AML memory are real.
  await navigate('/web/camera.html');
  const origin = await evaluate('location.origin');
  const readStore = `async()=>{const {worldStore}=await import('/web/storage.js');
    return worldStore(indexedDB,{key:'camera-v1',maxBytes:1500000}).load()}`;
  async function until(expression) {
    for (let i = 0; i < 160; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Camera did not settle: ${expression}`);
  }
  async function trackStreams() {
    await evaluate(`window.cameraStreams=[];window.cameraCalls=0;
      window.cameraGet=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async function(options){window.cameraCalls++;const s=await window.cameraGet(options);window.cameraStreams.push(s);return s}`);
  }
  async function open() {
    await click('camera-start');
    await until('!document.getElementById("camera-capture").disabled');
  }
  const stopped = () => evaluate('window.cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))');
  const photo = () => evaluate('document.getElementById("photo").src');
  assert.equal(await evaluate(`(${readStore})()`), null);
  assert.equal(await evaluate('document.getElementById("preview").srcObject'), null);
  await trackStreams();
  assert.equal(await evaluate('window.cameraCalls'), 0);
  await call('Browser.setPermission', { permission: { name: 'camera' }, setting: 'denied', origin }, false);
  await click('camera-start');
  assert.match(await evaluate('document.getElementById("error").textContent'), /denied/);
  assert.equal(await evaluate(`(${readStore})()`), null);
  await call('Browser.setPermission', { permission: { name: 'camera' }, setting: 'granted', origin }, false);
  await open(); await click('camera-stop');
  assert.equal(await stopped(), true); assert.equal(await evaluate(`(${readStore})()`), null);

  // A permission result arriving after Stop must not reopen the preview.
  await evaluate(`window.trackedCameraGet=navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia=async function(options){const s=await window.trackedCameraGet(options);
      await new Promise(resolve=>window.releaseCamera=resolve);return s};document.getElementById('camera-start').click()`);
  await until('typeof window.releaseCamera === "function"');
  await click('camera-stop'); await evaluate('window.releaseCamera()');
  await until('window.cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))');
  assert.equal(await evaluate('document.getElementById("preview").srcObject'), null);
  await evaluate('navigator.mediaDevices.getUserMedia=window.trackedCameraGet');

  await open(); await click('camera-capture');
  assert.equal(await evaluate('document.getElementById("error").hidden'), true);
  assert.equal(await stopped(), true);
  const first = await evaluate(`(${readStore})()`), firstPhoto = await photo();
  const records = JSON.parse(first.journal).records;
  assert.ok(records.length >= 4);
  assert.ok(records.every(f => f.source === 'browser:camera' && f.validTo === f.validFrom + 1));
  assert.ok(records[0].recordedAt >= records[0].validFrom);
  assert.equal(records.filter(f => f.predicate.startsWith('camera.jpeg.')).map(f => f.value).join(''), firstPhoto.split(',')[1]);
  const dimensions = await evaluate('document.getElementById("photo").decode().then(()=>{const p=document.getElementById("photo");return [p.naturalWidth,p.naturalHeight]})');
  assert.deepEqual(dimensions, records.slice(0, 2).map(f => f.value));
  assert.ok(Math.max(...dimensions) <= 640);
  await open(); await until('document.getElementById("preview").currentTime >= 0.5'); await click('camera-capture');
  const second = await evaluate(`(${readStore})()`), secondPhoto = await photo();
  assert.deepEqual(JSON.parse(second.journal).records.slice(0, records.length), records);
  assert.notEqual(firstPhoto, secondPhoto, 'synthetic device advances between captures');
  await reload(); await trackStreams();
  assert.equal(await photo(), secondPhoto);
  assert.equal(await evaluate('window.cameraCalls'), 0);
  assert.deepEqual(await evaluate(`(${readStore})()`), second);
  await evaluate(`{const k=document.getElementById('knowledge');k.value=0;k.dispatchEvent(new Event('input'))}`);
  assert.equal(await photo(), firstPhoto);
  assert.equal(await evaluate('document.querySelectorAll("#receipts button").length'), 1);
  await click('present');

  await evaluate('window.originalCameraPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException("Synthetic camera quota failure","QuotaExceededError")}');
  await open(); await click('camera-capture');
  assert.match(await evaluate('document.getElementById("error").textContent'), /Synthetic camera quota failure/);
  assert.equal(await stopped(), true); assert.equal(await photo(), secondPhoto);
  assert.deepEqual(await evaluate(`(${readStore})()`), second);
  await evaluate('IDBObjectStore.prototype.put=window.originalCameraPut');
  await reload(); await trackStreams();

  const idle = () => until('document.getElementById("actions").dataset.busy === "false"');
  await click('action-fill'); await click('action-run'); await idle();
  const trace = await evaluate('JSON.parse(document.querySelector(".action-raw pre").textContent)');
  assert.equal(trace.status, 'executed'); assert.equal(trace.call.name, 'lalo_facts');
  assert.equal(trace.memory.state, 'saved');
  const savedFrameID = JSON.parse(second.journal).records[records.length].id;
  assert.equal(trace.result.data.items[0].id, savedFrameID);
  await open(); await click('camera-capture');
  const third = await evaluate(`(${readStore})()`);
  await reload(); await trackStreams(); await click('action-recall'); await idle();
  await click('action-world-open'); await idle();
  while (!await evaluate(`Boolean(document.querySelector('#action-world button[data-id="${savedFrameID}"]'))`)) {
    assert.equal(await evaluate('document.getElementById("world-next").disabled'), false);
    await click('world-next');
  }
  await evaluate(`document.querySelector('#action-world button[data-id="${savedFrameID}"]').click()`);
  assert.equal(await evaluate('document.querySelector(".world-photo").src'), secondPhoto);
  await evaluate('document.querySelector(".world-photo").decode()');
  await click('world-replay');
  assert.equal(await evaluate('document.getElementById("action-world").dataset.comparison'), 'match');
  const reproduced = await evaluate('JSON.parse(document.getElementById("world-replay-result").textContent)');
  assert.deepEqual(reproduced.result, trace.result);
  assert.deepEqual(await evaluate(`(${readStore})()`), third);
  assert.equal(await evaluate('window.cameraCalls'), 0, 'memory recall never opens the camera');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await shot('camera-desktop');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await shot('camera-phone');
  await evaluate(`(async()=>{const {worldStore}=await import('/web/storage.js');const s=worldStore(indexedDB,{key:'camera-v1',maxBytes:1500000});
    const old=await s.load(),journal=JSON.parse(old.journal);journal.records[2].value='0'.repeat(64);await s.save(JSON.stringify(journal),old.revision)})()`);
  await reload();
  assert.equal(await evaluate('document.getElementById("camera-start").disabled'), true);
  assert.match(await evaluate('document.getElementById("error").textContent'), /digest mismatch/);
  assert.equal(JSON.parse((await evaluate(`(${readStore})()`)).journal).records[2].value, '0'.repeat(64));
  console.log('PASS: camera permissions, late-grant cleanup, real JPEG from synthetic video, stopped tracks, atomic save, rewind/reload, C facts, AML original image/replay, corrupt digest and 390px layout');
}
