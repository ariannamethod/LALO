import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../deps/aml/', import.meta.url));
const pin = '8ebc1b7e9333dcf062fdc32d3e6f935efd6f2595';
let head;
try { head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
catch { throw new Error('Initialize the pinned language first: git submodule update --init deps/aml'); }
if (head !== pin) throw new Error(`AML must be at pinned commit ${pin}`);
execFileSync('make', ['-C', root, 'runner'], { stdio: 'inherit' });
console.log(`LALO action memory: AML ${pin}`);
