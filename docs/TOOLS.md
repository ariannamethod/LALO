# Call the world

LALO exposes six read tools over one fixed journal snapshot. The portable host
runs in JavaScript; the local MCP process connects it to a stdio client.

## Start a session

Create a journal with the USGS CLI or export one from the USGS field:

```sh
node scripts/usgs.mjs > quakes.json
node scripts/mcp.mjs --journal quakes.json
```

An MCP client launches the second command as a subprocess. Its launch fields
are `command: "node"` and `args: ["/absolute/path/LALO/scripts/mcp.mjs",
"--journal", "/absolute/path/quakes.json"]`. Absolute paths make the client's
working directory irrelevant. The process loads that file once. Restart it to
read a newer journal. It writes JSON-RPC messages to stdout and diagnostics to
stderr; closing stdin ends the session.

The transport implements MCP `2025-11-25` initialization, the initialized
notification, ping, tools/list and tools/call. It advertises a fixed tools
capability. Tool replies carry identical structured JSON and serialized text.
Source ingestion remains the explicit CLI or browser action.

## The six tools

All timestamps are safe-integer Unix milliseconds. `knownAt` limits receipt
time. `validAt` selects world time, with half-open `[validFrom, validTo)`
intervals. A superseded assertion stays superseded outside its replacement's
world interval. Null magnitude remains unknown.

| Tool | Required arguments | Result |
| --- | --- | --- |
| `lalo_status` | none | Snapshot size, first/latest receipt and budgets |
| `lalo_subjects` | `knownAt` | Known subjects, receipt counts and minimum/maximum origin times; optional `prefix` |
| `lalo_facts` | `knownAt`, `validAt` | Active facts; optional exact `subject`, `predicate`, `source` filters |
| `lalo_history` | `knownAt` | Receipt history including superseded facts; the same optional filters |
| `lalo_lineage` | `knownAt`, `id` | Original assertion through the requested known revision |
| `lalo_reading` | `knownAt`, `validAt`, `subject`, `predicate`, `rule` | Complete rule conclusion and paginated, classified premises |

`lalo_status` describes the whole loaded snapshot. The other tools apply the
requested receipt cutoff to all returned rows and counts. A future receipt ID
and an absent ID both return `NOT_FOUND` at that cutoff.

`lalo_reading` accepts `unanimous-boolean/v1` with optional `expected` (default
true), or `magnitude-at-least/v1` with predicate `magnitude` and optional
`threshold` (default 3). Parameters belonging to the other rule fail explicitly.
The visual field and tools execute the same rule implementations. Each evidence
row contains its role and the full fact, including ID, source and predecessor.
The reading includes premise counts and the intersection of their intervals.

## Pages and budgets

Every row-producing tool accepts `offset` (default 0) and `limit` (default 32,
maximum 64). A successful call returns `{ok:true,data:{items,total,offset,
nextOffset,complete,...}}`. Follow `nextOffset` with unchanged arguments in the
same session until `complete` is true. Receipt and lineage order is oldest
first; subjects are sorted by their JavaScript string order.

The host computes a reading from the complete active premise set before
paging its evidence. `data.complete` describes delivery of the evidence rows.
`data.reading` always describes all active premises, including opposing or
unknown ones outside the returned page.

Limits: 1024 journal records, 2,000,000 journal bytes, 65,536 bytes per tool
result and 32,768 argument bytes. A host can choose a smaller result budget
between 1024 and 65,536 bytes. Pagination stops at whole rows. A row that cannot
fit returns `RESULT_BUDGET`. The stdio host bounds input frames to 32,768 bytes
and output messages to 262,144 bytes, including the duplicated text result.
An oversized input frame is discarded through its newline; later frames can
continue. UTF-8, JSON and protocol errors are explicit.

Errors use `{ok:false,error:{code,message}}`. Codes include `UNKNOWN_TOOL`,
`INVALID_ARGUMENTS`, `NOT_FOUND`, `INVALID_PREMISES`, `RESULT_BUDGET` and
`TOOL_FAILURE`. MCP exposes unknown tools and malformed protocol requests as
JSON-RPC errors; tool validation and execution failures use `isError:true`.

## Direct JavaScript and router definitions

```js
import { createToolHost } from './src/tools.js';

const host = createToolHost(world); // a FactLedger; copied once for this session
const tools = host.list();         // name, description, parameters
const result = host.call('lalo_facts', {
  subject: 'quake:1', predicate: 'magnitude', validAt: 1000, knownAt: 1100,
});
```

Call arguments stay flat: strings, booleans, finite numbers and safe integers.
There is no argument coercion. Nonblank strings are bounded to 512 UTF-16 code
units, or 4096 for `source`. The descriptions state these text budgets; the
host validates them. Definitions retain the schema subset accepted by WOLFE:

```sh
node scripts/mcp.mjs --definitions > lalo-tools.json
```

A router's `{name,arguments}` call feeds directly into `host.call(name,
arguments)`. `--definitions` is a separate export command, outside an MCP
session. The WOLFE descendant named LALO will own routing; the world tools and
MCP transport are the working call boundary today.
