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
const replay = await child(['--memory', memoryPath, '--replay', String(first.memory.sequence)]);
await save('replay.json', replay);
assert.equal(replay.comparison, 'match');
assert.equal(replay.answer, first.encounter.answer.output.text);
assert.equal(replay.read.result.data.items[0].value, 2.9);
const summary = { syntheticSources: true, liveModel: first.encounter.identity, experts: Boolean(mode),
  first: { question: first.encounter.question.output.text, answer: first.encounter.answer.output.text, receipt: earlier.id },
  corrected: { question: second.encounter.question.output.text, answer: second.encounter.answer.output.text, receipt: later.id,
    supersedes: later.supersedes }, replay: { comparison: replay.comparison, answer: replay.answer },
  expertStateRestored: mode ? second.encounter.question.output.metadata.stateBefore === first.encounter.answer.output.metadata.stateAfter : null,
  memory: { first: first.memory, second: second.memory } };
await save('summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
