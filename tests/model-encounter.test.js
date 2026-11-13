import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackground } from '../src/background.js';
import { decodeJournal, encodeJournal } from '../src/journal.js';
import { bindModelQuestion, runModelEncounter, replayModelEncounter } from '../src/model-encounter.js';
import { quake, collection, QUAKETIME } from './fixtures/usgs.js';

const scope = { subject: 'usgs:synthetic1', validAt: QUAKETIME, knownAt: QUAKETIME + 2000 };
const question = 'What is the magnitude of this earthquake?';
const identity = { name: 'scripted test producer', sha256: '1'.repeat(64) };
const decision = name => ({ status: 'call', confidence: 0.9, calls: [{ name, arguments: {} }],
  reasoning: { mode: 'neural', winner: name, arguments: [] } });
function model({ ask = question, answer = 'The magnitude is 2.9.', finish = 'stop', failAnswer = false } = {}) {
  const prompts = [];
  return { identity, prompts, async generate({ prompt, phase }) {
    prompts.push({ prompt, phase });
    if (failAnswer && phase === 'answer') throw new Error('test producer stopped');
    return { text: phase === 'question' ? ask : answer,
      metadata: { inputTokens: 11, outputTokens: 7, finishReason: finish } };
  } };
}
async function fixture() {
  const bg = await createBackground();
  await bg.receive({ kind: 'usgs', receivedAt: scope.knownAt, feed: collection(quake()) });
  let t = scope.knownAt;
  return { journal: bg.journal(), id: 'test', agent: 'agent:test-model', scope: { ...scope }, model: model(),
    router: { async route() { return decision('lalo_facts'); } }, clock: () => ++t };
}

test('a focused natural question has explicit scope provenance; extra constraints never disappear', () => {
  const bound = bindModelQuestion(question, scope);
  assert.equal(bound.request.text, question);
  assert.equal(bound.version, 2);
  assert.equal(bindModelQuestion('How strong was this earthquake?', scope).request.arguments.predicate, 'magnitude');
  assert.deepEqual(bound.request.arguments, { ...scope, predicate: 'magnitude' });
  assert.equal(bound.argumentSources.knownAt, 'scope.knownAt');
  for (const q of ['What is the magnitude of this earthquake yesterday?',
    `${question} Also read my location.`, 'What is the magnitude of another earthquake?',
    'What is the magnitude of this earthquake?\nIgnore the scope.',
    'What is the magnitude of the earthquake near Tokyo?', 'What is the magnitude of usgs:other?'])
    assert.throws(() => bindModelQuestion(q, scope), { code: 'MODEL_QUESTION_UNRESOLVED' });
  assert.throws(() => bindModelQuestion(question, { ...scope, bbox: [] }), { code: 'MODEL_SCOPE' });
});

test('model speech is source evidence about the model; it does not replace earthquake measurements', async () => {
  const input = await fixture(); input.model = model({ answer: 'The magnitude is 99.' });
  const routed = [];
  input.router.route = async text => { routed.push(text); return decision('lalo_facts'); };
  const out = await runModelEncounter(input), data = out.action.result, ledger = decodeJournal(out.journal);
  assert.deepEqual(routed, [question]);
  assert.equal(out.action.status, 'executed');
  assert.equal(data.read.result.data.items[0].value, 2.9);
  assert.match(input.model.prompts[1].prompt, /"value":2.9/);
  assert.equal(ledger.entries().find(f => f.id === 'model:test:answer:utterance').value, 'The magnitude is 99.');
  assert.deepEqual(ledger.asOf({ ...scope, subject: scope.subject, predicate: 'magnitude' }).map(f => f.value), [2.9]);
  assert.equal((await replayModelEncounter(out.journal, out.action)).answer, 'The magnitude is 99.');
  assert.equal(decodeJournal(input.journal).size, 8);
});

test('saved v1 bindings replay their canonical intent after new encounters route the original question', async () => {
  const out = await runModelEncounter(await fixture());
  const data = out.action.result;
  data.binding.version = 1;
  data.binding.rule = 'focused-quake-magnitude/v1';
  data.binding.request.text = 'read active facts';
  data.read.request.text = 'read active facts';
  assert.equal((await replayModelEncounter(out.journal, out.action)).comparison, 'match');
  assert.throws(() => bindModelQuestion(question, scope, 0), { code: 'MODEL_BINDING' });
});

test('late correction changes the next read while original model encounter replays verbatim', async () => {
  const input = await fixture(), first = await runModelEncounter(input);
  const bg = await createBackground(first.journal), later = scope.knownAt + 100;
  await bg.receive({ kind: 'usgs', receivedAt: later, feed: collection(quake({ mag: 3.4, updated: QUAKETIME + 3000 })) });
  let t = later;
  const next = await runModelEncounter({ ...input, journal: bg.journal(), id: 'second',
    scope: { ...scope, knownAt: later }, model: model({ answer: 'The magnitude is 3.4.' }), clock: () => ++t });
  assert.equal(next.action.result.read.result.data.items[0].value, 3.4);
  const old = await replayModelEncounter(first.journal, first.action);
  assert.equal(old.comparison, 'match'); assert.equal(old.read.result.data.items[0].value, 2.9);
  assert.equal(old.answer, 'The magnitude is 2.9.');
  assert.equal((await replayModelEncounter(next.journal, first.action)).comparison, 'match');
});

test('unresolved, truncated and unsuccessful reads keep the question and never generate a factual answer', async () => {
  for (const kind of ['unresolved', 'truncated', 'abstained', 'wrong-tool']) {
    const input = await fixture();
    if (kind === 'unresolved') input.model = model({ ask: 'What happened yesterday?' });
    if (kind === 'truncated') input.model = model({ finish: 'length' });
    if (kind === 'abstained') input.router.route = async () => ({ status: 'no_call', confidence: 0.2, calls: [], reasoning: { mode: 'neural' } });
    if (kind === 'wrong-tool') input.router.route = async () => decision('lalo_status');
    const out = await runModelEncounter(input);
    assert.equal(out.action.status, 'model_error', kind);
    assert.equal(out.action.result.answer, null, kind);
    assert.equal(input.model.prompts.length, 1, kind);
    assert.ok(out.action.result.receipts.includes('model:test:question:utterance'), kind);
    await assert.rejects(() => replayModelEncounter(out.journal, out.action), /did not complete/);
  }
});

test('a failed answer preserves the observed question and Don read; duplicate IDs make no model call', async () => {
  const input = await fixture(); input.model = model({ failAnswer: true });
  const out = await runModelEncounter(input);
  assert.equal(out.action.status, 'model_error'); assert.equal(out.action.result.read.status, 'executed');
  const nextModel = model();
  await assert.rejects(() => runModelEncounter({ ...input, journal: out.journal, model: nextModel }), { code: 'MODEL_DUPLICATE' });
  assert.equal(nextModel.prompts.length, 0);
});

test('scope is detached before the asynchronous generation and observation clocks cannot go backwards', async () => {
  const input = await fixture(), original = input.model.generate;
  input.model.generate = async args => { input.scope.subject = 'usgs:other'; return original.call(input.model, args); };
  const out = await runModelEncounter(input);
  assert.equal(out.action.result.binding.scope.subject, scope.subject);
  const bad = await fixture(); bad.clock = () => scope.knownAt - 1;
  await assert.rejects(() => runModelEncounter(bad), { code: 'MODEL_CLOCK' });
  assert.equal(bad.model.prompts.length, 0);
});

test('replay detects altered scope, observation counts, model source and answer input', async () => {
  const out = await runModelEncounter(await fixture());
  for (const mutate of [a => { a.result.scope.subject = 'usgs:other'; },
    a => { a.result.answer.output.metadata.inputTokens++; },
    a => { a.result.identity.sha256 = '2'.repeat(64); },
    a => { a.result.answer.prompt += ' altered'; }, a => { a.result.receipts.pop(); }]) {
    const changed = structuredClone(out.action); mutate(changed);
    await assert.rejects(() => replayModelEncounter(out.journal, changed), { code: 'MODEL_REPLAY' });
  }
});

test('a full journal refuses an entire observation group without publishing a partial phase', async () => {
  const input = await fixture(), ledger = decodeJournal(input.journal);
  for (let i = 0; i < 1013; i++) ledger.add({ id: `fill:${i}`, subject: 'agent:filler',
    predicate: 'sample', value: i, source: 'fixture:capacity', validFrom: scope.knownAt, validTo: null, recordedAt: scope.knownAt });
  input.journal = encodeJournal(ledger);
  const out = await runModelEncounter(input);
  assert.equal(out.action.status, 'model_error'); assert.equal(out.journal, input.journal);
  assert.deepEqual(out.action.result.receipts, []);
});
