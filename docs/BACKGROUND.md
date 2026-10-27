# Don Eduardo's event background

Observations arrive without a model call. The receiver commits them to a bounded
two-clock world journal. A separate reader chooses a fresh, bounded context from
that world. The agent participates as a named subject with sourced observations
of its own actions and explicitly supplied state signals.

The first source is the existing USGS adapter and its fixed `all_hour` feed.
The portable boundary has no network, timer, native process or ambient clock:

- `src/background.js`: receive whole USGS batches and explicit agent signals;
  validate and export the world using the existing journal format.
- `src/background-context.js`: select by an explicit request and replay a saved
  selection under the versioned `usgs-attention-receipt/v1` policy.
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

Use a new journal path for a fresh fixture run: the three frames preserve their
original receipt times, so rerunning them against the later world rejects a
backdated receipt. The example request intentionally reads the first version
after the receiver has stored the correction. `examples/background.js` also
checks the updated selection and original-world replay with assertions.

`ingest` accepts newline-terminated UTF-8 JSON on stdin and commits each frame
before reading the next one. It can remain attached to a local producer while
independent `select` processes read the last committed world. EOF closes the
receiver. No model context is retained by the receiver.

Two frame shapes:

```js
{ kind: 'usgs', receivedAt: 1792065602000, feed: geojsonFeatureCollection }
{ kind: 'signal', fact: {
  id: 'don:attention:1', subject: 'agent:don-eduardo',
  predicate: 'attention_subject', value: 'usgs:synthetic1',
  source: 'fixture:explicit-agent-action',
  validFrom: 1792065602000, validTo: null, recordedAt: 1792065603000
} }
```

The producer supplies actual receipt times. USGS origin time, source update
time and receipt time remain distinct. A correction appends all eight companion
facts and names each predecessor. The receiver validates the source URL, event
ID, source version, companion fields and lineage with `validateUSGSJournal`.
Imported GeoJSON keeps the existing adapter's source claims; the input producer
owns acquisition. No imported observation is upgraded to an authenticated fetch.

One explicit network acquisition is available:

```sh
node scripts/background.mjs poll --journal build/background-live.json
```

This calls the existing bounded USGS HTTP transport once, timestamps receipt
at the host and commits the batch. The receiver, selection, replay, module import
and examples never initiate it. Scheduling belongs to an explicit host choice;
there is no installed daemon or automatic polling loop.

## Agent signals and selection

An agent has identity `agent:<identifier>` in the same world as `usgs:<event>`.
Signal input uses the existing fact contract: scalar value, source, world
interval, receipt time and optional predecessor. New signal predicates can be
supplied without changing storage. The mechanism for obtaining model-internal
state is still open; this prototype accepts explicit host/agent observations.

The v1 selector interprets `attention_subject` as a USGS event identity or
explicit `null`. For example, an agent action may record which event it chose
to inspect. Corrections use `supersedes`; expired and replaced signals follow
the usual two-clock semantics. Independent signals coexist. Multiple active
attention subjects receive equal priority; a null independent assertion does
not erase another source's attention. Other predicates remain visible as
sourced state evidence and do not alter v1 ordering.

The request fields are:

| Field | Meaning |
| --- | --- |
| `agent` | Exact agent subject. |
| `knownAt` | Receipt cutoff for source observations and agent signals. |
| `stateAt` | World instant at which agent signals apply. |
| `worldFrom`, `worldTo` | Half-open interval of earthquake origin times. |
| `subject` | Optional exact USGS subject filter. |
| `maxEvents` | Whole event versions in the result; default 8, range 1–64. |
| `maxBytes` | Complete context JSON UTF-8 bytes; default 32768, range 1024–65536. |

Resolve each event's latest revision at `knownAt` first, then filter its origin
time. A correction moving an event outside the window removes it from the
selection; it never resurrects the earlier location or time. Rank matching
attention subjects first, then most recently received versions, then subject
in code-unit order. This is a deterministic selection policy. It emits no
reliability, uncertainty or routing-activation score.

The context contains the normalized request, policy version, active agent
signal receipts, selected complete event versions and their selection reasons.
Each event retains all eight source facts, both clocks and predecessor IDs.
`eligible`, `omitted`, `complete` and `limitedBy` expose the exact selection
boundary. The first whole event that cannot fit ends the ranked prefix. If
state evidence and the request alone cannot fit, selection fails explicitly.
Every selection is fresh: callers replace the previous context instead of
concatenating successive contexts. Full history stays in the journal and is
available to the existing fact/history/lineage tools.

## Budgets and persistence

The combined world allows 1024 facts and 2000000 UTF-8 bytes. A batch allows
64 source events; input frames allow 2000000 bytes. Portable callers can lower
the storage/batch limits. Each new USGS version costs eight facts; each agent
signal costs one. Duplicates and stale source revisions return explicit counts.
An empty feed leaves prior observations intact; absence from the hourly feed
does not retract an event. Same-version content changes fail.

Full storage rejects the whole batch or signal and preserves all accepted
history. Export/archive and selection of another storage budget are host
decisions. There is no automatic compaction, eviction or context accumulation.

The CLI takes an exclusive `<journal>.lock` for the receiver's lifetime.
Competing writers fail with `EEXIST`. Readers need no lock: the writer validates
the candidate, writes and syncs `<journal>.pending`, then atomically renames it
over the committed journal and syncs the directory. The old accepted records
remain an exact prefix of the new journal. Peak staging adds one bounded world
file beside the committed file. A missing parent directory is an error.

Acknowledgments report `saved` or `durability_unconfirmed`. Invalid, oversized,
torn or failed input stops the receiver with a nonzero exit code and a JSON
error on stderr. Earlier acknowledged frames remain committed. A crash can
leave `.lock` and `.pending`; inspect them with the receiver stopped before
removing either. Stale staging is never silently deleted. A crash after rename
can leave a committed update without an acknowledgment: inspect the journal
before replaying the input. Signal IDs enforce duplicate detection.

## Save and replay through AML

Build the pinned AML runtime as described in [ACTION_MEMORY](ACTION_MEMORY.md).
The existing v2 memory stores the context selection and its complete world:

```sh
node scripts/background.mjs select --journal build/background.json --request build/background-request.json --memory build/background-memory
node scripts/background.mjs replay --memory build/background-memory --sequence 1
```

Pass `--head` with the acknowledgment's exact head to bind the selected receipt.
The existing AML chain, world SHA-256, canonical encoding, byte/count validation,
shared snapshots and 64-action / 8 MiB budget apply. Replay requires no source
request or native routing call. It opens the saved world and returns `match` or
`changed` against the stored result. Unsupported policy versions fail explicitly.
`--journal` plus `--context` offers local replay of a validated journal; AML mode
adds verification against the saved receipt and its world digest.

Selection is recorded as a `lalo/action` with `request.kind = background-context`,
`status = executed`, `route = null`, `call = null` and the context in `result`.
It records a local context-selection action. The existing six native tools and
their routing stay intact. The CLI supplies this action's replay entry point;
the visual tool-call replay continues to handle routed actions. A failed save
returns the computed context alongside `memory.state = failed` and a nonzero
exit code, preserving the distinction between selection and persistence.

## Gates

```sh
node --test tests/background*.test.js
node --test tests/*.test.js
node --test tests/action-memory.integration.mjs
```

Tests cover independent arrival/read processes before stream EOF, exclusive
writers, corrections and moved origin times, deterministic ordering, empty and
null observations, explicit agent participation at both clocks, UTF-8 budgets,
atomic failure, preserved staging, restart, provenance checks, saved-result
comparison and real AML replay after later arrivals and snapshot corruption.
