// Differential gate: the C oracle (vendor/wolfe, --batch --reasoning-compact) against aml/wolfe.aml.
// Per intent: status and winner must match; |confidence| and |margin| deltas stay within 1e-4.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectorTools } from '../src/route.js';
import { wolfePrep } from './wolfe-aml-prep.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const args = process.argv.slice(2), take = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i < 0 ? fallback : args[i + 1];
};
const corpusPath = take('--corpus', here('../tests/fixtures/wolfe-corpus.jsonl'));
const oracle = take('--oracle', here('../build/lalo-router'));
const aml = take('--aml', here('../deps/aml/runner/aml'));
const program = take('--program', here('../aml/wolfe.aml'));
const examplesPath = take('--examples', here('../router/examples.jsonl'));
const toolsPath = take('--tools');
const TOLERANCE = 1e-4;

function run(command, argv, input) {
  const started = process.hrtime.bigint();
  const r = spawnSync(command, argv, { input, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 600_000 });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (r.error) throw r.error;
  return { lines: r.stdout.split('\n').filter(Boolean), status: r.status, stderr: r.stderr.trim(), ms };
}

const texts = (await readFile(corpusPath, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l).text);
if (texts.some(t => typeof t !== 'string' || /[\n\r]/.test(t))) throw new Error('corpus texts must be single-line strings');
const tools = toolsPath ? JSON.parse(await readFile(toolsPath, 'utf8')) : selectorTools();
const examples = await readFile(examplesPath, 'utf8');
const dir = await mkdtemp(join(tmpdir(), 'wolfe-diff-'));
let c, a;
try {
  await writeFile(join(dir, 'tools.json'), JSON.stringify(tools));
  c = run(oracle, ['--tools', join(dir, 'tools.json'), '--examples', examplesPath, '--batch', '--reasoning-compact'],
    texts.map(text => JSON.stringify({ text })).join('\n') + '\n');
  a = run(aml, [program], wolfePrep(tools, examples) + texts.join('\n') + '\n');
} finally { await rm(dir, { recursive: true, force: true }); }
if (take('--save-oracle')) await writeFile(take('--save-oracle'), c.lines.join('\n') + '\n');
if (take('--save-aml')) await writeFile(take('--save-aml'), a.lines.join('\n') + '\n');

const fields = d => ({ status: d.status, winner: d.reasoning?.winner ?? null, confidence: d.confidence,
  margin: d.reasoning?.margin, evidence: JSON.stringify(d.reasoning?.evidence ?? null), error: d.error ?? null });
const misses = { status: 0, winner: 0, confidence: 0, margin: 0, error: 0, parse: 0 };
let passed = 0, evidence = 0, identical = 0, worstConfidence = 0, worstMargin = 0, oracleErrors = 0;
console.log('  #  status oracle/aml          winner oracle/aml                 dconf     dmargin   ev  intent');
texts.forEach((text, i) => {
  let o, m;
  try { o = fields(JSON.parse(c.lines[i])); m = fields(JSON.parse(a.lines[i])); }
  catch { misses.parse++; console.log(`${String(i + 1).padStart(3)}  PARSE  missing or invalid JSON line  ${text}`); return; }
  // An error line carries a message instead of activations; its message must match.
  const errored = o.status === 'error' || m.status === 'error';
  if (o.status === 'error') oracleErrors++;
  const dc = errored ? 0 : Math.abs(o.confidence - m.confidence), dm = errored ? 0 : Math.abs(o.margin - m.margin);
  const failed = [o.status !== m.status && 'status', o.winner !== m.winner && 'winner',
    !(dc <= TOLERANCE) && 'confidence', !(dm <= TOLERANCE) && 'margin', o.error !== m.error && 'error'].filter(Boolean);
  failed.forEach(name => misses[name]++);
  if (!failed.length) passed++;
  if (o.evidence === m.evidence) evidence++;
  if (c.lines[i] === a.lines[i]) identical++;
  worstConfidence = Math.max(worstConfidence, dc || 0); worstMargin = Math.max(worstMargin, dm || 0);
  console.log(`${String(i + 1).padStart(3)}  ${`${o.status}/${m.status}`.padEnd(24)} ${`${o.winner}/${m.winner}`.padEnd(33)}`
    + ` ${dc.toExponential(1).padEnd(9)} ${dm.toExponential(1).padEnd(9)} ${o.evidence === m.evidence ? 'eq' : 'NE'}  `
    + `${text}${failed.length ? `  FAIL ${failed.join(',')}` : ''}`);
});
console.log(`oracle ${c.lines.length} lines in ${c.ms.toFixed(0)} ms (exit ${c.status}); aml ${a.lines.length} lines in ${a.ms.toFixed(0)} ms (exit ${a.status})`);
if (a.stderr) console.log(`aml stderr: ${a.stderr.slice(0, 400)}`);
console.log(`decisions ${passed}/${texts.length}; evidence equal ${evidence}/${texts.length}; byte-identical lines ${identical}/${texts.length}; `
  + `max dconf ${worstConfidence.toExponential(2)}; max dmargin ${worstMargin.toExponential(2)}`);
// The oracle's batch exits 1 after any error line; the AML program keeps serving and exits 0.
const oracleExit = c.status === 0 || c.status === 1 && oracleErrors > 0;
const counts = c.lines.length === texts.length && a.lines.length === texts.length && oracleExit && a.status === 0;
const ok = counts && passed === texts.length;
console.log(ok ? `VERDICT PASS ${passed}/${texts.length}` : `VERDICT FAIL ${passed}/${texts.length}`
  + ` (status ${misses.status}, winner ${misses.winner}, confidence ${misses.confidence}, margin ${misses.margin},`
  + ` error ${misses.error}, parse ${misses.parse}${counts ? '' : ', line count or exit status'})`);
process.exitCode = ok ? 0 : 1;
