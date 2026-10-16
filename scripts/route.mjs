import { createToolHost, TOOL_BUDGET } from '../src/tools.js';
import { createRouteSession, ROUTE_BUDGET } from '../src/route.js';
import { decodeJournal } from '../src/journal.js';
import { boundedTextFile, jsonLines } from './io.mjs';
import { createNativeRouter } from './native-router.mjs';

let router;
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--journal') throw new Error('usage: node scripts/route.mjs --journal journal.json < requests.jsonl');
  const world = decodeJournal(await boundedTextFile(args[1], TOOL_BUDGET.maxBytes), TOOL_BUDGET);
  router = await createNativeRouter();
  const session = createRouteSession(createToolHost(world), router);
  console.error(`LALO: ${world.size} receipts, fixed snapshot; intents on stdin, action traces on stdout`);
  for await (const frame of jsonLines(process.stdin, ROUTE_BUDGET.maxRequestBytes)) {
    let response;
    try {
      if (frame.error) throw new Error(frame.error);
      const request = JSON.parse(frame.text);
      response = await session.call(request);
    } catch (error) { response = { format: 'lalo/action', version: 1, status: 'invalid_request',
      request: null, route: null, call: null, result: null, error: { code: 'INVALID_REQUEST', message: error.message.slice(0, 400) } }; }
    await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(response) + '\n',
      error => error ? reject(error) : resolve()));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await router?.close(); }
