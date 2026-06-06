# 009 — Improve `mog/kernel/src/api` (kernel API surface & behavior gateway)

## Source folder and scope

- **Folder:** `mog/kernel/src/api`
- **Role:** the public interface for all kernel operations — three API styles (namespace functions, the unified `createWorkbook` OOP API, and the document lifecycle factory) plus the internal operation layer that actually mutates the document model.
- **Size:** ~53,750 lines of `.ts` across the folder; ~40,140 lines excluding `__tests__`.
- **Subfolders in scope:**
  - `index.ts` — public barrel (re-exports `createWorkbook`, namespaces, utils, `DocumentFactory`, introspection).
  - `namespaces/` (775 lines) — low-level stateless function API: `Cells`, `Sheets`, `Records`.
  - `workbook/` (6,199 lines) — unified API: `WorkbookImpl` (1,960 lines) + workbook-scoped sub-APIs (`sheets`, `names`, `scenarios`, `history`, `styles`, `protection`, `notifications`, `viewport`).
  - `worksheet/` (33,616 lines) — `WorksheetImpl` (2,901 lines) + ~30 lazy sub-API classes (`charts` 1,882, `pivots` 2,633, `tables` 1,574, `filters`, `slicers`, …) + `worksheet/operations/` (31 internal mutation modules) + `worksheet/handles/`.
  - `document/` (6,030 lines) — `DocumentFactory`, `mog-document-impl`, SDK event facade, timezone resolution.
  - `internal/` (1,583 lines) — shared helpers: `utils`, `address-resolver`, `format-utils`, `cell-data-conversion`, `introspection`, `number-format-locale`, `range-context`, `style-patterns`, `value-conversions`.
  - `app/` (5,481 lines) — capability-gated, app-scoped API.
  - `README.md` — folder-level documentation.
- **Out of scope (named only for coupling, not edit targets):** `@mog-sdk/contracts/*` type packages consumed by the barrel; the bridge implementations under `mog/kernel/src/bridges/**` and `mog/engine/src/**` reached through `ctx.computeBridge`; the ESLint import-boundary plugin. Changes that ripple into them are flagged as cross-folder dependencies.

## Current role of this folder in Mog

This folder is the **behavior gateway** between consumers (the Shell, OS apps, the external SDK) and the reactive engine. It owns three layered concerns:

1. **Public contract surface.** `createWorkbook()` returns a `Workbook` contract interface; `WorkbookImpl`/`WorksheetImpl` are kernel-internal and never exported. The barrel classifies every export with a `@stability` tag (stable / experimental / internal).
2. **Address & result translation.** The public layer (`worksheet/`, `workbook/`) resolves A1 strings to numeric coordinates (`internal/address-resolver.ts`), enforces the write gate, unwraps `OperationResult` into thrown `KernelError`s, and delegates to the internal operation layer.
3. **Internal mutation layer.** `worksheet/operations/` (31 modules) holds the raw mutation logic that calls `ctx.computeBridge` with explicit `(ctx, sheetId, row, col)` parameters.

It is also the **context-tier boundary**: `DocumentHandle.context` hands out a Tier 2 `IKernelContext` (bridges + services), while `WorkbookImpl` casts internally to Tier 3 `DocumentContext` (adds `computeBridge`, viewport buffers). Apps must never reach Tier 3.

Because it is the API of record, improvements here are about **consistency, accuracy, and disposability of the contract** — not behavior changes. The risk profile is high (every consumer compiles against it), so the plan favors additive, mechanical, reviewable steps.

## Evidence (observed in the current tree)

- **Stale README — references a directory that no longer exists.** `README.md` documents a top-level `sheet/` directory ("Internal operation modules… 35 modules of raw mutation logic") and a flow `MergeOps.merge(...)` under `sheet/`. There is **no `sheet/` directory**; the operations live in `worksheet/operations/` and number **31 modules**, not 35. The example flow points at a non-existent path.
- **Stale README — references a file that does not exist.** `README.md` §`internal/` lists `unwrap.ts` ("OperationResult error unwrapping"). **`internal/unwrap.ts` does not exist.** The `internal/` list is also incomplete: it names 5 files but the folder has 10 (`cell-data-conversion`, `number-format-locale`, `range-context`, `style-patterns`, `value-conversions` are undocumented).
- **Duplicated unwrap helper — verbatim copies.** The same `function unwrapResult<T>(result: { success: boolean; data?: T; error?: any }): T` is defined independently in three sub-APIs: `workbook/scenarios.ts:30`, `worksheet/print.ts:17`, `worksheet/outline.ts:23`. The `: any` error field defeats the typed `KernelError` model. There is no shared `internal/` unwrap utility despite the README claiming one.
- **Duplicated write-gate guard — 14+ copies.** A near-identical `private _ensureWritable(operation/op: string): void` that calls `ctx.writeGate.assertWritable(...)` and re-wraps with `toMogSdkError`/`toMogSdkError`-style conversion is hand-rolled in at least 14 classes: `workbook/workbook-impl.ts:247`, `workbook/sheets.ts:64`, `workbook/history.ts:39`, `workbook/names.ts:46`, `worksheet/worksheet-impl.ts:427`, `worksheet/structure.ts:49`, `worksheet/outline.ts:41`, `worksheet/print.ts:35`, `worksheet/layout.ts:22`, `worksheet/formats.ts:50`, `worksheet/hyperlinks.ts:23`, `worksheet/filters.ts:199`, and more. The parameter name even drifts (`operation` vs `op`).
- **Inconsistent failure convention in the operation layer.** Some operation modules **throw** `KernelError` (`worksheet/operations/floating-object-operations.ts` header: "Functions throw KernelError on failure instead of returning OperationResult"), while others **return** `OperationResult<T>` that callers must unwrap (`table-operations.ts`, `validation-operations.ts`). Two contracts coexist for "this can fail," forcing every consumer to know per-module which it is.
- **`as any` casts in production code — 16 occurrences (no `@ts-ignore`/`eslint-disable`).** Concentrated in `worksheet/handles/shape-handle-impl.ts` (6, a `ShapeFontProxy` building partial text payloads), `worksheet/operations/shape-operations.ts` (3), `document/document-factory.ts` (3), plus single casts in `floating-object-operations.ts:910`, `worksheet/formats.ts:266`, `worksheet/comments.ts:158` (overload bridge), and `workbook/workbook-impl.ts:1452` (error-type discrimination). These mark missing payload types at the bridge seam, not deliberate escapes.
- **God-files.** `worksheet/worksheet-impl.ts` (2,901), `worksheet/pivots.ts` (2,633), `workbook/workbook-impl.ts` (1,960), `worksheet/charts.ts` (1,882), `worksheet/tables.ts` (1,574). `WorksheetImpl` carries ~40 lazy `get` accessors following an identical `??=` boilerplate.
- **Deferred work flagged in code.** `worksheet/tables.ts:101` `TODO(4.8): Persist sort specs to document model via bridge`; `app/bindings-api.ts:11,28` `TODO: Wire ComputeBridge binding methods for cross-session persistence`. These are real contract gaps (sort specs and bindings are not durably persisted).
- **Tier 2→Tier 3 casts rely on caller discipline.** `workbook/workbook-impl.ts:254` `this.ctx = config.ctx as DocumentContext;` and `:1197` `this.ctx as DocumentContext`. Justified (WorkbookImpl is internal) but unchecked — a Tier 2 context passed by mistake fails only at runtime when `computeBridge` is dereferenced.

## Improvement objectives

1. **Make the README true.** It is the entry document for the most-consumed folder in the kernel and currently points at a directory and a file that do not exist, and undercounts both modules and helpers. A stale README of the public API is itself a defect.
2. **Centralize the result/error vocabulary.** One shared, strongly-typed `unwrapResult` (and friends) in `internal/`, replacing the three verbatim copies and the `error?: any` shape, so unwrapping is consistent and the `KernelError` type survives.
3. **Centralize the write-gate guard.** One shared `assertWritable`/`ensureWritable` helper consumed by all sub-APIs, eliminating ~14 hand-rolled copies and the `operation`/`op` naming drift.
4. **Unify the operation-layer failure convention.** Choose one contract — throw `KernelError` at the operation boundary (matches the public API, which already throws) — and migrate the `OperationResult`-returning modules to it, or formalize the split with a typed boundary so consumers no longer guess.
5. **Eliminate the `as any` at the bridge seam.** Introduce the missing payload types (e.g. a `ShapeTextUpdatePayload` for `ShapeFontProxy`) so the 16 casts become typed conversions.
6. **Tame the god-files without changing behavior.** Reduce `WorksheetImpl`/`WorkbookImpl` boilerplate via a sub-API registration helper; this is structural, not behavioral.
7. **Harden the Tier 2/Tier 3 boundary.** Make the internal Tier 3 cast assert (dev-time) that `computeBridge` is present, turning a late runtime failure into an immediate, attributable one.

These are production-path improvements: they tighten the types and contracts every consumer compiles against and remove latent inconsistency; none reduce scope or add shims.

## Production-path contracts and invariants to preserve or strengthen

- **Export stability classification.** Every barrel export keeps its `@stability` tag and its meaning. `createWorkbook` stays stable; `Cells`/`Sheets`/`Records` stay experimental; `DocumentFactory` and cell-data converters stay internal. No symbol is renamed or removed without a coordinated contracts update.
- **`WorkbookImpl`/`WorksheetImpl` remain unexported.** Only the `Workbook` contract interface escapes. Tests import the concrete class via the deep path; this must keep working.
- **Public API throws; it does not return `OperationResult`.** The unification (objective 4) must converge *toward* the public surface's throw-based contract, not introduce result-returning public methods.
- **Disposal ordering.** `wb.dispose()` order (DisposableStore → CodeExecutor → FloatingObjectManager → WorksheetImpl instances → CheckpointManager → FormControlManager) is load-bearing; any sub-API refactor must not change disposal order or drop a `dispose()` call. `WorksheetImpl.dispose()` must keep unregistering the cell-metadata cache (`computeBridge.setCellMetadataCache(null)`).
- **Address resolution semantics.** `resolveCell`/`resolveRange` overload discrimination (`typeof === 'string'` → A1, else numeric) is the contract for every overloaded method; refactors must preserve exact behavior, including 1-based vs 0-based conventions in `internal/utils.ts`.
- **Write-gate timing.** `assertWritable` must fire **before** any delegation to the operation layer; centralizing the helper must not move the check later.
- **Tier boundary.** `DocumentHandle.context` returns Tier 2; only kernel-internal code casts to Tier 3. The boundary is ESLint-enforced — strengthening it (objective 7) must not relax the lint rule.
- **`renderCached`/synchronous-path invariants** in any sub-API that participates in the canvas dispatch loop must remain synchronous.

## Concrete implementation plan

Sequenced so additive/mechanical steps land first; contract-shape changes that ripple into the operation layer come last behind explicit cross-folder coordination.

### Step 1 — Fix the README (additive, zero code risk)
- Replace the `sheet/` directory entry and the `MergeOps.merge` example flow with the real `worksheet/operations/` path and an extant operation (e.g. `MergeOps`→`merge-operations.ts`). Correct the module count (31, verify at edit time).
- Update the `internal/` section to list all 10 files and remove the non-existent `unwrap.ts` reference (replace with the new shared helper once Step 2 lands).
- Document the operation-layer failure convention chosen in Step 4.

### Step 2 — Shared result unwrap utility (`internal/result.ts`)
- Add a single typed `unwrapResult<T>(result: OperationResult<T>): T` (and any `isOk` guard) using the real `OperationResult`/`KernelError` types instead of `{ success; data?; error?: any }`.
- Replace the three copies in `workbook/scenarios.ts`, `worksheet/print.ts`, `worksheet/outline.ts` with imports. Verify no other inline copies exist before finishing.
- Purely internal; no public-surface change.

### Step 3 — Shared write-gate guard (`internal/write-gate.ts`)
- Extract `ensureWritable(ctx, operation: string): void` that calls `ctx.writeGate.assertWritable` and wraps with the existing `toMogSdkError` conversion.
- Replace the ~14 hand-rolled `_ensureWritable`/`_ensureWritable(op)` private methods with calls to the shared helper (keep a thin private wrapper per class if it reads better, but it must delegate). Standardize the parameter name to `operation`.
- Behavior-preserving: same exception, same timing.

### Step 4 — Unify the operation-layer failure convention
- Decision: operation modules **throw `KernelError`** (aligns with `floating-object-operations.ts` and the public throw contract). Migrate the `OperationResult`-returning modules (`table-operations.ts`, `validation-operations.ts`, and any others found at edit time) to throw, and delete the now-dead unwrap calls in their callers (which then use Step 2's helper only where a result still legitimately crosses a boundary).
- If a genuine result-returning boundary must remain (e.g. batch operations that report partial success), formalize it with a single documented `OperationResult` type and route every consumer through Step 2's helper — no ad-hoc shapes.
- This is the highest-ripple step; gate it behind a full kernel typecheck and the SDK conformance suite.

### Step 5 — Type the bridge-seam payloads (remove `as any`)
- Define the missing payload types where the casts cluster: a `ShapeTextUpdatePayload` (or extend the existing shape-update type) for `worksheet/handles/shape-handle-impl.ts`'s `ShapeFontProxy`; proper fill/content-type conversions for `worksheet/operations/shape-operations.ts`. Coordinate with the shape bridge contract (cross-folder if the type lives in `@mog-sdk/contracts`).
- Convert each `as any` to a typed conversion or a documented, narrowed cast. Target: zero `as any` in `worksheet/handles/` and `worksheet/operations/shape-operations.ts`; document any residual (e.g. `comments.ts:158` overload bridge) with a one-line rationale.

### Step 6 — Reduce `WorksheetImpl`/`WorkbookImpl` boilerplate (structural)
- Introduce a small `lazy<T>(factory)` / sub-API registration helper so the ~40 identical `private _x?; get x(){ return this._x ??= new XImpl(...) }` accessors collapse to one declarative line each, while preserving lazy semantics and the exact constructor arguments.
- Strictly behavior-preserving; no public-method signatures change. This is the only step that touches the god-files and can be deferred if review bandwidth is tight.

### Step 7 — Harden the Tier 3 cast
- Replace the two bare `as DocumentContext` casts in `workbook-impl.ts` with a tiny internal `asDocumentContext(ctx)` that, in dev builds, asserts `computeBridge` is present and throws an attributable error otherwise. Keep it a zero-cost cast in production builds.

### Step 8 — Resolve or formally track the code TODOs
- For `tables.ts:101` (sort-spec persistence) and `app/bindings-api.ts` (binding CRUD persistence): either implement the bridge wiring as part of this plan if the bridge methods exist, or convert each into a tracked issue reference so the gap is visible rather than an inline `TODO`. Do not silently leave them.

## Tests and verification gates

- **Existing suites must stay green.** `worksheet/__tests__`, `workbook/__tests__`, `app/__tests__`, and especially `document/__tests__/sdk-conformance/*` (`sdk-app-api`, `sdk-core`, `sdk-security`) — these encode the public contract and the Tier 2/3 security boundary. Step 4 (failure-convention migration) and Step 5 (payload typing) must run the full kernel typecheck plus these suites.
- **New tests to add:**
  - Unit tests for `internal/result.ts` (`unwrapResult` success/error/`KernelError` passthrough).
  - Unit tests for `internal/write-gate.ts` (throws on read-only ctx, passes on writable, correct `operation` label in the error).
  - A regression test asserting the operation layer throws `KernelError` (not returns a result) for the migrated modules in Step 4.
  - A negative test for Step 7: passing a Tier 2-only context to the internal cast throws an attributable dev-time error.
- **Static gates:** ESLint import-boundary rules (Tier 2/3) must still pass; a lint/grep check that `as any` count in `worksheet/handles/` and `shape-operations.ts` reached zero (or only documented residuals remain).
- **Behavioral parity:** disposal-order test (or a leak assertion) confirming Step 6's boilerplate refactor did not drop a `dispose()` or reorder cleanup.
- **No build/test commands are run as part of authoring this plan** — these gates are for the implementing change.

## Risks, edge cases, and non-goals

- **Highest risk: Step 4 (failure-convention migration).** Changing a module from return-result to throw changes control flow in every caller; a missed caller silently swallows a now-thrown error. Mitigation: migrate one module at a time, each behind the full conformance suite; keep the change purely about *how* failure is surfaced, never *whether* an operation succeeds.
- **Public-surface stability.** Any accidental change to an exported symbol or its `@stability` tag ripples to the external SDK. Steps 2/3/6 are internal-only by construction; Step 5 may touch a contracts type (cross-folder) — flag and coordinate.
- **Tier 3 cast hardening (Step 7)** must remain zero-cost in production; an always-on assertion on a hot path would regress performance.
- **Boilerplate refactor (Step 6)** risks subtly changing lazy-init timing or constructor args across 40 accessors; mechanical, test-guarded edits only, and it is the most deferrable step.
- **Edge case:** overload-bridge `as any` (`comments.ts:158`) is legitimately hard to type cleanly; acceptable to leave with a documented rationale rather than force an unsafe fix.
- **Non-goals:** no new public API capabilities; no behavior changes to formula/eval/rendering; no reorganization of `worksheet/` into new top-level folders (the README fix documents the *current* layout, it does not rename `worksheet/operations/` to `sheet/`); no test-only or shim solutions; no changes outside `mog/kernel/src/api` except explicitly-flagged contracts-type additions for Step 5.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now:** Step 1 (README), Step 2 (`internal/result.ts`), Step 3 (`internal/write-gate.ts`) touch disjoint files and can proceed concurrently.
- **Serialized:** Step 4 depends on Step 2 (uses the shared unwrap for any residual result boundary). Step 6 should land after Steps 2–3 so the boilerplate it collapses already calls the shared helpers. Step 8's `tables.ts` work should not collide with Step 4's table-operations migration — order them.
- **Cross-folder dependencies:**
  - Step 5 may require a new payload type in `@mog-sdk/contracts` (shape/bridge contracts) and possibly a matching change in `mog/kernel/src/bridges/**` or `mog/engine/src/**` shape bridge — coordinate with the contracts and bridges owners; this plan only edits the `api/` consumer side and the type, not the bridge implementation.
  - Step 8 binding persistence depends on `ComputeBridge` binding methods existing in the engine; if absent, it stays a tracked gap, not an implementation here.
  - The ESLint import-boundary plugin (`mog/tools/eslint-plugin-mog`) governs the Tier 2/3 rule referenced in Step 7 — no edit needed, but the rule must keep passing.
- **No dependency** on the unrelated dirty paths present before this worker (api-eval/app-eval scenarios, fixtures); they are not touched by this plan.
