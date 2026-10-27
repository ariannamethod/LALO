import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../deps/aml/', import.meta.url));
const pin = 'b932a09b7d38e2a9de9bbbcbb46cf568ae306411';
let head;
try { head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
catch { throw new Error('Initialize the pinned language first: git submodule update --init deps/aml'); }
if (head !== pin) throw new Error(`AML must be at pinned commit ${pin}`);
execFileSync('make', ['-C', root, 'runner'], { stdio: 'inherit' });
console.log(`LALO action memory: AML ${pin}`);
