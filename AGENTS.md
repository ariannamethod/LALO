# LALO — agent work rules

Read [ARIANNA_METHOD_MANIFESTO.md](ARIANNA_METHOD_MANIFESTO.md), then README.md
and the newest LALOLOG.md entry. The Manifesto governs this repository's
language, ontology and declared position. Preserve its text and meaning.

## Body

- JavaScript ES modules are the initial implementation language. Keep the core
  importable without Node-only APIs, a DOM, a server, or a bundler.
- Phones are target machines. Use explicit storage budgets and avoid eager
  model, map, camera, GPU or network initialization. Measure on a named device
  before claiming mobile performance or installation support.
- No Python in runtime, build, tests or tooling added to this repository.
- NoTorch is the numerical substrate when numerical work is needed. Check its
  JS and C APIs before adding arithmetic libraries or duplicating kernels.
  NumPy is absent from the audited source; do not claim a replacement occurred.
- AML is intended for programs of behavior. Its native runtime and NoTorch
  bridge already exist upstream; integration here must have a working call and
  a test before README calls it implemented. C/C++ modules need a concrete role.
- Keep the fact core, source adapters, storage, tool routing and presentation
  separable. Add a boundary when two actual components need it.
- Visuals are part of the product. Camera, GPS and interface actions must be
  able to feed the same observation model. Study Netta.Sonar when supplied
  before deciding how its interface agency should translate into LALO.

## Evidence

- Keep world time separate from receipt time. Never backdate receipt time to
  make a late observation look known earlier.
- Corrections append a new version and name the predecessor. Preserve earlier
  assertions and sources. Independent conflicting claims stay independent.
- Future derived facts must name their premises and rule. Compute their valid
  interval from those premises and invalidate stale derivations explicitly.
- Routing activation, source reliability and factual uncertainty are different
  quantities. Do not relabel one as another.
- Exhausted budgets, unavailable sources and incomplete inference must be
  observable. Silent eviction or a fabricated successful answer is a defect.
- Keep core tests offline and deterministic. Run the narrow gate, then the
  relevant suite. Current gate: `node --test tests/*.test.js`; demo:
  `node examples/earthquake.js`. Keep fixtures visibly synthetic.
- Record commands, environment and outcomes. A mobile or speed claim needs
  measurements on that target. A failed experiment belongs in the log too.

## Working together

- Check status and current origin/main before editing and before publication.
  Preserve unrelated work. Use an agent-specific branch and a reviewable PR;
  Oleg merges unless he explicitly directs otherwise.
- Runtime changes get a dated entry at the top of LALOLOG.md. Put technical
  detail, regressions, decisions and measurements there. Keep README short,
  blunt, useful and honest about what actually runs.
- Preserve license and attribution when importing code. Pin the source commit.
  The Manifesto was copied verbatim from NoTorch; its source is in LALOLOG.md.
- Keep generated binaries, model weights, credentials and device observations
  out of ordinary source commits. Commit portable code and synthetic fixtures.
- Commit messages explain the change and evidence, with a relevant `Quote:`
  and a short `Method:` line. Keep authorship truthful.
