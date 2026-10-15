// A local stdio process: stdout is JSON-RPC only. The journal is fixed at startup.
import { createToolHost, listTools, TOOL_BUDGET } from '../src/tools.js';
import { decodeJournal } from '../src/journal.js';
import { createMCPSession } from '../src/mcp.js';
import { boundedTextFile, jsonLines } from './io.mjs';

async function send(message) {
  // structuredContent plus its serialized text form fit within this wire budget.
  let text = JSON.stringify(message);
  if (Buffer.byteLength(text) > 262_144) text = JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null,
    error: { code: -32603, message: 'Response exceeds its 262144-byte transport budget' } });
  await new Promise((resolve, reject) => process.stdout.write(text + '\n', error => error ? reject(error) : resolve()));
}
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--definitions') {
    process.stdout.write(JSON.stringify(listTools(), null, 2) + '\n');
  } else {
    if (args.length !== 2 || args[0] !== '--journal') throw new Error('usage: node scripts/mcp.mjs --journal journal.json | --definitions');
    const world = decodeJournal(await boundedTextFile(args[1], TOOL_BUDGET.maxBytes), TOOL_BUDGET);
    const session = createMCPSession(createToolHost(world));
    console.error(`LALO MCP: ${world.size} receipts, fixed snapshot, stdio ready`);
    for await (const frame of jsonLines(process.stdin)) {
      let response;
      if (frame.error) response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: frame.error } };
      else {
        let request;
        try { request = JSON.parse(frame.text); }
        catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }; }
        if (!response) response = session.handle(request);
      }
      if (response) await send(response);
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
