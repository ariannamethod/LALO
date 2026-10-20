// Transport for aml/wolfe.aml: WOLFE's selector JSON becomes tagged lines read_line() can carry.
// The conversion is 1:1 and adds no selection semantics. Schemas with arguments are refused:
// wolfe.aml ports the selection path only, so its tools must have empty parameter objects.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { selectorTools } from '../src/route.js';

const bytes = s => Buffer.byteLength(s);
const refuse = message => { throw Object.assign(new Error(message), { code: 'WOLFE_AML_PREP' }); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const line = (s, what) => {
  if (typeof s !== 'string' || !s.isWellFormed() || /[\n\r\0]/.test(s))
    refuse(`${what} must be well-formed text without LF, CR or NUL`);
  return s;
};
const schemaKeys = new Set(['type', 'properties', 'required', 'additionalProperties', 'description', 'title', '$schema']);

export function wolfePrep(tools, examplesText) {
  const list = Array.isArray(tools) ? tools : object(tools) && Array.isArray(tools.tools) ? tools.tools
    : refuse('tools must be a JSON array or an object containing tools');
  if (!list.length || list.length > 64) refuse('tool count must be 1..64');
  const names = new Set(), out = ['WOLFE-AML/1'];
  for (const item of list) {
    const t = object(item?.function) ? item.function : item;
    if (!object(t) || !line(t.name, 'tool name') || bytes(t.name) > 95 || names.has(t.name))
      refuse('tool requires a unique nonempty name under 96 bytes');
    names.add(t.name);
    const description = t.description === undefined ? '' : line(t.description, 'tool description');
    if (bytes(description) > 2047) refuse('tool description too long');
    const p = t.parameters ?? t.input_schema;
    if (p !== undefined && (!object(p) || p.type !== 'object' || Object.keys(p).some(k => !schemaKeys.has(k))
      || p.properties !== undefined && (!object(p.properties) || Object.keys(p.properties).length)
      || p.required !== undefined && (!Array.isArray(p.required) || p.required.length)))
      refuse(`tool ${t.name} declares arguments; wolfe.aml selects among argument-free tools only`);
    out.push(`N:${t.name}`, `D:${description}`);
  }
  let count = 0;
  for (const raw of examplesText.split('\n')) {
    if (!raw.trim()) continue;
    let e;
    try { e = JSON.parse(raw); } catch { refuse('example line is not JSON'); }
    if (!object(e) || !Object.hasOwn(e, 'tool') || e.tool !== null && !names.has(e.tool))
      refuse('each example requires tool (a declared name or null)');
    if (bytes(line(e.text, 'example text')) > 2047) refuse('example text too long');
    if (e.arguments !== undefined && (!object(e.arguments) || Object.keys(e.arguments).length))
      refuse('example arguments must be empty for wolfe.aml');
    out.push(`X:${e.tool ?? ''}`, `T:${e.text}`);
    count++;
  }
  if (!count) refuse('examples file is empty');
  out.push('END');
  return out.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), take = flag => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  try {
    const tools = take('--tools') ? JSON.parse(await readFile(take('--tools'), 'utf8')) : selectorTools();
    const examples = await readFile(take('--examples') ?? new URL('../router/examples.jsonl', import.meta.url), 'utf8');
    process.stdout.write(wolfePrep(tools, examples));
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
