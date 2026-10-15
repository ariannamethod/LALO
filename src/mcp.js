// MCP 2025-11-25 tools-only session. Transport and journal loading belong to the host.
export const MCP_VERSION = '2025-11-25';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idOK = id => typeof id === 'string' && id.length <= 128 || Number.isSafeInteger(id);
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
export function createMCPSession(host) {
  let phase = 'new';
  return { handle(message) {
    if (!object(message) || message.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid JSON-RPC message');
    const hasID = Object.hasOwn(message, 'id'), id = idOK(message.id) ? message.id : null;
    // This server sends no requests. Never answer a client response with another response.
    if (hasID && !Object.hasOwn(message, 'method') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) return null;
    if (typeof message.method !== 'string' || message.method.length > 128 || hasID && !idOK(message.id))
      return rpcError(null, -32600, 'Invalid request method or ID');
    const { method } = message, params = Object.hasOwn(message, 'params') ? message.params : {};
    if (!hasID) {
      if (method === 'notifications/initialized' && phase === 'initializing' && object(params)) phase = 'ready';
      return null;
    }
    const success = result => ({ jsonrpc: '2.0', id, result });
    if (!object(params)) return rpcError(id, -32602, 'params must be an object');
    if (method === 'ping') return success({});
    if (method === 'initialize') {
      if (phase !== 'new') return rpcError(id, -32600, 'Session is already initialized');
      if (typeof params.protocolVersion !== 'string' || !params.protocolVersion
        || !object(params.capabilities) || !object(params.clientInfo)
        || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string')
        return rpcError(id, -32602, 'initialize requires protocolVersion, capabilities and clientInfo');
      phase = 'initializing';
      return success({ protocolVersion: MCP_VERSION, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lalo', version: '0.1.0' },
        instructions: 'This session reads one fixed journal. Use lalo_status for receipt bounds, lalo_subjects to discover objects, then query with explicit Unix-millisecond clocks. Continue paged results with nextOffset and unchanged arguments. Start a new session to load a new journal.' });
    }
    if (phase !== 'ready') return rpcError(id, -32002, 'Initialize and send notifications/initialized before using tools');
    if (method === 'tools/list') {
      if (params.cursor !== undefined) return rpcError(id, -32602, 'This fixed tool list has no continuation cursor');
      return success({ tools: host.list().map(({ name, description, parameters }) => ({ name, description, inputSchema: parameters,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
    }
    if (method === 'tools/call') {
      if (typeof params.name !== 'string' || params.name.length > 128 || params.arguments !== undefined && !object(params.arguments)
        || params.task !== undefined) return rpcError(id, -32602, 'tools/call requires a name and object arguments; task execution is not offered');
      const result = host.call(params.name, params.arguments ?? {});
      if (!result.ok && result.error.code === 'UNKNOWN_TOOL') return rpcError(id, -32602, result.error.message);
      return success({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok });
    }
    return rpcError(id, -32601, 'Method is not available');
  } };
}
