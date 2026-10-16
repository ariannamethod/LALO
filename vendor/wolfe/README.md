# WOLFE body, pinned

Imported unchanged from [ariannamethod/wolfe](https://github.com/ariannamethod/wolfe)
at commit `a04d2b7e6488656b715ca6b5b5ef5b1227eea79d`.
Copyright and authorship remain with the upstream authors; see the source
header and the exact upstream GPL-3.0 [LICENSE](LICENSE).

| File | SHA-256 |
| --- | --- |
| wolfe.c | dea0df2c4f81d64543b927e3f6e4d1a23bdf585500230a135f24a73f20529fda |
| LICENSE | e57f1c320b8cf8798a7d2ff83a6f9e06a33a03585f6e065fea97f1d86db84052 |

LALO uses the neural selection field in batch mode. The warm native process
receives intent text only; the JS host binds explicit arguments and executes
one of its six read-only tools. No correction memory, feedback, network,
training or model weights are enabled. The public entry points are
`scripts/build-router.mjs`, `scripts/route.mjs` and `examples/route.js`.

NoTorch's JS tensor/matmul API and C attention/value APIs were inspected before
this import. This stage preserves WOLFE's existing double-precision arithmetic
as a comparison baseline; it adds no numerical kernels. Migrating that body to
NoTorch needs a separate parity check. NoTorch and AML are not linked yet.

To update: review upstream changes, replace source/license from one commit,
update this pin and the build hash, then run the routing integration gate.
