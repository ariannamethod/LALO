// Zero npm dependencies: drive the runner's installed Chrome through CDP.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { serve } from './serve.mjs';

const server = await serve({ port: 0 });
const profile = await mkdtemp(join(tmpdir(), 'lalo-browser-'));
const out = process.env.BROWSER_ARTIFACTS || 'browser-artifacts';
await mkdir(out, { recursive: true });
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let log = '', socket, session, serial = 0;
const pending = new Map(), errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function call(method, params = {}, attached = true) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(attached ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function shot(name) {
  const { cssContentSize: size } = await call('Page.getLayoutMetrics');
  const r = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
  await writeFile(join(out, `${name}.png`), Buffer.from(r.data, 'base64'));
}
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome launch timeout: ${log}`)), 15000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.once('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}: ${log}`)); });
    chrome.stderr.on('data', bytes => {
      log += bytes;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(message.id);
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
  };
  console.log(JSON.stringify(await call('Browser.getVersion', {}, false)));
  const target = await call('Target.createTarget', { url: 'about:blank' }, false);
  session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false)).sessionId;
  await call('Runtime.enable'); await call('Page.enable');
  // Runtime exceptions and failed module requests fail this gate.
  await call('Network.enable');
  const receive = socket.onmessage;
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Network.loadingFailed') errors.push(m.params);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400
      && !m.params.response.url.endsWith('/favicon.ico')) errors.push(m.params.response);
    receive(event);
  };
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (await evaluate('document.documentElement.dataset.ready === "true"')) { ready = true; break; }
    await delay(100);
  }
  assert.ok(ready, 'page ready');
  const state = () => evaluate('document.getElementById("state").textContent');
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  assert.equal(await state(), 'supported');
  await shot('desktop-initial');
  await click('receive'); assert.equal(await state(), 'contested');
  await shot('desktop-contradiction');
  await click('receive'); await click('receive'); assert.equal(await state(), 'contradicted');
  await evaluate('document.querySelector("[data-id=a2]").click()');
  assert.match(await evaluate('document.getElementById("inspector").textContent'), /a1 → a2/);
  assert.equal(await evaluate('document.getElementById("inspector").getBoundingClientRect().bottom <= document.querySelector("aside").getBoundingClientRect().bottom'), true, 'selected lineage is visible without scrolling the sidebar');
  await shot('desktop-revised');
  await evaluate('const k=document.getElementById("knowledge");k.value=Number(k.min)+120000;k.dispatchEvent(new Event("input"))');
  assert.equal(await state(), 'supported');
  assert.equal(await evaluate('document.querySelectorAll(".receipt").length'), 2);
  assert.equal(await evaluate('document.querySelector("[data-id=a2]") === null'), true);
  await click('present'); assert.equal(await state(), 'contradicted');
  await evaluate('const w=document.getElementById("world");w.value=w.max;w.dispatchEvent(new Event("input"))');
  assert.equal(await state(), 'unsettled');
  await click('reset'); await click('closed'); assert.equal(await state(), 'contested');
  assert.match(await evaluate('document.getElementById("inspector").textContent'), /fixture:you/);
  await click('open'); assert.equal(await state(), 'supported');
  assert.match(await evaluate('document.getElementById("inspector").textContent'), /you1 → you2/);
  // The same UI and canvas are exercised at phone width, including a real touch tap.
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  await click('reset'); await click('receive');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
  await shot('phone-contradiction');
  const point = await evaluate(`(()=>{const r=document.getElementById('field').getBoundingClientRect();
    const unit=Math.min(r.width*.29,r.height*.23);const angle=-2.5;
    return {x:r.left+r.width*.5+Math.cos(angle)*unit*1.25,
      y:r.top+r.height*.59+Math.sin(angle)*unit*1.25*.82};})()`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 1, radiusY: 1 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(100);
  assert.equal(await evaluate('document.querySelector("[data-id=a1]").getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate('document.querySelector("[data-id=a1]").getBoundingClientRect().height >= 44'), true);
  assert.deepEqual(errors, [], 'no browser exceptions or failed application requests');
  console.log('PASS: history, disagreement, correction lineage, both clocks, user observations, phone layout and touch');
} finally {
  await writeFile(join(out, 'chrome.log'), log);
  for (const p of pending.values()) clearTimeout(p.timeout);
  socket?.close();
  const closed = chrome.pid && chrome.exitCode === null && chrome.signalCode === null ? once(chrome, 'exit') : Promise.resolve();
  chrome.kill('SIGTERM');
  await Promise.race([closed, delay(2000)]);
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
