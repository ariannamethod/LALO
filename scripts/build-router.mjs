import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = new URL('../vendor/wolfe/wolfe.c', import.meta.url);
const expected = 'dea0df2c4f81d64543b927e3f6e4d1a23bdf585500230a135f24a73f20529fda';
const target = `${root}build/lalo-router`, temporary = `${target}.${process.pid}.tmp`;
try {
  if (createHash('sha256').update(await readFile(source)).digest('hex') !== expected)
    throw new Error('WOLFE source differs from its recorded pin; review vendor/wolfe/README.md');
  await mkdir(`${root}build`, { recursive: true });
  const result = spawnSync(process.env.CC || 'cc', ['-O2', '-std=c99', '-Wall', '-Wextra', '-Wpedantic',
    fileURLToPath(source), '-o', temporary, '-lm'], { stdio: 'inherit', timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`C compiler exited ${result.status ?? result.signal}`);
  await rename(temporary, target);
  console.error('LALO router built: build/lalo-router (C99, libc, libm)');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await rm(temporary, { force: true }); }
