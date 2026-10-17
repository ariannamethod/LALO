import { checkActionField } from './action-browser-check.mjs';
// Exercise the real UI and fetch transport with synthetic HTTP responses; never poll USGS in CI.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { quake, collection, QUAKETIME as T } from '../tests/fixtures/usgs.js';
import { decodeJournal, encodeJournal } from '../src/journal.js';
import { ingestUSGS } from '../src/sources/usgs.js';

export async function checkQuakeField({ socket, call, evaluate, shot, waitIdle, click, reload, navigate, out }) {
  let response = collection(quake()), requests = 0;
  const failures = [];
  const intercept = event => {
    const m = JSON.parse(event.data);
    if (m.method !== 'Fetch.requestPaused') return;
    requests++;
    call('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(typeof response === 'string' ? response : JSON.stringify(response)).toString('base64'),
    }).catch(error => failures.push(error.message));
  };
  socket.addEventListener('message', intercept);
  await call('Fetch.enable', { patterns: [{ urlPattern: 'https://earthquake.usgs.gov/*', requestStage: 'Request' }] });
  const state = () => evaluate('document.getElementById("state").textContent');
  const budget = () => evaluate('document.getElementById("budget").textContent');
  const inspector = () => evaluate('document.getElementById("inspector").textContent');
  const setReceiptTime = time => evaluate(`window.receiptTime=${time};Date.now=()=>window.receiptTime`);
  const selectWorld = time => evaluate(`document.getElementById('world').value='${time}';document.getElementById('world').dispatchEvent(new Event('change'))`);
  async function importFile(path) {
    const { root } = await call('DOM.getDocument');
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '#import' });
    await call('DOM.setFileInputFiles', { nodeId, files: [resolve(path)] });
    await waitIdle();
  }
  try {
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate('/web/usgs.html');
    assert.equal(requests, 0, 'opening a source field never fetches automatically');
    assert.equal(await state(), 'unsettled');
    await setReceiptTime(T + 2000); await click('poll');
    assert.equal(await state(), 'contradicted'); assert.match(await budget(), /^8 \/ 1024/);
    assert.match(await inspector(), /Synthetic crossing/);
    assert.equal(await evaluate('document.querySelector("#inspector a").href'), 'https://earthquake.usgs.gov/earthquakes/eventpage/synthetic1');
    await setReceiptTime(T + 2500); await click('poll');
    assert.match(await budget(), /^8 \/ 1024/); assert.match(await evaluate('document.getElementById("source-status").textContent'), /1 unchanged/);
    response = collection(quake({ mag: 3.4, time: T + 100, updated: T + 3000, coordinates: [31, 41, 9], place: 'Revised synthetic place' }),
      quake({ id: 'synthetic2', mag: null, updated: T + 3000, place: 'Later synthetic event' }));
    await setReceiptTime(T + 4000); await click('poll');
    assert.equal(await state(), 'supported'); assert.match(await budget(), /^24 \/ 1024/);
    assert.match(await inspector(), /M 2\.9 .* → M 3\.4/);
    assert.match(await inspector(), /41°, 31°/);
    await shot('usgs-desktop-revised');
    await selectWorld(T); assert.equal(await state(), 'unsettled');
    await selectWorld(T + 101); assert.equal(await state(), 'unsettled');
    await evaluate('document.getElementById("knowledge").value=0;document.getElementById("knowledge").dispatchEvent(new Event("input"))');
    assert.equal(await state(), 'contradicted');
    assert.equal(await evaluate('document.querySelectorAll("#event option").length'), 1);
    assert.equal(await evaluate('document.body.textContent.includes("Revised synthetic place")'), false);
    assert.equal(await evaluate('document.body.textContent.includes("Later synthetic event")'), false);
    assert.match(await inspector(), /40°, 30°/);
    assert.equal(await evaluate('document.querySelectorAll(".receipt").length'), 1);
    await click('present');
    await evaluate(`document.querySelector('[data-id="usgs:synthetic1:${T + 1000}:magnitude"]').click()`);
    assert.match(await inspector(), /Synthetic crossing/); assert.match(await inspector(), /40°, 30°/);
    await evaluate(`document.getElementById('event').value='usgs:synthetic2';document.getElementById('event').dispatchEvent(new Event('change'))`);
    assert.equal(await state(), 'unsettled'); assert.match(await inspector(), /Magnitude unknown/);
    await reload();
    assert.equal(requests, 3, 'reload replays saved observations without HTTP');
    assert.equal(await state(), 'supported'); assert.match(await budget(), /^24 \/ 1024/);
    // A rejected save cannot advance either the field or the stored head.
    response = collection(quake({ mag: 4, updated: T + 5000 }));
    await setReceiptTime(T + 6000);
    await evaluate('window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException("USGS test quota failure","QuotaExceededError")}');
    await click('poll');
    assert.match(await budget(), /^24 \/ 1024/); assert.match(await inspector(), /Magnitude 3\.4/);
    assert.match(await evaluate('document.getElementById("error").textContent'), /USGS test quota failure/);
    await evaluate('IDBObjectStore.prototype.put=window.originalPut');
    response = 'broken feed'; await click('poll');
    assert.equal(await evaluate('document.getElementById("error").hidden'), false); assert.match(await budget(), /^24 \/ 1024/);
    await reload();
    await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(out) }, false);
    await click('export');
    const exportPath = join(out, 'lalo-usgs.json');
    let exported;
    for (let i = 0; i < 100; i++) {
      try { exported = decodeJournal(await readFile(exportPath, 'utf8')); break; } catch { await new Promise(r => setTimeout(r, 50)); }
    }
    assert.equal(exported?.size, 24, 'export contains the full replayable journal');
    const extended = ingestUSGS(exported, collection(quake({ mag: 4.1, updated: T + 9000 })), { receivedAt: T + 10000 }).ledger;
    const extensionPath = join(out, 'synthetic-extension.json');
    await writeFile(extensionPath, encodeJournal(extended)); await importFile(extensionPath);
    assert.match(await budget(), /^32 \/ 1024/); assert.match(await inspector(), /Magnitude 4\.1/);
    await importFile(exportPath);
    assert.match(await evaluate('document.getElementById("error").textContent'), /extend this journal/);
    assert.match(await budget(), /^32 \/ 1024/);
    await reload(); assert.match(await budget(), /^32 \/ 1024/);
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'source field fits phone width');
    await shot('usgs-phone-revised');
    await checkActionField({ evaluate, call, shot, kind: 'usgs' });
    assert.equal(await evaluate(`(async()=>{const {worldStore}=await import('/web/storage.js');return (await worldStore(indexedDB).load()).journal})()`), 'broken journal', 'crossing data is independent');
    await evaluate(`(async()=>{const {worldStore}=await import('/web/storage.js');const s=worldStore(indexedDB,{key:'usgs-v1',maxBytes:2000000});const old=await s.load();await s.save('damaged USGS journal',old.revision)})()`);
    await reload(); assert.equal(await evaluate('document.getElementById("poll").disabled'), true);
    assert.equal(await evaluate('document.getElementById("error").hidden'), false);
    assert.equal(await evaluate(`(async()=>{const {worldStore}=await import('/web/storage.js');return (await worldStore(indexedDB,{key:'usgs-v1'}).load()).journal})()`), 'damaged USGS journal');
    assert.deepEqual(failures, []);
    console.log('PASS: USGS fetch on demand, dedupe, corrected origin, historical metadata, unknown magnitude, reload, failed save/feed, export/import extension, phone layout and isolated corrupt journals');
  } finally { await call('Fetch.disable'); socket.removeEventListener('message', intercept); }
}
