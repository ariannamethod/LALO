
<p align="center">
  <img src="assets/lalo.png" alt="LALO" width="220">
</p>

# LALO

**LALO Analyzes Lineage & Ontology.**

> Read the [Arianna Method Manifesto](ARIANNA_METHOD_MANIFESTO.md) first.

The world changes. Keep the fucking receipts.

LALO is growing a small, local world engine: observations, memory, relations,
and the trail that connects a conclusion to its evidence. Built to earn its
place on a phone.

The first organs are alive: a **zero-dependency JavaScript fact journal**
and a visual field that reads it.
It remembers what happened, when we learned it, and which assertion corrected
which. Ask the same question with yesterday's knowledge. Get yesterday's answer.

## run it

```sh
git submodule update --init deps/aml
node examples/earthquake.js
node --test tests/*.test.js
node scripts/serve.mjs
```

Open `http://127.0.0.1:3000`. Receive reports about a crossing. Watch the
hypothesis fracture. Follow a witness. Rewind what was known. Add your own
observation. Every revision leaves a mark. The field saves locally and returns
after reload. “Begin again” asks for a second click before replacing it.

Open **USGS** for real earthquake observations. Read the feed on demand, pick
an event, follow its revisions. Rewind the evidence, including the old location
and origin time. Import or export the same journal the CLI reads.

No install step. The demo uses synthetic earthquake observations: magnitude
2.9, then a correction to 3.4. Both versions keep their source and history.

```js
import { FactLedger } from './src/ledger.js';

const world = new FactLedger({ capacity: 1024 });
world.add({
  id: 'q1:m1', subject: 'quake:1', predicate: 'magnitude', value: 2.9,
  source: 'fixture:sensor', validFrom: 1000, validTo: 1001, recordedAt: 1100,
});
world.asOf({ validAt: 1000, knownAt: 1100 });
world.lineage('q1:m1');
```

Times are integer Unix milliseconds. Records stay in memory; `entries()`
exports the complete journal. The capacity is explicit. Full means full:
history does not quietly disappear to make a counter look healthy.

## where this goes

- **JavaScript** owns the portable core and visual interface.
- **AML** writes and verifies optional action memory through its pinned C runtime.
- **NoTorch** supplies numerical work when an organ needs it: JS first for
  browser distribution, native C where the host calls for it.
- **LALO**, the WOLFE descendant, selects a tool and reads this world through
  the same JS host. Its optional C body is alive.
- **The interface participates.** Camera, GPS and visual interaction belong
  in LALO's observation/action loop. Rebecca informs its layers and inertia;
  Netta.Sonar informs the visible trace of action.

Today: two-clock journals, boolean and magnitude rules, visual history,
interface observations, and explicit memory budgets. The fields save in
IndexedDB. USGS also runs through the CLI:

```sh
node scripts/usgs.mjs > quakes.json
node scripts/usgs.mjs --prior quakes.json > quakes-next.json
```

Each poll keeps receipt time and source revisions. Imports extend saved history;
they never rewrite it.

Open **Device** for a one-shot location observation. Ask explicitly, let the
browser request permission, and keep latitude, longitude and accuracy with
the measurement and receipt times. Rewind, reload, export, or ask Don to read
the same journal. With action memory enabled, recall and reproduce that call.
256 observations, 512 kB, saved in this browser. No background location watcher.

Open **Camera**, grant permission, then **Keep this frame**. The camera stops.
The JPEG stays with its source, capture time and receipt time. Rewind or reload
to see it again; action memory retains the image in the original world.
Up to 32 frames within 1.5 MB, each at most 640 pixels and 48 KiB. This step
preserves images; it does not identify what they depict.

## call the world

Seven tools give models facts, history, lineage, rule readings and JANUS calendar coordinates.
The portable JS host and the local MCP server read the same journal:

```sh
node examples/tool-call.js
node scripts/mcp.mjs --journal quakes.json
```

[Tool contract and client setup](docs/TOOLS.md). No SDK install.

Give LALO an intent and explicit arguments. Get the decision, the call and
the receipts. The optional router needs a C99 compiler:

```sh
node scripts/build-router.mjs
node examples/route.js
node scripts/serve.mjs --router
```

Ask from any visual field. Follow the call into its receipts. Rewind without
rewriting the answer. Choose **Read selected receipt in JANUS** to see its Gregorian
and Hebrew date, JANUS epoch day and signed delay between occurrence and receipt.
The same call works through MCP and the route CLI. [Routing contract](docs/ROUTING.md).

Give him a memory that survives the host:

```sh
git submodule update --init deps/aml
node scripts/build-aml.mjs
node scripts/serve.mjs --router --memory build/action-memory
```

Restart and **Recall saved action** by number, or leave the number empty for
the latest action. **Open original world** reproduces what Don read. For a
saved rule reading, **Compare with current view** shows which receipts changed
his answer. MCP clients get the same comparison with `--memory DIRECTORY`.
Shared snapshots, one memory budget. Full means full; the
past stays put. [Action memory contract](docs/ACTION_MEMORY.md).

No Python in LALO's runtime, build or tests.

An optional **Gemma 3-270M-IT encounter** now runs through the pinned NoTorch
Harness. The model asks Don an ordinary magnitude question about a selected
earthquake, its magnitude history, or its own earlier statements. It receives
Don’s source receipts and answers. Don records its question,
answer, token counts and exact weight identity in the same world. A later
source correction changes the next answer; AML reopens the earlier encounter
with its original speech and evidence. Optional native DoE experts retain
their own saved state between those processes. Don can also compare two saved
answers and return the exact source revision chain behind their changed evidence.
[Run the model encounter and inspect its receipts](docs/MODEL_ENCOUNTERS.md).

LALO plays instruments; the world keeps sounding while no model is asking.
USGS revisions, NOAA weather frame listings, device fixes, kept camera frames and Don's own reads arrive through
one door into one bounded journal. Each context is a fresh, bounded reading
of that world with its own event, signal and byte limits:

```sh
node examples/background.js
```

With the native router and AML built, run `node examples/gev-weather.js` for an offline
session. A radar frame predates a quake but reaches Don later. He reopens his
earlier answer from AML memory and names the receipt that changed it. Run
`background.mjs poll-weather` against a God's Eye View server to receive its
radar, lightning or cloud imagery manifests. [Commands and source fields](docs/BACKGROUND.md#weather-from-gods-eye-view).

To ask what Don knew about a particular area, run `node examples/gev-firms.js`.
It puts satellite thermal detections and a USGS earthquake in one region,
reopens the noon answer from AML memory and identifies the earlier overpass
that reached Don at 12:07. A live `poll-firms` reads the same GEV server.
[Regional polling and replay](docs/BACKGROUND.md#regional-firms-observations).

To ask what was near the device, run `node examples/device-route.js` after
building AML. Don shows the fix he used, its reported accuracy and the
distance to each selected event. A delayed fix can change a retrospective
answer. AML can reopen the answer Don actually gave at noon.
[Device radius and synthetic route](docs/BACKGROUND.md#nearby-events-from-a-device-fix).

Don reads each selected event through AML's local C/WASM calendar.
Don can choose a known receipt as his calendar origin. Once his choice reaches
the background journal, future reads count from that event across restarts.
Rewinding to before the choice restores his earlier perspective. An explicit
`originId` overrides the origin for one read. Give `lalo_calendar` a second
receipt as `compareToId` to ask which event happened first and which report
reached Don first. JANUS compares both clocks to the millisecond. To find
reports without their IDs, ask `lalo_history` what reached Don during a
receipt window about events before a given instant. A late correction
returns its own receipt and the ID of the assertion it revises. Give
`lalo_reading` a `sinceKnownAt` baseline to see how Don revised his conclusion
about one world instant, with the source receipts behind each change.
AML supplies JANUS and action memory; the optional NoTorch submodule supplies
model inference and experts. Dependabot checks their `main` branches daily
at 03:17 UTC and opens update PRs. After pulling a merged update, run
`git submodule update --init deps/aml`; include `deps/notorch` for model encounters.

Offline and reproducible. Stream input, one-shot live acquisition and optional
AML snapshot replay: [Event background](docs/BACKGROUND.md).

[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) informs the world
sources; [Utopia](https://github.com/deeplethe/utopia) informs time and provenance.
This repository grows separately from the upstream contribution fork.

Technical guts, source pins and measured results: [LALOLOG](LALOLOG.md).
Agent work rules: [AGENTS.md](AGENTS.md). License: [GPL-3.0](LICENSE).

RESONANCE UNBROKEN.
