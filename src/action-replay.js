// Reproduce an already selected read against its original world, with no selector.
import { createToolHost, TOOL_BUDGET } from './tools.js';
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

export function createActionReplay(world, action) {
  if (action?.format !== 'lalo/action' || action.version !== 1) throw new TypeError('Expected a saved LALO action');
  const saved = copy(action), host = createToolHost(world);
  const canReplay = Boolean(saved.call && typeof saved.call.name === 'string' && saved.call.arguments && saved.result);
  return Object.freeze({ canReplay, read(offset) {
    if (!canReplay) throw new Error('This action did not select a tool call');
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > TOOL_BUDGET.capacity))
      throw new RangeError('Replay offset must be an integer within the snapshot budget');
    const args = { ...saved.call.arguments, ...(offset === undefined ? {} : { offset }) };
    const result = host.call(saved.call.name, args);
    return { format: 'lalo/action-replay', version: 1, call: { name: saved.call.name, arguments: args }, result,
      comparison: offset === undefined ? canonical(result) === canonical(saved.result) ? 'match' : 'changed' : 'page' };
  } });
}
