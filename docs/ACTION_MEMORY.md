# Actions survive a restart

The optional host memory stores the full `lalo/action` trace: request, routing
decision, explicit call, result and errors. Each new action retains the complete
canonical journal used by that call, its SHA-256, byte and record counts, plus the host's save
time in integer Unix milliseconds. That save time does not replace either
world time or receipt time in the underlying observations.

## Run

Node 24, a C99 compiler, make and a filesystem supporting hard links and fsync:

```sh
git submodule update --init deps/aml
node scripts/build-router.mjs
node scripts/build-aml.mjs
node scripts/serve.mjs --router --memory build/action-memory
```

No npm packages. The portable JS core and ordinary visual field do not load
or require AML. The pinned language is an optional Git submodule at
`8ebc1b7e9333dcf062fdc32d3e6f935efd6f2595`; its own license and attribution stay
in `deps/aml`. Build checks that pin. Only its C interpreter is compiled.
The pinned compiler currently warns about an allocation bound in the existing
autodiff code; LALO does not use that code in these memory programs.

`--memory` requires `--router`. The host binds to `127.0.0.1`; both API routes
require same-origin JSON POSTs. The directory comes from the host's CLI, never
from a model or browser request, and is outside the static routes. Store private
actions in an appropriately protected directory. The example lives under the
ignored `build/` directory. No device observations belong in source commits.

The host validates existing history before listening and before each append.
Saving follows every completed route trace, including abstention and tool errors.
Rejected HTTP envelopes are not action traces and are not saved.

## Read it back

Both visual fields have **Recall last saved action**. Recall is explicit; it
does not start the neural selector or rerun the tool. The restored trace shows
its original result and snapshot identity. **Open original world** loads the
verified journal into a separate read-only panel: browse its receipts, inspect
their exact clocks and follow lineage. The live field and IndexedDB journal
retain their current state. Snapshot receipt lists page in groups of 16.

**Reproduce saved call** executes the recorded tool and explicit arguments
against that fixed original journal through the portable JS host. The original
neural selection remains recorded in the trace. The result is compared with
the saved result, ignoring object-key order; a match or change is visible.
**Next reproduced page** keeps the tool, clocks, filters and complete inference,
changing only the evidence offset. The original action remains available above.
An abstaining action has an inspectable world and no tool call to reproduce.

`POST /api/memory` with `{}` returns `lalo/action-recall`, version 1, with the
latest verified receipt or `null` for an empty memory. It is host-wide: crossing
and USGS share the configured directory. Optional fields are `sequence` (1–64),
`head` (the selected receipt's SHA-256) and `snapshot` (boolean). A snapshot
request returns `journal` alongside `receipt`. The UI supplies both sequence
and head so a later action cannot change which world it opens. All reads verify
the chain first. The complete chain and selected world are available locally:

```sh
node scripts/action-memory.mjs build/action-memory
node scripts/action-memory.mjs build/action-memory --head SAVED_SHA256
node scripts/action-memory.mjs build/action-memory --snapshot 2
```

The optional head is an earlier acknowledgment kept outside the directory.
Unkeyed hashes detect broken contents and links; they do not authenticate the
writer. Without an external head, deleting a suffix leaves a valid shorter
chain. Even an expected head does not recover missing data.

## On disk

Each new `000001.action`, `000002.action`, … directory contains `world.json`
and a `receipt` file. The receipt contains one UTF-8 line:

```text
sequence|previous-line-sha256|payload-sha256|complete-JSON-payload\n
```

The first previous head is SHA-256 of the empty string. Each next head hashes
the complete preceding line **without** its final LF. Only the first three
pipes are delimiters; JSON text may contain pipes and escaped newlines.

`aml/action-write.aml` formats and appends one staged receipt using
`file_append_line`. The host writes and synchronizes the canonical world first.
`aml/world-verify.aml` streams its full SHA-256 using the language's file hash
intrinsic, including journals larger than AML's one-MiB text-input window.
The host synchronizes the completed staging directory, renames it into its
numbered slot, then synchronizes the containing directory. Both files appear
together. A committed nonempty directory cannot be replaced by this rename.
Competing writers reread the chain and retry a taken slot at most three times.
One HTTP action or recall occupies the host at a time.

Identical journals reuse a hard link to an earlier stored world. A competing
writer that loses publication retries against the winning chain and reuses its
snapshot when the digest matches. The shared byte budget counts receipt bytes
plus distinct world inodes. A backup restored without hard links consumes more
of that budget; the reader measures the actual stored inodes.

`aml/action-read.aml` is an independent verifier: bounded 4096-byte reads,
UTF-8 byte advancement, complete final newline, exact sequence, previous head
and payload hash. JSON numbers remain text in AML, preserving JavaScript's
safe integer timestamps through the language's float32 runtime. Node validates
the payload envelope after verification. Each distinct stored world is also
checked for regular-file type, exact byte length and SHA-256. Selected readback
uses a bounded Node file read, checks its digest again and decodes the canonical
JS journal with its original integer clocks and record count. Missing, malformed and damaged records
fail visibly. Earlier receipts are never repaired or evicted automatically.

A crash before publication may leave a `.pending-*` directory with staged
files or hard links. It is not part
of accepted history. Retain it for inspection or remove it manually with the
host stopped. A crash after publication may leave a valid receipt even if the
client did not receive an acknowledgment. Read back before deciding to repeat
an action; there is no request deduplication or automatic retry on reconnect.

## Existing memories

Stop the old host before upgrading or running the new writer against its
directory. Version 1 `NNNNNN.receipt` files keep their exact bytes and position
in the chain. New writes use payload version 2 inside `NNNNNN.action` bundles.
Both formats can coexist in one chain. A duplicate sequence is rejected.
Version 1 receipts retain their original snapshot fingerprints; requesting a
stored world for one returns `MEMORY_SNAPSHOT`. There is no inferred backfill
or migration of old facts. The original-world button appears for v2 snapshots.

## Acknowledgments and limits

The HTTP action retains its execution status and adds a `memory` field:

| State | Meaning |
| --- | --- |
| absent | Memory disabled; trace is session-local. |
| `saved` | World-file, receipt-file, staging-directory and containing-directory synchronization succeeded; sequence and head are included. |
| `durability_unconfirmed` | Receipt was published, but synchronization was not confirmed. It is never appended a second time automatically. |
| `failed` | Persistence failed; code and message explain why. Execution/result remain visible. |

Readback in the UI labels a verified stored trace `recalled`. This is not a new
save acknowledgment. Synchronization success describes system calls, not a
guarantee against every filesystem, hardware or parent-directory failure.

Budgets: 64 accepted actions, 8 MiB shared by receipts and distinct world inodes,
201000 bytes per receipt file, 200704 bytes per payload, 2000000 bytes / 1024
facts per world, and the existing 196608-byte action limit. AML processes
share a five-second deadline per read/append operation. Staging is separate from
the accepted-byte count. Full means an explicit error with prior history intact;
there is no compaction, rotation or silent eviction. Browser trace responses
allow the action plus 4096 envelope bytes. Explicit world readback allows the
2 MB journal plus the action budget and 8192 envelope bytes. Both use exact
uncompressed Content-Length framing and a 20-second browser deadline.

## Gate

```sh
node --test tests/action-memory.integration.mjs
node --test tests/action-replay.test.js
node scripts/browser-check.mjs
```

The first uses real AML and C bodies, including restart, exact Unicode/timestamps,
corruption, truncation, budget exhaustion, concurrent publication, failed writes,
unconfirmed synchronization and stalled interpreter faults. The browser gate
also requires installed Chrome and verifies manual recall after reload, original
world inspection and deterministic call reproduction in both fields, including
unchanged live IndexedDB contents. The storage gate covers mixed v1/v2 chains,
shared inodes, damaged/missing worlds, concurrent byte-budget exhaustion and
streamed verification of a world larger than one MiB. Screenshots are retained
at desktop and 390-pixel widths.
