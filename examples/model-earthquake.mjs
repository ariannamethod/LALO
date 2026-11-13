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
  expertStateRestored: mode ? second.encounter.question.output.metadata.stateBefore === first.encounter.answer.output.metadata.stateAfter : null,
  memory: { first: first.memory, second: second.memory } };
await save('summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
