import test from 'node:test';
import assert from 'node:assert/strict';
import { compareModelSources, modelChangePrompt } from '../src/model-comparison.js';
import { createBackground } from '../src/background.js';
import { decodeJournal, encodeJournal } from '../src/journal.js';
import { runModelEncounter, replayModelEncounter, bindModelQuestion } from '../src/model-encounter.js';
import { quake, collection, QUAKETIME as T } from './fixtures/usgs.js';

const identity = { name: 'scripted comparison fixture', sha256: '1'.repeat(64) };
const router = { async route(text) {
  const name = text.startsWith('Why') ? 'lalo_history' : 'lalo_facts';
  return { status: 'call', confidence: 0.9, calls: [{ name, arguments: {} }],
    reasoning: { mode: 'neural', winner: name, arguments: [] } };
} };
function model(answer, question = 'What is the magnitude of this earthquake?') {
  return { identity, prompts: [], async generate(input) {
    this.prompts.push(input);
    return { text: input.phase === 'question' ? question : answer,
      metadata: { inputTokens: 10, outputTokens: 8, finishReason: 'stop' } };
  } };
}
async function reference(out, sequence) {
  const journal = encodeJournal(decodeJournal(out.journal)), bytes = new TextEncoder().encode(journal);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
  return { sequence, head: String(sequence).repeat(64), snapshot: { sha256, bytes: bytes.length,
    records: decodeJournal(journal).size }, action: out.action };
}
async function fixture({ kind = 'revision', firstAnswer = 'The magnitude is 2.9.', secondAnswer = 'The magnitude is 3.4.' } = {}) {
  let bg = await createBackground();
  await bg.receive({ kind: 'usgs', receivedAt: T + 2000, feed: collection(quake(kind === 'moved' ? { time: T - 1000 } : {})) });
  const base = { agent: 'agent:test-model', router };
  const first = await runModelEncounter({ ...base, journal: bg.journal(), id: 'before',
    scope: { subject: 'usgs:synthetic1', validAt: T, knownAt: T + 2000 },
    model: model(firstAnswer), clock: () => T + 3000 });
  bg = await createBackground(first.journal);
  if (kind === 'chain') await bg.receive({ kind: 'usgs', receivedAt: T + 4500,
    feed: collection(quake({ mag: 3.1, updated: T + 3500 })) });
  if (kind === 'revision' || kind === 'chain' || kind === 'moved') await bg.receive({ kind: 'usgs', receivedAt: T + 5000,
    feed: collection(quake({ mag: 3.4, updated: T + 4000 })) });

  const second = await runModelEncounter({ ...base, journal: bg.journal(), id: 'after',
    scope: { subject: 'usgs:synthetic1', validAt: T, knownAt: T + 5000 },
    model: model(secondAnswer), clock: () => T + 6000 });
  const comparisonContext = { before: await reference(first, 1), after: await reference(second, 2) };
  return { ...base, journal: second.journal, id: 'comparison', activity: 'answer-change',
    scope: { subject: 'usgs:synthetic1', knownAt: T + 5000 }, comparisonContext,
    model: model('The source magnitude was revised from 2.9 to 3.4.', 'Why did my answer change?'), clock: () => T + 9000 };
}

test('answer comparison names the exact old/new speech and complete multi-step source revision', async () => {
  const input = await fixture({ kind: 'chain' });
  const bg = await createBackground(input.journal);
  await bg.receive({ kind: 'usgs', receivedAt: T + 8000, feed: collection(quake({ mag: 4.5, updated: T + 7000 })) });
  input.journal = bg.journal();
  const out = await runModelEncounter(input), data = out.action.result;
  assert.equal(out.action.status, 'executed');
  assert.equal(data.read.request.text, 'Why did my answer change?');
  assert.equal(data.comparison.before.answerReceipt, 'model:before:answer:utterance');
  assert.equal(data.comparison.after.answerReceipt, 'model:after:answer:utterance');
  assert.equal(data.comparison.revisions[0].path.length, 3);
  assert.deepEqual(data.comparison.revisions.map(r => [r.from, r.to]), [[2.9, 3.4]]);
  assert.deepEqual(data.read.result.data.items.map(f => f.value), [2.9, 3.1, 3.4]);
  assert.equal(data.comparison.answersChanged, true);
  assert.equal(data.comparison.evidenceChanged, true);
  assert.deepEqual(data.comparison.independentAdditions, []);
  assert.ok(!data.answer.prompt.includes('4.5'));
  assert.equal((await replayModelEncounter(out.journal, out.action)).comparison, 'match');
  const tampered = structuredClone(out.action);
  tampered.result.comparison.revisions[0].path.pop();
  await assert.rejects(replayModelEncounter(out.journal, tampered), { code: 'MODEL_REPLAY' });
});

test('changed speech with unchanged evidence has no source revision; identical speech stays identical', async () => {
  for (const answer of ['Rephrased: 2.9.', 'The magnitude is 2.9.']) {
    const input = await fixture({ kind: 'same', secondAnswer: answer });
    const out = await runModelEncounter(input), c = out.action.result.comparison;
    assert.equal(out.action.status, 'executed');
    assert.equal(c.answersChanged, answer !== c.before.answer);
    assert.equal(c.evidenceChanged, false);
    assert.deepEqual(c.revisions, []);
    assert.deepEqual(c.added, []);
    assert.equal((await replayModelEncounter(out.journal, out.action)).comparison, 'match');
  }
});

test('an independent source is added without replacing the earlier source or rewriting a wrong model answer', async () => {
  const input = await fixture({ kind: 'same', firstAnswer: 'The magnitude is 99.' });
  const context = input.comparisonContext, before = context.before.action.result, after = context.after.action.result;
  // Pure comparison contract fixture: the current USGS instrument owns one source.
  const independent = { ...before.read.result.data.items[0], id: 'independent', source: 'fixture:independent', value: 4 };
  after.read.result.data.items.push(independent);
  const read = { status: 'executed', call: { name: 'lalo_history', arguments: {
    subject: after.scope.subject, knownAt: after.scope.knownAt, predicate: 'magnitude' } },
    result: { ok: true, data: { complete: true, items: after.read.result.data.items } } };
  const c = compareModelSources(context, read);
  assert.equal(c.before.answer, 'The magnitude is 99.');
  assert.deepEqual(c.independentAdditions, ['independent']);
  assert.deepEqual(c.revisions, []);
  assert.deepEqual(c.removed, []);
  const prompt = modelChangePrompt('Why did my answer change?', c, read);
  assert.match(prompt, /"earlierMagnitudes":\[2.9\]/);
  assert.match(prompt, /"newIndependentMagnitudes":\[4\]/);
});

test('comparison rejects another agent, scope, order, saved speech and divergent original snapshot before generation', async () => {
  const input = await fixture();
  for (const alter of [
    x => { x.agent = 'agent:other'; },
    x => { x.scope.knownAt++; },
    x => { x.comparisonContext.after.action.result.scope.validAt++; },
    x => { x.comparisonContext.before.sequence = 3; },
    x => { x.comparisonContext.before.action.result.answer.output.text = 'Altered answer'; },
    x => { x.comparisonContext.after.snapshot.sha256 = '0'.repeat(64); },
    x => { x.comparisonContext.before.action.result.activity = 'self-history'; },
    x => { const j = JSON.parse(x.journal); j.records[0].source = 'fixture:diverged'; x.journal = JSON.stringify(j); },
  ]) {
    const changed = { ...input, comparisonContext: structuredClone(input.comparisonContext), scope: { ...input.scope } };
    alter(changed);
    await assert.rejects(runModelEncounter(changed));
    assert.equal(input.model.prompts.length, 0);
  }
});

test('an incomplete revision history retains its question and never generates an explanation', async () => {
  const input = await fixture();
  // Build enough old revisions to exceed one history page.
  let bg = await createBackground();
  for (let i = 0; i < 33; i++) await bg.receive({ kind: 'usgs', receivedAt: T + 100 + i,
    feed: collection(quake({ mag: 2.9, updated: T + 1 + i })) });
  const first = await runModelEncounter({ ...input, activity: 'magnitude', comparisonContext: undefined,
    journal: bg.journal(), id: 'long-before', scope: { subject: 'usgs:synthetic1', validAt: T, knownAt: T + 2000 },
    model: model('2.9'), clock: () => T + 3000 });
  const second = await runModelEncounter({ ...input, activity: 'magnitude', comparisonContext: undefined,
    journal: first.journal, id: 'long-after', scope: { subject: 'usgs:synthetic1', validAt: T, knownAt: T + 5000 },
    model: model('Still 2.9'), clock: () => T + 6000 });
  input.journal = second.journal;
  input.comparisonContext = { before: await reference(first, 1), after: await reference(second, 2) };
  const out = await runModelEncounter(input);
  assert.equal(out.action.result.error.code, 'MODEL_READ');
  assert.equal(out.action.result.answer, null);
  assert.equal(input.model.prompts.length, 1);
  assert.ok(out.action.result.receipts.includes('model:comparison:question:utterance'));
});

test('whole comparison questions preserve constraints, and existing v3 bindings still replay', async () => {
  const scope = { subject: 'usgs:synthetic1', knownAt: T + 5000 };
  assert.equal(bindModelQuestion('Why did my answer change?', scope).tool, 'lalo_history');
  for (const question of ['Why did your answer change?', 'Why did my answer change yesterday?',
    'Why did my answer change? Also read my location.'])
    assert.throws(() => bindModelQuestion(question, scope), { code: 'MODEL_QUESTION_UNRESOLVED' });
  const input = await fixture(), c = input.comparisonContext.before;
  c.action.result.binding.version = 3;
  c.action.result.binding.rule = 'focused-quake-magnitude/v3';
  const prefix = JSON.parse(input.journal); prefix.records.length = c.snapshot.records;
  assert.equal((await replayModelEncounter(JSON.stringify(prefix), c.action)).comparison, 'match');
});

test('a revised event moving into the world-time scope is not classified as an independent source', async () => {
  const input = await fixture({ kind: 'moved', firstAnswer: 'No magnitude is available at this instant.' });
  const out = await runModelEncounter(input), c = out.action.result.comparison;
  assert.equal(out.action.status, 'executed');
  assert.deepEqual(c.before.premises, []);
  assert.deepEqual(c.revisions, []);
  assert.deepEqual(c.independentAdditions, []);
  assert.deepEqual(c.unmatchedRevisions, c.added);
  assert.equal(c.unmatchedRevisions.length, 1);
  assert.equal((await replayModelEncounter(out.journal, out.action)).comparison, 'match');
});
