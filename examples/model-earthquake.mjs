// Real local Gemma, synthetic quake sources, native routing, separate processes.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackground } from '../src/background.js';
import { actionMemory } from '../scripts/action-memory.mjs';
import { quake, collection, QUAKETIME } from '../tests/fixtures/usgs.js';

const exec = promisify(execFile), cli = fileURLToPath(new URL('../scripts/model-encounter.mjs', import.meta.url));
const [modelPath, directory, mode, ...extra] = process.argv.slice(2);
if (!modelPath || !directory || extra.length || mode && mode !== '--experts')
  throw new Error('Usage: node examples/model-earthquake.mjs MODEL.gguf NEW_DIRECTORY [--experts]');
const root = resolve(directory), model = resolve(modelPath), memoryPath = join(root, 'memory');
await mkdir(root, { recursive: false, mode: 0o700 });
const save = (name, value) => writeFile(join(root, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx' });
async function child(args) {
  const { stdout } = await exec(process.execPath, [cli, ...args], { timeout: 240_000, maxBuffer: 400_000 });
  return JSON.parse(stdout);
}
let world = await createBackground();
await world.receive({ kind: 'usgs', receivedAt: QUAKETIME + 2000, feed: collection(quake()) });
await save('initial.json', world.journal());
await save('initial-scope.json', { subject: 'usgs:synthetic1', validAt: QUAKETIME, knownAt: QUAKETIME + 2000 });
const base = ['--model', model, '--memory', memoryPath];
const first = await child([...base, '--journal', join(root, 'initial.json'), '--scope', join(root, 'initial-scope.json'), '--id', 'first',
  ...(mode ? ['--experts-output', join(root, 'first-experts')] : [])]);
await save('first.json', first);
assert.equal(first.status, 'executed');
assert.equal(first.encounter.read.result.data.items[0].value, 2.9);
assert.match(first.encounter.answer.output.text, /\b2\.9\b/);
const memory = await actionMemory(memoryPath), initial = await memory.recall({ sequence: first.memory.sequence, snapshot: true });
world = await createBackground(JSON.stringify(initial.journal));
const receivedAt = Date.now();
await world.receive({ kind: 'usgs', receivedAt, feed: collection(quake({ mag: 3.4, updated: QUAKETIME + 4000 })) });
await save('corrected.json', world.journal());
await save('corrected-scope.json', { subject: 'usgs:synthetic1', validAt: QUAKETIME, knownAt: receivedAt });
const second = await child([...base, '--journal', join(root, 'corrected.json'), '--scope', join(root, 'corrected-scope.json'), '--id', 'corrected',
  ...(mode ? ['--experts-output', join(root, 'second-experts'), '--spore-in', first.expertState] : [])]);
await save('second.json', second);
assert.equal(second.status, 'executed');
const earlier = first.encounter.read.result.data.items[0], later = second.encounter.read.result.data.items[0];
assert.equal(later.value, 3.4); assert.equal(later.supersedes, earlier.id);
assert.match(second.encounter.answer.output.text, /\b3\.4\b/);
if (mode) assert.equal(second.encounter.question.output.metadata.stateBefore, first.encounter.answer.output.metadata.stateAfter);
let preceding = second;
const histories = {};
for (const activity of ['self-history', 'quake-history']) {
  const prior = await memory.recall({ sequence: preceding.memory.sequence, snapshot: true });
  await save(activity + '-world.json', JSON.stringify(prior.journal));
  await save(activity + '-scope.json', { subject: activity === 'self-history' ? 'agent:gemma-270m' : 'usgs:synthetic1',
    knownAt: activity === 'self-history' ? first.encounter.answer.observedAt : Date.now() });
  const encounter = await child([...base, '--journal', join(root, activity + '-world.json'),
    '--scope', join(root, activity + '-scope.json'), '--id', activity, '--activity', activity,
    ...(mode ? ['--experts-output', join(root, activity + '-experts'), '--spore-in', preceding.expertState] : [])]);
  await save(activity + '.json', encounter);
  assert.equal(encounter.status, 'executed');
  assert.equal(encounter.encounter.read.call.name, 'lalo_history');
  assert.equal(encounter.encounter.read.request.text, encounter.encounter.question.output.text);
  assert.match(encounter.encounter.answer.output.text, /\b2\.9\b/);
  if (activity === 'quake-history') {
    assert.match(encounter.encounter.answer.output.text, /2\.9[\s\S]*3\.4/);
    assert.doesNotMatch(encounter.encounter.answer.output.text, /decreas/i);
  }
  const evidence = encounter.encounter.read.result.data.items;
  if (activity === 'self-history') assert.deepEqual(evidence.map(f => f.id), [
    'model:first:question:utterance', 'model:first:answer:utterance']);
  else assert.deepEqual(evidence.map(f => f.value), [2.9, 3.4]);
  if (mode) assert.equal(encounter.encounter.question.output.metadata.stateBefore,
    preceding.encounter.answer.output.metadata.stateAfter);
  histories[activity] = { scope: encounter.encounter.scope, question: encounter.encounter.question.output.text,
    answer: encounter.encounter.answer.output.text,
    receipts: encounter.encounter.read.result.data.items.map(f => f.id) };
  const opened = await child(['--memory', memoryPath, '--replay', String(encounter.memory.sequence)]);
  assert.equal(opened.comparison, 'match');
  assert.equal(opened.answer, encounter.encounter.answer.output.text);
  preceding = encounter;
}
const comparisonWorld = await memory.recall({ sequence: preceding.memory.sequence, snapshot: true });
await save('comparison-world.json', comparisonWorld.journal);
await save('comparison-scope.json', { subject: second.encounter.scope.subject, knownAt: second.encounter.scope.knownAt });
const changed = await child([...base, '--journal', join(root, 'comparison-world.json'),
  '--scope', join(root, 'comparison-scope.json'), '--id', 'answer-change', '--activity', 'answer-change',
  '--compare-from', String(first.memory.sequence), '--compare-to', String(second.memory.sequence),
  ...(mode ? ['--experts-output', join(root, 'comparison-experts'), '--spore-in', preceding.expertState] : [])]);
await save('comparison.json', changed);
assert.equal(changed.status, 'executed');
assert.equal(changed.encounter.read.request.text, changed.encounter.question.output.text);
assert.equal(changed.encounter.read.call.name, 'lalo_history');
assert.deepEqual(changed.encounter.comparison.revisions.map(r => r.path), [[earlier.id, later.id]]);
assert.equal(changed.encounter.comparison.before.answer, first.encounter.answer.output.text);
assert.equal(changed.encounter.comparison.after.answer, second.encounter.answer.output.text);
assert.match(changed.encounter.answer.output.text, /2\.9[\s\S]*3\.4/);
assert.match(changed.encounter.answer.output.text, /updat|revis|chang/i);
assert.doesNotMatch(changed.encounter.answer.output.text, /decreas/i);
if (mode) assert.equal(changed.encounter.question.output.metadata.stateBefore,
  preceding.encounter.answer.output.metadata.stateAfter);
const comparisonReplay = await child(['--memory', memoryPath, '--replay', String(changed.memory.sequence)]);
await save('comparison-replay.json', comparisonReplay);
assert.equal(comparisonReplay.comparison, 'match');
assert.equal(comparisonReplay.answer, changed.encounter.answer.output.text);
assert.deepEqual(comparisonReplay.sourceComparison, changed.encounter.comparison);
// A second real read without any new source receipt is the negative control.
const stableWorld = await memory.recall({ sequence: changed.memory.sequence, snapshot: true });
await save('unchanged-world.json', stableWorld.journal);
await save('unchanged-scope.json', { ...second.encounter.scope, knownAt: Date.now() });
const repeated = await child([...base, '--journal', join(root, 'unchanged-world.json'),
  '--scope', join(root, 'unchanged-scope.json'), '--id', 'unchanged-source',
  ...(mode ? ['--experts-output', join(root, 'unchanged-experts'), '--spore-in', changed.expertState] : [])]);
await save('unchanged.json', repeated);
assert.equal(repeated.status, 'executed');
assert.deepEqual(repeated.encounter.read.result.data.items, second.encounter.read.result.data.items);
if (mode) assert.equal(repeated.encounter.question.output.metadata.stateBefore,
  changed.encounter.answer.output.metadata.stateAfter);
const repeatedWorld = await memory.recall({ sequence: repeated.memory.sequence, snapshot: true });
await save('stable-comparison-world.json', repeatedWorld.journal);
await save('stable-comparison-scope.json', { subject: repeated.encounter.scope.subject, knownAt: repeated.encounter.scope.knownAt });
const stable = await child([...base, '--journal', join(root, 'stable-comparison-world.json'),
  '--scope', join(root, 'stable-comparison-scope.json'), '--id', 'stable-comparison', '--activity', 'answer-change',
  '--compare-from', String(second.memory.sequence), '--compare-to', String(repeated.memory.sequence),
  ...(mode ? ['--experts-output', join(root, 'stable-comparison-experts'), '--spore-in', repeated.expertState] : [])]);
await save('stable-comparison.json', stable);
assert.equal(stable.status, 'executed');
assert.equal(stable.encounter.comparison.evidenceChanged, false);
assert.deepEqual(stable.encounter.comparison.revisions, []);
assert.equal(stable.encounter.comparison.answersChanged,
  second.encounter.answer.output.text !== repeated.encounter.answer.output.text);
if (stable.encounter.comparison.answersChanged) assert.match(stable.encounter.answer.output.text, /source did not change/i);
else {
  const text = stable.encounter.answer.output.text, quote = JSON.stringify(second.encounter.answer.output.text);
  // Exact Original/Later quotations of the same speech also show no change.
  const exactPair = /original/i.test(text) && /later/i.test(text) && text.split(quote).length - 1 === 2;
  assert.ok(/(?:same|unchanged|no change|nothing changed)/i.test(text) || exactPair,
    'Expected an unchanged result or the exact identical original/later quotations');
}
assert.doesNotMatch(stable.encounter.answer.output.text, /source (?:was |has |had )?(?:changed|revised|updated)|change in the source/i);
if (mode) assert.equal(stable.encounter.question.output.metadata.stateBefore,
  repeated.encounter.answer.output.metadata.stateAfter);
const stableReplay = await child(['--memory', memoryPath, '--replay', String(stable.memory.sequence)]);
await save('stable-comparison-replay.json', stableReplay);
assert.equal(stableReplay.comparison, 'match');
assert.equal(stableReplay.answer, stable.encounter.answer.output.text);
assert.deepEqual(stableReplay.sourceComparison, stable.encounter.comparison);
const replay = await child(['--memory', memoryPath, '--replay', String(first.memory.sequence)]);
await save('replay.json', replay);
assert.equal(replay.comparison, 'match');
assert.equal(replay.answer, first.encounter.answer.output.text);
assert.equal(replay.read.result.data.items[0].value, 2.9);
const summary = { syntheticSources: true, liveModel: first.encounter.identity, experts: Boolean(mode),
  first: { question: first.encounter.question.output.text, answer: first.encounter.answer.output.text, receipt: earlier.id },
  corrected: { question: second.encounter.question.output.text, answer: second.encounter.answer.output.text, receipt: later.id,
    supersedes: later.supersedes }, replay: { comparison: replay.comparison, answer: replay.answer },
  histories,
  comparison: { question: changed.encounter.question.output.text, answer: changed.encounter.answer.output.text,
    evidence: changed.encounter.comparison, replay: comparisonReplay.comparison },
  stableComparison: { answer: stable.encounter.answer.output.text, evidence: stable.encounter.comparison, replay: stableReplay.comparison },
  expertStateRestored: mode ? second.encounter.question.output.metadata.stateBefore === first.encounter.answer.output.metadata.stateAfter : null,
  memory: { first: first.memory, second: second.memory } };
await save('summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
