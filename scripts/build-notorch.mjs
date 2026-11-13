import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const native = fileURLToPath(new URL('../deps/notorch/', import.meta.url));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pin = git(root, 'rev-parse', ':deps/notorch');
let head;
try { head = git(native, 'rev-parse', 'HEAD'); } catch {}
if (head !== pin) throw new Error(`Expected NoTorch ${pin}. Run git submodule update --init deps/notorch`);
execFileSync('make', ['-C', native, 'harness', 'BLAS_FLAGS=', 'BLAS_LIBS=', 'BLAS_NAME=native'], { stdio: 'inherit' });
console.log(`LALO optional model runtime: NoTorch ${pin}`);
