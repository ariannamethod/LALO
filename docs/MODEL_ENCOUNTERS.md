# A model asks Don

Working with an LLM is one optional activity of LALO. The world receiver,
instruments, tools and AML memory remain independently callable. Importing the
model encounter module starts no model or numerical work.

The first native encounter runs **Gemma 3-270M-IT Q8_0** in the pinned NoTorch
Harness. Gemma generates a question, Don reads his world, and Gemma receives
the actual source receipts and generates an answer. Don records both utterances
as observations about that model, with their token counts, weight identity and
observation/receipt times. The earthquake source retains its own assertions.

## Run the complete experiment

Node 24, a C compiler, Git and make are sufficient. The build uses NoTorch's
native CPU kernels. Initialize these dependencies when choosing this activity:

```sh
git submodule update --init deps/aml deps/notorch
node scripts/build-router.mjs
node scripts/build-aml.mjs
node scripts/build-notorch.mjs
mkdir -p build/models
curl -fL --retry 2 https://huggingface.co/ggml-org/gemma-3-270m-it-GGUF/resolve/e7647be17ae1108f2f605ed061ca0608b171afff/gemma-3-270m-it-Q8_0.gguf -o build/models/gemma-3-270m-it-Q8_0.gguf
node examples/model-earthquake.mjs build/models/gemma-3-270m-it-Q8_0.gguf build/model-plain
node examples/model-earthquake.mjs build/models/gemma-3-270m-it-Q8_0.gguf build/model-experts --experts
```

Each experiment takes a **new directory** and preserves its sources, scopes,
complete encounters, AML receipts, world snapshots and replay. The expert run
also preserves each native spore. The model adapter verifies the GGUF SHA-256
`0ef57d2c838458a1952664260dcba38e5bdda37494f3af732f06e4add24068e3` before generation.

The quake sources are synthetic. Model generation, native routing, expert
updates and AML persistence execute their real implementations. Separate Node
processes perform the first encounter, corrected encounter and old-answer replay:

| Stage | Source magnitude | Gemma's recorded answer |
|---|---:|---|
| First source receipt | 2.9 | The magnitude of the earthquake is 2.9. |
| Later correction to that receipt | 3.4 | The magnitude of the earthquake is 3.4. |
| Reopen the first AML encounter | 2.9 | The magnitude of the earthquake is 2.9. |

Both native modes produced these answers in the initial Linux x86_64 run.
The experiment asserts the values and predecessor link. It also checks that
the new expert process starts with the exact SHA-256 saved after the first answer.

## Ordinary words and an explicit focus

This first language contract answers magnitude questions about **one selected
USGS event**. The host names the focus and both clocks; the model speaks ordinary
English and supplies no JSON or tool schema. For example:

```json
{"subject":"usgs:synthetic1","validAt":1792065600000,"knownAt":1792065602000}
```

“What is the magnitude of this earthquake?” binds to that scope. Supported
whole-question variants are defined in `bindModelQuestion`. The bridge records
the original question, the binding rule and the provenance of every argument.
The native selector receives the original question verbatim, including its
whitespace. Nine added field examples cover earthquake magnitude requests and
their negations. The existing tool host validates the explicit arguments.
Bindings use version 2; saved version 1 encounters retain their canonical
intent during replay.

Questions naming another date, region or event, adding another request, or
otherwise falling outside this contract return `MODEL_QUESTION_UNRESOLVED`.
Their actual utterance remains in the encounter. No broader scope is silently
selected. Free date/region extraction and additional question families can be
added as separately versioned bindings.

To use an existing journal, create a scope file and choose a fresh encounter ID:

```sh
node scripts/model-encounter.mjs --model build/models/gemma-3-270m-it-Q8_0.gguf --journal build/world.json --scope build/scope.json --memory build/model-memory --id encounter-1
node scripts/model-encounter.mjs --memory build/model-memory --replay 1
```

The input journal is read-only. The acknowledged AML action owns the resulting
world snapshot. Replay retrieves the exact saved speech, validates its signal
receipts and binding, and recomputes Don's source read at the saved clocks.
It requires neither model weights nor a running model. A fresh model generation
is a new encounter with its own ID.

## Two directions, two kinds of records

`src/model-encounter.js` accepts injected `model.generate`, router and clock
providers. It is portable JavaScript; Node owns the process adapter and AML
publication. Every model result is detached at its return boundary. A frozen
world snapshot supplies the whole encounter's source read.

Each question or answer appends one atomic group of ordinary `signal` facts:

| Predicate | Observation |
|---|---|
| `utterance` | Exact model text, preserving whitespace |
| `phase` | `question` or `answer` |
| `model_sha256` | Exact GGUF weight identity |
| `input_tokens`, `output_tokens` | Native generation counts |
| `finish_reason` | Native stop or exhausted length budget |
| `expert_state_before`, `expert_state_after` | Available native spore SHA-256 addresses |

Subjects are `agent:<identifier>`, and sources are `model-runtime:<weight SHA>`.
Each measurement has a one-millisecond validity interval at the host-observed
completion time. These observations are available to the ordinary fact,
history and background-state tools. The complete action additionally contains
both prompts, output token IDs, the native routing decision and source receipts.

The native adapter applies the chat template from the pinned GGUF through
explicit token IDs: one BOS, the user turn, its end, and the model turn. It
uses NoTorch's tokenizer for the content. This places BOS before the user turn
even though the tokenizer itself emits BOS. The native prompt echo is removed
exactly; diagnostics are parsed only after that complete echo.

## Optional experts

`--experts-output NEW_DIRECTORY` enables the existing native `--experts
--learn-experts` path. The question and answer each complete one learning turn.
`--spore-in FILE` explicitly resumes an earlier population. Every successful
generation publishes a new spore; later encounters retain their parent's hash.
The CLI never overwrites an earlier generation. No dreams or replay training
are automatically scheduled by this adapter.

AML retains the factual history and the expert content addresses. The spore
files hold the acquired numerical state. Keep the experiment directory to
continue that population. The standalone replay command reads the saved facts
and speech without loading or changing that population.

## Budgets and failure

The initial profile permits 16,384 UTF-8 prompt bytes, fewer than 8192 assembled
context positions, 1–256 generation choices (96 by default), and a 120-second
deadline per native process. Native output buffers are bounded at 2 MB. Text
must be valid UTF-8; utterances fit the ledger's 4096-code-unit limit. The
focused question also fits its routing contract. Inherited `NT_*` overrides
are removed; this profile records greedy sampling, two matrix threads, one
attention thread and floating activations.

An exhausted token budget, unavailable native process, unresolved question,
wrong/failed tool read or incomplete evidence returns a failed encounter with
the observations already completed. Generation stops on that path. The memory
acknowledgment separately reports whether the failed or successful encounter
was saved. An observation group either fits completely or leaves the prior
world intact. A failed memory append returns the computed encounter and its
unsaved journal with a nonzero exit, so the observation can be recovered.
Existing 1024-fact/2 MB world and 64-action/8 MiB AML limits apply.

## Verification

```sh
node --test tests/model-encounter.test.js
LALO_GEMMA_GGUF=build/models/gemma-3-270m-it-Q8_0.gguf node --test tests/notorch-model.integration.mjs
```

The live gate requires the actual weight file. A missing file is reported
explicitly and cannot pass as a zero-check run. It covers both complete
experiments, prompt/diagnostic boundaries, inherited token overrides, length
exhaustion, substituted weights and a corrupted expert restore. The portable
tests cover time/scope preservation, wrong answers as model observations,
unsupported questions, failures, replay inconsistencies and atomic capacity
failure. The model CI job retains its encounter directories as evidence.
