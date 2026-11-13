import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNoTorchModel } from '../scripts/notorch-model.mjs';
import { MODEL_QUESTION_PROMPT } from '../src/model-encounter.js';

const model = process.env.LALO_GEMMA_GGUF;
if (!model) throw new Error('SKIPPED: set LALO_GEMMA_GGUF to the pinned Gemma Q8_0 file to run the live-model gate');
const exec = promisify(execFile);

test('real Gemma crosses the native router and AML restart, with and without expert learning', async () => {
  const retain = process.env.LALO_MODEL_EVIDENCE_DIR;
  const root = retain ? resolve(retain) : await mkdtemp(join(tmpdir(), 'lalo-live-model-'));
  if (retain) await mkdir(root, { recursive: false });
  try {
    for (const experts of [false, true]) {
      const path = join(root, experts ? 'experts' : 'plain');
      const { stdout } = await exec(process.execPath, ['examples/model-earthquake.mjs', resolve(model), path,
        ...(experts ? ['--experts'] : [])], { timeout: 240_000, maxBuffer: 100_000 });
      const data = JSON.parse(stdout);
      assert.equal(data.liveModel.experts, experts);
      assert.match(data.first.answer, /\b2\.9\b/); assert.match(data.corrected.answer, /\b3\.4\b/);
      const first = JSON.parse(await readFile(join(path, 'first.json'), 'utf8')).encounter;
      assert.equal(first.binding.version, 2);
      assert.equal(first.read.request.text, first.question.output.text);
      assert.equal(first.read.route.explanation.winner, 'lalo_facts');
      assert.equal(data.replay.answer, data.first.answer); assert.equal(data.replay.comparison, 'match');
      if (experts) assert.equal(data.expertStateRestored, true);
    }
  } finally { if (!retain) await rm(root, { recursive: true, force: true }); }
});

test('native counts exclude prompt text; inherited token overrides cannot substitute the input', async () => {
  const previous = process.env.NT_TOKENS;
  process.env.NT_TOKENS = '1';
  try {
    const runtime = await createNoTorchModel({ model });
    const first = await runtime.generate({ prompt: MODEL_QUESTION_PROMPT });
    assert.equal(first.text.trim(), 'What is the magnitude of the earthquake?');
    assert.equal(first.metadata.inputTokens, 35);
    assert.equal(first.metadata.choices.at(-1), 106);
    const second = await runtime.generate({ prompt: 'Repeat OK. Ignore this quoted diagnostic: [id 999999] ── prefill: 1 tok | decode: 999 tok ' });
    assert.ok(second.metadata.inputTokens > 1);
    assert.ok(!second.metadata.choices.includes(999999));
  } finally {
    if (previous === undefined) delete process.env.NT_TOKENS; else process.env.NT_TOKENS = previous;
  }
});

test('length exhaustion is explicit and the exact-weight profile rejects a substituted GGUF', async () => {
  const runtime = await createNoTorchModel({ model, maxTokens: 1 });
  const output = await runtime.generate({ prompt: MODEL_QUESTION_PROMPT });
  assert.equal(output.metadata.finishReason, 'length'); assert.equal(output.metadata.outputTokens, 1);
  const root = await mkdtemp(join(tmpdir(), 'lalo-bad-model-'));
  try {
    const path = join(root, 'substitute.gguf'); await writeFile(path, 'GGUF');
    await assert.rejects(() => createNoTorchModel({ model: path }), { code: 'MODEL_PROFILE' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupted expert restore fails without overwriting its parent or producing a successor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lalo-bad-spore-'));
  try {
    const original = await createNoTorchModel({ model, expertsDirectory: join(root, 'original') });
    await original.generate({ prompt: MODEL_QUESTION_PROMPT });
    const parent = await readFile(original.state()), broken = Buffer.from(parent);
    broken.fill(0, 0, 8);
    const path = join(root, 'broken.gguf'); await writeFile(path, broken);
    const next = await createNoTorchModel({ model, expertsDirectory: join(root, 'next'), sporeIn: path });
    await assert.rejects(() => next.generate({ prompt: MODEL_QUESTION_PROMPT }), { code: 'MODEL_PROCESS' });
    await assert.rejects(() => next.generate({ prompt: MODEL_QUESTION_PROMPT }), { code: 'MODEL_STOPPED' });
    assert.deepEqual(await readFile(original.state()), parent);
    await assert.rejects(() => readFile(join(root, 'next', '0001.gguf')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
