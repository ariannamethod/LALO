# LALOLOG

The engineering record. New entries first. README keeps the pulse; this file
keeps the measurements, decisions, sources and scars.

## 2026-10-15 — missing is not forever

The Codex connector's [review of PR #1](https://github.com/ariannamethod/LALO/pull/1#discussion_r4288025393)
found a real validation defect: `validTo == null` accepted both explicit `null`
and a missing/undefined endpoint. An incomplete source record therefore became
an assertion with an unbounded world interval.

Only explicit `validTo: null` now opens the upper bound. An omitted or undefined
endpoint fails timestamp validation before any journal mutation. Optional
`supersedes` behavior is unchanged.

The regression covers both forms of missing endpoint on a correction. It checks
that rejection preserves the predecessor, future-time answers, record count,
receipt clock and reusable ID, then accepts an explicit-null correction.

Verification on Node v24.19.0, Linux x86_64:

- Before the fix, `node --test tests/ledger.test.js`: 10 passed, the new test
  failed with "Missing expected exception."
- After the fix, `node --test tests/*.test.js`: 11 passed, zero failures or skips.
- `node examples/earthquake.js`: the earlier view is 2.9, the corrected view is
  3.4, and lineage contains both revisions.
- `git diff --check` passed. No packages added.

## 2026-10-15 — the first organ: a two-clock fact journal

### Decision and scope

JavaScript ES modules are the initial language. The core has no external
packages, ambient clock, DOM, filesystem, network or native bindings. It is
small enough to inspect and uses the same module boundary a browser can import.
No phone installation or device benchmark has been performed in this entry.

AML remains the intended language for programs of behavior; C is its existing
runtime and the native NoTorch substrate. A C++ component will need a concrete
job before it enters the dependency graph. The visual body remains first-class:
camera, GPS and interface interactions are future observations/actions. The
user will supply Netta.Sonar as a reference for interface agency.

### Current contract

`src/ledger.js` exports `FactLedger`:

- `add(record)` accepts an immutable scalar assertion with stable ID, subject,
  predicate, value, source, world interval and receipt timestamp.
- Times are safe-integer Unix milliseconds. World intervals are half-open
  `[validFrom, validTo)`; `null` means an open upper bound. Values are null,
  boolean, finite number, or text up to 4096 UTF-16 code units. IDs and relation
  names are bounded to 512 code units; source references to 4096.
- `recordedAt` follows journal order. Late observations use an earlier world
  time and their actual later receipt time. A correction must be learned
  strictly after the revision it replaces.
- `supersedes` explicitly replaces a whole assertion, preserving its subject
  and predicate. It must point to a current revision. All earlier rows remain.
  No automatic source arbitration, state succession or conflict resolution is
  implemented; independent claims coexist.
- `asOf({validAt, knownAt, subject?, predicate?})` filters on both clocks. Once
  a revision is known, its predecessor stays replaced even outside the revised
  world interval. An old claim cannot resurrect through an interval mismatch.
- `lineage(id)` returns the original through the named revision. `entries()`
  returns a detached array of immutable records, including every correction.
- Default capacity is 1024 records. Capacity exhaustion rejects the append
  before any mutation; it never drops evidence. Storage is currently in memory.
  Historical queries scan the journal. Persistence and indexes are later work.

`examples/earthquake.js` is an explicitly synthetic magnitude correction,
2.9 → 3.4. Its one-millisecond world interval represents the fixture event,
not a continuing physical state or a live USGS observation.

### Sources inspected

| Repository | Commit | Role |
|---|---|---|
| God's Eye View | `5b3e852aa2d14ad1460eb9367c82dbf68ef84bfc` | Source/tool boundaries; no runtime code imported in this change |
| Utopia | `cda374771577b2d42ed257312864ecf8e067bfbd` | Bitemporal assertions, explicit supersession, provenance; design reference |
| WOLFE | `a04d2b7e6488656b715ca6b5b5ef5b1227eea79d` | Future tool caller, C99 + libc/libm, flat schemas |
| NoTorch | `2ed0cb03654b445df76168ada21477ab7282b70f` | Manifesto copied verbatim; inspected JS numerical engine and optional WebGPU |
| AML | `8ebc1b7e9333dcf062fdc32d3e6f935efd6f2595` | Inspected native language and existing NoTorch bridge |

God's Eye View declares 11 production and 6 development npm dependencies.
Its lockfile has 243 package locations excluding the root: 86 not marked dev,
157 marked dev, with optional/platform entries included. No NumPy reference
was found in the audited source. No NumPy-to-NoTorch replacement was necessary.

The read-only source audit counted 985 JS/TS files and 240,881 physical lines
under src/server/build, excluding test files and testSupport. Following static
relative imports plus literal dynamic imports from the MCP entry and all local
providers reached 233 files / 48,524 lines. This describes an extraction
boundary, not a validated replacement for the full application. Data assets,
runtime loading and packaging require their own inventory during extraction.

The existing provider path uses satellite.js, pbf, @mapbox/vector-tile,
eccodes-wasm and the dynamically required ws transport. LALO's first journal
uses none of them. They belong with the source modules that need them.

### Next organs

1. Durable local storage with historical replay and explicit capacity behavior.
2. A real observation adapter, preserving source identity and receipt times.
3. Ontology constraints and derived facts with premises and temporal validity.
4. The renamed WOLFE caller, translating flat arguments into typed core calls.
5. A visual observation/action loop informed by Netta.Sonar, then camera/GPS.

AML and NoTorch integrations are planned. No embedded runtime or numerical
backend is claimed by this commit.

### Verification

- Node v24.19.0, Linux x86_64: `node --test tests/*.test.js` — 10 passed,
  zero failures or skips. Covers both clocks, three-revision history, interval
  boundaries, independent disagreement, ownership, atomic rejection, capacity,
  fork rejection and JSON journal replay.
- `node examples/earthquake.js` — earlier knowledge returns 2.9; corrected
  knowledge returns 3.4; lineage lists both stable IDs.
- `git diff --check` passed. `cmp` confirmed the Manifesto matches the pinned
  NoTorch checkout byte-for-byte.
- `src/ledger.js` is 4,955 bytes of source. This is source size, not installed
  footprint or measured heap use. Runtime and development dependencies: zero.
- GitHub Actions runs the same offline test and demo commands on Node 24.14.0.
