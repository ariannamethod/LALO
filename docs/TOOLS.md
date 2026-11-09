# Call the world

LALO exposes seven read tools over one fixed journal snapshot. The portable host
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

## Tools

All timestamps are safe-integer Unix milliseconds. `knownAt` limits receipt
time. `validAt` selects world time, with half-open `[validFrom, validTo)`
intervals. A superseded assertion stays superseded outside its replacement's
world interval. Null magnitude remains unknown.

| Tool | Required arguments | Result |
| --- | --- | --- |
| `lalo_status` | none | Snapshot size, first/latest receipt and budgets |
| `lalo_subjects` | `knownAt` | Known subjects, receipt counts and minimum/maximum origin times; optional `prefix` |
| `lalo_facts` | `knownAt`, `validAt` | Active facts; optional exact `subject`, `predicate`, `source` filters |
| `lalo_history` | `knownAt` | Receipt history including corrections, with optional subject, predicate, source and time filters |
| `lalo_lineage` | `knownAt`, `id` | Original assertion through the requested known revision |
| `lalo_calendar` | `knownAt`, `id` | JANUS coordinates and personal origin. Optional `compareToId` compares two receipts on both clocks. |
| `lalo_reading` | `knownAt`, `validAt`, `subject`, `predicate`, `rule` | Complete rule conclusion and paginated evidence, with optional revision history |

`lalo_status` describes the whole loaded snapshot. The other tools apply the
requested receipt cutoff to all returned rows and counts. A future receipt ID
and an absent ID both return `NOT_FOUND` at that cutoff.

Use `await host.call('lalo_calendar', { id, knownAt, originId })` in JavaScript.
Plain history and single-cutoff readings return synchronously. Calendar calls,
filtered history and reading timelines load the local JANUS WASM on demand.
Generic clients can await every call. The calendar result includes the source assertion, both POSIX instants, the signed
receipt lag, the occurrence's UTC civil view and the WASM SHA-256. The UTC
midnight policy applies to the civil date. The JANUS epoch turns over at noon.
After the background receiver records an origin for `agent` (default
`agent:don-eduardo`), subsequent calendar calls return AML's subject view and
`calendar.originChoice`, the receipt for the choice. The tool reads a fixed
snapshot. Open the updated journal to see a newly recorded choice. A supplied
`originId` uses another known receipt for this read. A call with
`chooseOrigin: true` proposes the named `id` and returns `data.originProposal`.
Pass the executed trace to the background receiver to record it.
[Recording a calendar origin](BACKGROUND.md#personal-calendar-origin).
`CALENDAR_RANGE` identifies an unsupported coordinate and
`CALENDAR_UNAVAILABLE` identifies an unavailable local runtime.

For two named revisions, supply both IDs in the same call.

```js
const result = await host.call('lalo_calendar', { id: 'tuesday', compareToId: 'thursday', knownAt });
```

Both receipts must be visible at `knownAt`, including previously superseded
revisions named explicitly. The result keeps the first assertion at
`data.calendar.assertion` and the second at `data.calendar.comparison.assertion`.
The comparison has two independent readings.

| Field | Moments compared |
| --- | --- |
| `comparison.occurrence` | The assertions’ `validFrom` timestamps |
| `comparison.receipt` | The assertions’ `recordedAt` timestamps |

Each reading returns AML's `order` (−1 for left before right, 0 for a tie,
+1 for left after right) and signed `delta` (right minus left, in POSIX days,
seconds and milliseconds). If Tuesday's report arrives on Friday and Thursday's
on Thursday, the order for Tuesday versus Thursday is −1 on occurrence and
+1 on receipt. A comparison uses the usual personal origin for the primary
reading. Choosing a new origin takes a separate action. A pair read adds no
single-subject attention receipt to the background.

In the action panel, select **Compare occurrence and receipt order**, pick the
second receipt and use the current view to fill the request. The saved action
can be reproduced on its original world. Run the same example directly in AML
with `deps/aml/runner/aml examples/receipt-order.aml` after building the runner.

`lalo_reading` accepts `unanimous-boolean/v1` with optional `expected` (default
true), or `magnitude-at-least/v1` with predicate `magnitude` and optional
`threshold` (default 3). Parameters belonging to the other rule fail explicitly.
The visual field and tools execute the same rule implementations. Each evidence
row contains its role and the full fact, including ID, source and predecessor.
The reading includes premise counts and the intersection of their intervals.

## Follow revisions of one conclusion

Add `sinceKnownAt` to `lalo_reading` to start with what Don knew at that instant.
JANUS selects later receipt instants through `knownAt`, including its endpoint.
The world instant, subject, predicate, rule and expected value or threshold
stay fixed. In the crossing and earthquake views, **What changed this reading?**
seeds the baseline from the first known receipt for the selected predicate.
Both receipt cutoffs are editable UTC Unix milliseconds in JANUS years 1–9999.

```js
const result = await host.call('lalo_reading', {
  subject: 'fixture:crossing', predicate: 'open', rule: 'unanimous-boolean/v1',
  validAt: Date.UTC(2026, 10, 3, 12),
  sinceKnownAt: Date.UTC(2026, 10, 5, 23, 59, 59, 999),
  knownAt: Date.UTC(2026, 10, 7),
});
```

In the late-reports fixture the baseline is supported by `original`. The
Friday receipt `correction` contradicts it. The Saturday receipt
`saturday-update` replaces the correction and supports the reading again.

* `data.timeline` gives the baseline state, time, change count and JANUS
  version and digest. An empty baseline is `unsettled` with zero baseline rows.
  Equal cutoffs return only the baseline. `data.reading` gives the complete
  conclusion at the closing cutoff.
* Evidence rows at step zero contain the active baseline facts. Each later
  row names the incoming fact, its role, and the removed role if its
  `supersedes` displaced an active premise. A correction that withdraws a
  premise by moving its world interval has a null incoming role.
* All rows with the same step describe one atomic receipt instant. A
  `verdict` step changes the conclusion. An `evidence` step changes the
  premises while preserving that conclusion. Pages can split the receipts
  for a step. The step number and complete verdict stay the same on each page.

## Find reports by receipt and occurrence time

All three time filters on `lalo_history` are optional. Times are integer Unix
milliseconds. For example, find reports received on Friday, November 6, 2026
UTC about events before that day:

```js
const friday = Date.UTC(2026, 10, 6), saturday = Date.UTC(2026, 10, 7);
const result = await host.call('lalo_history', {
  knownAt: saturday, receivedFrom: friday, receivedTo: saturday, occurredBefore: friday
});
```

| Argument | Match |
| --- | --- |
| `knownAt` (required) | Only receipts already recorded at this instant, inclusive |
| `receivedFrom` | Receipt time at or after this instant |
| `receivedTo` | Receipt time strictly before this instant |
| `occurredBefore` | The revision's `validFrom` is strictly before this instant |

Equal receipt bounds describe an empty interval. Reversed bounds return
`INVALID_ARGUMENTS`. A later correction has its own receipt time and names
its predecessor in `supersedes`. Earlier revisions stay searchable. A rewind
to Thursday can still find the original report even after Friday's correction.

Subject, predicate, source and knowledge filters narrow the candidates before
JANUS evaluates the requested clocks. Bounds and clocks evaluated by JANUS
use Gregorian years 1–9999. Outside that range the call returns
`CALENDAR_RANGE`. Results use the usual ledger order, counts and pagination.
Filtered pages include the requested bounds, JANUS API and WASM digest in
`data.window`. A plain history read works without loading AML.

In the action panel, **Late reports since the world clock** uses the displayed
world time for `receivedFrom` and `occurredBefore`, and the displayed
knowledge cutoff for `knownAt`. Edit the explicit arguments to set a different
window. Run the synthetic Friday example in the native interpreter with
`deps/aml/runner/aml examples/history-window.aml`.

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
session. LALO's optional native selector now connects to this host through the
[routing boundary](ROUTING.md). It chooses intent; explicit JSON supplies the
tool arguments. The MCP client can still choose and call these tools directly.
