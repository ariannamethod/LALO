// Reproduce an already selected read against its original world, with no selector.
import { createToolHost, mapToolResult, sameToolResult, TOOL_BUDGET } from './tools.js';
const copy = value => JSON.parse(JSON.stringify(value));

export function createActionReplay(world, action) {
  if (action?.format !== 'lalo/action' || action.version !== 1) throw new TypeError('Expected a saved LALO action');
  const saved = copy(action), host = createToolHost(world);
  const canReplay = Boolean(saved.call && typeof saved.call.name === 'string' && saved.call.arguments && saved.result);
  return Object.freeze({ canReplay, read(offset) {
    if (!canReplay) throw new Error('This action did not select a tool call');
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > TOOL_BUDGET.capacity))
      throw new RangeError('Replay offset must be an integer within the snapshot budget');
    const args = { ...saved.call.arguments, ...(offset === undefined ? {} : { offset }) };
    return mapToolResult(host.call(saved.call.name, args), result => ({
      format: 'lalo/action-replay', version: 1, call: { name: saved.call.name, arguments: args }, result,
      comparison: offset === undefined ? sameToolResult(result, saved.result) ? 'match' : 'changed' : 'page',
    }));
  } });
}
