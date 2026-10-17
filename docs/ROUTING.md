# From intent to receipts

LALO's optional C body selects one of the six world tools. JavaScript supplies
the explicitly requested arguments, validates them through the tool host and
returns an action trace. It reads one fixed journal snapshot per session.

## Run

Node 24 and a C99 compiler with libc/libm are sufficient. No npm install,
checkpoint download or Python. The native gate currently runs on Linux x86_64.

```sh
node scripts/build-router.mjs
node examples/route.js
node --test tests/native-router.integration.mjs
```

The example creates three synthetic crossing reports. An intent selects
`lalo_reading`; the result is a contested conclusion with all three sources.
The build verifies the pinned C source hash and writes `build/lalo-router`.
`CC` may name another compiler executable. Generated binaries stay out of git.
The portable JS tests, browser fields and MCP host work without this build.

To query an exported or CLI-created journal:

```sh
node scripts/route.mjs --journal quakes.json < requests.jsonl > actions.jsonl
```

Each input line is exactly `{text,arguments}`. For example:

```json
{"text":"read journal status","arguments":{}}
{"text":"list known subjects","arguments":{"knownAt":1792101558171}}
{"text":"read active facts","arguments":{"subject":"usgs:example","validAt":1792101000000,"knownAt":1792101558171}}
```

These times and the event ID illustrate the shape; choose actual values from
your journal. `text` carries the tool intent only. **Every clock, filter, rule,
ID and page offset must be supplied in `arguments`. Nothing is extracted from
the prose.** Missing optional filters have the tool's documented unfiltered
meaning; prose cannot narrow them. Missing required values fail validation.

| Intent example | Selected tool |
| --- | --- |
| read journal status | lalo_status |
| list known subjects | lalo_subjects |
| read active facts | lalo_facts |
| read receipt history | lalo_history |
| trace revision lineage | lalo_lineage |
| read hypothesis | lalo_reading |

The initial corpus contains 35 English examples, including no-call examples.
The native field also derives examples from tool names/descriptions. Routing
is statistical: paraphrases can abstain or select incorrectly. The six examples
above and six held-out phrasings have executable tests; this is not a general
language benchmark. UTF-8 subjects and source strings travel unchanged in JSON.

## Action contract

Each stdout line has `format: "lalo/action"`, `version: 1` and:

- `request`: a detached copy of the explicit input.
- `route`: native status, routing `activation`, score meaning and compact
  field explanation (winner, evidence tokens, margin).
- `call`: selected name, explicit arguments and `argumentSource: "request.arguments"`.
- `result`: the unchanged world-tool result, including sources, revisions,
  both clocks, rule premises and evidence continuation offsets.
- `status`: `executed`, `tool_error`, `no_call`, `ambiguous`,
  `missing_arguments`, `invalid_request` or `router_error`.

Routing activation never changes a fact's value, reliability or rule outcome.
An abstention or ambiguous selection has null `call` and `result`. Unknown tool
names, multiple calls or model-generated arguments fail before execution.
Tool errors remain structured results; invalid requests and router failures
carry `error: {code,message}`. No implicit retry or fallback tool runs.
Follow result `nextOffset` with the same intent and arguments to retrieve the
next evidence page. A reading already uses all premises on its first page.

Action traces are returned to the caller. The CLI can save them by redirecting
stdout; they are not appended as world observations. Session metadata comes
from `lalo_status`. Diagnostics use stderr. EOF closes the native worker.

## Boundaries and budgets

`src/route.js` is portable and accepts a `router.route(text)` provider plus an
existing tool host. `scripts/native-router.mjs` owns the optional process and
temporary selector definitions. It starts the C field lazily, keeps it warm,
allows one in-flight request and requires `await router.close()` in a finally
block. Executable overrides are trusted host configuration, never request data.

| Limit | Bound |
| --- | --- |
| Intent | 2047 UTF-8 bytes, no NUL; native tokenizer at most 96 tokens |
| Request / input line | 32768 bytes |
| Native decision | 16384 bytes |
| Tool result | 65536 bytes, whole evidence rows |
| Complete action trace | 196608 bytes |
| In-flight native calls | 1; concurrent call returns ROUTER_BUSY |
| Native call deadline | 5000 ms including first-load work |
| Retained stderr | first 4096 bytes |

Timeout, invalid native framing or process failure stops that worker; restart
the session to recover. Oversized external JSONL frames are discarded through
the newline, and later frames can continue. Bad request lines do not change the
journal. The CLI's exit status describes transport/startup success; inspect
each trace status for request failures.

## Why explicit arguments first

A probe with the full tool schemas confused two numeric clock values and
sometimes omitted an unquoted colon-bearing subject. Treating that output as
a complete query could broaden its scope. The current selector schemas have
zero arguments, and only the explicit JSON object can cross into execution.
The public schemas in [TOOLS](TOOLS.md) remain complete.

The [pinned WOLFE source](../vendor/wolfe/README.md) remains unchanged for a
comparison baseline. No correction memory, automatic feedback, training or
network calls are enabled. Its numerical body has not yet moved to NoTorch,
and the C router has not been compiled to browser WASM or measured on a phone.
The browser gate checks the portable dispatcher using a synthetic decision;
the native gate exercises the actual neural field and real tool execution.

## Actions in the visual field

```sh
node scripts/build-router.mjs
node scripts/serve.mjs --router
```

Open `http://127.0.0.1:3000`. Both Crossing and USGS have an action field below
their time controls. Pick a starting point and press **Use current view** to
copy its explicit arguments. Review or edit the intent and JSON, then **Call
LALO**. Moving the world afterward never silently edits that JSON.

The panel shows selection activation, the executed call, rule reading and
returned receipts, plus the complete `lalo/action` JSON. Dotted outer rings
mark returned receipts in the current canvas; their buttons open the existing
source/lineage inspector. Rewinding, changing events or receiving new evidence
leaves the answer attached to its original snapshot and clears its markers.
A response arriving after the view moves has the same behavior. An edited
query with different clocks also has no markers in the current field.

**Next evidence page** sends the original snapshot and intent again with its
next offset. The unchanged native selector repeats its selection; each page
still computes the reading from all premises. It does not switch to the new
world while you page through an earlier answer. The panel holds only the
latest action, in memory, and labels that lifetime. Action traces never enter
the fact journal. The full trace exposes predicates not represented by canvas
nodes too.

The optional `POST /api/action` bridge binds only to `127.0.0.1`. It accepts
exactly `{journal, request}`; journal is the versioned JSON object, request is
`{text, arguments}`. It reads no caller-named files. Host and Origin must match
the actual loopback port; content type is `application/json`. Static serving
without `--router` retains its old behavior and returns an explicit unavailable
response for action calls. There is no eager native startup or action polling.

One request is admitted at a time, including body upload. Limits: 2,100,000
UTF-8 request bytes, five seconds to upload, existing 2 MB / 1024-record journal
budget, five-second native decision deadline and 196,608-byte trace limit.
The browser bounds response bytes and the whole call to twelve seconds. Each
HTTP call constructs its own immutable tool host from the submitted snapshot;
only the C selector stays warm. Closing the server stops that selector. Calls
are read-only; malformed uploads, busy state, unavailable C, abstention and
tool argument failures appear explicitly.
