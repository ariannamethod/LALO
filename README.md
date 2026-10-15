# LALO

**LALO Analyzes Lineage & Ontology.**

> Read the [Arianna Method Manifesto](ARIANNA_METHOD_MANIFESTO.md) first.

The world changes. Keep the fucking receipts.

LALO is growing a small, local world engine: observations, memory, relations,
and the trail that connects a conclusion to its evidence. Built to earn its
place on a phone.

The first organ is alive: a **zero-dependency JavaScript fact journal**.
It remembers what happened, when we learned it, and which assertion corrected
which. Ask the same question with yesterday's knowledge. Get yesterday's answer.

## run it

```sh
node examples/earthquake.js
node --test tests/*.test.js
```

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
- **WOLFE's descendant** will select tool calls under its own name here.
- **The interface participates.** Camera, GPS and visual interaction belong
  in LALO's future observation/action loop. Netta.Sonar is a coming reference.

Today: journal, historical queries, correction lineage, explicit memory budget.
Next: persistent storage and a real observation source. Ontology, inference,
tool routing and the visual body grow against that working spine.

No Python in LALO's runtime, build or tests.

[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) informs the world
sources; [Utopia](https://github.com/deeplethe/utopia) informs time and provenance.
This repository grows separately from the upstream contribution fork.

Technical guts, source pins and measured results: [LALOLOG](LALOLOG.md).
Agent work rules: [AGENTS.md](AGENTS.md). License: [GPL-3.0](LICENSE).

RESONANCE UNBROKEN.
