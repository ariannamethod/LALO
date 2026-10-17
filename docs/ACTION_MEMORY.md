# Actions survive a restart

The optional host memory stores the full `lalo/action` trace: request, routing
decision, explicit call, result and errors. It also records the SHA-256 and
record count of the canonical journal used by that call, plus the host's save
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
its original result and its snapshot digest in the complete JSON. It adds no
facts and makes no marks on the current world's canvas. Paging is disabled for
a restored trace because memory keeps the snapshot digest, not the full journal.
Keep/export the fact journal separately if you need to reproduce the call.

`POST /api/memory` with `{}` returns `lalo/action-recall`, version 1, with the
latest verified receipt or `null` for an empty memory. It is host-wide: crossing
and USGS share the configured directory. The complete chain is available locally:

```sh
node scripts/action-memory.mjs build/action-memory
node scripts/action-memory.mjs build/action-memory --head SAVED_SHA256
```

The optional head is an earlier acknowledgment kept outside the directory.
Unkeyed hashes detect broken contents and links; they do not authenticate the
writer. Without an external head, deleting a suffix leaves a valid shorter
chain. Even an expected head does not recover missing data.

## On disk

Each immutable `000001.receipt`, `000002.receipt`, … contains one UTF-8 line:

```text
sequence|previous-line-sha256|payload-sha256|complete-JSON-payload\n
```

The first previous head is SHA-256 of the empty string. Each next head hashes
the complete preceding line **without** its final LF. Only the first three
pipes are delimiters; JSON text may contain pipes and escaped newlines.

`aml/action-write.aml` formats and appends one staged receipt using
`file_append_line`. The host publishes the completed inode with an exclusive
hard link, then synchronizes the containing directory. An existing sequence
cannot be overwritten. Concurrent writers reread the chain and retry a taken
slot, at most three times; no automatic tool execution is involved in that retry.
One HTTP action or recall occupies the host at a time.

`aml/action-read.aml` is an independent verifier: bounded 4096-byte reads,
UTF-8 byte advancement, complete final newline, exact sequence, previous head
and payload hash. JSON numbers remain text in AML, preserving JavaScript's
safe integer timestamps through the language's float32 runtime. Node validates
the payload envelope after verification. Missing, malformed and damaged records
fail visibly. Earlier receipts are never repaired or evicted automatically.

A crash before publication may leave a `.pending-*` directory. It is not part
of accepted history. Retain it for inspection or remove it manually with the
host stopped. A crash after publication may leave a valid receipt even if the
client did not receive an acknowledgment. Read back before deciding to repeat
an action; there is no request deduplication or automatic retry on reconnect.

## Acknowledgments and limits

The HTTP action retains its execution status and adds a `memory` field:

| State | Meaning |
| --- | --- |
| absent | Memory disabled; trace is session-local. |
| `saved` | AML file synchronization and host directory synchronization both returned success; sequence and head are included. |
| `durability_unconfirmed` | Receipt was published, but synchronization was not confirmed. It is never appended a second time automatically. |
| `failed` | Persistence failed; code and message explain why. Execution/result remain visible. |

Readback in the UI labels a verified stored trace `recalled`. This is not a new
save acknowledgment. Synchronization success describes system calls, not a
guarantee against every filesystem, hardware or parent-directory failure.

Budgets: 64 accepted actions, 8 MiB of accepted receipts, 201000 bytes per file,
200704 bytes per payload, and the existing 196608-byte action limit. AML processes
share a five-second deadline per read/append operation. Staging is separate from
the accepted-byte count. Full means an explicit error with prior history intact;
there is no compaction, rotation or silent eviction. Browser responses allow
the action plus 4096 envelope bytes, and the total browser deadline is 20 seconds.

## Gate

```sh
node --test tests/action-memory.integration.mjs
node scripts/browser-check.mjs
```

The first uses real AML and C bodies, including restart, exact Unicode/timestamps,
corruption, truncation, budget exhaustion, concurrent publication, failed writes,
unconfirmed synchronization and stalled interpreter faults. The browser gate
also requires installed Chrome and verifies manual recall after reload in both
fields. Phone-width screenshots are layout evidence, not a mobile-device speed
or installation claim.
