import { encodeJournal, decodeJournal, extendsJournal } from './journal.js';
import { RULE, MAGNITUDE_RULE } from './hypothesis.js';
import { readRule, readingTimeline } from './reading.js';
import { historyWindow, knownReceipt, receiptCalendar } from './janus-calendar.js';
import { calendarOrigins, DON_EDUARDO, isAgent } from './calendar-origin.js';

export const TOOL_BUDGET = Object.freeze({ capacity: 1024, maxBytes: 2_000_000,
  maxResultBytes: 65_536, maxPage: 64, maxArgumentBytes: 32_768 });
const timestamp = description => ({ type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER, description });
const name = description => ({ type: 'string', description: `${description} Nonblank; at most 512 UTF-16 code units.` });
const clocks = { knownAt: timestamp('Knowledge cutoff, integer Unix milliseconds; no receipt after this instant is visible.'),
  validAt: timestamp('World instant, integer Unix milliseconds; intervals are [validFrom, validTo).') };
const paging = { offset: { type: 'integer', minimum: 0, maximum: 1024, default: 0, description: 'Resume at nextOffset with the same arguments and session.' },
  limit: { type: 'integer', minimum: 1, maximum: 64, default: 32, description: 'Maximum rows; the byte budget may return fewer. Follow nextOffset.' } };
const filters = { subject: name('Exact subject.'), predicate: name('Exact predicate.'),
  source: { type: 'string', description: 'Exact source. Nonblank; at most 4096 UTF-16 code units.' } };
const define = (name, description, properties, required = []) => ({ name, description,
  parameters: { type: 'object', properties, required, additionalProperties: false } });
// Only flat primitive arguments: also accepted by the existing WOLFE schema subset.
const definitions = [
  define('lalo_status', 'Read fixed session metadata and budgets. Receipt bounds describe the complete loaded snapshot.', {}),
  define('lalo_subjects', 'Discover subjects known at a receipt cutoff, with receipt counts and world-time bounds. Includes historical assertions.',
    { knownAt: clocks.knownAt, prefix: name('Subject prefix.'), ...paging }, ['knownAt']),
  define('lalo_facts', 'Read active facts through both clocks, retaining source and predecessor IDs.',
    { ...clocks, ...filters, ...paging }, ['knownAt', 'validAt']),
  define('lalo_history', 'Read the append-only receipt history up to knownAt, including superseded assertions and their world intervals.',
    { knownAt: clocks.knownAt, ...filters,
      receivedFrom: timestamp('Inclusive lower bound on receipt time (recordedAt).'),
      receivedTo: timestamp('Exclusive upper bound on receipt time (recordedAt).'),
      occurredBefore: timestamp('Exclusive upper bound on occurrence time (validFrom).'), ...paging }, ['knownAt']),
  define('lalo_lineage', 'Follow a known receipt from its original assertion to the requested revision. Future and unknown IDs return NOT_FOUND.',
    { id: name('Receipt ID.'), knownAt: clocks.knownAt, ...paging }, ['id', 'knownAt']),
  define('lalo_reading', 'Evaluate a named rule over ALL active premises. Page through its evidence; the conclusion always uses the complete premise set. Boolean uses expected (default true); magnitude uses threshold (default 3) and predicate magnitude.',
    { ...clocks, subject: filters.subject, predicate: filters.predicate,
      sinceKnownAt: timestamp('Return the baseline reading at this receipt time and its changes through knownAt, inclusive.'),
      rule: { type: 'string', enum: [RULE, MAGNITUDE_RULE] }, expected: { type: 'boolean' }, threshold: { type: 'number' }, ...paging },
    ['knownAt', 'validAt', 'subject', 'predicate', 'rule']),
  define('lalo_calendar', 'Read JANUS calendar coordinates, the Hebrew and Gregorian dates and the exact elapsed time from occurrence to receipt.',
    { id: name('Receipt ID.'), knownAt: clocks.knownAt, originId: name('Optional one-read origin override.'),
      compareToId: name('Compare occurrence and receipt order with this second receipt at the same cutoff.'),
      agent: name('Agent whose stored origin applies. Defaults to agent:don-eduardo.'),
      chooseOrigin: { type: 'boolean', description: 'Propose this receipt as the agent’s fixed origin. Ingest the successful action in the background journal to record the choice.' } },
    ['id', 'knownAt']),
];
const compareTool = define('lalo_compare_reading', 'Compare an AML-saved reading with this journal at a new knowledge cutoff. The original world instant, rule and scope come from memory. Page the receipts that changed its evidence.',
  { sequence: { type: 'integer', minimum: 1, description: 'Saved action sequence.' }, head: name('Optional saved action SHA-256 head.'),
    knownAt: clocks.knownAt, ...paging }, ['sequence', 'knownAt']);
export const listTools = () => JSON.parse(JSON.stringify(definitions));
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const sameToolResult = (left, right) => canonical(left) === canonical(right);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function invalid(message) { throw new ToolError('INVALID_ARGUMENTS', message); }
// Reads that use JANUS load its C/WASM body on demand.
export const mapToolResult = (result, project) => result instanceof Promise ? result.then(project) : project(result);
function argumentsFor(tool, input) {
  if (!object(input)) invalid('arguments must be an object');
  const schema = tool.parameters, args = {};
  for (const key of Object.keys(input)) if (!Object.hasOwn(schema.properties, key)) invalid(`Unknown argument: ${key.slice(0, 80)}`);
  for (const key of schema.required) if (!Object.hasOwn(input, key)) invalid(`Missing argument: ${key}`);
  for (const [key, spec] of Object.entries(schema.properties)) {
    const value = Object.hasOwn(input, key) ? input[key] : spec.default;
    if (value === undefined && !Object.hasOwn(input, key)) continue;
    if (spec.type === 'integer' ? !Number.isSafeInteger(value)
      : spec.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value)
      : typeof value !== spec.type) invalid(`${key} must be ${spec.type}`);
    if (typeof value === 'string' && (!value.trim() || value.length > (key === 'source' ? 4096 : 512)))
      invalid(`${key} is empty or exceeds its text budget`);
    if (spec.minimum !== undefined && value < spec.minimum || spec.maximum !== undefined && value > spec.maximum)
      invalid(`${key} is outside its declared bounds`);
    if (spec.enum && !spec.enum.includes(value)) invalid(`${key} is not a supported value`);
    args[key] = value;
  }
  if (bytes(args) > TOOL_BUDGET.maxArgumentBytes) invalid('arguments exceed their byte budget');
  return args;
}

// Each host owns a fixed snapshot, so pagination and repeated calls cannot drift.
export function createToolHost(world, { maxResultBytes = TOOL_BUDGET.maxResultBytes, recall } = {}) {
  if (!Number.isSafeInteger(maxResultBytes) || maxResultBytes < 1024 || maxResultBytes > TOOL_BUDGET.maxResultBytes)
    throw new RangeError('result byte budget must be between 1024 and 65536');
  const ledger = decodeJournal(encodeJournal(world, TOOL_BUDGET), TOOL_BUDGET), all = ledger.entries();
  const registered = recall ? [...definitions, compareTool] : definitions;
  const known = at => all.filter(f => f.recordedAt <= at);
  const match = (f, a) => ['subject', 'predicate', 'source'].every(k => a[k] === undefined || f[k] === a[k]);
  function page(rows, args, extra = {}) {
    if (args.offset > rows.length) invalid('offset exceeds this result; keep the query and session unchanged');
    const data = { ...extra, items: [], total: rows.length, offset: args.offset, nextOffset: null, complete: false };
    const result = { ok: true, data };
    for (let i = args.offset; i < Math.min(rows.length, args.offset + args.limit); i++) {
      data.items.push(rows[i]);
      // Reserve the actual continuation fields when measuring the whole envelope.
      data.nextOffset = TOOL_BUDGET.capacity; data.complete = false;
      if (bytes(result) > maxResultBytes) { data.items.pop(); break; }
    }
    const end = args.offset + data.items.length;
    data.complete = end === rows.length; data.nextOffset = data.complete ? null : end;
    if (!data.items.length && !data.complete) throw new ToolError('RESULT_BUDGET', 'One result row exceeds the byte budget; request a larger host budget');
    return result;
  }
  async function compareSaved(a) {
    const { receipt, journal } = await recall({ sequence: a.sequence,
      ...(a.head === undefined ? {} : { head: a.head }), snapshot: true });
    const action = receipt.action;
    if (action.format !== 'lalo/action' || action.version !== 1 || action.status !== 'executed'
      || action.call?.name !== 'lalo_reading' || !action.result?.ok || !action.result.data?.reading)
      throw new ToolError('NOT_A_READING', 'Select a successful saved lalo_reading action');
    const original = decodeJournal(JSON.stringify(journal), TOOL_BUDGET);
    if (!extendsJournal(ledger, original))
      throw new ToolError('WORLD_DIVERGED', 'The current journal must contain the complete saved journal as its prefix');
    const args = action.call.arguments;
    const reproduced = await createToolHost(original).call('lalo_reading', args);
    if (!sameToolResult(reproduced, action.result))
      throw new ToolError('SAVED_READING_CHANGED', 'The original tool result could not be reproduced');
    const { rows, reading, timeline, comparison } = await readingTimeline(ledger,
      { ...args, sinceKnownAt: args.knownAt, knownAt: a.knownAt }, original);
    return page(rows, a, { savedReading: action.result.data.reading, reading, timeline,
      comparison: { sequence: receipt.sequence, head: receipt.head, snapshotSha256: receipt.snapshot.sha256, ...comparison } });
  }
  function execute(tool, a) {
    if (tool === 'lalo_compare_reading') return compareSaved(a);
    if (tool === 'lalo_status') return { ok: true, data: { snapshot: 'fixed for this host session', records: all.length,
      firstReceipt: all[0]?.recordedAt ?? null, latestReceipt: all.at(-1)?.recordedAt ?? null,
      limits: { ...TOOL_BUDGET, maxResultBytes } } };
    if (tool === 'lalo_subjects') {
      const subjects = new Map();
      for (const f of known(a.knownAt)) {
        if (a.prefix !== undefined && !f.subject.startsWith(a.prefix)) continue;
        const s = subjects.get(f.subject) || { subject: f.subject, receipts: 0, firstReceipt: f.recordedAt,
          latestReceipt: f.recordedAt, validFromMin: f.validFrom, validFromMax: f.validFrom };
        s.receipts++; s.latestReceipt = f.recordedAt;
        s.validFromMin = Math.min(s.validFromMin, f.validFrom); s.validFromMax = Math.max(s.validFromMax, f.validFrom);
        subjects.set(f.subject, s);
      }
      const rows = [...subjects.values()].sort((x, y) => x.subject < y.subject ? -1 : x.subject > y.subject ? 1 : 0);
      return page(rows, a, { knownAt: a.knownAt });
    }
    if (tool === 'lalo_facts') return page(ledger.asOf(a).filter(f => match(f, a)), a, { validAt: a.validAt, knownAt: a.knownAt });
    if (tool === 'lalo_history') {
      const candidates = known(a.knownAt).filter(f => match(f, a));
      if (a.receivedFrom === undefined && a.receivedTo === undefined && a.occurredBefore === undefined)
        return page(candidates, a, { knownAt: a.knownAt });
      return historyWindow(candidates, a).then(({ rows, window }) => page(rows, a, { knownAt: a.knownAt, window }));
    }
    if (tool === 'lalo_lineage') {
      if (!known(a.knownAt).some(f => f.id === a.id)) throw new ToolError('NOT_FOUND', 'Receipt is not known at this cutoff');
      return page(ledger.lineage(a.id), a, { id: a.id, knownAt: a.knownAt });
    }
    if (tool === 'lalo_calendar') {
      const agent = a.agent ?? DON_EDUARDO;
      if (!isAgent(agent)) invalid('agent must be agent:<identifier>');
      if (a.chooseOrigin && a.originId !== undefined) invalid('chooseOrigin and originId are mutually exclusive');
      if (a.chooseOrigin && a.compareToId !== undefined) invalid('chooseOrigin and compareToId are mutually exclusive');
      const fact = knownReceipt(all, a.id, a.knownAt);
      const other = a.compareToId === undefined ? undefined : knownReceipt(all, a.compareToId, a.knownAt);
      const saved = calendarOrigins(known(a.knownAt)).get(agent);
      if (a.chooseOrigin && saved) throw new ToolError('ORIGIN_ALREADY_SET', 'Agent already has a calendar origin');
      const explicit = a.originId === undefined ? null : knownReceipt(all, a.originId, a.knownAt);
      const choice = a.chooseOrigin || explicit ? undefined : saved?.choice;
      const anchor = a.chooseOrigin ? fact : explicit ?? saved?.anchor;
      return receiptCalendar(fact, anchor, choice, other).then(calendar => {
        if (calendar.error) throw new ToolError(calendar.error.code, calendar.error.message);
        const data = { knownAt: a.knownAt, calendar };
        if (a.chooseOrigin) data.originProposal = { agent, originId: fact.id };
        return { ok: true, data };
      });
    }
    if (a.rule === RULE && a.threshold !== undefined) invalid('threshold belongs to magnitude-at-least/v1');
    if (a.rule === MAGNITUDE_RULE && (a.expected !== undefined || a.predicate !== 'magnitude'))
      invalid('magnitude-at-least/v1 requires predicate magnitude and uses threshold, not expected');
    if (a.sinceKnownAt !== undefined)
      return readingTimeline(ledger, a).then(({ rows, reading, timeline }) => page(rows, a, { reading, timeline }));
    const { premises, evidence, summary } = readRule(ledger, a);
    return page(premises.map(id => evidence.get(id)), a, { reading: summary });
  }
  function checked(result) {
    if (bytes(result) > maxResultBytes) throw new ToolError('RESULT_BUDGET', 'Result exceeds the host byte budget');
    return JSON.parse(JSON.stringify(result));
  }
  const failed = error => ({ ok: false, error: { code: error?.code || 'TOOL_FAILURE',
    message: String(error?.message || 'Tool call failed').slice(0, 400) } });
  return Object.freeze({ list: () => JSON.parse(JSON.stringify(registered)), call(name, input = {}) {
    try {
      const tool = registered.find(t => t.name === name);
      if (!tool) throw new ToolError('UNKNOWN_TOOL', 'Tool is not registered');
      const args = argumentsFor(tool, input), result = execute(name, args);
      return result instanceof Promise ? result.then(checked).catch(failed) : checked(result);
    } catch (error) { return failed(error); }
  } });
}
