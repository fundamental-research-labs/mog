Rating: 8/10

# Review of Plan 055 — XLSX Bridge Source (`mog/file-io/xlsx/bridge/src`)

## Summary judgment

This is a strong, evidence-grounded plan. Its central thesis — that the bridge's TypeScript surface has drifted out of sync with the current Rust/generated command surface and the production import path, and that the fix is to make the bridge a *verifiable facade over real generated commands* rather than a hand-maintained mirror — is correct and well-supported. I independently verified every load-bearing factual claim in the plan against the source, and they hold:

- `bridge.rs` exposes only `xlsx_parse_lazy`, `xlsx_parse_lazy_with_mode`, `xlsx_version`; line 20 explicitly states `parse_full`/`parse_full_profiled` were removed and `FullParseResult` is crate-private. ✔
- `command-metadata.gen.ts` lists only `xlsx_parse_lazy`, `xlsx_parse_lazy_with_mode`, `xlsx_version` (plus the `compute_import_from_xlsx_bytes*` commands). ✔
- `worker/parse-worker.ts:273` still calls `wasmModule?.xlsx_parse_full` — a command that no longer exists in the bridge surface. ✔ This is a genuine latent breakage, not a stylistic nit.
- `parse-worker.ts` mixes worker-thread top-level init, `require('worker_threads')`, and main-thread `createWorkerParser` (exported line 483) in one module. ✔
- `package.json` exports `.`, `./progress`, `./types`, `./worker/types`, `./xlsx-parser/*` but **not** `./worker` or `./worker/parse-worker`, while `worker/index.ts:11` documents `import … from '@mog/xlsx-parser/worker'`. The documented subpath is genuinely unresolvable. ✔
- `types.ts` both re-imports generated `FullParseResult`/`FullParsedSheet` aliases *and* defines its own local `FullParseResult` (line 176) / `FullParseOptions` (line 2340); `WorkerParseOptions extends Omit<FullParseOptions,'onProgress'>` (worker/types.ts:154). ✔
- `parse.rs:48` confirms `skip_styles`, `max_cells`, `sheet_filter`, `values_only` are **ignored** by `parse_with_options`, while `max_sheets` *is* honored via `parse_max_sheets`. The plan's option-honesty section (§5) reproduces this distinction exactly. ✔

The diagnosis quality here is unusually high. The plan reads the actual generated metadata and Rust descriptors rather than trusting the package's own comments, which is precisely the discipline the plan then prescribes.

## Major strengths

- **Architectural fit is excellent.** It refuses to revive an obsolete JSON full-parse contract and instead routes any future full import through the real production owner (`compute_import_from_xlsx_bytes_deferred` / `ComputeBridge.importFromXlsxBytesDeferred`). It explicitly forbids a parallel JSON import path that would bypass engine hydration, mutation propagation, and deferred hydration state. This respects compute/kernel ownership boundaries.
- **Generated-types-as-source-of-truth** is the right contract direction, and the plan correctly anticipates the trap that generated `xlsx-types.ts` contains parser-internal `*Output` shapes not backed by any command, warning against re-exporting them as live results.
- **Command-drift-must-fail-verification** (§"Command surface") is a high-value invariant: it converts the exact class of bug that produced this drift (`xlsx_parse_full`) into a test failure.
- **Worker lifecycle invariants** are precise and testable: single-resolution `ready`, request-id cleanup on every terminal path, explicit `ArrayBuffer` transfer/neutering semantics, deterministic `terminate()`.
- **Honest progress/cancellation.** Calling out that synchronous WASM calls can only be cancelled pre/post-call, and that fine-grained percentages would be fabricated absent Rust checkpoints, is exactly right and resists a common temptation.
- **Sequencing and parallelization** are concrete (Agents A–D) and correctly gate the Rust-side work behind the single product decision.

## Major gaps or risks

- **The pivotal product decision is punted.** Nearly half the plan's branches hinge on "does the browser need full XLSX import through this package?" — and the plan defers that to "product owners" without a recommendation or a method to determine it. It does provide a sane *default* (lazy metadata is the correct contract absent a Rust command), but a plan this thorough should state a recommended default outcome up front so an implementer isn't blocked. This is the main thing keeping it from a 9.
- **No enumeration of current consumers of the doomed exports.** The plan's own top risk is "removing stale full-parse exports exposes downstream code compiling against an unbacked contract." But it never identifies *who* imports `FullParseResult` / `createWorkerParser` / the worker today (it gestures only at `@mog/xlsx-tooling`). Without that consumer inventory, the breaking-change sequencing is underspecified and the blast radius is unknown. A `git grep` of importers should be a Step 0 deliverable.
- **The `wasm-contract.ts` signatures are speculative.** `BridgeLazyParseResult` / `BridgeLazyParseResultWithErrors` are proposed names, and I confirmed no such aliases exist in the generated `xlsx-types.ts`. The plan acknowledges this and routes it through generation, which is correct — but it means §1 cannot be completed standalone; it has a hidden dependency on generated aliases that may need to be added first.
- **Verification gate breadth vs. scope.** The gates list `cargo test/clippy` for `xlsx-api`/`xlsx-parser`/`compute-core`, WASM smoke gates, and deferred-import roundtrip tests. These are correctly conditionalized ("for Rust command-surface changes…"), but for the likely TS-only outcome the *required* gate set collapses to ~3 commands. The plan would read more decisively if it separated "minimum gate for the default (lazy) outcome" from "additional gates if full import is added."
- **Some redundancy.** Objectives, "production-path contracts," and "concrete implementation plan" restate the same invariants three times. Not wrong, but it inflates length and makes the actionable steps harder to extract.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. It defines an explicit `XlsxWasmModule` surface, names the command set, specifies `parseModeToBridgeCode(mode): 0|1|2`, mandates structural assertions for any locally-duplicated shape (e.g. `CellRange` vs. the canonical `@mog-sdk/contracts/core` type — verified that the local `CellRange` is indeed a documented subset), and pins ownership of full import to compute. The worker protocol contract (per-variant request/response types, consistent `id`, worker-level error rejecting all pending) is complete and lifecycle-aware.

Verification is well-conceived but, as noted, over-broad for the default path and under-specific about the breaking-change rollout. The package-local test list (§9) is excellent and directly targets the failure mode that created this drift: an export-map test that imports each documented subpath *through the package name*, command-guard tests, and a fake-`Worker` lifecycle test covering ready/success/progress/cancel/error/terminate/timeout/cleanup. The edge-case list (empty bytes, non-ZIP, encrypted package, valid-ZIP-no-workbook, concurrent requests, progress-callback-throws, `initTimeoutMs`) is thorough.

## Concrete changes that would raise the rating

1. **State a recommended default outcome** (lazy metadata facade, no browser full import) at the top, with a one-line decision criterion, instead of deferring entirely to product owners. Make full import the explicit opt-in branch.
2. **Add a Step 0 consumer inventory**: `git grep` for importers of `FullParseResult`, `FullParseOptions`, `createWorkerParser`, and the `./worker*` subpaths, and list the migration action per consumer. This de-risks the plan's own #1 risk and makes sequencing concrete.
3. **Resolve the generated-alias dependency explicitly**: confirm whether `xlsx-api` lazy parse already emits a generated TS type for its result; if not, make "add `BridgeLazyParseResult` aliases via bridge-ts generation" an ordered prerequisite to §1 rather than an inline "or."
4. **Split the verification gates** into "required for default (TS-only) outcome" vs. "required if full import is added," so the minimal gate set is unambiguous.
5. **Trim the triple restatement** of invariants — fold "production-path contracts" into acceptance criteria attached to each implementation step.

Net: a precise, correctly-scoped, architecturally-sound plan with real verified evidence. Held back from 9–10 by the unresolved central product decision and the missing consumer inventory needed to sequence the breaking removal safely.
