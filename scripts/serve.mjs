import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { actionHandler } from './action-http.mjs';
import { actionMemory } from './action-memory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
export async function serve({ port = 3000, host = '127.0.0.1', router = false, routerFactory, memoryDirectory } = {}) {
  if (router && host !== '127.0.0.1') throw new Error('The native action host binds to 127.0.0.1');
  if (memoryDirectory !== undefined && !router) throw new Error('Action memory requires --router');
  const memory = memoryDirectory === undefined ? undefined : await actionMemory(memoryDirectory);
  if (memory) await memory.read(); // Reject damaged history before accepting another action.
  const actions = actionHandler({ enabled: router, routerFactory, memory });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/action') { await actions.handle(req, res); return; }
      if (req.url === '/api/memory') { await actions.handle(req, res, true); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, 'http://localhost');
      const route = decodeURIComponent(url.pathname);
      const path = resolve(root, '.' + (route === '/' ? '/web/index.html' : route));
      if (!['web', 'src'].some(dir => path.startsWith(resolve(root, dir) + sep)) || !mime[extname(path)]) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const content = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end('Unable to read resource');
    }
  });
  server.closeActions = () => actions.close();
  server.on('close', () => { void actions.close().catch(error => console.error(error.message)); });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); let router = false, memoryDirectory;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--router' && !router) router = true;
    else if (arg === '--memory' && memoryDirectory === undefined && args[0] && !args[0].startsWith('--')) memoryDirectory = args.shift();
    else throw new Error('Usage: node scripts/serve.mjs [--router [--memory DIRECTORY]]');
  }
  const server = await serve({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1',
    router, memoryDirectory });
  console.log(`LALO: http://${server.address().address}:${server.address().port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(); void server.closeActions().catch(error => { console.error(error.message); process.exitCode = 1; });
  });
}
