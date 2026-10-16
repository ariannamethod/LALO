// Portable execution boundary. Intent selects a tool; only explicit JSON supplies arguments.
import { listTools } from './tools.js';

export const ROUTE_BUDGET = Object.freeze({ maxTextBytes: 2047, maxRequestBytes: 32_768,
  maxDecisionBytes: 16_384, maxTraceBytes: 196_608, timeoutMs: 5000 });
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const bytes = v => new TextEncoder().encode(v).byteLength;
const copy = v => JSON.parse(JSON.stringify(v));
const fail = (code, message) => Object.assign(new Error(message), { code });
const names = new Set(listTools().map(t => t.name));

// These are selection heads, not the public tool schemas. The host validates real arguments.
export const selectorTools = () => listTools().map(({ name, description }) => ({ name, description,
  parameters: { type: 'object', properties: {}, additionalProperties: false } }));

export function routeRequest(input) {
  if (!object(input) || Object.keys(input).some(k => !['text', 'arguments'].includes(k))
    || !Object.hasOwn(input, 'text') || !Object.hasOwn(input, 'arguments'))
    throw fail('INVALID_REQUEST', 'Expected exactly text and arguments');
  if (typeof input.text !== 'string' || !input.text.trim() || !input.text.isWellFormed()
    || input.text.includes('\0') || bytes(input.text) > ROUTE_BUDGET.maxTextBytes)
    throw fail('INVALID_REQUEST', 'Intent must be nonblank UTF-8, without NUL, at most 2047 bytes');
  if (!object(input.arguments) || Object.values(input.arguments).some(v =>
    !['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v)
    || typeof v === 'string' && !v.isWellFormed()))
    throw fail('INVALID_REQUEST', 'Arguments must be an object of finite numbers, strings or booleans');
  if (bytes(JSON.stringify(input)) > ROUTE_BUDGET.maxRequestBytes)
    throw fail('INVALID_REQUEST', 'Request exceeds 32768 bytes');
  return copy(input);
}

function checkedDecision(value) {
  if (!object(value) || bytes(JSON.stringify(value)) > ROUTE_BUDGET.maxDecisionBytes)
    throw fail('INVALID_DECISION', 'Router decision is malformed or exceeds its byte budget');
  const d = copy(value);
  if (!['call', 'no_call', 'ambiguous', 'missing_arguments', 'error'].includes(d.status)
    || !Array.isArray(d.calls)) throw fail('INVALID_DECISION', 'Router status or calls are malformed');
  if (d.status === 'error') throw fail('ROUTER_FAILURE', String(d.error || 'Native router failed').slice(0, 400));
  if (typeof d.confidence !== 'number' || !Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1
    || !object(d.reasoning) || d.reasoning.mode !== 'neural')
    throw fail('INVALID_DECISION', 'Expected neural activation and its explanation');
  if (d.status === 'call') {
    if (d.calls.length !== 1 || !object(d.calls[0]) || !names.has(d.calls[0].name)
      || !object(d.calls[0].arguments) || Object.keys(d.calls[0].arguments).length
      || d.reasoning.winner !== d.calls[0].name
      || !Array.isArray(d.reasoning.arguments) || d.reasoning.arguments.length)
      throw fail('INVALID_DECISION', 'Selection must name one registered tool with no generated arguments');
  } else if (d.calls.length) throw fail('INVALID_DECISION', 'An abstaining router cannot carry calls');
  return d;
}

export function createRouteSession(host, router) {
  return Object.freeze({ async call(input) {
    const trace = { format: 'lalo/action', version: 1, status: 'invalid_request', request: null,
      route: null, call: null, result: null };
    try { trace.request = routeRequest(input); }
    catch (error) { return { ...trace, error: { code: 'INVALID_REQUEST', message: error.message.slice(0, 400) } }; }
    try {
      const d = checkedDecision(await router.route(trace.request.text));
      trace.route = { status: d.status, activation: d.confidence,
        scoreKind: 'routing activation, not factual reliability', explanation: d.reasoning };
      if (d.status !== 'call') { trace.status = d.status; return trace; }
      trace.call = { name: d.calls[0].name, arguments: copy(trace.request.arguments), argumentSource: 'request.arguments' };
      trace.result = host.call(trace.call.name, trace.call.arguments);
      trace.status = trace.result.ok ? 'executed' : 'tool_error';
      if (bytes(JSON.stringify(trace)) > ROUTE_BUDGET.maxTraceBytes)
        throw fail('TRACE_BUDGET', 'Action trace exceeds 196608 bytes');
      return trace;
    } catch (error) {
      return { ...trace, status: 'router_error', result: null,
        error: { code: error.code || 'ROUTER_FAILURE', message: String(error.message || error).slice(0, 400) } };
    }
  } });
}
