Rating: 8/10

Summary judgment

This is a strong plan for `mog/compute/api/src`: it correctly identifies the folder as a boundary layer, targets production code rather than a harness, and ties most proposed work to real defects visible in the current source. The best parts are the systematic treatment of the raw `Workbook`/`Sheet` facade, the typed write-intent gap, range validation, public type leakage, and repeated dispatch-result boilerplate. It also names downstream consumers and gives meaningful verification gates.

The rating is not higher because the plan has a few contract-level inaccuracies and an unresolved sequencing problem around the facade security decision. Most importantly, it overstates `ComputeApiError` as the FFI-wide error type. The generated `ComputeService` delegate preserves engine return types, usually `value_types::ComputeError`, while the facade returns `ComputeApiError`. That matters because the TS bridge union currently mirrors both shapes, and `SecurityDenied` is not byte-identical between `ComputeError` and `ComputeApiError` (`principalTags` string/flat target versus vector/object target). A plan whose central theme is boundary contracts needs to be exact here.

Major strengths

- The scope is explicit and largely correct: it distinguishes `Dispatch`, generated `ComputeService`, handwritten `Workbook`/`Sheet`, and `pure/*`, and correctly treats binding crates and TS error handling as downstream coordination rather than primary edit targets.
- The security-bypass finding is real and important. `Workbook`/`Sheet` methods call `dispatch.call_engine` and `query_engine` directly, while `ComputeService` is generated with `gated = true`; the plan correctly elevates this as the first architectural decision.
- The typed write-intent finding is precise. `SdkValue` exists to distinguish clear, empty literal, and parse intent, but `Sheet::set_cell` takes `impl Into<String>` and `set_range` takes `&[Vec<String>]`, then both call parsed-string engine methods.
- The range-contract work is production-relevant. `set_range` currently resolves the end bounds and ignores them, accepts jagged grids, and has no facade-level rectangularity or size guard.
- The public-boundary hygiene section is valuable: deep `compute_core::...` return types leak through public signatures, and the stub modules are public enough to advertise non-existent capabilities.
- Verification coverage is better than average. It asks for unit, integration, cross-target, downstream, and contract tests, not just compile checks.

Major gaps or risks

- Step 1 asks for an owner decision, but later ordering says to land Steps 3/5/6 first. That is backwards if path (b) gates or removes the facade from default builds. The facade posture should be resolved before investing heavily in facade API changes.
- The proposed "ComputeService-equivalent enforcement context" is not yet a concrete contract. It does not specify how `Workbook` exposes principal/session state, whether `Workbook::from_snapshot` should construct or wrap a `ComputeService`, how `Sheet` clones inherit the active principal, or whether Rust callers can intentionally request owner/trusted mode.
- Reusing "the same gated closure wrapper the delegate uses" may require factoring macro-only logic out of `bridge-delegate` into a runtime helper or making the facade delegate through generated methods. The plan names the desired property but not the architectural seam.
- The error-contract section is partially wrong. `ComputeApiError` is not the type returned by every generated `ComputeService` method, and the typed `SecurityDenied` shape emitted by `ComputeApiError` does not currently match the TS comment/type that treats `principalTags`, `target`, `required`, and `actual` as strings. This must be corrected before golden fixtures are designed.
- The range section claims unbounded ranges are accepted, but this facade's `CellRange` has only `A1Range(String)` and fixed numeric `Bounds`; `parse_a1_range` requires exactly `A1:B2`-style corners. The real gap is inverted/out-of-bounds/unvalidated numeric bounds, not unbounded parsing.
- The stub-module cleanup is underspecified. Removing only top-level re-exports does not remove `pub mod` declarations or accessor methods like `workbook.protection()` / `sheet.pivots()`. The plan should state the intended API compatibility policy.
- The boilerplate-helper step should inventory method return-shape exceptions before promising a broad mechanical rewrite. Some engine calls already map inside the closure, some return `(String, MutationResult)`, and some are queries; a helper is sensible but needs precise helper signatures.
- Dispatch backpressure and thread joining are valid concerns, but changing from unbounded to bounded channels is a behavioral contract change. The plan says "evaluate", which is appropriate, but this should be separated from must-fix boundary hardening unless a real production failure is demonstrated.

Contract and verification assessment

The plan is contract-oriented and mostly aligned with Mog's production-path standards. It identifies invariants for target-agnostic dispatch, WASM feature discipline, bridge auto-generation, `SdkValue` semantics, principal non-serializability, and public range/write contracts. The verification matrix is credible and includes the right kinds of tests: facade security parity, address/range tests, write-intent tests, error golden tests, cross-target build checks, and downstream bridge checks.

The weak point is contract precision at the Rust/TS error boundary. The plan should distinguish three contracts: engine `ComputeError` on generated `ComputeService` methods, facade `ComputeApiError`, and the TS `BridgeError` union that accepts both. It should also decide whether security-denied promotion belongs in the facade, in binding error translation, or in generated delegate output; those are different implementation choices with different compatibility implications.

Verification gates also need more exact commands and ownership. For Rust, require the package-specific `cargo test -p compute-api` and `cargo clippy -p compute-api`, plus targeted downstream build/test gates for any crate whose descriptors or imports change. For TypeScript, name the actual transport/kernel test file or package script that pins `BridgeError` shape. For WASM feature leakage, specify the cargo-tree invocation or equivalent expected assertion.

Concrete changes that would raise the rating

- Make the first implementation milestone a written facade posture decision: enforced public Rust SDK, explicitly trusted/internal feature, or facade removal. Include the API contract for principal/session state in that decision.
- Correct the error-contract section to reflect current generated delegate behavior: `ComputeService` mostly returns `ComputeError`; `Workbook`/`Sheet` return `ComputeApiError`; TS must cover both wire shapes. Then define the desired final `SecurityDenied` wire shape exactly.
- Replace the vague gated-wrapper reuse instruction with a concrete architecture: wrap `ComputeService`, factor reusable enforcement helpers from `bridge-delegate`, or generate facade methods from descriptors. State why the chosen approach preserves descriptor auto-generation and native/WASM parity.
- Add a table of facade write APIs and their target engine methods, including which should use `CellInput`, which remain parsed-string entry points, and how `set_range` generics should be source-compatible.
- Tighten the address/range specification to the actual representations: validate `Position`/`Bounds`, normalize inverted corners, reject out-of-bounds coordinates, reject jagged/mismatched `set_range` grids, and explicitly decide whether whole-row/whole-column ranges are in or out of scope.
- For stub modules, define the exact public API action: remove modules/accessors/re-exports, gate them behind an unstable feature, or keep them but make constructors private and docs explicit.
- Add a small inventory for the dispatch helper rewrite so implementation does not accidentally flatten methods that intentionally return non-`MutationResult` payloads.
