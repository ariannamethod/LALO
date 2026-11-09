import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the parity gate fails when a selector drops a call or changes the evidence behind it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lalo-parity-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const oracle = join(dir, 'oracle'), aml = join(dir, 'aml'), corpus = join(dir, 'corpus');
  await writeFile(corpus, JSON.stringify({ text: 'read active facts' }) + '\n');
  const good = { status: 'call', calls: [{ name: 'lalo_facts', arguments: {} }], confidence: 0.9,
    reasoning: { winner: 'lalo_facts', margin: 0.8, evidence: ['facts'] } };
  const emit = (file, output) => writeFile(file,
    `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(JSON.stringify(output))}));\n`,
    { mode: 0o700 });
  await emit(oracle, good);
  for (const [decision, outcome] of [[good, 0], [{ ...good, calls: [] }, 1],
    [{ ...good, reasoning: { ...good.reasoning, evidence: ['lineage'] } }, 1]]) {
    await emit(aml, decision);
    const result = spawnSync(process.execPath, ['scripts/wolfe-diff.mjs', '--corpus', corpus, '--oracle', oracle, '--aml', aml],
      { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, outcome, result.stdout + result.stderr);
  }
});
