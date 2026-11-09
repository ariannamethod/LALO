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
  selection under its recorded policy. New selections use `regional-events-janus/v6`.
- `scripts/background.mjs`: persist an input stream, request one live poll,
  select locally, or replay from a journal or a verified AML snapshot.

## Reproduce offline

Use Node 24 and initialize the AML submodule once with `git submodule update --init deps/aml`.
The synthetic fixture then runs offline.

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
| `gev-weather` | subject `nowcoast:<product>` | `weatherFrames` | 13 times per manifest, 32 KiB per HTTP response |
| `gev-firms` | subject `firms:<satellite>:<instrument>:<minute-ms>:<latitude>:<longitude>` | `firmsGroups` | 64 regional rows per poll by default |
| `location` | source `browser:geolocation` | `locationSamples` | 768 receipts, 512000 bytes |
| `camera` | source `browser:camera` | `cameraFrames` (SHA-256) | 32 frames, 1500000 bytes |
| `signal` | subject `agent:<identifier>` | attention values and calendar origin references | one fact per frame |

Frames:

```js
{ kind: 'usgs', receivedAt, feed: geojsonFeatureCollection }
{ kind: 'gev-weather', receivedAt, origin, manifest }
{ kind: 'gev-firms', receivedAt, origin, bbox: [west, south, east, north], feed }
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

The receiver copies each frame when `receive` is called, including the
measurement and coordinates from a browser position. The producer can then
reuse its object. Overlapping calls commit in submission order against the
latest world. After a rejected frame the queue continues from the last commit.

To fetch one USGS batch, run

```sh
node scripts/background.mjs poll --journal build/background-live.json
```

It calls the existing bounded USGS HTTP transport once, stamps receipt at the
host and commits the batch. The receiver, selection, replay, module import and
examples never start it. Scheduling is an explicit host decision. There is no
daemon and no polling loop.

## Weather from God's Eye View

With a GEV server running, set `GEV_ORIGIN` to its HTTP(S) origin. Each
command fetches one manifest. All four products share the same journal.

```sh
mkdir -p build
for product in radar lightning clouds clouds-regional; do
  node scripts/background.mjs poll-weather --gev-origin "$GEV_ORIGIN" --product "$product" --journal build/background-live.json || break
done
```

The [GEV weather provider](https://github.com/bilawalsidhu/gods-eye-view/blob/027c9616a5245bd5e0725cd03d62fce41d54c691/server/providers/weather.js)
lists observation times in `/api/weather/manifest?product=…`. For each new time,
Don records `frame_listed = true`, the first witnessing manifest's `manifest_fetched_at`
and its `manifest_stale` flag. The source is the GEV endpoint. The observation
time anchors a one-millisecond interval. All three facts receive the time when
Don accepted that manifest. Radar covers CONUS, lightning reports a regional
density product, and the two cloud products list global and regional satellite
imagery. These receipts answer when a frame was listed. Reading rain, strikes
or cloud cover at a point requires measurements from the image itself.

The same endpoint listing the same time again returns a duplicate count and
the current cache status. A frame falling out of the list stays in history.
A provider outage without usable metadata rejects the poll and preserves the
journal. Responses from distinct GEV origins keep distinct receipts.

To run the reproducible scenario, build the native router and the pinned AML
runner, then run `node examples/gev-weather.js`. It creates temporary AML
memory, records the radar question before the late arrival, reopens it and
compares with the extended world. For a durable copy of the synthetic inputs
use a new journal path:

```sh
node examples/gev-weather.js --frames | node scripts/background.mjs ingest --journal build/weather-simulation.json
```

## Regional FIRMS observations

GEV serves NASA FIRMS thermal detections from VIIRS and MODIS at `/api/firms`.
The operator configures `FIRMS_MAP_KEY` on the GEV server. Set `GEV_ORIGIN`
to that server's origin, then request an area. This example covers part of
northern California and Nevada.

```sh
mkdir -p build
node scripts/background.mjs poll-firms --gev-origin "$GEV_ORIGIN" --bbox -122,38,-119,40 --journal build/regional.json
```

The endpoint returns a global JSON feed. The CLI caps the HTTP response at
64 MiB and 300,000 rows. It checks each location, filters to the requested
box and queues at most 64 regional rows. A larger regional result rejects
the poll so the operator can narrow the box. The acknowledgment gives
global count, outside count, added and repeated detections, failed products,
and the GEV cache timestamp and stale flag. A successful empty selection
adds zero receipts. An HTTP error or invalid response leaves the journal intact.

Each detection keeps ten facts: `thermal_detection`, both coordinates,
satellite, instrument, source confidence, fire radiative power in MW, proxy
fetch time, cache status, and the products unavailable at first receipt.
FIRMS publishes the acquisition minute in UTC. Its ledger interval spans
that minute, and JANUS uses the start as its time anchor. Don stamps receipt
independently. GEV's CSV parser encodes missing or malformed power as zero.
Don records that ambiguous zero as `null`. Confidence retains the supplied
category or numeric text. [GEV parser](https://github.com/bilawalsidhu/gods-eye-view/blob/e5da073d33c76a6fe8f56d676b13b4a12152e0ce/src/data/firmsCsv.js) · [NASA VIIRS guide](https://www.earthdata.nasa.gov/s3fs-public/2024-07/VIIRS_C2_AF-375m_User_Guide_1.0.pdf)

Identity includes the relay endpoint, satellite, instrument, acquisition
minute and pixel-center coordinates. Repeated rows preserve their first
receipt. A change to measured values at that identity rejects the whole poll
because GEV supplies no revision ID. Distinct satellites keep separate
observations even when they report the same point and minute.

Both poll and selection use inclusive box edges. A west longitude greater
than the east longitude crosses the antimeridian. Regional context includes
FIRMS and USGS groups with coordinates inside the box. A USGS correction uses
the coordinates known at the requested cutoff. Camera frames and weather
manifests carry no point location. Device fixes are counted at their own
coordinates. Omit `bbox` to read across the world.

After building the AML runner, run the offline simulation with
`node examples/gev-firms.js`. To keep its synthetic inputs for other tools:

```sh
node examples/gev-firms.js --frames | node scripts/background.mjs ingest --journal build/regional-simulation.json
```

## Don in the world

Don has identity `agent:<identifier>` in the same world as `usgs:<event>` and
`device:this-browser`. Receipts about him use the ordinary fact contract:
scalar value, source, world interval, receipt time, optional predecessor.

Two channels exist. An `action` frame takes an executed `lalo/action` trace,
the same trace the router and action memory already keep. A successful
`lalo_facts`, `lalo_history`, `lalo_reading` or single-receipt `lalo_calendar`
read of a USGS event, a nowCOAST product or a FIRMS detection becomes an `attention_subject` receipt with source
`lalo:action/<tool>`, valid from its receipt time. The next action-derived
attention supersedes the previous one, so Don's focus moves and its lineage
stays. An abstention, an error or a read of any other subject names no
attention and appends nothing. A `signal` frame takes an explicit receipt from
the host. The read's knowledge cutoff must match the result and precede or
equal the action receipt time. Returned facts and readings must agree with
the requested subject. The `lalo:action/` source prefix belongs to action
frames. The host's own sources can supply additional predicates, which are
preserved as sourced state evidence.

Model-internal state has no channel. No receipt here claims to come from inside
a model, and none is inferred. A future channel enters as another source on
the same `agent:` subject and becomes a new policy version when selection
starts reading it.

## Personal calendar origin

A routed `lalo_calendar` call can choose a receipt already known to Don. Its
occurrence day becomes day zero. The choice itself enters the background as a
separate receipt at the time the receiver accepts the action. For example, Don
chooses Monday's entry on Thursday. Reading Wednesday's event on Friday gives
`age_days: 2`. A rewind to Wednesday still shows the perspective he had then.

Given a route session over the receiver's current journal, record the choice
through the same action input used for attention:

```js
const agent = 'agent:don-eduardo';
const trace = await session.call({ text: 'read janus calendar',
  arguments: { id: anchorReceiptId, knownAt, agent, chooseOrigin: true } });
if (trace.status === 'executed') {
  await background.receive({ kind: 'action', id: choiceReceiptId, agent, receivedAt, trace });
}
```

The CLI equivalent sends the request to `scripts/route.mjs --journal FILE`
and passes its output as `trace` in an action frame to
`scripts/background.mjs ingest --journal FILE`. A successful choice appends
one `calendar_origin` receipt with source `lalo:action/calendar-origin/v1`.
Its value names the exact anchor revision. Retrying the same frame appends zero
receipts. Each agent has one fixed origin in this journal. Later corrections to
the anchor remain visible in its lineage.

A new calendar session uses the recorded choice at or after its receipt time.
Background selection requires both `knownAt` and `stateAt` to include the
choice. Each affected event carries the anchor provenance and the choice receipt,
even when `maxSignals` is zero. Its bytes count toward the event budget.
An explicit `originId` overrides the origin for one request.

## Selection

| Field | Meaning |
| --- | --- |
| `agent` | Exact agent subject. |
| `knownAt` | Receipt cutoff for every instrument and for Don's receipts. |
| `stateAt` | World instant at which Don's receipts apply. |
| `worldFrom`, `worldTo` | Half-open interval of observed instants. |
| `subject` | Optional exact USGS, nowCOAST or FIRMS subject. |
| `bbox` | Optional inclusive point bounds, `[west,south,east,north]`. |
| `originId` | Optional receipt known at `knownAt`. Its occurrence day anchors the personal calendar view for this request. |
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
code-unit order. Simultaneous receipts for the same product sort by newest
observation and then by receipt ID. The policy emits no reliability, uncertainty or
routing-activation score.

The context carries the normalized request, the policy, Don's carried receipts,
the selected complete event versions and their reasons. Each event keeps all
eight USGS facts, three weather facts or ten FIRMS facts, both clocks and predecessor IDs. `stateEligible`,
`stateOmitted`, `eligible`, `omitted`, `complete` and `limitedBy` (the list of
budgets that cut anything) mark the exact boundary of the reading.
`otherInstruments` counts location and camera observations inside the window
and known at the cutoff that this policy does not select. Their receipts, the
full JPEG included, stay in the world for the existing fact, history and
lineage tools. Every selection is fresh: callers replace the previous context
and never concatenate. A request envelope that cannot fit alone fails
explicitly.

Each selected group has one JANUS annotation anchored to its magnitude,
`frame_listed` or `thermal_detection` receipt. Companion facts share occurrence, receipt and validity clocks.
The complete annotation counts toward the context byte budget alongside the facts.
An unavailable calendar or out-of-range timestamp leaves a structured error
on that event alongside its source receipts. The separate `lalo_calendar` tool
can also read individual device, camera and agent receipts. An executed calendar
read of a single USGS, weather or FIRMS receipt in the background world can become Don's next attention
signal. A comparison with `compareToId` reads both revisions and leaves Don's
attention as it was.

Historical v2 through v5 contexts replay with their original projection and byte budget.
New contexts save the coordinates and calculator's WASM digest. Replay compares
both against a fresh reading of the saved world.

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
The CLI provides
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
