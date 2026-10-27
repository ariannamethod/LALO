# LALOLOG

The engineering record. New entries first. README keeps the pulse; this file
keeps the measurements, decisions, sources and scars.

## 2026-10-27 — pin the merged field organ and reopen the WOLFE gate

`deps/aml` and the independent guard in `scripts/build-aml.mjs` now both pin
`b932a09b7d38e2a9de9bbbcbb46cf568ae306411`, the merge of AML #47. The previous
pin was `8ebc1b7e9333dcf062fdc32d3e6f935efd6f2595`. This brings the three field
intrinsics and the merged scalar-math behavior into the actual LALO build.
The existing CI memory job now runs `scripts/wolfe-diff.mjs` after building
both bodies and checking action memory. Production routing continues through
the unchanged C body; this change adds no router switch.

Fresh verification on Linux x86_64, Node v24.22.1, GCC 13.3.0, from LALO
`661d8b5a160c9f1875f19088f4871ce48f14e00f`:

- `node scripts/build-aml.mjs`: exit 0. A temporary checkout of the old AML
  commit was rejected with exit 1 and the new expected SHA; the merged pin
  was restored and rebuilt successfully.
- `node scripts/build-router.mjs` then `node scripts/wolfe-diff.mjs`: exit 0,
  **68/68**, evidence equal 68/68, 64/68 byte-identical lines. Maximum absolute
  confidence and margin differences both `1e-6`, within `1e-4`. Both processes
  exited 0 and returned 68 lines. One local sample: C 30 ms, AML 2506 ms.
  These are measurements of the merged dependency in this session.
- Negative control: a temporary copy changing only `a = .78 * att / total`
  to `.80` failed with exit 1: 67 confidence and 67 margin mismatches,
  `VERDICT FAIL 1/68`, maximum differences 0.0207 and 0.0159. The checked-in
  AML program was untouched.
- `node --test tests/*.test.js`: **75/75**, zero failures or skips. The
  previously recorded action-http flake did not occur in this run.
- `node --test tests/action-memory.integration.mjs tests/native-router.integration.mjs`:
  **20/20**, zero failures or skips (14 real-AML memory, six native router).
  Covers legacy v1 receipt preservation, extending the same chain with v2
  worlds, exact UTF-8/integer clocks, restart and original-world replay,
  damaged snapshots, concurrent writers, budgets and missing/stalled AML.
- All four examples exited 0: `earthquake.js`, `tool-call.js`, `background.js`
  and `route.js` under `examples/`.
- `make -C deps/aml test-field test-scalar-math test`: exit 0; 3333 field
  C/runtime checks, golden fixture and 24 refused programs across five
  execution paths; 877 scalar-math checks and 39 invalid fixtures across five
  paths; core **550/550**.
- `git diff --check`: pass. C source SHA-256 remains
  `dea0df2c4f81d64543b927e3f6e4d1a23bdf585500230a135f24a73f20529fda`.

### Haiku Parliament on this AML revision

Checked against `haiku.aml` at `da750619bf781f505c8242928fb4db07b46c0945`
and its recorded scalar NoTorch baseline
`e84262669b2e349c6436ed0422028107b3d166b3`. Both real 21,308,576-byte
`weights/haiku1.gguf` and `weights/haiku2.gguf` were present. These are external
verification checkouts, with no new LALO dependencies or Haiku source edits.
With `AML_ROOT` naming LALO's absolute `deps/aml` path and `NOTORCH_ROOT`
naming that NoTorch checkout, the commands were:

```sh
make -C "$NOTORCH_ROOT" lib BLAS_FLAGS= BLAS_LIBS= X86_SIMD=0 ARM_SIMD=0
make -C "$AML_ROOT" notorch NOTORCH_ROOT="$NOTORCH_ROOT"
make -C "$AML_ROOT" test-parliament NOTORCH_ROOT="$NOTORCH_ROOT"
make -C /path/to/haiku.aml test-parliament test-parliament-contact \
  AML_ROOT="$AML_ROOT" NOTORCH_ROOT="$NOTORCH_ROOT"
```

All exited 0. AML's bridge passed 656 checks plus native/compiler value and
backend-refusal gates. Haiku's vote, life and memory fixtures agreed between
interpreter and compiled execution; validation preserved owners after rejected
calls and thirteen malformed states, and verified exact checkpoint/reward/Oja
continuation with independent source namespaces. Contact fixtures passed real
PEN7 mixture/prototype encounters in both execution paths and exact restart;
replay, seven rejected calls and ten corrupt private states preserved owners.

A separate temporary probe imported `src/parliament.aml`, constructed origin
and boundary with `field_project` and `field_normalize`, checked the unit norm
with `field_dot`, then created a parliament and voted without changing its
owner. Both `runner/aml-notorch` and the `amlc --scalar` executable printed
`HAIKU_PARLIAMENT_FIELD_OK`. The exact FIELD.md example also built and ran with
output identical to the interpreter. Both generated executables use amlc's
runtime-backed `am_exec_source` path. The first compiler probe stopped because
`AML_PREFIX` was unset; rerunning with a temporary prefix containing the built
AML, bridge and NoTorch archives succeeded.

Build warnings observed: AML's `am_tape_backward` allocation-range warning and
amlc's `strncpy` truncation warning; NoTorch's format and `strncpy` warnings.
No build failed. Browser/physical-phone gates and the full Haiku suite were
not run; the Haiku checks above target Parliament and contact specifically.

## 2026-10-27 — every instrument sounds into one world

The 2026-10-20 event background below was transplanted onto main after #11 and
#12 (merge commit; the only conflict was the two sides' LALOLOG heads). Three
probes against the transplanted prototype found three defects. Open agent
signals accumulated inside every context: at 143 active `attention_subject`
receipts each default selection threw `agent state and request exceed the
context byte budget`, so a Don who keeps acting loses his background. A world
holding one `browser:geolocation` group was rejected with `signal subject must
be agent:<identifier>`; location and camera receipts had no way in. A stdin
frame stamped ten years ahead was committed (exit 0), after which an honest
present-time frame failed with `receipt time precedes the world journal`
(exit 1). The prototype also described agent actions recording their focus
without code that connected an action trace to a signal.

`src/background.js` now has one async door, `receive(frame)`, over an
instrument table: `usgs`, `location`, `camera`, `signal`, plus `action`.
Every receipt has exactly one owner by subject or source. Each projection
passes its own adapter's validator (`validateUSGSJournal`, `locationSamples`,
`cameraFrames` with SHA-256, signal attention values) on arrival, restart and
selection. The adapters' own budgets hold inside the shared 1024-fact /
2000000-byte world. Overlapping arrivals are serialized; with the queue
removed, three successful arrivals committed stale worlds of 8, 3 and 1
records instead of 8, 11 and 12. An `action` frame turns an executed
`lalo/action` trace that read a `usgs:` subject into an `attention_subject`
receipt with source `lalo:action/<tool>`. The next one supersedes it.
Abstentions, errors and other subjects append nothing. Model-internal state
has no channel and none is inferred.

Selection policy `usgs-attention-receipt/v2` carries Don's active receipts as
a newest-first prefix bounded by `maxSignals` (default 8, 0–64) and the byte
budget, with `stateEligible`/`stateOmitted`. Attention ranks only through
carried receipts. `limitedBy` lists every budget that cut. `otherInstruments`
counts location and camera observations in the window that v2 does not select;
their receipts, the full JPEG included, stay reachable through the existing
tools. v1 contexts are rejected explicitly. The CLI refuses a receipt ahead of
its own clock. docs/BACKGROUND.md now opens with the instrument frame: the
background is the world the instruments resonate in, the context is one
bounded reading of it.

Local verification: Node v25.9.0, Apple clang 21.0.0, Darwin arm64. Main
baseline 62/62 offline; after the transplant 70/70; after this step 75/75
(nine core and four CLI background tests). Ten counted full runs of the final
tree: four 75/75, six 74/75. The one failing test is the existing
`action endpoint is opt-in…` in tests/action-http.test.js, unchanged from main:
fetch reports `ECONNRESET` instead of the 413 for its 2.1 MB body. Main's own
62-test set without the background files gave 61/62 in five of ten runs, and
the HTTP file alone failed 10 of 30 runs on this host. `node scripts/build-router.mjs`
then the native integration: 6/6. Pinned AML 8ebc1b7 built; action-memory
integration 14/14, including the CLI save and v2 replay of a background
selection from its original world. All four examples pass. The documented
offline sequence commits four frames, replays `match` locally, saves through
AML and replays `match` by sequence. Four mutants each turned a gate red and
were reverted to their anchored SHA-256: queue removed, attention read from
all active state, default `maxSignals` 64, future-receipt guard disabled. The
only network call in the background path is `fetchUSGS()` inside the explicit
`poll` branch of `scripts/background.mjs`; the portable modules import no
transport.

Limits: the browser Device and Camera fields still save only to their own
IndexedDB journals; no producer carries their observations into a host
background yet. Selection reads USGS events and Don's receipts; location and
camera are counted, not selected. Stream producers stamp receipt time, bounded
only by the receiver clock. A local `--journal` replay can report `changed`
when later receipts fall at or before the saved `knownAt`; AML replay reads
the exact original world. No browser gate or phone measurement was run; this
step adds no visual surface.

## 2026-10-20 — the camera keeps its frame in the world

Camera opens only on a click and captures only on a second click. Capture,
Stop, page hide and visibility loss stop its video tracks. Permission has a
15-second deadline; a late grant is stopped without becoming an observation.
Capture scales a JPEG to at most 640 pixels / 48 KiB. Source `browser:camera`
and subject `device:this-browser` accompany separate capture and receipt clocks.
The observed interval is one millisecond; later captures append independent
groups. This is image retention, without semantic image interpretation.

The portable adapter stores dimensions, SHA-256 and bounded base64 chunks as
ordinary scalar receipts. Full image bytes therefore travel with the existing
journal, tool pagination and AML original-world snapshots. Loading validates
group structure, JPEG framing and digest; browser capture owns image encoding.
The budget is 32 frames / 1.5 MB with no eviction. IndexedDB publishes a complete
candidate before the UI advances. Damaged storage blocks writes; save failure
retains the previous frame and still stops the camera.

The Camera field adds selection, receipt-time rewind, reload and JSON export.
The original-world panel reconstructs the retained image from its own journal.
Local Node v24.19.0 / GCC 13.3.0 / Linux x86_64: 62 core and 19 native/AML tests
pass, along with all three examples. Seven new camera tests cover byte
round-trip through paged tools and replay, late observations, malformed groups,
budgets, denied/late permissions and capture bounds. Browser verification uses
Chrome's synthetic video device with real permission control, JPEG codec,
IndexedDB, C routing and AML memory. Physical-phone measurements remain in TODO.

Hosted run [39453932639](https://github.com/ariannamethod/LALO/actions/runs/39453932639),
code `12f409ab`, passes all three jobs on Node v24.14.0 / Chrome 155.0.8059.39.
Desktop and 390-pixel screenshots were downloaded and visually inspected.

## 2026-10-20 — the device gives Don a place and an instant

The Device field requests one browser geolocation fix on an explicit click.
It appends latitude, longitude and horizontal accuracy as three linked-by-ID
scalar receipts. Source is `browser:geolocation`, subject `device:this-browser`.
The browser's measurement timestamp and the callback receipt timestamp remain
separate integer milliseconds. Each sample covers its one-millisecond observed
instant. Later and repeated fixes append independent groups; earlier movement
remains readable. No polling, watcher, map provider or external tile request.

The portable adapter validates complete groups, coordinates, accuracy and
timestamps. It builds a candidate journal before publication. The existing
IndexedDB compare-and-swap save publishes all three receipts before the UI
advances. Storage failure retains the previous displayed and persisted world;
damaged history blocks new observations. Budget: 256 samples / 768 receipts,
512000 bytes. The location request has a 15-second deadline including the
permission wait; late callbacks cannot add observations.

The field supports receipt-time rewind, selection by observed instant, local
reload and JSON export. The existing action panel accepts a subset of presets
so this world starts with active facts. Its unchanged C routing and AML action
memory boundaries support saved location calls and original-world replay.

Local Node v24.19.0 / GCC 13.3.0 / Linux x86_64: the initial core run passes
55 tests, including six new location gates; 19 native/AML integration tests
and all three examples also pass. C router and pinned AML build.
Local Chrome installation failed: package-manager identity operations are
unavailable, and the browser download returned an invalid archive. The hosted
browser gate exercises real browser permissions with explicitly synthetic CDP
coordinates, storage failure, rewind, reload, C calls, AML recall/replay and
390-pixel layout.

Hosted run [39449809165](https://github.com/ariannamethod/LALO/actions/runs/39449809165),
code `3d0e60ac`, passes all three jobs on Node v24.14.0 and Chrome
155.0.8059.39. The first browser attempt hit the existing 15-second Chrome
startup deadline before opening the application; its retry passed unchanged.
Desktop and 390-pixel screenshots were downloaded and visually inspected.

## 2026-10-20 — observations arrive outside the context window

The first event background receives bounded USGS batches independently of model
calls. `createBackground` keeps source observations and explicit `agent:*`
signals in the existing two-clock FactLedger, under one 1024-record / 2000000-byte
budget. USGS validation runs on the ordered source projection: complete versions,
event/source identity, companion fields, source updates and predecessor links.
Every mutation stages and validates a complete candidate before replacing the
world. A batch has at most 64 events. Exhaustion rejects the complete operation;
accepted history remains intact. Duplicate/stale source updates report counts.

The separate `usgs-attention-receipt/v1` policy resolves source revisions at the
knowledge cutoff, then filters origin times. Active, explicitly supplied
`attention_subject` signals rank matching events before receipt order and a
stable subject tie-break. Other scalar signals remain sourced state evidence.
The agent is a subject in the same world and can record its chosen focus through
this boundary. Acquisition of model-internal signals remains an open interface;
the prototype receives host/agent observations with explicit source and clocks.

Context is a fresh bounded projection: default eight complete event versions and
32768 UTF-8 bytes, including request, state evidence, policy, reasons and omission
counts. Callers replace the previous context. History stays outside that context
and remains readable by the existing tools. A correction moving an event outside
the requested window removes it without reviving its older version. Replay uses
the original request and policy and reports match/changed for the complete result.

`background.mjs ingest` consumes newline-delimited events without network access,
persists each accepted frame before EOF and permits independent local selection
readers. An exclusive lock serializes writers. A synced bounded staging file is
renamed over the journal, followed by directory sync; acknowledgments distinguish
saved/unconfirmed persistence. Invalid or torn frames stop with a visible error.
Interrupted lock/staging files require inspection and are never silently adopted
or deleted. `poll` explicitly requests one bounded fetch through the existing
USGS HTTP transport. No startup poll, scheduler or background network loop was
added. Persistent acquisition can be driven by an external producer independently
of any context reader.

Optional `select --memory` uses the existing AML v2 action/world storage, shared
snapshots, chain, streamed SHA-256 and canonical readback. A local selection action
has `request.kind = background-context`, a null route/call and its result. Its CLI
replay selects the saved sequence/head and opens that exact world; the six-tool
native router and routed-action replay retain their existing contracts. Failed
memory writes return the selected context with a separate failure acknowledgment.
No new dependency, source pin or memory format was introduced.

Verification: Node v24.19.0, GCC 13.3.0, Linux x86_64. All 77 tests pass: 57 offline
(`node --test tests/*.test.js`), six native (`node scripts/build-router.mjs` then
`node --test tests/native-router.integration.mjs`), 14 real AML (`node
scripts/build-aml.mjs` then `node --test tests/action-memory.integration.mjs`).
Eight new offline tests cover independent readers before input EOF, restart,
exclusive writers, broken/torn/oversized input, retained staging, source validation,
atomic record/byte limits, old and moved event times, state at both clocks, null
magnitude, deterministic ranking, complete-event UTF-8 limits and replay. The new
AML gate saves two worlds through the CLI, replays the first by sequence/head and
rejects its damaged snapshot. The pinned AML build repeats its existing
`am_tape_backward` allocation-bound compiler warning.

All four examples pass. The synthetic frame producer → persistent receiver →
selection → replay commands from docs/BACKGROUND.md also run locally. The new
example is in the existing core CI job. `git diff --check` passes. Local browser
gate (`node scripts/browser-check.mjs`) fails to launch with `spawn google-chrome
ENOENT`; no browser executable is installed. This change adds no visual surface.

## 2026-10-17 — the action keeps the world it read
## 2026-10-20 — WOLFE speaks AML; the C router stays the oracle

`aml/wolfe.aml` (1,207 lines) reproduces the vendored C router's whole
selection path — tokenization, the hash-projected lexical field, IDF,
Hebbian proximity, tool signatures, example scores, the Boltzmann layer,
the six-iteration attractor, thresholds and abstention — in AML, on the
five field intrinsics grown upstream for exactly this
(`ariannamethod.ai` branch `fable/field-organ`, commit `0db4861`:
`field_project`/`field_normalize`/`field_dot` carry the exact u64
FNV-1a/LCG word identity that float32 scalars cannot, plus scalar
`exp`/`log`). `vendor/wolfe/wolfe.c` is byte-untouched and remains the
golden oracle.

The measurement that shaped it: an honest float32 shadow of C-WOLFE
flips **zero of 68 decisions** at a thinnest margin of 2.05e-4 —
accumulation precision is not load-bearing in this architecture;
identity precision is. The forbidden move (silently narrowing double to
float32) was not taken; it was measured, and the real gap turned out to
be the hash, not the arithmetic.

**Status: measured artifact, not a replacement.** The router keeps
calling C WOLFE. Activation waits for the field organ to merge upstream
and for the `deps/aml` pin to move past it — then a separate decision.
Named limits: zero-argument tool schemas only (the extractor does not
exist in either body); neural mode only; the field vocabulary bound is
1,024 words; AML runs the 68-phrase corpus in 1.59 s against the
oracle's 16 ms, inside the router's 5 s budget.

### Verification

- `node scripts/wolfe-diff.mjs --aml <runner>` — decisions 68/68,
  evidence tokens 68/68, 64/68 output lines byte-identical, max
  |Δconfidence| and |Δmargin| 1.00e-6 (one ulp of the `%.6f` contract
  surface). Corpus: the 35 shipped examples plus held-out phrasings from
  this repo's tests plus stress lines — `tests/fixtures/wolfe-corpus.jsonl`.
- Red run: one attention constant in `wolfe.aml` (.78→.80) fails 67/68
  with deltas ~2e-2; restored by SHA, final run green. The harness bites
  drift well before a decision flips.
- `scripts/wolfe-aml-prep.mjs` emits the tool table byte-equal to the
  live selector's own `tools.json`.
- Oracle intact: `vendor/wolfe/wolfe.c` SHA unchanged (`dea0df2c…`);
  the pinned oracle rebuilds with `scripts/build-router.mjs`.

Action memory now retains the complete canonical source journal. Each new v2
action is staged as a directory containing `receipt` and `world.json`; AML
verifies the world's streamed SHA-256, then the host publishes both files with
one directory rename. A committed nonempty slot survives competing publication.
The loser rereads the chain and its budgets before retrying. Directory and file
synchronization feed the existing saved/unconfirmed/failed acknowledgment.

Identical worlds share a hard-linked inode. The existing 8 MiB budget now counts
accepted receipt bytes plus distinct stored world inodes, with the same limit
of 64 actions. Each world uses the existing 2 MB / 1024-fact tool budget. AML's
streamed file hash handles journals above its one-MiB text-input window; JS
performs a bounded read and verifies the exact digest, canonical encoding and
record count before returning a selected world. Timestamp integers travel
unchanged. No new dependency or source pin is introduced.

Version 1 receipt files retain their bytes and chain positions. New v2 bundles
extend the same sequence. Old hosts must stop before the directory is used by
the new writer. V1 worlds were not stored, so their recall remains a trace and
fingerprint. Explicit snapshot retrieval accepts a sequence and optional exact
receipt head; the UI supplies both. CLI: `action-memory.mjs DIRECTORY --snapshot
SEQUENCE`. Full chain readback and its expected-head check remain available.

Both fields offer **Open original world** beside a saved or recalled v2 action.
Its separate panel pages through the original receipts and inspects sources,
clocks and lineage. **Reproduce saved call** uses the recorded tool and explicit
arguments against a fixed JS host built from that world. Result comparison
ignores object-key order and reports match/change. Paging alters only the
evidence offset, preserving the complete reading and both clocks. The stored
trace remains visible above; the live field and its IndexedDB journal retain
their current state. Abstention still has a world to inspect and no call to
reproduce. The new portable boundary is `src/action-replay.js`.

Local verification: Node v24.19.0, GCC 13.3.0, Linux x86_64. All 68 tests pass:
49 offline, six native router/HTTP, 13 AML memory. The three examples pass.
New gates cover exact v1 preservation and mixed chains, actual shared inodes,
missing/corrupted worlds, selected old-world recall after later actions,
verification/readback above one MiB, and competing different snapshots against
one byte limit. Replay gates cover frozen input, original clocks, complete
inference through pages, visibly changed results, abstention and host errors.
The local Chrome retry returns ENOENT. The hosted browser gate now additionally
opens and reproduces both fields' original worlds after reload, compares the
stored result, checks live IndexedDB equality and retains 390-pixel screenshots.

Hosted code 6ffe65a passes all three jobs in
[39063591671](https://github.com/ariannamethod/LALO/actions/runs/39063591671) and
[39063587866](https://github.com/ariannamethod/LALO/actions/runs/39063587866), on
Node v24.14.0 and Chrome 155.0.8059.39. Screenshot inspection led to one visual
refinement: reproduced output now leads with the reading and selectable source
receipts, with complete JSON under details. The browser gate follows a returned
fact into the original-world inspector and compares its complete record.

## 2026-10-17 — Don Eduardo keeps the receipt after the lights go out

Optional action memory is alive. `--router --memory DIRECTORY` persists the
complete request, decision, call and result through AML, plus a digest/count
of the canonical source journal and a separate host save timestamp. No action
becomes a fact merely because it ran. The two observation clocks remain exact
integer milliseconds: AML transports the JSON as text instead of parsing its
numbers into float32. The portable JS core still has no external dependencies.

`deps/aml` pins ariannamethod.ai at
8ebc1b7e9333dcf062fdc32d3e6f935efd6f2595, the SUBLITERATUS revision inspected
in the preceding entry. `build-aml.mjs` verifies the pin and builds only the C
runner. Its source and license remain in the submodule. This compiler reports
an existing allocation-bound warning in `am_tape_backward`; the memory path
uses text/file/hash intrinsics, not autodiff. The compiled runner is 318192
bytes on the named local Linux host; this is an executable-size measurement,
not a phone performance claim.

Two original AML programs implement staged writes and independent readback.
Numbered single-line receipts link sequence, previous-line SHA-256, payload
SHA-256 and full JSON. Node publishes the completed inode with an exclusive
hard link and synchronizes the directory. Readers check 4096-byte windows,
Unicode boundaries, final LF, sequence and both hashes. Competing writers retry
a taken slot at most three times. Unpublished staging is outside accepted
history. Written-but-unsynchronized receipts are acknowledged once as
`durability_unconfirmed`; they are never silently repeated. Host execution
status survives a save failure, with a separate visible memory error.

Memory has explicit limits: 64 accepted actions, 8 MiB total, 201000 bytes per
receipt, 200704 payload bytes, and a shared five-second AML deadline per
operation. A full or damaged chain blocks further saves without erasing it.
An independently retained head can detect a missing suffix; hashes alone do
not authenticate the writer or prove that no tail was removed. The original
world journal remains separate; action memory stores its digest, not a second
copy of all facts. The complete contract is in docs/ACTION_MEMORY.md.

Both fields now show save acknowledgment and offer explicit last-action recall.
Recall verifies the chain and reads the stored trace without starting the
selector or executing a tool. Restored results retain their original scope,
do not mark the current world, and cannot page without their source journal.
No automatic recall occurs on reload. Response framing remains exact and
uncompressed, with 4096 bytes reserved above the action budget for the memory
envelope; the browser deadline is now 20 seconds.

Local verification: Node v24.19.0, GCC 13.3.0, Linux x86_64. All 59 tests pass
(45 offline, six existing native, eight new AML integration gates). The three
earthquake/tool-call/route examples pass. New gates use the real language and
selector, exercising host restart, millisecond and UTF-8 preservation, broken
payloads, invalid UTF-8, torn final LF, sequence gaps, missing tails, orphan
staging, count/byte limits, concurrent publication, unconfirmed sync, missing
and stalled interpreters, and a successful tool call whose save fails. The
local Chrome retry still returns `spawn google-chrome ENOENT`. Hosted runs of
code 6735aa5 pass all three jobs (core/native, AML memory, browser):
[39059566633](https://github.com/ariannamethod/LALO/actions/runs/39059566633) and
[39059563313](https://github.com/ariannamethod/LALO/actions/runs/39059563313).
They use Node v24.14.0 and Chrome 155.0.8059.39. Both fields pass real C calls,
AML persistence, explicit recall after reload, original-result comparison,
disabled paging/markers for restored traces and the strict network-error gate.
The 390-pixel recall screenshots were downloaded and visually inspected.

The faceless black-on-white identikit now lives in assets/lalo.png and README.
Generation mode, reference, actual dimensions and final prompt are recorded in
assets/README.md. Oleg's forthcoming visual idea about bidirectional Time is
parked in TODO.md without inventing its mechanics. Camera/GPS remain future
organs. This step gives the action a durable, inspectable history first.

## 2026-10-17 — intent leaves a visible mark

Crossing and USGS now call the optional native LALO body through the local
host. Each action submits a bounded journal snapshot and explicit arguments;
the existing route session selects and executes a tool. The UI displays its
activation, call, complete reading, evidence page and full action JSON. Returned
canvas receipts get dotted rings and link to the source/lineage inspector.

Time travel keeps the answer's original snapshot. New receipts, a different
event or either clock moving clear its markers; late responses obey the same
rule. Explicit argument edits survive world changes. Evidence paging resubmits
the original journal, intent and arguments with the returned offset, preserving
the complete inference even after the visible world advances. The latest action
is session-local and never becomes an observation in the fact journal.

The Node bridge is opt-in through --router, loopback-only, exact-origin JSON
POST, one in-flight upload/call. Limits: 2.1 MB body, five-second body deadline,
2 MB / 1024 journal receipts, existing native five-second deadline, 196608-byte
response, browser twelve-second total deadline. No new npm dependencies or
eager native initialization. Server shutdown closes the warm selector.

Verification on Node v24.19.0, GCC 13.3.0, Linux x86_64: 45 offline tests and
six native integration tests pass. The new gates exercise invalid origins and
uploads, UTF-8 and byte limits, concurrency, fixed-snapshot paging, host errors
and an actual C → HTTP → fact-reading call. The browser gate now builds the C
body and exercises both visual fields through real calls, including response
arrival after a rewind, complete inference through one-row pages, receipt
selection, abstention, argument errors and 390-pixel layout. Local Chrome launch
returned ENOENT. Hosted runs of code 0d8f9e6 passed both core and browser jobs:
[39057273429](https://github.com/ariannamethod/LALO/actions/runs/39057273429) and
[39057266909](https://github.com/ariannamethod/LALO/actions/runs/39057266909),
on Node v24.14.0 and Chrome 155.0.8059.39. Desktop and 390-pixel screenshots
were downloaded and inspected.

Earlier browser runs completed the behavior assertions but intermittently
reported cancelled /api/action fetches. Removing an explicit completed-reader
cancel and adding Content-Length alone did not settle that failure. The final
transport requires exact uncompressed byte framing within the response budget,
reads the bounded body through fetch's native arrayBuffer completion and checks
its received length and UTF-8. Both final runs passed the unchanged strict
network-failure gate. Diagnostic output retains each failed synthetic request.
Receipt buttons now scroll their source inspector into view, respecting reduced
motion.

### AML reference: the next persistent action organ

Inspected SUBLITERATUS at 6d517255b1222c408da70a79b9a54bdb72d4d112. Its second
pinned submodule is deps/aml from ariannamethod.ai at
8ebc1b7e9333dcf062fdc32d3e6f935efd6f2595. The actual integration is
research/operations/vnext/journal.aml and journal_verify.aml, built by make aml
and checked in its separate CI job. They use file_size/file_read_slice for
bounded byte reads, file_append_line for appends and text_hash_sha256 for an
append-only sequence with genesis/resume/close records. The verifier reads
4096-byte windows and catches broken chains, missing closure and a torn final
line. Append status distinguishes durable success from a completed write whose
synchronization was not confirmed; the latter is not retried.

Reference verification on the same Linux host: make aml succeeded; the pinned
language core passed 550/550 checks and journal_test.sh returned VNEXT_OK 40.

A concrete next use here: an optional AML program persists and independently
rereads action receipts across host restarts, with the head kept for readback.
Keep the JS two-clock journal as the source of world facts. Send complete action
JSON as text to preserve its exact integer timestamps through AML's float32
runtime; bind its digest and the source snapshot digest into the action record.
The persistence step needs a working append/resume/readback gate before adding
the pinned language dependency. No AML code or dependency is added in this step.

## 2026-10-16 — LALO selects a tool and follows through

The optional native body now connects intent selection to the six existing
world tools. `src/route.js` owns a portable dispatch boundary and a versioned
`lalo/action` trace: explicit request, neural decision, selected call and the
unchanged tool result. A high routing activation never becomes factual
reliability. Rule readings retain their premises, source URLs/IDs, revision
history and both clocks. Evidence paging still uses the complete conclusion.

### The extraction failure that set the boundary

The first probe gave WOLFE the full schemas and argument templates. For
`read active facts for crossing:north valid at 1000 known at 1300`, selection
found lalo_facts but could not distinguish the two clock slots. A history
query sometimes omitted the colon-bearing subject, which would broaden its
scope. Quoting preserved a UTF-8 subject but did not resolve the clock clash.
These failures are not papered over with example values or the current time.

Selection heads therefore declare zero arguments. The intent text selects a
tool; a separate explicit JSON object supplies every clock, filter, ID, rule
and pagination value. The existing tool host validates that object. Missing
required arguments fail. No text-derived defaults are inserted. Unknown tool
names, multiple calls and generated arguments are rejected before execution.
No-call and ambiguous decisions execute nothing. The public MCP schemas remain
complete and continue to serve clients that already select their own tools.

The first corpus has 35 English examples plus 12 native name/description
examples. Six held-out phrasings select and execute all six tools in tests.
This is a small integration corpus, not a general language benchmark: an
additional probe, “could you show known subjects”, abstained. The runtime
preserves such abstentions; it does not force a successful call.

### Body and lifetime

Imported `wolfe.c` and its exact GPL-3.0 license from
`ariannamethod/wolfe@a04d2b7e6488656b715ca6b5b5ef5b1227eea79d`, unchanged.
Source hashes and update procedure are in `vendor/wolfe/README.md`. The build
checks the source hash before compiling C99 with libc/libm. It adds no package
dependency. A path-specific Git whitespace attribute preserves the upstream
license's final blank line byte-for-byte. NoTorch JS Tensor/matmul and C
attention/value APIs were inspected;
this step retains the upstream numerical body for later parity comparison.
NoTorch and AML are not yet linked into the routing body.

`scripts/native-router.mjs` creates private temporary selector definitions,
starts the C batch process lazily and keeps its field warm. One request can be
in flight. Startup/exit, invalid JSON, oversized output and timeout failures
stop the worker visibly. Close kills/reaps the process and removes temporary
files. No correction memory, feedback, training, network or model download is
enabled. `scripts/route.mjs` reads one journal, processes bounded JSONL requests
serially, writes traces with backpressure and closes the worker on EOF.
Traces are caller-owned action records, not newly asserted world facts.

Limits: 2047 UTF-8 intent bytes, 96 native tokens, 32 KiB request, 16 KiB native
decision, 64 KiB tool result, 192 KiB complete trace, five-second call deadline
and 4 KiB retained native stderr. The portable core, browser fields and MCP
server continue to run without a C build. Usage: [ROUTING](docs/ROUTING.md).

### Verification

Linux x86_64, Node v24.19.0, GCC 13.3.0: 41 portable tests and five native
integration tests pass (46 total). All three examples pass. The native suite
executes real neural selection and world tools, two-clock rewinds, UTF-8 scope,
future-ID refusal, complete contested inference with one-row evidence,
no-call/ambiguous requests, missing explicit clocks, concurrency rejection,
worker startup/crash/protocol/timeout failures, framing recovery and EOF exit.
The portable suite also rejects fabricated decisions and checks argument
ownership across asynchronous selection. `git diff --check` passes.

Local `-O2` executable: 97,928 bytes; pinned C source: 109,866 bytes; intent
corpus: 2,317 bytes. The native stats probe reports six tools, 47 examples,
116 vocabulary entries, 96 field dimensions, six iterations and 921,136 bytes
of model capacity. Model capacity is the engine's own allocation accounting,
not process RSS. No phone or browser-native performance claim is made.
The browser gate adds a portable dispatcher check with an explicitly synthetic
decision; the actual native field is tested separately. Code `73a8104` passed
both jobs in hosted runs
[38836537607](https://github.com/ariannamethod/LALO/actions/runs/38836537607)
and [38836498624](https://github.com/ariannamethod/LALO/actions/runs/38836498624)
on Node v24.14.0. The C build, 41 portable and five native tests, three examples,
browser dispatcher, and both existing visual-world scenarios all passed.

## 2026-10-16 — models get a call boundary

`src/tools.js` exposes six tools: session status, known subjects, active facts,
receipt history, revision lineage and a rule reading with classified evidence.
Each host copies one validated journal snapshot. Caller mutation, continued
ingestion and edits to returned data cannot move its pagination or answers.
All historical rows and counts obey knownAt; active facts and rules also obey
validAt. Requesting a future ID produces the same NOT_FOUND as an absent ID.

The visual field and tool host now share `magnitudeHypothesis` alongside the
existing boolean rule. A conclusion uses all active premises before its
evidence is paged. Responses retain source, ID, predecessor, role and the
intersection of premise intervals. Explicit unknown magnitude stays unknown.
The direct JS example walks a contested reading one premise at a time.

### Interface and transport

Tool arguments are flat primitives with explicit clocks, filters and paging.
The definitions use WOLFE's accepted schema subset; runtime validation also
enforces the text budgets stated in their descriptions. No implicit coercion
or ignored rule parameters. Structured errors identify malformed arguments,
unknown receipts, invalid premises and exhausted response budgets.

The stdio entry point is `node scripts/mcp.mjs --journal journal.json`.
`src/mcp.js` handles initialization, ready notification, ping, tool discovery
and calls for MCP 2025-11-25. It advertises only the fixed tools capability.
Results include structured JSON and matching serialized text. stdout contains
protocol messages; diagnostics use stderr. Closing stdin ends the session.
The journal loads once; a new process loads the next snapshot.

Contracts checked against the official
[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
specifications. Full usage and response semantics: [TOOLS](docs/TOOLS.md).

Budgets: 1024 records, 2 MB journal, at most 64 rows and 64 KiB per tool result,
32 KiB per input frame and 256 KiB per output frame. Byte-limited pages stop
at whole rows and expose continuation offsets. A single row that exceeds the
chosen host result budget fails explicitly. Oversized input is discarded to
the next newline before processing resumes. Serial processing and awaited
stdout writes apply backpressure. Shared bounded file loading now serves
both the source CLI and MCP process, with strict UTF-8 decoding.

### Verification

Node v24.19.0, Linux x86_64: 37 offline tests pass. Both examples pass. Added
tests cover historical visibility, fixed snapshots, UTF-8 byte pagination,
complete inference with partial evidence, shared visual/tool results, schema
errors, protocol lifecycle, malformed/oversized frames and real subprocess
stdin/stdout with EOF shutdown. The browser gate additionally imports the
portable tools and checks a three-premise conflict through a one-row page.
Code `3fe9cdc` passed both jobs in hosted runs
[38815893665](https://github.com/ariannamethod/LALO/actions/runs/38815893665)
and [38815890147](https://github.com/ariannamethod/LALO/actions/runs/38815890147),
on Node v24.14.0 and Chrome 155.0.8059.39. The portable tool check and both
existing visual-world scenarios passed.

A separate MCP subprocess opened the earlier live USGS journal and returned
all six known subjects from its 48 receipts. The source observations remain
outside the repository.

Compatibility probe against WOLFE `a04d2b7e6488656b715ca6b5b5ef5b1227eea79d`:
its existing C loader accepted all six generated definitions. With one explicit
example, “read journal status” returned `lalo_status` with empty arguments.
The probe binary and example file stay outside this repository. LALO's router
body is the next integration; this change supplies its executable world tools.

## 2026-10-16 — the source journal enters the field

`/web/usgs.html` reads earthquake observations into the visual field. The
crossing and USGS have separate entry points and IndexedDB keys, sharing the
journal, transactional storage and canvas renderer. Opening or reloading a
field performs no source request. Read USGS fetches the past-hour feed once;
the complete candidate is saved before the displayed world advances.

The CLI and browser now share a bounded HTTP transport: 2 MB, 15 seconds,
explicit HTTP/body failures, streaming UTF-8 decoding, and omitted credentials.
The portable ingestion boundary still owns no I/O. A source-header check on
2026-10-15 returned HTTP 200 and `Access-Control-Allow-Origin: *`; the field
calls USGS directly without a proxy or an API key.

### Reading and replay

The named rule `magnitude-at-least/v1` asks whether magnitude is at least 3.
It returns the exact active premise IDs and their intersected interval.
Explicit null magnitude remains unknown and unsettled. Magnitude receipts
drive the contour, revisions and selectable nodes; the selected version's
companion facts expose place, coordinates, depth, event type, source update
time, origin time, receipt time and a source link.

The knowledge slider steps through receipt times. Its event catalog, metadata,
nodes, links and contours exclude future receipts. The world selector lists
known origin instants and their one-millisecond interval ends. A corrected
origin retires the old assertion across its whole interval. Selecting an old
version still shows its old coordinates and place. Rewinding preserves the
selected world instant when it remains among known choices; otherwise it
follows the latest origin known then. Latest knowledge follows the latest
known origin explicitly.

Import accepts a complete, canonical USGS adapter journal. Every version is
validated as eight coherent facts with canonical IDs, source, time and
predecessors. An existing journal accepts only an exact prefix extension;
historical receipts cannot be replaced or retimed. Export returns the same
versioned JSON for CLI `--prior`. Equal imports and repeated polls append
nothing. Source absence from a rolling feed still preserves earlier events.

The USGS field has 1024 receipt and 2 MB UTF-8 budgets. Save failures leave
the displayed and stored history intact; corrupt saved data blocks writes
and preserves its bytes. Both fields retain compare-and-swap revision checks.
No additional npm packages, model initialization or background polling.

### Verification

Node v24.19.0, Linux x86_64: `node --test tests/*.test.js` passes 28 offline
tests; `node examples/earthquake.js` passes. New cases cover old metadata,
origin corrections, unknown magnitude, exact import extension, malformed
companion facts, UTF-8 split across chunks, response budgets and timeout.

The browser gate adds synthetic intercepted HTTP for the real source UI:
on-demand fetching, repeated polls, both clocks, old metadata, null magnitude,
reload, failed save/feed, actual file export/import, phone width and isolated
corrupt journals. The first PR run
[38813855864](https://github.com/ariannamethod/LALO/actions/runs/38813855864)
passed both jobs on Node v24.14.0 and Chrome 155.0.8059.39. Desktop and
390-pixel screenshots were inspected; canvas labels are clamped inside the
field at narrow widths. The parallel push run 38813852005 exposed a gate
startup race: its ready probe accessed `documentElement` before it existed.
The probe now waits through that state. Final code `a5b5c7d` passed both jobs
in [38814196851](https://github.com/ariannamethod/LALO/actions/runs/38814196851)
and [38814206631](https://github.com/ariannamethod/LALO/actions/runs/38814206631).

A live CLI poll using the shared transport added three events to the earlier
saved journal: 48 receipts across six events. Source validation and all six
magnitude projections succeeded. Live observations remain outside the repo.

## 2026-10-16 — local continuity and the first external source

### Persistence

`src/journal.js` encodes versioned JSON and restores it through FactLedger's
validation. Byte and record budgets are caller-owned; unknown versions,
malformed records and budget overruns fail explicitly. Crossing replay derives
its script position and user lineage from validated receipts, then continues
without reusing IDs or resetting the receipt clock.

The browser saves the crossing in IndexedDB. Each action builds a candidate
world, commits its snapshot in one transaction with an expected revision, and
only then replaces the displayed world. Conflicting tabs cannot silently
replace each other's snapshots. Save failure retains the previous world;
corrupt saved data blocks startup without overwriting it. Reset requires a
second explicit click and commits through the same revision check. The saved
world is bounded to 64 receipts and 128 KB of UTF-8 journal text. Reload opens
at latest knowledge and the scenario's default world time.

### USGS adapter

Source contract: [USGS GeoJSON Summary](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).
`src/sources/usgs.js` is a portable, pure ingestion boundary. The on-demand
CLI `node scripts/usgs.mjs` fetches the past-hour feed. `--prior` replays an
existing journal; `--input` accepts a feed file for offline use. The resulting
journal goes to stdout and poll counts to stderr. Use a new output file for
each poll, preserving the input journal.

Each event version contributes eight scalar claims: magnitude, magnitude type,
longitude, latitude, depth, place, event type and source update timestamp.
Source IDs and update timestamps form stable record IDs. Event time defines
the one-millisecond world interval; receipt time is measured after the response
is read. Source update time remains a separate claim. Null magnitude stays
null. A new source version supersedes each corresponding prior claim, including
when origin time changes. Identical versions do not duplicate records; older
versions are counted as stale. Same-version content changes fail explicitly.
Absence from a later feed does not retract an earlier event.

A poll stages its complete result on a new ledger. Malformed events, duplicate
event IDs, incomplete prior versions and budget failures leave the caller's
journal intact. Defaults: 500 feed events, 1024 journal records, 2 MB input,
15-second HTTP timeout. No external packages or scheduled fetching. The visual
crossing and the CLI source journal are separate consumers of the same core;
a live source view follows this ingestion boundary.

### Verification

Node v24.19.0, Linux x86_64: 23 offline tests pass. Added coverage exercises
snapshot replay and continuation, format and capacity failures, actual source
revision mechanics using synthetic fixtures, stale and duplicate polls,
changed origin times, atomic batch failure and explicit unknown magnitude.

An on-demand live USGS request returned three events and produced 24 records.
A second request returned two unchanged events; the journal still held all 24
records, with the first poll preserved byte-for-byte. Live observations and
generated journals remain outside the repository.
Browser verification now also covers saved-world reload, continued user
lineage, injected save failure, concurrent revision checks, and preservation
of a corrupt snapshot. The gate remains offline.

Hosted run [38810118438](https://github.com/ariannamethod/LALO/actions/runs/38810118438)
passed both jobs on Node v24.14.0 and Chrome 155.0.8059.39. The browser gate
passed reload, resumed lineage, injected quota failure, two concurrent writes,
and corrupt-snapshot preservation as well as the existing visual interactions.
The pull-request run 38810123545 also passed.

## 2026-10-15 — a crossing, three witnesses, a visible history

LALO now has its first visual observation loop. The WOLFE descendant will itself
be named LALO; its tool calling body is a subsequent implementation step.

### What runs

- The synthetic North crossing receives five scripted reports. Two independent
  sources first say open, a third says closed, then the first two correct their
  own reports. Interface observations append their own revision lineage.
- The named rule `unanimous-boolean/v1` reads current boolean premises through
  both clocks. It returns unsettled (none), supported (all match), contested
  (both values), or contradicted (all oppose), with premise IDs and the
  intersection of their world intervals. Results are rebuilt from the journal.
- The visual projection includes only receipts known at the selected time.
  Correction links and historical outlines obey the same cutoff. Rewinding
  recovers the earlier projection exactly; expired claims remain inspectable.
- Canvas 2D shows witnesses, the hypothesis contour, fractures for opposing
  premises and earlier contours. Receipt selection exposes source, validity,
  receipt time and lineage. Two independent sliders control the two clocks.
- Geometry eases into a new reading over 800 ms; reduced motion skips it.
  Animation stops after that transition. Device pixel ratio is capped at 2.
- The demo budget is 64 records, with no eviction. It displays at most six old
  outlines while the receipt list retains every known row. Data is in memory;
  reset or reload starts a new synthetic run. No source fetch or model loads.
- A small Node static server serves the portable ES modules and UI. Runtime,
  development and browser-check npm dependencies remain zero. The browser gate
  drives an installed Chrome using Node's built-in WebSocket and CDP.

### Reference decisions

Rebecca supplies the material direction: slate, ink, layered contours, erosion,
contradictions and inertia. Its rereading becomes an explicit historical
projection here. Netta.Sonar supplies the input/action/visible-trace principle.
Utopia supplies the temporal and premise lineage design already recorded below.
The new implementation is written for LALO; supplied reference files and Netta's
corpus remain outside this repository.

Supplied reference SHA-256 identities:

```text
rebecca(1).html: acb72315926fc5dc9504f1572ea75300a14d117408ca1b3da78f38b7520da477
NETTA.SONAR.html.html: 50de68a639f1299a2ad37e9b158d9c880150508d1dc6716900c7e14692901646
```

The next sequence is durable local replay, a real source adapter, then richer
ontology and the LALO caller. Geography and relation-space will be two views
of the same receipts. AML, NoTorch, camera and GPS retain their planned roles.

### Verification

Node v24.19.0, Linux x86_64: `node --test tests/*.test.js` passes 17 tests.
The six added tests cover disagreement, historical projection without future
leaks, world interval boundaries, premise interval intersection, user revision
lineage and atomic rejection at capacity. The earthquake demo still runs.
Syntax checks and `git diff --check` pass.

Local installed Chrome launch failed at ProcessSingleton with
`socket() failed: Operation not permitted`. The hosted browser gate exercises
1280 × 1000 and 390 × 844 layouts, receipt selection, corrections, both clocks,
interface observations and touch hit-testing, and retains screenshots.

Hosted run [38807631828](https://github.com/ariannamethod/LALO/actions/runs/38807631828)
passed on Node v24.14.0 and Chrome 155.0.8059.39, Linux x86_64. Desktop and
phone screenshots were downloaded and inspected. Inspection prompted one
layout adjustment: move the selected receipt details above the receipt list
so desktop users can see lineage without scrolling the sidebar. The browser
gate now checks that visibility explicitly.

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
