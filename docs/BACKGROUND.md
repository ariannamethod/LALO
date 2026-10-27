# Don Eduardo's event background

English splits one Russian word in two: tool and instrument. LALO takes the
second. Don Eduardo plays instruments, and the event background is the world
in which they resonate. The seismometer keeps sounding while no model is
listening. A device fix, a kept camera frame and Don's own reads land in the
same world, under the same two clocks. The context a model receives is one
bounded reading of that world, chosen fresh each time. Don is inside it: what
he reads becomes a receipt about him, and that receipt shapes what reaches him
next.

The portable boundary has no network, timer, native process or ambient clock:

- `src/background.js`: one door, `receive(frame)`, for every instrument. Each
  instrument owns its receipts and validates them with its own source adapter.
- `src/background-context.js`: select by an explicit request and replay a saved
  selection under the versioned `usgs-attention-receipt/v2` policy.
- `scripts/background.mjs`: persist an input stream, request one live poll,
  select locally, or replay from a journal or a verified AML snapshot.

## Reproduce offline

Node 24. These fixtures are synthetic; this sequence makes no network requests.

```sh
node examples/background.js
mkdir -p build
node examples/background.js --frames | node scripts/background.mjs ingest --journal build/background.json
node examples/background.js --request > build/background-request.json
node scripts/background.mjs select --journal build/background.json --request build/background-request.json > build/background-context.json
node scripts/background.mjs replay --journal build/background.json --context build/background-context.json
```

Use a new journal path for each fixture run: the four frames keep their
original receipt times, so replaying them into the later world is a backdated
receipt and fails. The example request reads the first earthquake version
after the receiver has already stored its correction. `examples/background.js`
also checks the updated selection and the original-world replay with assertions.

`ingest` reads newline-terminated UTF-8 JSON on stdin and commits each frame
before it reads the next one. It can stay attached to a local producer while
independent `select` processes read the last committed world. EOF closes the
receiver. The receiver keeps no model context.

## Instruments

Every receipt in the world belongs to exactly one instrument. A receipt that no
instrument owns, or that two would claim, rejects the whole journal. Each
instrument's projection keeps the world's single receipt order and passes the
validator of its own source adapter. That holds on every arrival, every
restart and every selection.

| `kind` | Owns | Validator | Own budget |
| --- | --- | --- | --- |
| `usgs` | subject `usgs:<event>` | `validateUSGSJournal` | 64 events per batch |
| `location` | source `browser:geolocation` | `locationSamples` | 768 receipts, 512000 bytes |
| `camera` | source `browser:camera` | `cameraFrames` (SHA-256) | 32 frames, 1500000 bytes |
| `signal` | subject `agent:<identifier>` | attention values | one fact per frame |

Frames:

```js
{ kind: 'usgs', receivedAt, feed: geojsonFeatureCollection }
{ kind: 'location', id, receivedAt, position: { timestamp, coords: { latitude, longitude, accuracy } } }
{ kind: 'camera', id, receivedAt, image: { jpeg, width, height, capturedAt } }
{ kind: 'signal', fact: { id, subject: 'agent:don-eduardo', predicate, value, source,
  validFrom, validTo, recordedAt, supersedes } }
{ kind: 'action', agent: 'agent:don-eduardo', id, receivedAt, trace: laloActionTrace }
```

Location and camera frames carry exactly what the Device and Camera fields
already produce: `requestLocation` returns `{ position, receivedAt }`, and
`captureFrame` returns the image. The adapters are the ones those fields use,
so a fix is three linked receipts at one observed instant. A kept frame stays
the actual JPEG, in bounded base64 chunks with its digest. The browser fields
still save to their own IndexedDB journals; carrying their observations into
a host background is a producer's job and needs no new format.

The producer supplies receipt times. USGS origin time, source update time and
receipt time remain distinct. A correction appends all eight companion facts
and names each predecessor. The USGS validator checks the source URL, event ID,
source version, companion fields and lineage. Imported GeoJSON keeps the
existing adapter's source claims; a stream frame is never upgraded to an
authenticated fetch. The CLI refuses a receipt time ahead of its own clock. One
future-stamped frame would otherwise block every honest receipt after it.

Arrivals are serialized. Overlapping `receive` calls commit one after another
against the latest world. A failed arrival changes nothing and does not block
the next one.

One explicit network acquisition exists:

```sh
node scripts/background.mjs poll --journal build/background-live.json
```

It calls the existing bounded USGS HTTP transport once, stamps receipt at the
host and commits the batch. The receiver, selection, replay, module import and
examples never start it. Scheduling is an explicit host decision. There is no
daemon and no polling loop.

## Don in the world

Don has identity `agent:<identifier>` in the same world as `usgs:<event>` and
`device:this-browser`. Receipts about him use the ordinary fact contract:
scalar value, source, world interval, receipt time, optional predecessor.

Two channels exist. An `action` frame takes an executed `lalo/action` trace,
the same trace the router and action memory already keep. When its call read
a USGS subject, the trace becomes an `attention_subject` receipt with source
`lalo:action/<tool>`, valid from its receipt time. The next action-derived
attention supersedes the previous one, so Don's focus moves and its lineage
stays. An abstention, an error or a read of any other subject names no
attention and appends nothing. A `signal` frame takes an explicit receipt from
the host. Its predicates stay open: unknown ones are kept and shown as sourced
state evidence.

Model-internal state has no channel. No receipt here claims to come from inside
a model, and none is inferred. A future channel enters as another source on
the same `agent:` subject and becomes a new policy version when selection
starts reading it.

## Selection

| Field | Meaning |
| --- | --- |
| `agent` | Exact agent subject. |
| `knownAt` | Receipt cutoff for every instrument and for Don's receipts. |
| `stateAt` | World instant at which Don's receipts apply. |
| `worldFrom`, `worldTo` | Half-open interval of observed instants. |
| `subject` | Optional exact USGS subject filter. |
| `maxEvents` | Whole event versions in the result; default 8, range 1–64. |
| `maxSignals` | Don's active receipts in the result; default 8, range 0–64. |
| `maxBytes` | Complete context JSON UTF-8 bytes; default 32768, range 1024–65536. |

Don's receipts active at `stateAt` and known at `knownAt` enter first, newest
receipt first, as a bounded prefix. Attention ranks only through receipts the
context carries, so every `attention_subject` reason has its receipt
beside it. Open receipts can pile up in the journal for as long as he acts; the
context still holds `maxSignals` of them and counts the rest.

Each USGS event resolves its latest revision at `knownAt` first, then its
origin time is filtered. A correction that moves an event out of the window
removes it; the earlier location or time never comes back. Attention subjects
rank first, then the most recently received versions, then subject in
code-unit order. The policy emits no reliability, uncertainty or
routing-activation score.

The context carries the normalized request, the policy, Don's carried receipts,
the selected complete event versions and their reasons. Each event keeps all
eight source facts, both clocks and predecessor IDs. `stateEligible`,
`stateOmitted`, `eligible`, `omitted`, `complete` and `limitedBy` (the list of
budgets that cut anything) mark the exact boundary of the reading.
`otherInstruments` counts location and camera observations inside the window
and known at the cutoff that this policy does not select. Their receipts, the
full JPEG included, stay in the world for the existing fact, history and
lineage tools. Every selection is fresh: callers replace the previous context
and never concatenate. A request envelope that cannot fit alone fails
explicitly.

## Budgets and persistence

The combined world allows 1024 facts and 2000000 UTF-8 bytes. Input frames
allow 2000000 bytes. Portable callers can lower the world and batch limits.
Each USGS version costs eight facts, a location fix three, a camera frame three
plus its chunks, a signal one. Duplicates and stale source revisions return
explicit counts. An empty feed leaves earlier observations intact; dropping out
of the hourly feed does not retract an event. A same-version content change
fails.

Full storage rejects the whole arrival and preserves all accepted history.
Export, archive and the choice of another storage budget are host decisions.
There is no automatic compaction, eviction or context accumulation.

The CLI holds an exclusive `<journal>.lock` for the receiver's lifetime.
Competing writers fail with `EEXIST`. Readers need no lock: the writer
validates the candidate, writes and syncs `<journal>.pending`, atomically
renames it over the committed journal and syncs the directory. The old accepted
records stay an exact prefix of the new journal. Peak staging adds one bounded
world file beside the committed file. A missing parent directory is an error.

Acknowledgments report `saved` or `durability_unconfirmed` with the arriving
`kind`. Invalid, oversized, torn, future-stamped or failed input stops the
receiver with a nonzero exit code and a JSON error on stderr. Frames that were
already acknowledged stay committed. A crash can leave `.lock` and `.pending`;
inspect them with the receiver stopped before removing either. Stale staging
is never deleted silently. A crash after rename can leave a committed update
without an acknowledgment: inspect the journal before replaying the input.
Receipt IDs catch duplicates.

## Save and replay through AML

Build the pinned AML runtime as described in [ACTION_MEMORY](ACTION_MEMORY.md).
The existing v2 memory stores the selection and its complete world:

```sh
node scripts/background.mjs select --journal build/background.json --request build/background-request.json --memory build/background-memory
node scripts/background.mjs replay --memory build/background-memory --sequence 1
```

Pass `--head` with the acknowledgment's exact head to bind the selected receipt.
The existing AML chain, world SHA-256, canonical encoding, byte/count validation,
shared snapshots and the 64-action / 8 MiB budget all apply. Replay needs no
source request and no native routing call. It opens the saved world and returns
`match` or `changed` against the stored result. Unsupported formats and policy
versions fail explicitly, v1 included. `--journal` plus `--context` replays
locally against a validated journal; AML mode also verifies the saved receipt
and its world digest.

Selection is recorded as a `lalo/action` with `request.kind = background-context`,
`status = executed`, `route = null`, `call = null` and the context in `result`.
The existing six native tools and their routing stay intact. The CLI provides
this action's replay entry point; the visual tool-call replay keeps handling
routed actions. A failed save returns the computed context alongside
`memory.state = failed` and a nonzero exit code, so selection and persistence
stay distinguishable.

## Gates

```sh
node --test tests/background*.test.js
node --test tests/*.test.js
node --test tests/action-memory.integration.mjs
```

Tests cover independent arrival/read processes before stream EOF, exclusive
writers, serialized overlapping arrivals, corrections and moved origin times,
deterministic ordering, empty and null observations, location and camera
arrival through the same door, single-owner provenance, bounded state with
counted omission, action-derived attention and its supersession, future-stamped
receipts, UTF-8 budgets, atomic failure, preserved staging, restart,
saved-result comparison and real AML replay after later arrivals and snapshot
corruption.
