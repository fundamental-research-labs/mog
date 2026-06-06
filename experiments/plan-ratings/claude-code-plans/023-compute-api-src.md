# Plan 023 — Harden and unify the `compute-api` boundary (`mog/compute/api/src`)

## Source folder and scope

- **Folder:** `mog/compute/api/src`
- **Crate:** `compute-api` (`mog/compute/api/Cargo.toml`, `publish = false`, `default = ["native"]`).
- **In scope (production code under this folder):**
  - Boundary plumbing: `lib.rs`, `dispatch.rs`, `error.rs`, `address.rs`, `sdk_value.rs`, `types.rs`.
  - FFI surface: `bridge_service.rs` (`ComputeService`).
  - Ergonomic Rust facade: `workbook.rs`, `sheet.rs`, `workbook/*.rs` (7 sub-APIs), `sheet/*.rs` (18 sub-APIs).
  - Stateless functions: `pure/*.rs` (8 modules).
- **Out of scope:** the engine itself (`mog/compute/core`), the binding crates (`mog/compute/{napi,pyo3,wasm}`, `mog-internal/runtime/src-tauri`), the bridge macro infra (`mog/infra/rust-bridge/*`), and the TS-side error union (`kernel/src/types/bridge-error.ts`). These are dependencies/consumers; this plan changes only the `compute-api` boundary and calls out the cross-folder coordination it requires.

This plan does not include running builds/tests; it specifies the verification gates a follow-up implementation must pass.

## Current role of this folder in Mog

`compute-api` is the single Rust boundary between the spreadsheet compute engine (`YrsComputeEngine`, which is `!Send + !Sync`) and everything outside it. It provides three distinct surfaces:

1. **`Dispatch`** (`dispatch.rs`) — the actor that serializes all engine access. On `native` the engine runs on a dedicated 16 MB-stack thread reached over a `crossbeam_channel` unbounded command queue with `bounded(1)` oneshot replies; on WASM it is an `Rc<RefCell<YrsComputeEngine>>` called synchronously. Both expose identical `call_engine`/`query_engine` closure-dispatch primitives so the upper layers are target-agnostic.

2. **`ComputeService`** (`bridge_service.rs`) — the **production FFI surface**. `bridge_delegate::delegate!(target = ComputeService, gated = true, …)` consumes ~30 `#[bridge::api]` descriptor groups from `compute-core` and auto-generates delegate methods plus re-emitted descriptor macros that the napi/pyo3/wasm/tauri crates consume via `generate!()`. It owns the security session state (`active_principal: ArcSwap<Option<Principal>>`, `principal_pool`, `security_active: Arc<AtomicBool>`) and routes every gated call through the access-policy enforcement layer. **Confirmed by evidence:** all four binding crates (`compute/napi/src/lib.rs`, `compute/pyo3/src/lib.rs`, `compute/wasm/src/lib.rs`, `runtime/src-tauri/src/commands/compute.rs`) import and build on `compute_api::ComputeService` and its `__bridge_descriptor_ComputeService_*` macros — none of them touch `Workbook`/`Sheet`.

3. **`Workbook` / `Sheet` + sub-APIs** (`workbook.rs`, `sheet.rs`, `workbook/*`, `sheet/*` — ~3,700 LOC) — a hand-written ergonomic Rust facade over `Dispatch`. **Confirmed by evidence:** the only non-test consumers of `compute_api` outside this crate are the binding crates (which use `ComputeService`) and `mog-internal/dev/formula-eval` (which uses only `compute_api::pure::pivot_convert`). The `Workbook`/`Sheet` facade is exercised by the crate's own integration tests (`smoke.rs`, `delete_columns_ref_error.rs`, `principal_state.rs`, `security_e2e/*`) but **has no production FFI consumer today**.

`error.rs` defines `ComputeApiError`, which implements `bridge_types::BridgeStructuredError` so every transport emits the same `[BRIDGE_ERROR]{…}` tagged-JSON envelope, mirrored by hand in the TS `BridgeError` union. `pure/*` re-exposes stateless engine bridge functions (pivot/table/chart/cf/format/schema/solver) that need no engine instance.

## Improvement objectives

The central problem is **two divergent surfaces over one engine with different security postures and different value/error contracts**, plus boundary-hygiene and round-trip-efficiency gaps. Objectives, in priority order:

1. **Close the security-bypass divergence.** The `Workbook`/`Sheet` facade calls `dispatch.call_engine`/`query_engine` directly — it does **not** pass through the `gated = true` access-policy enforcement that `ComputeService` applies, and it never calls `ComputeApiError::promote_security_denied`. Any native Rust caller of the facade therefore bypasses the privacy/policy engine and receives flat-string `Compute(SecurityDenied{…})` errors instead of the typed `SecurityDenied` shape. Decide and enforce a single production posture for the facade (see implementation step 1).

2. **Make the write-value contract honor typed intent.** `SdkValue` (`sdk_value.rs`) was built specifically to carry Clear vs `Literal("")` vs `Parse(…)` intent across the boundary "with no in-band sentinels." But `Sheet::set_cell`/`set_range` take `impl Into<String>` and call `set_cell_value_parsed`/`set_cell_values_parsed` with a bare string — re-introducing exactly the empty-vs-clear ambiguity `SdkValue` exists to prevent. Route facade writes through `SdkValue`/`CellInput`.

3. **Strengthen the address/range contract.** `CellRange::resolve` and `parse_a1_range` accept inverted (`end < start`) and unbounded ranges; `set_range` blindly materializes one entry per cell from a possibly-jagged `&[Vec<String>]` with no rectangularity or size guard. Normalize, bounds-check, and reject degenerate input with typed errors before it reaches the engine.

4. **Lock the error wire contract.** `ComputeApiError::to_bridge_value` is mirrored by hand in TS with no automated equivalence check, and there are two independent reconstruction paths for `SecurityDenied` (`From<SecurityError>` typed vs `rehydrate_security_denied` string-parse) that can drift. Add golden-shape coverage and converge the two paths.

5. **Remove round-trip and boilerplate amplification.** Multi-hop facade queries (`sheet_names`, `sheet_by_name`, `sheet`) do O(N) channel round-trips where one engine closure suffices; ~190 sub-API methods repeat the identical `.and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))` viewport-discarding incantation by hand.

6. **Tighten boundary hygiene.** Public signatures leak deep engine-internal paths (`compute_core::storage::engine::search::WorkbookTable`, `compute_core::engine_types::DataBounds`, `compute_core::ZOrderEntry`, `compute_core::bridge_types::BridgeSortOptions`), and five sub-API modules are publicly-exported empty TODO stubs that advertise capabilities the engine does not yet provide.

These are production-path improvements to the boundary contract — not test-only changes, shims, or scope reductions.

## Production-path contracts and invariants to preserve or strengthen

**Preserve:**

- **Target-agnostic upper layers.** `Workbook`/`Sheet`/`ComputeService` must keep compiling and behaving identically on `native` (threaded actor) and WASM (`Rc<RefCell>`). The `Send + 'static` bounds on the native `Dispatch` are load-bearing and must not regress.
- **WASM memory discipline.** `compute-core` is pulled with `default-features = false` deliberately (the comment in `Cargo.toml` documents heap-OOM on ≥500K-formula fixtures if `native` leaks into WASM). No change may re-enable engine `native` features transitively in the WASM build.
- **Bridge auto-generation.** `ComputeService` adds zero hand-written delegate boilerplate for engine methods; adding a `#[bridge::api]` method on the engine must continue to surface automatically. The descriptor-group list in `bridge_service.rs` and the re-emitted `__bridge_descriptor_ComputeService_*` macros are a consumed contract for four binding crates.
- **Error envelope.** `ComputeApiError::to_bridge_value` must keep `kind` discriminators in PascalCase, fields in camelCase, `Compute(inner)` passing through with no wrapper, and an auto-injected human `message`. The TS union mirrors this exactly; the legacy app-eval scenarios grep human substrings (e.g. "part of an array formula").
- **`SdkValue` semantics:** `Null→Clear`, `Bool→Parse(TRUE|FALSE)`, integral `Number→Parse(no decimal)`, `Text("")→Literal("")`, `Text(s)→Parse(s)`.
- **Principal non-serializability.** `Principal` stays off the wire; the four session methods trade `Vec<String>` and intern through `principal_pool`. `security_active` remains a single `Arc<AtomicBool>` shared with the engine's `SecurityState` (one source of truth).

**Strengthen:**

- **Uniform enforcement invariant:** *every* mutating/reading path that crosses this crate's public surface — facade included — resolves the active principal and is subject to the same access-policy gate and redaction as `ComputeService`. No public path may reach the engine ungated when policies are active.
- **Address/range well-formedness invariant:** a resolved `(sr,sc,er,ec)` is always normalized (`sr≤er`, `sc≤ec`) and within `MAX_ROWS`/`MAX_COLS`, or resolution returns a typed `InvalidRange`.
- **Write-intent invariant:** facade writes preserve Clear vs empty-literal vs parse intent end to end (no `to_string()` flattening).

## Concrete implementation plan

### Step 1 — Resolve the facade/security divergence (highest priority)

Investigate-then-commit. The facade currently bypasses gating; the production-correct fix is to make the ergonomic facade a thin layer over the **enforced** boundary rather than a parallel raw-`Dispatch` boundary.

- Audit every `Workbook`/`Sheet`/sub-API method against the engine's gated `#[bridge::read|write|structural]` classification (the `tests/coverage_audit.rs` machinery already enumerates engine-side scopes — reuse that catalog).
- Reroute facade methods so they share `ComputeService`'s enforcement: either
  - **(a, preferred)** give `Workbook`/`Sheet` an owned `ComputeService`-equivalent enforcement context (active principal + `security_active` + pool) and have facade calls go through the same gated closure wrapper the delegate uses, **or**
  - **(b)** if the facade is genuinely intended only as a trusted in-process Rust SDK, make that explicit: gate the entire facade behind a non-default `unenforced-internal` cargo feature, document the trust assumption in `lib.rs`, and ensure no default build re-exports it as enforcement-free.
- Apply `ComputeApiError::promote_security_denied` at the facade boundary so native callers receive the typed `SecurityDenied` variant, identical to the FFI surface.
- Decision input required from a compute owner before coding: is the `Workbook`/`Sheet` facade a committed public Rust SDK (→ path a) or internal-only tooling scaffolding (→ path b)? This is the one genuinely owner-level fork in the plan.

### Step 2 — Route facade writes through typed `CellInput`

- Change `Sheet::set_cell` / `set_range` to accept `impl Into<SdkValue>` (string callers still work via the existing `From<&str>`/`From<String>` impls) and dispatch through the engine's typed-input path (`CellInput`) rather than `set_cell_value_parsed(&str)`.
- For `set_range`, accept a typed grid and translate per cell through `SdkValue::to_cell_input`, preserving Clear/empty distinctions per element.
- Keep a parsed-string entry point available where the engine genuinely needs raw user text, but make the default path intent-preserving.

### Step 3 — Normalize and bound-check addresses/ranges

- In `address.rs`, extend `CellRange::resolve` (and `parse_a1_range`) to normalize corners (`min`/`max`) and validate against `MAX_ROWS`/`MAX_COLS`, returning `InvalidRange` with a precise reason on violation. Add the inverted-range and out-of-bounds test cases alongside the existing parser tests.
- In `Sheet::set_range`, reject jagged `values` (non-uniform inner lengths) with `InvalidRange` and validate that the supplied grid matches the resolved bounds, instead of silently expanding from `start` and ignoring `_end_row/_end_col`.
- Audit sub-APIs that take raw `u32` quadruples (`structure.rs` merges/relocate/shift, `tables.rs`, `objects.rs`) and funnel them through the same normalization helper so coordinate validation is centralized rather than per-method-absent.

### Step 4 — Converge and lock the error contract

- Collapse the two `SecurityDenied` reconstruction paths: have `From<SecurityError>` and `rehydrate_security_denied` share one constructor so the typed-vs-string forms cannot diverge.
- Add a golden-snapshot unit test for `to_bridge_value` over every `ComputeApiError` variant (the existing tests cover only a subset) so any field-name/discriminator drift fails locally.
- Add a contract assertion (or a checked-in JSON fixture consumed by both Rust and the TS `bridge-error.ts` test) that pins the wire shape across the language boundary. (Cross-folder coordination — see Parallelization.)
- Reassess the `CellError` variant: confirm it is still reachable or remove it to keep the public error enum honest.

### Step 5 — Remove round-trip and boilerplate amplification

- Replace the multi-hop `Workbook::sheet_names`, `sheet_by_name`, `sheet`, and `sheet_count` with single engine closures that gather order+names in one `query_engine` call (today `sheet_names` does 1 + N channel round-trips; `sheet_by_name` worst-case 1 + N).
- Introduce two private `Dispatch` helpers — `mutate(closure) -> Result<MutationResult, _>` and `mutate_with_id(...)` — that encapsulate the repeated `(_vp, m)` unwrap + `map_err` pattern used ~190 times across sub-APIs. This removes the manual viewport-patch discard at each call site and prevents a method from accidentally returning the wrong half of the tuple.

### Step 6 — Boundary hygiene

- Re-export the engine types that appear in public signatures (`DataBounds`, `WorkbookTable`/`WorkbookComment`/`WorkbookPivotTable`, `ZOrderEntry`, `BridgeSortOptions`) from `compute_api::types` (or a dedicated module) so consumers depend on `compute_api::…` rather than `compute_core::storage::engine::search::…`. This decouples the public contract from engine-internal module paths without changing the underlying types.
- Resolve the five publicly-exported empty stub modules (`workbook/protection.rs`, `workbook/styles.rs`, `sheet/hyperlinks.rs`, `sheet/pivots.rs`, `pure/solver.rs`): either wire them to real engine support if it now exists, or remove them from `lib.rs`'s public re-exports so the surface does not advertise no-op capabilities. Convert their TODO comments into tracked issues.

### Step 7 — Dispatch robustness (native)

- Document and bound the command channel: the unbounded `crossbeam_channel` provides no backpressure; under FFI write floods the queue can grow unbounded. Evaluate a bounded channel (with explicit `EngineBusy`/blocking semantics) or document the unbounded contract intentionally.
- Make `Dispatch::Drop` join (or detach with an explicit rationale) the engine thread so repeated per-doc create/drop in the binding registries cannot accumulate live engine threads. The `bounded(1)` oneshot reply and the `downcast::<T>().expect("dispatch type mismatch")` are sound by construction; leave the `expect` but add a comment asserting the type-identity invariant that justifies it.

## Tests and verification gates

(Implementation worker runs these; this plan only specifies them.)

- **Unit — address/range:** inverted range normalizes; out-of-bounds row/col → `InvalidRange`; jagged `set_range` grid → `InvalidRange`; existing `address.rs` parser tests still pass.
- **Unit — write intent:** facade `set_cell`/`set_range` preserve Clear vs `Literal("")` vs `Parse` (extend the `sdk_value.rs` regression tests to the facade path).
- **Unit — error contract:** golden `to_bridge_value` snapshot over all `ComputeApiError` variants; `SecurityDenied` typed and string-rehydrated paths produce byte-identical wire shapes; `Compute(inner)` still passes through unwrapped with human `message`.
- **Integration — enforcement parity:** extend `tests/security_e2e/*` so a denied operation issued through the `Workbook`/`Sheet` facade is rejected and surfaces the typed `SecurityDenied` exactly as the `ComputeService` path does (this is the regression guard for Step 1). `tests/coverage_audit.rs` must still pass and should be extended to assert facade/delegate parity.
- **Integration — round-trip count:** assert `sheet_names`/`sheet_by_name` issue a single engine dispatch (e.g. via a counting test `Dispatch` wrapper) to lock the O(1)-hop improvement.
- **Cross-target build gate:** crate compiles and tests pass under both default (`native`) and the WASM target; verify `compute-core`'s `native` features do **not** leak into the WASM build (cargo-tree check on the wasm binding).
- **Standard gates:** `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test -p compute-api`, plus the `compute/napi`, `compute/pyo3`, `compute/wasm`, and tauri crates still build against the re-emitted descriptors and the relocated public re-exports.
- **Downstream contracts:** the TS `bridge-error.ts` union test and the relevant api-eval/app-eval scenarios that assert engine error messages still pass.

## Risks, edge cases, and non-goals

**Risks / edge cases:**

- **Step 1 is the load-bearing decision.** If the facade becomes enforced (path a), any existing trusted internal caller that relied on ungated access changes behavior — must be validated against `formula-eval` and the crate's own tests. If it stays trusted (path b), the feature-gating must not accidentally drop the facade from a build that some tool depends on.
- **`set_cell` signature change** from `impl Into<String>` to `impl Into<SdkValue>` is source-compatible for string literals (existing `From` impls) but may need call-site review for any `String`-typed variable that relied on `Into<String>` blanket coverage. Confirm via `cargo check` across the workspace.
- **Re-exporting engine types** must re-export the *same* types (type aliases / `pub use`), not redefine parallel structs — `types.rs` already documents "does NOT define parallel type hierarchies"; preserve that rule.
- **Bounded-channel change (Step 7)** alters backpressure semantics under load; gate behind benchmarking and a deliberate decision rather than flipping it silently.
- **Error-shape golden tests** are intentionally brittle — that is the point — but mean any legitimate wire change now requires updating both the Rust snapshot and the TS fixture in lockstep.

**Non-goals:**

- Changing engine (`compute-core`) behavior, the bridge macro infrastructure, or the TS error union beyond adding a shared contract fixture.
- Adding new spreadsheet features; this is a boundary-correctness and hygiene plan.
- Reworking the WASM-vs-native dispatch model — only robustness hardening within it.
- Implementing the stubbed sub-APIs' engine functionality (Step 6 only resolves their *exposure*; implementing pivot/hyperlink/protection/style/solver engine support is owned by `compute-core`).

## Parallelization notes and dependencies on other folders

- **Independent, can start immediately:** Step 3 (address/range, `address.rs` self-contained), Step 4's golden snapshot (within this crate), Step 5 (round-trip + boilerplate helpers), Step 6's empty-stub triage.
- **Needs an owner decision first:** Step 1 (facade enforcement posture) — this is the single fork requiring a compute owner's input; everything else can proceed around it.
- **Cross-folder coordination required:**
  - Step 4's cross-language wire fixture touches `kernel/src/types/bridge-error.ts` (folder owned elsewhere) — coordinate the shared fixture, do not edit the TS union unilaterally.
  - Re-exports in Step 6 are consumed by `compute/napi`, `compute/pyo3`, `compute/wasm`, and `runtime/src-tauri`; their import paths may need a coordinated follow-up if they referenced the deep `compute_core::…` paths directly.
  - Step 1 path (a) reuses the enforcement primitives in `compute-core/crates/compute-security` and the `bridge-delegate` gating wrapper — read-only dependency, no changes expected there.
- **Ordering:** land Steps 3/5/6 (low-risk, isolated) first to shrink the surface; then Step 2 (write intent); then Step 4 (lock the contract); then Step 1 (enforcement parity, the behaviorally significant change) behind its decision; Step 7 last as opportunistic hardening.
