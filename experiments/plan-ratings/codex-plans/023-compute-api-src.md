# Plan 023: Compute API Source Boundary Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/api/src`

Scope this plan covers:

- The `compute-api` Rust crate source that exposes workbook and sheet operations through the ergonomic `Workbook`/`Sheet` facade and the generated `ComputeService` bridge facade.
- Boundary types and helpers in `address.rs`, `sdk_value.rs`, `types.rs`, `error.rs`, and `dispatch.rs`.
- Workbook and sheet sub-API modules under `workbook/`, `sheet/`, and stateless wrappers under `pure/` only where they affect the public compute API contract.
- Production consumers that depend on this folder's exported contract: `compute/wasm`, `compute/napi`, `compute/pyo3`, kernel compute bridge callers, and Rust tests in `compute/api/tests`.

Out of scope for the first implementation slice:

- Rewriting compute-core engine algorithms.
- Replacing the bridge macro stack.
- Adding compatibility shims around broken public behavior instead of fixing the compute-api and compute-core contract that creates it.

## Current role of this folder in Mog

`compute/api/src` is the public Rust API boundary around the spreadsheet compute engine. It has two distinct but related roles:

- Rust facade: `Workbook` owns a target-specific `Dispatch`, returns `Sheet` handles, and organizes workbook/sheet operations into domain sub-APIs. Native builds serialize access through a compute-engine actor thread; non-native builds use direct `Rc<RefCell<YrsComputeEngine>>` access.
- Bridge facade: `ComputeService` is the single generated bridge service consumed by WASM, N-API, PyO3, and Tauri-style transport generation. It delegates compute-core bridge descriptors through `bridge_delegate::delegate!`, adds lifecycle creation from snapshots/Yrs state, owns active security principal session state, and defines the tagged error shape through `ComputeApiError`.

Important observed structure:

- The crate intentionally re-exports core type crates instead of defining parallel domain types.
- `compute/wasm` and `compute/napi` consume nearly the full `ComputeService` descriptor set; `compute/pyo3` consumes a smaller set and should have an explicit parity/disposition contract.
- TypeScript production callers flow through transport and kernel bridge layers, especially `infra/transport/src/factory.ts`, `infra/transport/src/napi-transport.ts`, `kernel/src/bridges/compute/compute-bridge.ts`, and SDK boot code. The ergonomic Rust `Workbook`/`Sheet` facade appears primarily covered by `compute/api` tests rather than app/runtime production callers.
- Existing tests cover smoke workbook/sheet behavior, security principal state, security enforcement audits, bridge error serialization, address parsing, SDK value normalization, and a structural formula `#REF!` regression.
- Several facade modules are placeholders or incomplete boundaries: workbook protection, workbook styles, sheet hyperlinks, sheet pivots, and `pure::solver`.
- Some methods still accept loose strings or `serde_json::Value` where the public API should expose typed Rust/domain inputs with explicit validation.

## Improvement objectives

1. Make the compute API boundary contract auditable.
   Build a generated or source-scanned contract matrix for every public facade method and every `ComputeService` bridge descriptor: owner module, scope, read/write/session/lifecycle classification, input types, output type, mutation result shape, viewport patch behavior, security gating, transport exposure, and coverage status.

2. Close facade completeness gaps systematically.
   Compare `Workbook`/`Sheet` sub-APIs with the compute-core bridge descriptors and public SDK/API dispositions. Implement every engine-supported workbook/sheet operation in the ergonomic facade, and remove or replace placeholder modules whose engine support already exists.

3. Replace loose boundary inputs with typed contracts.
   Introduce typed enums/input structs for clear modes, structure operations, outline axes, calculation modes, format properties, object/chart update payloads, filter configs, text-to-columns options, and other current string/JSON entrypoints where a domain type exists or should exist.

4. Align Rust facade, generated bridge, and SDK behavior.
   Ensure `Workbook`/`Sheet`, `ComputeService`, WASM, N-API, PyO3, and kernel bridge callers preserve the same semantics for cell values, ranges, mutation results, security errors, recalculation, sync state, and sheet/workbook lookup.

5. Strengthen dispatch and lifecycle safety.
   Preserve target-specific access semantics while making shutdown, panics, type erasure, and construction failure behavior explicit and tested. The actor boundary should never silently lose a command, confuse a downcast, or expose a partially attached `ComputeService`.

6. Upgrade tests from smoke coverage to boundary contracts.
   Add contract tests that fail when a new engine method lacks facade coverage, bridge exposure, typed error shape, security scope, or transport parity.

## Production-path contracts and invariants to preserve or strengthen

- `ComputeService` remains the single FFI bridge surface for compute engine operations. Binding crates should not reach directly into `YrsComputeEngine`.
- `Workbook` and `Sheet` handles remain cheap clones sharing one underlying engine state.
- Native dispatch must serialize all engine access on the compute-engine thread; WASM dispatch must remain synchronous and single-threaded without enabling native compute-core features.
- `compute-api` must keep `compute-core` default features disabled by default and re-enable native behavior only through the crate's `native` feature.
- `ComputeApiError::Compute` must flatten the inner `ComputeError` wire shape; API-specific errors keep stable tagged JSON with camelCase bridge fields where already established.
- Security principal state remains session-local to `ComputeService`, uses canonicalized tag lists at the wire boundary, and must not serialize `Principal` itself.
- Gated bridge methods must carry explicit read/write/structural scope and apply redaction/security filtering on the production path, not only in tests.
- Mutating operations that return `(viewport_patch, MutationResult)` at the engine level must expose the correct mutation result and preserve viewport patch behavior where generated bridge consumers rely on it.
- Address and range resolution must enforce spreadsheet bounds and produce typed `InvalidAddress`/`InvalidRange` errors; numeric coordinate inputs should not silently exceed grid bounds.
- Rust facade and generated bridge operations must agree on sheet identity, sheet ordering, case-sensitive sheet name lookup, recalc behavior, sync state bytes, and workbook/sheet protection semantics.
- No public facade method should accept in-band sentinels for clear/null/empty-string behavior. `SdkValue` and typed cell input paths should keep clear, literal empty string, parsed formula, parsed number, and boolean intent distinct.

## Concrete implementation plan

1. Build the API boundary inventory.
   Add a compute-api contract audit that scans `compute/api/src`, compute-core bridge descriptors, and binding crate descriptor lists. The audit should produce a stable matrix checked into tests or generated fixtures with method name, owner, scope, operation kind, input/output types, bridge groups, and consumers. It should flag uncovered methods, mismatched descriptor groups, missing security scope, and undocumented PyO3 omissions.

2. Normalize bridge descriptor parity.
   Compare the `ComputeService` descriptor groups consumed by WASM, N-API, PyO3, and any Tauri generation path. WASM and N-API currently include groups that PyO3 omits, including `core_cells`, `core_sync`, `core_theme`, `objects_floating`, `objects_groups`, `objects_hyperlinks`, `objects_z_order`, and `screenshot`. For every missing PyO3 group, decide and encode one of two outcomes: implement the group in PyO3, or record a first-class disposition with the exact unsupported type/codegen blocker. The contract test should fail on accidental drift.

3. Complete the ergonomic Rust facade against engine-supported operations.
   For each workbook/sheet domain module, map all compute-core engine methods to `Workbook`, `Workbook*`, `Sheet`, or `Sheet*` facade methods. Implement missing supported operations in complete categories, not one-off methods. Remove empty placeholder APIs when the correct production API belongs elsewhere, or replace them with fully implemented typed modules when engine support exists.

4. Move stateful "pure" stubs to the correct owner.
   `pure::solver` documents that solver, goal seek, and data tables require live engine state. Implement these as workbook/sheet operations if compute-core supports them, with typed params and recalc/mutation semantics. Keep only genuinely stateless operations under `pure`.

5. Introduce typed boundary inputs.
   Replace public loose strings and JSON payloads with domain enums and structs. Priority targets are clear modes, calculation modes, structure operation names, outline axes, format property toggles, filter creation/application configs, object/chart creation/update configs, text-to-columns options, and workbook/sheet settings keys. Use existing compute-core/domain-types structs when available; otherwise add public compute-api structs that map to engine types with explicit validation.

6. Centralize mutation result extraction and error promotion.
   Many facade methods repeat `.map(|(_vp, mutation)| mutation).map_err(ComputeApiError::from)`. Add small internal helpers for read calls, mutation calls, and mutation-with-viewport calls that consistently promote security-denied errors, preserve viewport-patch semantics where needed, and reduce copy/paste divergence across sub-APIs.

7. Strengthen address/range validation.
   Extend `CellAddress::Position` and `CellRange::Bounds` resolution to validate `MAX_ROWS`, `MAX_COLS`, ordering, and normalized bounds consistently with A1 parsing. Decide whether reversed ranges should normalize or reject, document it, and test both A1 and numeric paths.

8. Harden dispatch lifecycle behavior.
   Replace the unchecked dispatch downcast expectation with an internal invariant path that reports a structured internal API error in tests and debug logs. Add tests for command-after-shutdown, clone drop behavior, panic containment if feasible, and `ComputeService::new` construction failure assumptions. Preserve the native actor and WASM direct-access split.

9. Align value semantics across SDKs.
   Expand `SdkValue` and facade cell input coverage to include large integers, negative zero, non-finite numbers, dates/times if they cross this layer, empty string, clear, formulas, escaped literals, and boolean parsing. Ensure Python/JS binding behavior maps to the same `CellInput` intent as Rust facade calls.

10. Expand workbook/sheet behavior contracts.
    Add integration tests that exercise representative operations in every workbook and sheet sub-API category through the Rust facade, then verify engine state through the same public read paths. Include sheet creation/deletion/reordering, settings, names, comments, validation, layout, tables, filters, objects/charts, protection, outline, print, sparklines, bindings, sync, and full recalc.

11. Add transport-level contract checks.
    For WASM and N-API, add descriptor surface tests that verify `compute_full_recalc`, principal methods, viewport/export/security groups, object groups, hyperlinks, z-order, screenshot, and any newly completed methods are emitted. For PyO3, update generated Python surface/dispositions and tests so unsupported status is explicit and not accidental.

12. Add generated bridge freshness checks.
    Add a freshness gate for generated bridge artifacts that carry compute API commands and metadata, including `kernel/src/bridges/compute/compute-bridge.gen.ts`, `kernel/src/bridges/compute/manifest.gen.ts`, and `infra/transport/src/command-metadata.gen.ts`. The gate should rerun the repo's bridge generation command and fail when generated files drift from descriptors.

13. Update public docs generated from the contract.
    Generate concise API docs or fixture metadata from the contract matrix so public SDK documentation, Python dispositions, and Rust facade docs do not drift independently.

## Tests and verification gates

Rust gates:

- `cargo test -p compute-api`
- `cargo clippy -p compute-api`
- `cargo test -p compute-api --no-default-features` or the repo's wasm-compatible equivalent for the non-native dispatch path.
- Focused compute-core tests for any engine methods touched while completing facade categories, such as `cargo test -p compute-core` or narrower crate tests where the implementation lives.

Bridge and binding gates:

- WASM build/check gate for `compute/wasm` after descriptor changes, using the repo's configured `target-wasm` path.
- N-API build/smoke gate for `compute/napi` when descriptor groups or exported methods change.
- PyO3 generation and Python SDK tests when descriptor parity or dispositions change, including security-session tests.
- Expanded N-API serde tests for every generated/manual serde command touched by the change, especially security payloads, options structs, enums, byte-return tuples, and JSON-backed payloads.
- A real WASM smoke covering init, set cell, formula recalc, a byte/tuple command, and session security.

TypeScript and app integration gates:

- Kernel compute bridge tests covering generated command metadata, session security, full recalc, viewport patches, and any renamed/typed command payloads.
- Relevant TypeScript `pnpm test` package gates for kernel/runtime callers changed by bridge contract updates.
- `pnpm typecheck` for TypeScript declaration or command metadata changes.

Contract/audit tests to add or strengthen:

- Contract matrix test: every compute-core bridged method has an intentional `ComputeService` exposure and security scope.
- Facade coverage test: every engine-supported workbook/sheet operation is implemented or has an explicit engine-missing disposition.
- Descriptor parity test: WASM, N-API, PyO3, and transport metadata descriptor groups are intentionally identical or explicitly disposed.
- Generated artifact freshness test: compute bridge generated TypeScript, manifest, and command metadata are current after descriptor changes.
- Error wire test: every `ComputeApiError` variant and promoted `ComputeError` variant serializes to the expected tagged bridge shape.
- Address/range property tests for A1, absolute A1, lowercase A1, numeric bounds, max bounds, reversed ranges, malformed inputs, and out-of-grid positions.
- SDK value property tests for clear/literal/parse distinctions and numeric edge cases.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Descriptor parity can expose methods in a binding target before its type converter supports the method's payloads. The correct fix is converter/type support or an explicit disposition, not silently omitting the group.
- Tightening typed inputs may reveal callers that currently pass arbitrary strings or JSON. Migration should update those callers to public typed contracts in the same change set.
- Dispatch lifecycle hardening must not accidentally make WASM borrow behavior diverge from native actor behavior.
- Numeric coordinate validation may change behavior for callers that relied on out-of-bounds passthrough. The production contract should reject invalid grid coordinates because the A1 path already does.
- Security error promotion must be applied consistently; otherwise SDKs may see flat engine errors in some paths and typed API errors in others.
- Placeholder module removal can break downstream Rust imports. Only remove placeholders when replacing them with the correct production API in the same category, or keep a documented module with real dispositions if engine support is truly absent.

Non-goals:

- Do not optimize test harnesses or mock-only paths.
- Do not add compatibility shims around old loose payloads as the primary solution.
- Do not make `compute-api` depend on private/internal repos.
- Do not duplicate compute-core domain type hierarchies in compute-api.
- Do not bypass generated bridge descriptors by hand-writing separate WASM/N-API/PyO3 method surfaces.

## Parallelization notes and dependencies on other folders, if any

This work is highly parallelizable once the contract inventory exists:

- Agent A: build the contract matrix and audit tests for `compute/api/src`, compute-core descriptors, and binding descriptor lists.
- Agent B: complete workbook sub-APIs and typed workbook settings/protection/styles/scenario/name contracts.
- Agent C: complete sheet sub-API coverage for layout/structure/tables/filters/comments/validation/formatting/objects/charts/print/sparklines/bindings.
- Agent D: normalize bridge descriptor parity across `compute/wasm`, `compute/napi`, `compute/pyo3`, generated command metadata, and Python dispositions.
- Agent E: expand Rust facade integration tests and SDK value/address/range property tests.
- Agent F: update kernel/runtime TypeScript callers and transport tests for any typed command payload changes.

Dependencies:

- `mog/compute/core/src` and compute-core domain crates own engine behavior, bridge descriptors, security scopes, and many canonical types.
- `mog/infra/rust-bridge/*` owns descriptor generation, delegate behavior, and binding macro support.
- `mog/compute/wasm`, `mog/compute/napi`, and `mog/compute/pyo3` consume `ComputeService` descriptors and must be updated with any descriptor/type changes.
- `mog/kernel/src/bridges/compute` and generated transport metadata consume bridge command names, payloads, and error shapes.
- `mog/types/api` and public SDK surfaces may need coordinated updates when loose Rust/bridge payloads become typed public contracts.
