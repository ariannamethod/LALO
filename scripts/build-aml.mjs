import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const aml = fileURLToPath(new URL('../deps/aml/', import.meta.url));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const pin = git(root, 'rev-parse', ':deps/aml');
let head;
try { head = git(aml, 'rev-parse', 'HEAD'); } catch {}
if (head !== pin) throw new Error(`Expected AML ${pin}. Run git submodule update --init deps/aml`);
execFileSync('make', ['-C', aml, 'runner'], { stdio: 'inherit' });
console.log(`LALO action memory: AML ${pin}`);
