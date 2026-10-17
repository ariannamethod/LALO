import assert from 'node:assert/strict';

export async function checkActionField({ evaluate, call, shot, reload, kind }) {
  const value = expression => evaluate(expression);
  const click = id => value(`document.getElementById('${id}').click()`);
  const trace = () => value(`JSON.parse(document.querySelector('.action-raw pre').textContent)`);
  const markers = () => value(`JSON.parse(document.getElementById('field').dataset.actionIds || '[]')`);
  async function idle() {
    for (let i = 0; i < 200; i++) {
      if (await value(`document.getElementById('actions').dataset.busy === 'false'`)) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Action did not settle');
  }
  await click('action-fill');
  const args = await value(`JSON.parse(document.getElementById('action-args').value)`);
  assert.equal(args.rule, kind === 'crossing' ? 'unanimous-boolean/v1' : 'magnitude-at-least/v1');
  await value(`{const a=document.getElementById('action-args');const v=JSON.parse(a.value);v.limit=1;a.value=JSON.stringify(v,null,2)}`);
  await click('action-run'); await idle();
  let result = await trace();
  assert.equal(result.memory.state, 'saved');
  assert.equal(result.status, 'executed'); assert.equal(result.call.name, 'lalo_reading');
  assert.equal(result.result.data.reading.state, kind === 'crossing' ? 'contested' : 'supported');
  assert.equal(result.result.data.items.length, 1);
  const id = result.result.data.items[0].fact.id;
  assert.deepEqual(await markers(), [id]);
  await value(`document.querySelector('.action-receipts button').click()`);
  assert.ok((await value(`document.getElementById('inspector').textContent`)).includes(id));
  assert.equal(await value('document.documentElement.scrollWidth <= innerWidth'), true);
  await shot(`${kind}-action-phone`);
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await shot(`${kind}-action-desktop`);
  const originalArgs = await value(`document.getElementById('action-args').value`);
  await value(`{const k=document.getElementById('knowledge');k.value=k.min;k.dispatchEvent(new Event('input'))}`);
  assert.deepEqual(await markers(), []);
  assert.equal(await value(`document.getElementById('action-args').value`), originalArgs, 'rewind never edits an explicit request');
  assert.match(await value(`document.getElementById('action-scope').textContent`), /View changed/);
  assert.equal(await value(`document.querySelector('.action-receipts button').disabled`), true);
  if (kind === 'crossing') {
    await click('action-next'); await idle(); result = await trace();
    assert.equal(result.result.data.reading.premiseCount, 3);
    assert.equal(result.result.data.reading.state, 'contested');
    assert.equal(result.result.data.items[0].fact.id, 'b1');
    assert.deepEqual(await markers(), []);
    await click('action-next'); await idle(); result = await trace();
    assert.equal(result.result.data.items[0].fact.id, 'c1');
    assert.equal(await value(`document.getElementById('action-next').hidden`), true);
  }
  await click('present'); await click('action-fill');
  // Hold an actual response until the view has moved: a late answer retains its request's world.
  await value(`window.actionFetch=window.fetch;window.fetch=async(...a)=>{
    const response=await window.actionFetch(...a);
    if(a[0]==='/api/action')await new Promise(r=>{window.releaseAction=r});return response;
  }`);
  try {
    await click('action-run');
    for (let i = 0; i < 100 && !await value('Boolean(window.releaseAction)'); i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(await value('Boolean(window.releaseAction)'), true);
    await value(`{const k=document.getElementById('knowledge');k.value=k.min;k.dispatchEvent(new Event('input'))}`);
    await value('window.releaseAction()'); await idle();
    assert.deepEqual(await markers(), []);
    assert.match(await value(`document.getElementById('action-scope').textContent`), /View changed/);
  } finally { await value('window.fetch=window.actionFetch'); }
  await click('present');
  await value(`document.getElementById('action-intent').value='hello';document.getElementById('action-args').value='{}'`);
  await click('action-run'); await idle();
  assert.equal((await trace()).status, 'no_call'); assert.deepEqual(await markers(), []);
  await value(`document.getElementById('action-intent').value='read active facts'`);
  await click('action-run'); await idle();
  assert.equal((await trace()).status, 'tool_error'); assert.match(await value(`document.getElementById('action-status').textContent`), /Missing argument/);
  await value(`document.getElementById('action-args').value='{broken'`);
  await click('action-run');
  assert.match(await value(`document.getElementById('action-status').textContent`), /Request rejected/);
  await click('action-fill');
  await value(`{const a=document.getElementById('action-args');const v=JSON.parse(a.value);v.limit=1;a.value=JSON.stringify(v,null,2)}`);
  await click('action-run'); await idle();
  const saved = await trace(); assert.equal(saved.memory.state, 'saved');
  await reload();
  assert.equal(await value(`document.querySelector('.action-raw') === null`), true, 'reload does not execute or recall automatically');
  await click('action-recall'); await idle();
  const restored = await trace();
  assert.equal(restored.memory.state, 'recalled'); assert.equal(restored.memory.head, saved.memory.head);
  assert.deepEqual(restored.request, saved.request); assert.deepEqual(restored.result, saved.result);
  assert.deepEqual(await markers(), []);
  assert.equal(await value(`document.getElementById('action-next').hidden`), true);
  assert.match(await value(`document.getElementById('action-scope').textContent`), /Restored action/);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await value('document.documentElement.scrollWidth <= innerWidth'), true);
  await shot(`${kind}-memory-phone`);
  // Capture the actual live store; opening/reproducing history must leave it identical.
  const liveStore = `worldStore(indexedDB${kind === 'usgs' ? ",{key:'usgs-v1',maxBytes:2000000}" : ''})`;
  const liveBefore = await value(`(async()=>{const {worldStore}=await import('/web/storage.js');return JSON.stringify(await ${liveStore}.load())})()`);
  assert.notEqual(liveBefore, 'null');
  await click('action-world-open'); await idle();
  assert.match(await value(`document.getElementById('action-world-status').textContent`), /Original world opened/);
  assert.equal(await value(`document.getElementById('action-world').dataset.sequence`), String(saved.memory.sequence));
  const firstFact = await value(`JSON.parse(document.querySelector('#world-inspector pre').textContent)`);
  assert.ok(Number.isSafeInteger(firstFact.recordedAt)); assert.equal(typeof firstFact.source, 'string');
  await click('world-replay');
  assert.equal(await value(`document.getElementById('action-world').dataset.comparison`), 'match');
  let reproduced = await value(`JSON.parse(document.getElementById('world-replay-result').textContent)`);
  assert.deepEqual(reproduced.result, saved.result);
  const returned = reproduced.result.data.items[0].fact;
  assert.equal(await value(`document.querySelector('#world-replay-evidence button').dataset.id`), returned.id);
  await value(`document.querySelector('#world-replay-evidence button').click()`);
  assert.deepEqual(await value(`JSON.parse(document.querySelector('#world-inspector pre').textContent)`), returned);
  if (saved.result.data.nextOffset !== null) {
    await click('world-replay-next');
    reproduced = await value(`JSON.parse(document.getElementById('world-replay-result').textContent)`);
    assert.equal(reproduced.comparison, 'page');
    assert.equal(reproduced.result.data.reading.premiseCount, saved.result.data.reading.premiseCount);
    assert.equal(reproduced.call.arguments.knownAt, saved.call.arguments.knownAt);
    assert.equal(reproduced.call.arguments.validAt, saved.call.arguments.validAt);
  }
  const liveAfter = await value(`(async()=>{const {worldStore}=await import('/web/storage.js');return JSON.stringify(await ${liveStore}.load())})()`);
  assert.equal(liveAfter, liveBefore); assert.deepEqual(await markers(), []);
  assert.equal(await value('document.documentElement.scrollWidth <= innerWidth'), true);
  await shot(`${kind}-original-world-phone`);
  console.log(`PASS: ${kind} real C calls, explicit clocks, complete inference, evidence selection, fixed-snapshot paging, stale/late responses, abstention, argument failures, AML readback, original-world reproduction after reload and phone layout`);
}
