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
processes perform the first encounter, corrected encounter, two history queries, a comparison of the two saved answers, a repeated read with no source update,
a comparison of that repeated read, and saved-answer replay:

| Stage | Source magnitude | Gemma's recorded answer |
|---|---:|---|
| First source receipt | 2.9 | The magnitude of the earthquake is 2.9. |
| Later correction to that receipt | 3.4 | The magnitude of the earthquake is 3.4. |
| Ask for own speech at the first answer cutoff | 2.9 | Recalls its first answer from the two original utterance receipts. |
| Ask for earthquake magnitude history | 2.9, 3.4 | Reads both magnitude versions and their predecessor link. |
| Compare the two saved answers | 2.9 → 3.4 | Explains the source revision using both original answers and their premises. |
| Read again without a source update | 3.4 | Reads the same source receipt. |
| Compare the two unchanged source reads | 3.4 | Reports the unchanged result. |
| Reopen the first AML encounter | 2.9 | The magnitude of the earthquake is 2.9. |

Both native modes passed the seven-encounter sequence on Linux x86_64.
The extended experiment asserts the values, exact history receipt IDs, predecessor
link and replay of both history encounters. The self-history cutoff is the
completion of the first answer, although its input journal already includes
the later 3.4 answer. The earthquake history cutoff includes the correction. It also checks that
the new expert process starts with the exact SHA-256 saved after the first answer.

## Ordinary words and an explicit focus

The host selects one activity, its subject and explicit time scope. The model
speaks ordinary English and supplies no JSON or tool schema.

| Activity flag | Subject | Scope clocks | Tool |
|---|---|---|---|
| `--activity magnitude` (default) | Selected `usgs:` event | `validAt`, `knownAt` | `lalo_facts` |
| `--activity self-history` | Querying `agent:` identity | `knownAt` | `lalo_history`, predicate `utterance` |
| `--activity quake-history` | Selected `usgs:` event | `knownAt` | `lalo_history`, predicate `magnitude` |

A magnitude scope, for example:

```json
{"subject":"usgs:synthetic1","validAt":1792065600000,"knownAt":1792065602000}
```

“What is the magnitude of this earthquake?” binds to that scope. Supported
whole-question variants are defined in `bindModelQuestion`. The bridge records
the original question, the binding rule and the provenance of every argument.
The native selector receives the original question verbatim, including its
whitespace. The routing field covers magnitude requests, own-speech history, earthquake
history and their negations. The previous 109 labeled decisions remain intact; the comparison paraphrase
observed after six native expert turns and its negation bring the corpus to 111. The existing tool host validates the explicit arguments.
Bindings use version 5 and record the activity and selected tool. Encounter
results use version 2 for magnitude/history and version 4 for saved-answer
comparisons. Replay retains encounter versions 1–4 and binding versions 1–5.
Comparison v3 keeps its original answer presentation; v4 explicitly presents
unchanged-source cases.

“What did I say earlier?” binds to the querying agent’s utterances at `knownAt`.
“What was the magnitude history of the reported earthquake?” binds to all
magnitude receipts known for the selected event. History scopes have exactly
`subject` and `knownAt`; a supplied `validAt` is rejected. The self-history
subject must equal the querying agent. The question being generated is observed
after the frozen source snapshot and cannot become its own history evidence.

For history answers the model receives the exact utterance strings or magnitude
values, in receipt order. Clock and identifier digits stay in the saved tool
result, which retains every original field and predecessor link. Replay
reconstructs the same presentation from those original receipts and verifies
the answer prompt.

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

## Why the answer changed

Choose two completed magnitude encounters in the same AML memory. They must
belong to the querying agent and weight identity, concern the same event and
world instant, and occur in chronological order. The current journal must
extend both original snapshots. The portable comparison checks each snapshot's
SHA-256 with Web Crypto and replays each original encounter before generation.

`--activity answer-change` uses `--compare-from SEQUENCE` and
`--compare-to SEQUENCE`. Its scope file has exactly `subject` and `knownAt`,
matching the later saved encounter. For example, after the sample experiment:

```sh
node scripts/model-encounter.mjs --model build/models/gemma-3-270m-it-Q8_0.gguf --journal build/model-plain/comparison-world.json --scope build/model-plain/comparison-scope.json --memory build/model-plain/memory --id another-comparison --activity answer-change --compare-from 1 --compare-to 2
```

Gemma receives the task of asking what changed between its two saved answers.
Its generated question passes unchanged through the native selector to
`lalo_history`. Supported question forms include “Why did my answer change?”
“What was the most significant change in the two saved answers?” and
“What was the result of the change in the answers?”

The resulting comparison records both AML sequence/head addresses, original
answer receipt IDs, verbatim answers, original premise IDs, added and removed
premises, and every predecessor step linking a revised source to its earlier
version. It tracks `answersChanged` and `evidenceChanged` separately. An
independent addition has its own list; unchanged evidence has no revision chain.
A revision that enters the world-time scope without replacing an earlier premise
is retained under `unmatchedRevisions`.
The comparison helper's independent-source case has a synthetic unit fixture;
the current USGS instrument owns a single event-source chain.

Only receipts known at the later encounter's cutoff enter the comparison.
Later corrections in the current world stay outside it. Incomplete history
stops before explanation generation. The model receives the two exact answers,
their magnitude values and the verified revision values. Full source IDs and
snapshot hashes remain in the saved exchange. Replay reproduces both original
reads and the comparison, returns `sourceComparison`, and recovers the exact
saved explanation without starting NoTorch or changing its expert population.
The embedded comparison context is bounded at 65,536 UTF-8 bytes and accepts
only magnitude encounters, so comparisons cannot nest recursively.

When source receipts are identical, the model receives an explicit comparison
result: either both answers and sources stayed the same, or the answer text
changed while the source stayed the same. The original answer strings follow
that result. Source revisions retain their separate presentation. The saved
encounter version selects the presentation during replay, so old v3 exchanges
keep their original prompts and output.

The complete example now adds two real native exchanges after the source
revision: another magnitude read with no source update, and a comparison of
that read with the previous magnitude answer. Both plain and expert modes
check unchanged evidence, expert-state continuity and AML replay. A separate
native test supplies two controlled, explicitly synthetic pairs of original
utterances (identical speech, and changed speech with identical source facts).
Gemma generates the comparison sentences; those fixture utterances are never
stored as observations of Gemma. CI retains these controls alongside the live
encounters in `unchanged-source-controls.json`.

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
wrong/failed tool read or incomplete evidence (including a history exceeding
the 32-row tool budget) returns a failed encounter with
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
