# Plan 012 — Harden the Kernel→Compute Bridge (`mog/kernel/src/bridges/compute`)

## Source folder and scope

- **Folder:** `mog/kernel/src/bridges/compute`
- **Public source.** All planning text and rationale live here in `mog-internal`; the production change set is confined to the files below.
- **In-scope files (hand-written):**
  - `compute-core.ts` (1744 LOC) — lifecycle, mutation/query pipeline, viewport orchestration, trap state, sync, schema sync.
  - `compute-bridge.ts` (1833 LOC) — composition root over the generated base class; hand-written method overrides; standalone schema API; factories.
  - `compute-wire-converters.ts`, `compute-wire-types.ts`, `types.ts` — wire⇄domain conversion and leaf wire types.
  - `floating-object-mapper.ts`, `floating-object-geometry-normalization.ts`, `chart-import-normalization.ts` — domain-specific wire normalization.
  - `viewport-fetch-manager.ts` — TS-owned viewport movement (scroll/resize/sheet-switch) pipeline.
  - `errors.ts`, `index.ts` — error taxonomy and barrel.
- **Generated files (NOT edited directly):** `compute-bridge.gen.ts` (3217 LOC), `compute-types.gen.ts` (5861 LOC), `manifest.gen.ts` (649 LOC). These are emitted by `@mog/bridge-ts` (`pnpm generate:bridge` → `cargo test -p bridge-ts ...`). Any change to their shape is a change to the generator and/or the Rust `#[bridge::*]` annotations, which live **outside this folder**; see Dependencies.
- **Out of scope:** the Rust compute core (`compute/core/...`), `@mog/bridge-ts` generator internals, `@mog/transport`, `../wire/*` (viewport coordinator/buffer), and `../mutation-result-handler`. These are named as upstream/sibling dependencies where the bridge currently compensates for their gaps.

## Current role of this folder in Mog

This folder is the **single integration boundary** between the TypeScript kernel and the Rust compute engine (reached over Tauri IPC on desktop, WASM in the browser, NAPI in headless). Every spreadsheet read and write the kernel performs flows through `ComputeBridge`:

- `ComputeBridge extends GeneratedBridgeBase` — a thin composition root. ~430 passthrough methods are mixed in from the generated factory; lifecycle, viewport, sync, undo, error-recovery, and special-cased adapter methods are hand-written overrides that delegate to `ComputeCore`.
- `ComputeCore` owns the real infrastructure: init phase machine (`CREATED → HYDRATED → CONTEXT_SET → STARTED → DESTROYING → DISPOSED`), the unified `mutate`/`mutateCore`/`query` pipeline, trap detection + short-circuit, the write gate, viewport patch application, hydration-deficit backfill, the update_v1 provider drain, schema sync, and undo/redo.
- Wire types are generated from Rust serde as the source of truth (`.gen.ts`); hand-written branded helpers (`TypedActiveCellData`, `TypedCellEdit`) narrow generated `string` formula fields to branded `FormulaA1`/`FormulaTemplate`.

It is one of the most load-bearing modules in the product: a correctness or lifecycle defect here corrupts data, breaks undo, or crashes the document. The code is heavily documented and already battle-hardened (trap recovery, hydration deficit, superseded-instance guard), so improvements must be **surgical and invariant-preserving**, not rewrites.

## Improvement objectives

Ordered by production value. Each is a real production-path fix, not a shim.

1. **O1 — Replace `_forceRecomputeRefErrorCells` with a correct cross-sheet invalidation.** The current `removeSheet` workaround is incorrect (string-matches `#REF!` in formula display text → false positives/negatives), O(sheets × cells × round-trips) slow, and masks a Rust dep-graph gap (`remove_sheet()` misses `DepTarget::Range` dependents). Move the fix to the engine and delete the workaround.
2. **O2 — Move `copySheet`'s manual recalc into the engine mutation.** `mutation_copy_sheet` registers formulas but does not recalc, so the bridge fires a follow-up `compute_full_recalc` + `forceRefreshAllViewports`. This is a second non-atomic mutation observable to subscribers. Fold recalc + viewport-patch emission into the Rust mutation; drop the TS compensation.
3. **O3 — Eliminate the fragile fabricated/`as unknown as` mutation returns and manual `normalizeBytesTuple` sites** by extending the generator (`@mog/bridge-ts`) to model non-standard return tuples (`[String, MutationResult]`, `[String, PivotTableConfig, MutationResult]`) and `bridge::skip(ts_bridge)` methods natively, shrinking the hand-override surface in `compute-bridge.ts`.
4. **O4 — Type the workbook-security boundary.** `wbSecurityListPolicies(): Promise<any[]>`, `wbSecurityExplainAccess(...): Promise<any>`, and `target: unknown` params are untyped holes in an otherwise generated-typed surface. Define wire types in `types.ts`/contracts and remove the `any`.
5. **O5 — Make per-mutation viewport refresh targeted and coalesced.** `mutateCore` issues up to four independent `forceRefresh*` passes per mutation (table, pivot-remove, dimension/visibility, show-formulas) plus an unconditional CF-sibling refresh. The `sheetsWithCfRules` map is declared "reserved … currently unused." Coalesce these into a single deduplicated refresh and gate CF-sibling refresh on actual CF presence.
6. **O6 — Harden module-global lifecycle state.** `activeInstancePerDocId` (module Map) and `schemaTransport` (module singleton) never participate in a teardown contract beyond `destroy()`'s superseded-instance path. Audit for leak/staleness and add explicit disposal hooks.
7. **O7 — Add a build-drift guard between the WASM/NAPI binary and the `.gen.ts` types.** `extractMutationData` and the `as T` wire casts trust that the loaded engine binary matches the committed generated types. A version/schema-hash assertion at `start()` turns silent drift into a loud, diagnosable failure.

## Production-path contracts and invariants to preserve or strengthen

These are non-negotiable behaviors the current code documents; every change must keep them green.

- **C1 — Single mutation pipeline.** Every write goes through `mutateCore()`: write-gate check → apply binary viewport patches (zero-copy) → targeted refreshes → `MutationResultHandler.applyAndNotify` → validation annotations → `afterMutationHook` (update_v1 drain). No write may bypass it (event-bus delivery + undo-cache refresh depend on it — see the `copySheet`/`removeSheet`/`renameSheet` notes about FT-009/FT-010 and Cmd+Z parity).
- **C2 — Atomicity / single undo entry.** Operations that today span multiple engine calls (`removeSheet` + `_forceRecomputeRefErrorCells`, `copySheet` + recalc) MUST collapse into exactly one undo step. O1/O2 must not regress this — moving work into Rust naturally preserves it; the `beginUndoGroup/endUndoGroup` wrapper in `removeSheet` exists precisely for this.
- **C3 — Trap short-circuit.** Once a `TrapError` is observed, the `transport` getter returns a stub that throws `ModuleTrappedError` for all subsequent calls; `DESTROYING/DISPOSED` takes precedence over `MODULE_TRAPPED`. The constructor's inline trap-wrapping transport is the single integration point — do not move it to middleware (it couples to `markModuleTrapped` state by design).
- **C4 — Phase guards.** `ensureInitialized()`/`ensurePhase()` gate operations; `syncApply` and `createEngine` deliberately tolerate pre-STARTED phases (provider replay). Refresh coalescing (O5) must keep the `if (!this.isInitialized)` early-return that arms the hydration deficit.
- **C5 — Bootstrap vs user provenance.** `createDefaultSheet` (ORIGIN_BOOTSTRAP, never enters undo) vs `createSheet` (user, undoable). A fresh workbook must report `canUndo === false`. Any generator change (O3) must preserve the distinct origin tagging.
- **C6 — Rust is the single source of truth for positions/values.** The renderer never recomputes geometry; it re-reads from Rust. Targeted refresh (O5) must still produce a fresh fetch whenever dimensions/visibility/show-formulas change.
- **C7 — Branded formula invariant.** `ActiveCellData.formula` carries the `=` prefix (`FormulaA1`); `CellEdit.formula` is the prefix-less template (`FormulaTemplate`). The `types.ts`-is-a-leaf rule (no intra-package imports) keeps codegen cycle-free — O4's new security wire types must stay leaf-safe.
- **C8 — update_v1 dispatch semantics.** FIFO commit order, one fire per `txn.commit()`, read-only ops never fire, reentrancy-guarded, subscriber set snapshotted per batch, loop self-terminates on `instance not found`. O6 must not perturb this.

## Concrete implementation plan

### Phase 1 — Low-risk, in-folder hardening (no engine/generator dependency)

**Step 1.1 — Type the security boundary (O4).**
- In `types.ts` add leaf wire types: `SecurityPolicyWire`, `SecurityAccessExplanationWire`, `SecurityTargetWire`, `AccessPrincipalWire` mirroring `compute_security::SecurityEvent`/policy shapes (cross-reference `contracts/src/events/security-events.ts`, which already mirrors the Rust union for `RawSecurityEvent`).
- Re-export them through `compute-wire-types.ts`.
- Replace `Promise<any[]>` / `Promise<any>` / `target: unknown` in `wbSecurityListPolicies`, `wbSecurityExplainAccess`, `wbSecurityEffectiveAccess`, `wbSecurityApplyTemplate`, `wbSecurity*Policy` with the new types.
- Keep the comment noting these are "flat bridge methods (future privacy rebuild)"; the typing does not pre-commit the rebuild.

**Step 1.2 — Coalesce per-mutation viewport refresh (O5).**
- Introduce a private `collectRefreshPlan(result): { allViewports: boolean; sheetIds: Set<string> }` in `compute-core.ts` that folds the existing four trigger blocks (table changes, pivot `Removed`, dimension/visibility, show-formulas) plus CF-sibling needs into one plan.
- Execute one refresh pass: if `allViewports` → `forceRefreshAllViewports()` once; else `forceRefreshSheetViewports` for the deduped `sheetIds` set via a single `Promise.all`. This removes redundant double-refreshes when, e.g., a mutation both removes a pivot and changes dimensions on the same sheet.
- Activate the dormant `sheetsWithCfRules` map: populate it from `cfChanges` and only run `refreshViewportForCfSiblings` for sheets known to carry CF rules. Remove the "currently unused" caveat or delete the map if the coalesced plan subsumes it — do not leave dead state.
- Preserve ordering guarantees: patches apply before refresh; `afterMutationHook` still runs last.

**Step 1.3 — Tighten remaining `as any` in mappers (O4 adjacent).**
- `floating-object-mapper.ts:758,772` (`(d as any).lockAspectRatio`, `(d as any).colorType`) indicate the `WireShape`/`WirePicture` types are missing fields present on the Rust wire. Add the fields to the wire interfaces (in `types.ts` or the relevant wire type) and drop the casts. If the field is genuinely generated-only, source it from `compute-types.gen.ts` instead of `any`.

### Phase 2 — Remove TS compensations for engine gaps (requires Rust core changes — cross-folder)

**Step 2.1 — Fix `remove_sheet` range-dependent invalidation, then delete `_forceRecomputeRefErrorCells` (O1).**
- Upstream (Rust, `compute/core`): make `remove_sheet()` invalidate `DepTarget::Range` dependents (cross-sheet positional refs like `=Sheet2!A1`), not only `DepTarget::Cell`, and recalc them to `#REF!` within the same mutation, emitting binary viewport patches.
- In this folder: once the engine emits correct patches, delete `_forceRecomputeRefErrorCells`, the post-delete `forceRefreshAllViewports`, and simplify `removeSheet` to the standard `normalizeBytesTuple` → `core.mutate()` shape. The `beginUndoGroup/endUndoGroup` wrapper can drop to a single mutation (C2 then holds trivially).
- This removes a correctness bug (formula-text `#REF!` matching) and a large IPC-round-trip cost on every sheet deletion.

**Step 2.2 — Fold recalc into `mutation_copy_sheet`, simplify `copySheet` (O2).**
- Upstream (Rust): `mutation_copy_sheet` runs the recalc pass and emits viewport patches as part of one mutation.
- In this folder: `copySheet` becomes capture-`newSheetId` + single `core.mutate(...)`; delete the follow-up `compute_full_recalc` call, the `applyAndNotify({ recalc })` re-injection, and the trailing `forceRefreshAllViewports`. Result: one atomic, undoable operation with no observable intermediate state.

### Phase 3 — Generator-driven override reduction (requires `@mog/bridge-ts` — cross-folder)

**Step 3.1 — Model non-standard return tuples in the generator (O3).**
- Extend `@mog/bridge-ts` so methods returning `[String, MutationResult]`, `[String, PivotTableConfig, MutationResult]`, or non-bytes-tuple `MutationResult` (currently `bridge::skip(ts_bridge)`) generate correct passthroughs that route through `core.mutate()` and unpack via the shared `normalizeBytesTuple` path.
- After regeneration (`pnpm generate:bridge`), delete the now-redundant hand overrides: `createSheet`, `createDefaultSheet` (preserving its ORIGIN_BOOTSTRAP tag — C5), `pivotCreateWithSheet`, `addComment`/`addCommentByPosition`, `renameSheet`, and the fabricated `beginUndoGroup`/`endUndoGroup` returns (`{ recalc: { changedCells: [] } } as unknown as MutationResult`). The generator should emit the real return type instead of the fabricated cast.
- The composition root shrinks toward its stated "~200-line" intent; fewer hand-written tuple-unpack sites means fewer places for WASM-vs-NAPI packing drift.

### Phase 4 — Boundary integrity (in-folder + small contract addition)

**Step 4.1 — Build-drift guard (O7).**
- At `start()` (or first `createEngine`), call a cheap engine RPC returning a generated-types schema hash/version and assert it equals a constant emitted into `manifest.gen.ts` by the generator. Mismatch throws a `BridgeError` with both versions — turning "silent wire drift after a partial rebuild" into an immediate, diagnosable failure. (Ties to the recurring `compute-bridge.gen.ts`/`compute-types.gen.ts` regeneration discipline.)

**Step 4.2 — `activeInstancePerDocId` / `schemaTransport` lifecycle audit (O6).**
- Confirm every `createEngine*` path that `set`s the map has a corresponding `delete` on `destroy()` even when `engineCreated` is false at dispose time; add the missing delete if a CREATED-but-never-started core can leak an entry.
- Give `schemaTransport` an explicit reset/dispose hook (e.g. for test isolation and HMR) so the module singleton can be torn down deterministically.

## Tests and verification gates

> Per task constraints this worker does not run builds/tests. The following defines the gates the implementing change must pass.

- **Existing unit tests must stay green** (this folder's `__tests__/`): `trap-recovery`, `sync-mutation-result`, `viewport-fetch-manager`, `viewport-sheet-switch`, `compute-core-lifecycle-cleanup`, `session-security-doc-scope`, `floating-object-mapper`, `floating-object-geometry-normalization`, `chart-import-normalization`, `compute-wire-converters`, `finite-f64-roundtrip`, `date-formula-format-compat`.
- **New unit tests:**
  - O1: `removeSheet` with cross-sheet `=Sheet2!A1` *range* references → cells recalc to `#REF!` via engine patches, and a single undo restores both the sheet and the references (C2). Negative: a cell whose literal text is `#REF!` is NOT rewritten.
  - O2: `copySheet` of a sheet with formulas → copied formula cells carry computed values after exactly one mutation; `canUndo === true` and one Cmd+Z reverts the copy atomically.
  - O5: a mutation that simultaneously removes a pivot and changes row heights on the same sheet triggers exactly one `forceRefreshSheetViewports` for that sheet (assert via fetch-manager spy call count); a CF-free sheet triggers no CF-sibling refresh.
  - O4: security methods return the new typed shapes; typecheck rejects `any` usage.
  - O7: drift guard throws `BridgeError` when the engine reports a mismatched schema hash.
  - O6: dispose of a CREATED-but-never-started core leaves `activeInstancePerDocId` empty.
- **Codegen gate (Phase 3):** `pnpm generate:bridge` produces no diff beyond the intended new method shapes; `manifest.gen.ts` `BRIDGE_METHOD_KIND` entries unchanged for affected methods.
- **Integration / eval gates:** `api-eval` `history/undo-redo-state`, `history/undo-state-tracking` (C5 bootstrap), sheet copy/delete/rename scenarios; `app-eval` viewport-repaint scenarios for pivot-delete, dimension change, and show-formulas toggle (C6). Provider-replay/hydration path covered by trap-recovery + sync tests.
- **Typecheck:** full kernel `tsc` (note `@mog-sdk/contracts` declaration rollup ordering — `pnpm --filter @mog-sdk/contracts build` before kernel typecheck, per the contracts-declaration-rollup memory).
- **Performance check:** `removeSheet` on a workbook with N sheets must drop from O(sheets × cells) IPC round-trips to a single mutation (O1).

## Risks, edge cases, and non-goals

- **R1 — Atomicity regressions (C2).** Moving recalc into Rust (O1/O2) must emit viewport patches in the same mutation; if not, the renderer paints stale cells. Mitigation: assert patch emission in the new tests; keep the undo-group wrapper until the single-mutation path is proven.
- **R2 — Provenance loss (C5).** Generator-driven removal of `createDefaultSheet` (O3) risks dropping ORIGIN_BOOTSTRAP. Mitigation: the generator must thread the bootstrap origin; gate on the undo-state evals.
- **R3 — Trap/dispose ordering (C3).** Any refresh-coalescing change must keep the `transport` getter as the only guard point and must not call `forceRefresh*` after dispose. Mitigation: preserve `isDestroyingOrDisposed()` checks in the fetch manager paths.
- **R4 — Hidden CF dependence (O5).** Gating CF-sibling refresh on `sheetsWithCfRules` risks missing a freshly-added rule. Mitigation: populate the map from the *current* mutation's `cfChanges` before deciding, and fall back to refresh when a CF change is present in-result.
- **R5 — Generated-file drift.** `.gen.ts` edits must come only from regenerating, never by hand. The drift guard (O7) is the backstop.
- **R6 — `as unknown as` removal exposes real shape mismatches.** Removing fabricated returns (O3) may surface that some Rust returns genuinely lack a `MutationResult`; handle by giving those methods an honest return type rather than re-introducing a cast.
- **Non-goals:** rewriting `ComputeCore`/`ComputeBridge`; changing the WASM/Tauri/NAPI transport selection; the workbook-security "privacy rebuild" (O4 only types the current surface); altering the viewport binary wire format; touching `../wire/*` coordinator internals; any reduced-scope test-only patch in place of the engine fixes in O1/O2.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now (Phase 1):** O4 (security typing), O5 (refresh coalescing), Step 1.3 (mapper casts), Step 4.2 (lifecycle audit) — all in-folder, no upstream dependency. These can land first and de-risk the larger work.
- **Cross-folder dependencies (sequence after the upstream change merges):**
  - **O1, O2 → Rust compute core** (`compute/core` — `remove_sheet`/`DepTarget::Range` invalidation; `mutation_copy_sheet` recalc + patch emission). The TS deletions must merge *after* the engine emits correct patches, or sheet-delete/copy regress.
  - **O3 → `@mog/bridge-ts`** generator (multi-value tuple + `skip(ts_bridge)` modeling) and the Rust `#[bridge::*]` annotations. Requires regenerating `compute-bridge.gen.ts`/`compute-types.gen.ts`/`manifest.gen.ts`; coordinate so no other bridge consumer is mid-regeneration.
  - **O7 → `@mog/bridge-ts`** must emit a schema hash/version constant into `manifest.gen.ts`, plus a tiny Rust RPC to report the binary's hash.
- **Adjacent consumers to notify:** `shell/src/services/trap-recovery/*` (constructs `ComputeCore` directly — keep that export stable), `RustDocument`/`DocumentLifecycleSystem` (write-gate + `waitForReady`), and Provider protocol subscribers (`subscribeUpdateV1`). None of these need code changes if C1–C8 hold, but they are the blast radius for review.
- **Suggested execution order:** Phase 1 (parallel) → Phase 2 (after engine PRs) → Phase 3 (after generator PR) → Phase 4. Phases 2 and 3 are independent of each other and can proceed in parallel once their respective upstreams land.
