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
- **AML** is the intended home for programs of behavior; its C runtime is a
  future integration.
- **NoTorch** supplies numerical work when an organ needs it: JS first for
  browser distribution, native C where the host calls for it.
- **LALO**, the coming WOLFE descendant, will select tools and act on this world.
- **The interface participates.** Camera, GPS and visual interaction belong
  in LALO's observation/action loop. Rebecca informs its layers and inertia;
  Netta.Sonar informs the visible trace of action.

Today: two-clock journals, boolean and magnitude rules, visual history,
interface observations, and explicit memory budgets. Both fields save in
IndexedDB. USGS also runs through the CLI:

```sh
node scripts/usgs.mjs > quakes.json
node scripts/usgs.mjs --prior quakes.json > quakes-next.json
```

Each poll keeps receipt time and source revisions. Imports extend saved history;
they never rewrite it. Next: richer ontology and LALO's tool calling body.

No Python in LALO's runtime, build or tests.

[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) informs the world
sources; [Utopia](https://github.com/deeplethe/utopia) informs time and provenance.
This repository grows separately from the upstream contribution fork.

Technical guts, source pins and measured results: [LALOLOG](LALOLOG.md).
Agent work rules: [AGENTS.md](AGENTS.md). License: [GPL-3.0](LICENSE).

RESONANCE UNBROKEN.
