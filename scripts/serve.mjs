import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
export async function serve({ port = 3000, host = '127.0.0.1' } = {}) {
  const server = createServer(async (req, res) => {
    try {
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
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await serve({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1' });
  console.log(`LALO: http://${server.address().address}:${server.address().port}`);
}
