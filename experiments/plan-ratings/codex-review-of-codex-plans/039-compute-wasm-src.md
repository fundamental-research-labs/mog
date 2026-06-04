Rating: 8/10

Summary judgment

This is a strong plan. It correctly treats `compute/wasm/src/lib.rs` as a browser compute boundary and not as an algorithm implementation folder, and it targets real production contracts: the generated `bridge_wasm::generate!` export set, descriptor drift against N-API, positional dispatch through `Object.values(args)`, wasm-pack reset patching, startup idempotence, and the `@mog-sdk/wasm` package consumed by browser transport. The plan is especially good at turning a past production failure (`Unknown WASM function`) into a systematic export-completeness contract.

The rating is not higher because several central contracts are still underspecified for parallel implementation. The canonical manifest location and schema, the exact WASM command-name/parameter-name mapping, and the real-module smoke harness need to be nailed down before multiple agents can build compatible pieces without rework.

Major strengths

- The plan is grounded in the actual source shape: `compute/wasm/src` is a single Rust entrypoint with panic/tracing setup, bare-type imports, a manual descriptor list, and generated exports.
- It chooses structural fixes over whack-a-mole patches: a shared binding surface, parity tests, generated param-order metadata, generated expected export lists, and freshness gates.
- It keeps the work on the production path. The required smokes use the built `@mog-sdk/wasm` package, production loader, `createWasmTransport`, time injection, bytes-tuple handling, case normalization, lifecycle teardown, and reset/reload behavior.
- The contract list is broad and relevant: no `SystemTime::now()` on wasm, `doc_id` first at the JS boundary, deterministic raw return shapes, `[Uint8Array, MutationResult]` bytes tuples, single-module XLSX exports, and fail-fast missing export detection.
- The plan recognizes the dependency graph across `compute-api`, `compute-core`, `xlsx-api`, `bridge-wasm`, `bridge-ts`, `infra/transport`, and kernel consumers instead of pretending this can be solved inside `lib.rs` alone.
- Parallelization notes are plausible and mostly independent: manifest/parity, TS metadata, binding entrypoints, transport dispatch, real-module smokes, and docs can be split if the manifest contract is specified first.

Major gaps or risks

- The canonical binding-surface manifest is the most important deliverable, but its ownership and schema are still vague. "generated or macro-backed" and "appropriate public Rust crate" leave too much room for incompatible implementations. The plan should name the module/crate and define fields such as descriptor path, service/pure kind, target disposition, command name, export name, lifecycle semantics, parameter metadata, and allowed target differences.
- WASM/N-API parity needs a precise equivalence model. N-API exposes stateful commands as `ComputeEngine` class methods while WASM exposes free functions with `doc_id` first. The plan should define how class methods, lifecycle methods, pure functions, destroy/reset helpers, and XLSX parser functions compare.
- The parameter-order metadata shape is not concrete enough. `fn(...paramOrder.map(name => args[name]))` is risky unless the generated metadata explicitly distinguishes TS object keys (`docId`, camelCase) from wasm-bindgen parameter names (`doc_id`, snake_case) and command strings. The plan calls out the risk but should decide the mapping contract.
- The real-module smoke tests are directionally right but not executable yet. The plan should specify whether they run under Node with wasm bytes, Vite/browser, Playwright, `wasm-bindgen-test`, or a dedicated package script, and it should name representative commands and fixtures rather than leaving each agent to choose easy cases.
- The verification gates cover `bridge-wasm`, `bridge-ts`, `compute-api`, transport, and generated TS, but they do not explicitly include a direct wasm-target lint/check for the crate whose `lib.rs` changes. `bash compute/wasm/build.sh --profile dev` compiles the target, but the plan should either add `cargo clippy -p compute-core-wasm --target wasm32-unknown-unknown` or state why that gate is not available.
- The reset hook remains a fragile post-`wasm-bindgen` patch. The plan correctly gates it, but it should define exact expected JS and `.d.ts` signatures and a failure message, because a small wasm-bindgen glue change could make a grep-only check pass while the cache variables no longer exist under those names.
- Scope is broad across bridge generation, transport, kernel tests, runtime loading, and docs. That breadth is justified by the boundary contract, but sequencing should make the manifest and generated metadata the blocking first milestone before transport and smoke-test work starts.

Contract and verification assessment

The plan has unusually good contract coverage for a folder-level plan. It identifies the live contracts that matter to browser compute: descriptor completeness, export names, argument order, lifecycle registry behavior, return shapes, error classification, time injection, bytes tuples, XLSX merging, and trap recovery. It also correctly rejects test-only validation by requiring smokes against the built `@mog-sdk/wasm` package.

The main weakness is that several contracts are written in prose rather than as precise machine-readable artifacts. The expected export set, WASM parameter order, and target disposition manifest should be generated from one parsed binding API and checked for freshness. The plan should define exact generated files and exact test commands for both generation and stale-artifact detection. It should also separate "regenerate artifacts" commands from "verify checked-in artifacts are fresh" commands, since current bridge-ts generation tests can write outputs when run in generation mode.

Concrete changes that would raise the rating

1. Specify the manifest home and schema, including target disposition, stateful vs pure classification, export name derivation, lifecycle handling, and documented WASM/N-API exceptions.
2. Define the generated TS metadata shape explicitly, for example a readonly command map that stores command string, ordered TS arg keys, wasm parameter names, serde/bytes/parse tags, and whether `docId` is injected.
3. Name the exact real-module smoke harness, package script, test file location, build prerequisite, and representative commands for formula recalc, bytes tuple mutation, table/chart/pure bridge, XLSX parse, lifecycle destroy/recreate, and reset/reload.
4. Add or explicitly waive a wasm-target lint/check gate for `compute-core-wasm`, distinct from host-side `bridge-wasm` tests.
5. Define freshness gates as commands that fail on stale generated files without rewriting them, with a separate regeneration command for developers.
6. Make the first implementation milestone the shared manifest plus parity/export metadata, then gate transport changes and behavior smokes on that artifact so the parallel agents compose cleanly.
