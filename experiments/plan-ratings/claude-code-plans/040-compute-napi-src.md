# 040 — Improve `mog/compute/napi/src` (Node/server compute N-API bindings)

## Source folder and scope

- **Folder:** `mog/compute/napi/src`
- **Crate:** `compute-core-napi` (`crate-type = ["cdylib"]`), built with `napi build` into `compute-core-napi.node`. This is the single native addon that Node/server runtimes load to reach the Rust compute engine.
- **Files (3, ~590 lines of `.rs`):**
  - `lib.rs` (112 lines) — the binding entrypoint. Two macro invocations: `bridge_napi::generate_class!` emits the `ComputeEngine` class from ~30 auto-generated `ComputeService` descriptors; `bridge_napi::generate!` emits free functions for the stateless bridge types (`PivotBridge`, `TableBridge`, `ChartBridge`, `FormatBridge`, `SchemaBridge`, `CfBridge`, `ClockBridge`) and the merged `XlsxParser`. The bulk of the file is `#[allow(unused_imports)] use …` lines that put bare type identifiers in scope for the generated descriptor expansions.
  - `coordinator.rs` (380 lines) — **hand-written** N-API bindings for `SyncCoordinator` (collaboration server: join/leave, push/pull, lock acquisition, awareness) plus `yrs_state_to_snapshot_json`. Uses a process-global handle table.
  - `chart_render.rs` (36 lines) — **hand-written** `render_chart_marks_image(request_json)` that rasterizes a chart-mark IR JSON into encoded image bytes via `compute_chart_render`.
- **In scope (edit targets):** the three files above and, where the contract requires it, the binding-side type/struct definitions they own (`#[napi(object)]` result types, handle representation, async-task wrappers).
- **Out of scope (named for coupling, not edited here):**
  - `compute-coordinator`, `compute-collab`, `compute-chart-render`, `compute-core`, `compute-api` crates — the engine logic lives there; this folder only marshals across the FFI boundary. Behavioral fixes that belong in those crates are flagged as cross-folder dependencies, not changed here.
  - `infra/rust-bridge/bridge-napi` (the `generate!`/`generate_class!` macros and `__expand`) — the descriptor-driven codegen. `lib.rs` is a *consumer* of it.
  - TS consumers in `mog/runtime/sdk` (`boot.ts`, `collaborative-engine.ts`, `chart-export/node-chart-image-exporter.ts`) and `mog/kernel/src/bridges/compute/compute-core.ts` — they define the JS-side contract this folder must keep compatible. Changes that ripple into them are called out explicitly.
  - `Cargo.toml`, `package.json`, `build.rs`, `npm/*`, `smoke-test.mjs`, the prebuilt `*.node` artifacts, and `index.d.ts` (gitignored, regenerated) — not edited by this plan except where a new test target is described as a follow-on (and even then, manifest edits are noted as out-of-band).

## Current role of this folder in Mog

This is the **Node/server FFI seam** for the compute engine. Browser builds reach the engine through the wasm bridge (`bridge-wasm`); everything that runs under Node — the headless SDK runtime, the collaboration server, the chart-image exporter, api-eval, the xlsx-corpus harness — loads `compute-core-napi.node` and calls into it. Three distinct surfaces share the one addon:

1. **The stateful engine (`ComputeEngine` class).** Auto-generated from `ComputeService` bridge descriptors. The Rust `Drop` impl handles cleanup (no registry, no manual destroy). This surface is *entirely* macro-generated; `lib.rs` only wires descriptors and imports.

2. **The collaboration coordinator (`coordinator_*` functions).** Hand-written. A process-global table of `SyncCoordinator` instances, addressed by `u32` handle, drives the authoritative server-side CRDT merge: participants join, push local updates (lock-checked), pull server diffs, hold sheet/workbook/structural locks with TTLs, and exchange awareness state. This is the engine behind `mog/runtime/sdk/src/collaborative-engine.ts` and the collaboration-server Docker image.

3. **Stateless utilities.** `render_chart_marks_image` (server-side chart PNG/JPEG export), `yrs_state_to_snapshot_json` (rehydrate a NAPI engine from raw Yrs bytes so it shares CellIds with a source engine), and the generated free functions for the pure bridge types.

The defining property of this seam: **every `#[napi]` function here is synchronous and runs on the Node main (JS) thread.** For the engine class that is acceptable (single-document, request-scoped). For the collaboration coordinator — which is multi-document and on the hot path of a shared server — it is a structural liability, as the evidence below shows.

## Evidence (observed in the current tree)

- **The global table mutex is held for the entire duration of every coordinator operation, serializing all documents server-wide.** `with_coordinator` (`coordinator.rs:55-68`) does `let table = COORDINATORS.lock()?;`, looks up the slot, locks the inner per-coordinator mutex, then calls `f(&mut coord)` — *while `table` is still in scope*. `table` (the `MutexGuard` over the whole `Vec`) is not dropped until the function returns, i.e. after `f` completes. So `coordinator_push`/`coordinator_pull` for document A — which run a CRDT apply + diff-encode — block `coordinator_*` calls for every other document B, C, … on the process. The per-coordinator inner mutex is therefore almost decorative: real concurrency is bounded by the single global table lock. On a collaboration server hosting many docs this is a global serialization point on the hottest path.

- **Handle reuse + non-generational `u32` handles means a stale TS handle can silently operate on the wrong document.** `insert_coordinator` (`coordinator.rs:86-100`) reuses freed slots (`if slot.is_none() { *slot = Some(...); return Ok(i) }`), and `coordinator_dispose` (`:114-123`) sets the slot to `None`. A handle is a bare slot index with no generation/epoch. Sequence: dispose handle `3`; a new `coordinator_create` reuses slot `3`; a TS caller still holding the old `3` now reads/writes a *different document's* coordinator with no error. This is a logical use-after-free / handle-aliasing bug. `coordinator_dispose` also silently ignores out-of-range handles (`if let Some(slot)`), so it cannot signal misuse.

- **Inconsistent allocation path: `coordinator_create_from_state` never reuses freed slots.** `coordinator_create`/`coordinator_create_empty` go through `insert_coordinator` (slot reuse), but `coordinator_create_from_state` (`:102-112`) always `table.push(...)`. On a server that boots coordinators from persisted state and disposes them across document lifecycles, the table grows monotonically — freed slots accumulate as permanent `None` holes that the `from_state` path never reclaims. Two allocation policies for the same table.

- **`.unwrap()` on `serde_json::to_string` can panic across the FFI boundary while holding locks.** `coordinator_join` (`:142`), `coordinator_push` (`:172-184`), and `coordinator_active_locks` (`:335`) all build a `serde_json::Value` and `.unwrap()` the serialization. A panic unwinds into napi-rs (UB-adjacent / process-abort territory for a `cdylib`) and — because of the first finding — poisons the *global* table mutex, bricking every coordinator in the process, not just the one that panicked. Serialization of these small JSON values is effectively infallible today, but the construct is a latent process-killer with global blast radius.

- **Invalid sheet IDs are silently dropped on the lock-checked write path.** `coordinator_push` (`:166-169`) does `touched_sheet_ids.iter().filter_map(|s| SheetId::from_uuid_str(s).ok())`. A malformed or unrecognized sheet id is dropped without error, so the push is lock-checked against a *narrower* set of sheets than the caller declared it touches. That can let a write through a lock it should have violated — a correctness hole in the very mechanism (`lock_table.check_push`) that exists to serialize structural edits. Failures should be explicit, not swallowed.

- **The wire protocol is hand-rolled JSON strings, including binary buffers encoded as number arrays.** `coordinator_join` returns a JSON *string* whose `fullState` field is a `Vec<u8>` (`types.rs:23`) — `serde_json` serializes that as a JSON array of integers (`[12, 255, 0, …]`), which the TS side must parse and re-pack into a Buffer. For full-document state this is a large, avoidable allocation on a hot path. `coordinator_acquire_lock` (`:219-262`) parses its scope from a hand-decoded `scope_json` string by string-matching `scope.type`. Every coordinator result type is stringly-typed rather than a `#[napi(object)]`, so the JS contract is enforced only by `as (...) => any` casts in `collaborative-engine.ts:101-206`, with no compiler check on either side.

- **All work runs synchronously on the JS event-loop thread.** `coordinator_push`/`coordinator_pull` (CRDT apply + diff), `coordinator_full_state`, `yrs_state_to_snapshot_json` (`:38-46`, full snapshot build), and `render_chart_marks_image` (`chart_render.rs:18-35`, rasterization) are all blocking `#[napi]` functions. On the collaboration server and the headless runtime they stall the event loop for the duration of the merge/encode/raster. napi-rs's `AsyncTask` / `#[napi]` async support exists precisely to move CPU-bound work to the libuv threadpool; none of it is used here.

- **`lib.rs` carries a hand-maintained import surface coupled to generated code.** Lines 22-54 are seven `#[allow(unused_imports)] use …;` blocks whose only job is to put bare type identifiers in scope for descriptor expansions that use `use super::*;`. The set must be kept in sync by hand whenever a descriptor's signature gains a type; the `#[allow(unused_imports)]` blanket means a *stale* import (one no longer needed) is never flagged, and a *missing* one only surfaces as an opaque "cannot find type" error inside a macro expansion. There is no test that asserts the addon's exported symbol set, so a descriptor that silently stops generating a function is invisible until a TS consumer breaks at runtime.

- **No Rust-side tests in the crate.** The crate has no `#[cfg(test)]` module and no integration test. `smoke-test.mjs` exists but is a manual `pnpm smoke-test` script, not wired into a gate. The handle-table semantics (reuse, dispose, aliasing), the lock-scope JSON parsing, and the push lock-check are all untested at this layer.

## Improvement objectives

1. **Make the coordinator table safe for concurrent multi-document use** — remove the global-lock-held-during-work serialization so independent documents proceed in parallel.
2. **Make handles unambiguous** — eliminate the stale-handle-aliases-new-document failure mode via generational handles, and unify the allocation policy across all three create paths.
3. **Remove the panic-on-`unwrap` process-kill risk** and make all FFI-boundary error paths propagate as `napi::Error`.
4. **Close the silent-sheet-id-drop lock hole** — invalid `touched_sheet_ids` must fail the push explicitly.
5. **Replace the stringly-typed wire protocol with typed `#[napi(object)]` structs and `Buffer` for binary**, removing JSON-string round-trips (especially the `fullState`-as-number-array allocation) and giving both sides a checked contract.
6. **Move CPU-bound operations off the JS event-loop thread** via napi `AsyncTask`/async, while preserving synchronous variants where callers depend on them.
7. **Reduce the maintenance fragility of `lib.rs`'s generated-import surface** and add a symbol-set assertion so dropped exports are caught at build/test time.
8. **Add crate-level tests** covering handle lifecycle, lock-scope marshaling, and the push lock-check.

## Production-path contracts and invariants to preserve or strengthen

- **Exported symbol names and JS-visible signatures are a published contract.** `boot.ts`, `collaborative-engine.ts`, `node-chart-image-exporter.ts`, `compute-core.ts`, api-eval, and the xlsx-corpus harness bind functions by exact `js_name`. Any rename or signature change is a coordinated cross-folder change with those consumers, never a unilateral edit here. New typed-object return shapes must be introduced behind the same names or via additive new names with the old ones kept until consumers migrate.
- **Coordinator authoritativeness.** The server-side `SyncCoordinator` is the source of truth for the merged document and the lock table. The binding must never reorder, drop, or partially apply a push: a push either applies-and-diffs fully or returns a typed error (`lock_violation`, `unknown_participant`, `sync_error`). The current ok/error JSON discriminator (`coordinator.rs:172-187`) is the contract to preserve in typed form.
- **Lock semantics.** Sheet/workbook/structural scopes, TTL expiry (`coordinator_expire_locks`), and the "structural lock serializes insert/delete row/col" guarantee must be preserved exactly. Strengthening means: the set of sheets a push is lock-checked against must equal the set the caller declared (no silent narrowing).
- **`Drop`-based cleanup for `ComputeEngine`.** The class surface relies on Rust `Drop`; do not introduce a registry or manual destroy that could double-free or leak.
- **Chart rendering stays semantics-free.** `render_chart_marks_image` must remain a pure rasterizer of the typed, versioned mark IR (the doc-comment contract at `chart_render.rs:1-5`). No chart-layout logic migrates into the binding.
- **Binary fidelity.** Yrs updates, state vectors, and snapshots are exact byte sequences; any protocol change must round-trip them byte-identically (Buffer in, Buffer out) — moving off number-array JSON encoding must not alter bytes.

## Concrete implementation plan

### Phase 1 — Coordinator concurrency and handle safety (highest value)

1. **Drop the global lock before doing work.** Change the table to `Vec<Option<Arc<Mutex<SyncCoordinator>>>>` (or `HashMap<u64, Arc<Mutex<SyncCoordinator>>>` — see step 2). Rewrite `with_coordinator` to: lock the table, `Arc::clone` the slot, **drop the table guard**, then lock and operate on the per-coordinator mutex. This makes the table lock a short critical section (lookup only) and lets independent documents run their push/pull concurrently on separate threads. `SyncCoordinator` is already `Send` (it lives in a `static Mutex`), so the `Arc<Mutex<…>>` is sound.
2. **Generational, unambiguous handles.** Replace the bare `u32` slot index with a generational handle. Simplest robust form: a `HashMap<u64, Arc<Mutex<SyncCoordinator>>>` keyed by a monotonic `u64` id (an `AtomicU64` counter), so a disposed id is never reused and a stale handle deterministically resolves to "disposed" rather than aliasing a new document. `coordinator_dispose` removes the entry and becomes idempotent but *observable* (return whether it existed, or keep `()` but stop silently swallowing out-of-range — at minimum log/error on unknown). This unifies all three create paths onto one allocation policy and eliminates the `from_state`-never-reclaims divergence.
3. **Remove every `.unwrap()` on serialization.** Once results are typed `#[napi(object)]` (Phase 2) most disappear; any residual `serde_json` call propagates via `?`/`map_err(Error::from_reason)`. No FFI function may panic on a serialization failure.
4. **Fail closed on invalid sheet ids in `coordinator_push`.** Replace `filter_map(|s| …ok())` with a `collect::<Result<Vec<_>, _>>()` that returns a typed `Error::from_reason("invalid touched sheet id: …")` (or an `invalid_argument` discriminated result) on the first malformed id, so the lock check always runs against the full declared set.

### Phase 2 — Typed wire protocol

5. **Define `#[napi(object)]` result structs** for the coordinator surface: `JoinResult { full_state: Buffer, active_locks: Vec<LockInfo>, participant_count: u32 }`, `LockInfo { id: String, owner: String, scope: LockScopeWire }`, `PushResult` as a discriminated result (`{ ok, server_diff?: Buffer, error?: "lock_violation" | …, conflicting_locks?, attempted_sheets? }` — or model it as a tagged union the way napi best supports). Return `Buffer` for `full_state`/`server_diff` instead of JSON number arrays.
6. **Type the lock-scope input.** Replace the hand-parsed `scope_json` string in `coordinator_acquire_lock` with a `#[napi(object)] LockScopeWire { kind: "sheet"|"workbook"|"structural", sheet_id?: String }` (or three explicit functions). Keep the `coordinator_acquire_structural_lock` convenience entry.
7. **Migrate consumers in lockstep.** Update `collaborative-engine.ts` to consume the typed objects and drop the `as (…) => any` casts. This is the cross-folder half of the change and must land together with (or immediately after) the binding change; sequence it so the addon keeps the old names.

### Phase 3 — Off-thread CPU-bound work

8. **Provide async variants for blocking operations.** Wrap `coordinator_push`, `coordinator_pull`, `coordinator_full_state`, `yrs_state_to_snapshot_json`, and `render_chart_marks_image` as napi `AsyncTask`s (or `#[napi] async fn`) so the merge/encode/raster runs on the libuv threadpool. Keep the existing synchronous names as thin shims (or behind the same name with an async signature) per what consumers can adopt — `node-chart-image-exporter.ts` and the collab server are the drivers. Because Phase 1 makes coordinator access `Arc<Mutex<…>>`, an `AsyncTask` can hold the `Arc` across the threadpool hop safely.

### Phase 4 — `lib.rs` maintainability and export assertions

9. **Tighten the import surface.** Where feasible, scope the `#[allow(unused_imports)]` to the specific generated modules rather than the whole file, or replace blanket globs with explicit imports so a stale import is flagged. Add a short doc-comment mapping each `use` block to the descriptor group that needs it, so future descriptor edits know which import to touch.
10. **Add an exported-symbol assertion.** Add a test (Rust integration test loading the built addon, or extend `smoke-test.mjs` into a gated check) that asserts the full set of expected `js_name` exports is present. This catches a descriptor that silently stops generating a function before a TS consumer hits it at runtime.

## Tests and verification gates

- **New crate tests** (`#[cfg(test)]` in `coordinator.rs` or a `tests/` integration target):
  - Handle lifecycle: create → use → dispose → reuse; assert a stale handle after dispose resolves to "disposed", **never** to a different live coordinator (the aliasing regression test).
  - Allocation policy: interleave `create`, `create_from_state`, and `dispose`; assert no unbounded growth / consistent reclamation.
  - `coordinator_push` lock-check with a malformed sheet id → typed error, push not applied.
  - Lock-scope marshaling round-trips for sheet/workbook/structural.
  - Concurrency smoke: two threads pushing to two different handles make progress without the global-table serialization (e.g. assert no deadlock and both complete; a timing assertion is fragile, so test structurally — that the table guard is released before work — via a barrier).
- **Exported-symbol test** as in Phase 4 step 10.
- **Byte-fidelity tests**: `full_state`/`server_diff`/state-vector buffers round-trip byte-identically before vs. after the JSON→Buffer protocol change.
- **Verification gates (run by a human/CI, not by this planning task):**
  - `cargo build -p compute-core-napi` and `cargo test -p compute-core-napi`.
  - `pnpm build` (the `napi build` target) regenerates `index.d.ts`; diff it to confirm the typed-object surface and that no export name changed unexpectedly.
  - `node smoke-test.mjs` passes.
  - `api-eval` and the `xlsx-corpus-eval` harness (which load this addon) pass — these are the integration safety net for the engine class and free-function surface.
  - The collab-server path: exercise `collaborative-engine.ts` / `ws-sidecar` collab e2e tests to confirm join/push/pull/lock behavior is unchanged through the typed protocol.

This planning task itself runs **no** build/test/cargo/pnpm commands; the above are the gates the implementing change must pass.

## Risks, edge cases, and non-goals

- **Cross-FFI contract risk.** The single biggest risk is changing a `js_name` or return shape that a consumer binds positionally. Mitigation: keep names stable, make protocol changes additive where possible, and land the `collaborative-engine.ts` migration in the same change set. Treat `node-chart-image-exporter.ts`'s expectation of `render_chart_marks_image` as fixed unless co-changed.
- **`AsyncTask` ordering.** Moving coordinator push/pull off-thread must not reorder operations for a single document. Per-document ordering is already the caller's responsibility (the WS sidecar serializes a participant's pushes); the `Arc<Mutex<…>>` preserves mutual exclusion per coordinator. Document explicitly that async does not relax per-handle ordering, and verify the sidecar does not fire concurrent pushes for one handle expecting sync completion.
- **Panic safety vs. process abort.** Removing `.unwrap()` reduces but does not eliminate panic risk (engine code can still panic). Consider a `catch_unwind` boundary in the hand-written functions as a defensive follow-on, but the primary fix is the global-lock removal so a panic can no longer poison every document.
- **Handle representation change.** Switching from slot-index `u32` to a monotonic-id `HashMap` keeps the JS type (`number`) but changes the numeric values consumers see; confirm no consumer persists or arithmetic-manipulates handles (a grep of `collaborative-engine.ts` shows handles are opaque pass-through — safe).
- **Edge cases:** dispose-during-in-flight-async (the `Arc` keeps the coordinator alive until the task finishes — define whether a post-dispose result is delivered or dropped); double-dispose; push with empty `touched_sheet_ids`; awareness updates on a disposed handle.
- **Non-goals:** changing CRDT/lock/awareness *semantics* (those live in `compute-coordinator`/`compute-collab`); modifying the `bridge-napi` codegen macros; reworking the `ComputeEngine` class surface (it is generated and correct); altering `Cargo.toml`/`package.json`/`npm/*` packaging or the multi-triple build matrix; introducing a new transport. No reduced-scope shims or test-only patches — the fixes are on the production binding path.

## Parallelization notes and dependencies on other folders

- **Independent now:** Phase 1 (concurrency + handle safety) and Phase 4 (lib.rs imports, symbol assertion) are self-contained to this folder and can proceed in parallel with no consumer coordination.
- **Coupled, sequence required:** Phase 2 (typed protocol) and Phase 3 (async variants) require lockstep edits in `mog/runtime/sdk/src/collaborative-engine.ts` (and the chart exporter for `render_chart_marks_image`). Coordinate with the kernel/runtime plans owning those files; land the binding change keeping old names, then migrate consumers, then optionally remove deprecated shims.
- **Upstream dependency:** any behavioral fix that belongs in `compute-coordinator`/`compute-collab` (e.g. how `PushError` variants are structured) is owned by those crates' plans; this folder only marshals their results. If `JoinResult`/`PushResult` field shapes change there, this binding's typed structs follow.
- **No dependency on the macro infra change:** `bridge-napi` is consumed as-is; this plan does not block on, and is not blocked by, changes to the codegen.
