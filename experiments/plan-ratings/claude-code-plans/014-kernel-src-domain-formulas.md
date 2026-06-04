# Plan 014 — Harden the formula-facing kernel domain (`mog/kernel/src/domain/formulas`)

## Source folder and scope

- **Folder:** `mog/kernel/src/domain/formulas`
- **Files in scope:**
  - `named-ranges.ts` (977 lines) — CRUD + query + import/export + create-from-selection for Excel-style defined names.
  - `structured-ref-updater.ts` (128 lines) — five exported no-op stubs delegating table/column rename + delete formula rewriting to Rust compute-core.
  - `__tests__/named-ranges.test.ts` — unit coverage for the `create` comment-persistence path only.
- **Adjacent code touched only as dependency (not edited blindly):**
  - `mog/kernel/src/bridges/compute/compute-wire-converters.ts` — canonical, tested wire⇄contract converters (`wireToIdentityFormula`, `identityFormulaToWire`, `contractRefToWireRef`, `wireRefToContractRef`).
  - `mog/kernel/src/bridges/compute/compute-bridge.ts` — `setNamedRange`, `updateNamedRange`, `removeNamedRange`, `removeNamedRangeById`, `getAllNamedRangesWire`, `getVisibleNamedRanges`, `toIdentityFormula`, `toA1DisplayQualified`, `queryRange`.
  - Consumers: `api/workbook/names.ts`, `api/worksheet/names.ts`, `api/worksheet/operations/describe-operations.ts` (named ranges); `domain/tables/core.ts`, `domain/tables/operations.ts` (structured-ref stubs).

This plan covers only production behavior of the two source modules and their contract with the compute bridge. It is a **production-path** plan, not a test-only or shim plan.

## Current role of this folder in Mog

This is the TypeScript kernel's formula-facing domain layer. It is the bridge between the API surface (workbook/worksheet `names` modules, table operations) and the Rust compute-core, which is the single source of truth for formula evaluation and reference rewriting.

- **Named ranges** are stored as `IdentityFormula` (template + stable `CellId`/`RowId`/`ColId` refs), *not* A1 strings, so concurrent structure edits (insert/delete row/col) compose CRDT-safely and A1 display is regenerated at render time. The TS layer converts between A1 ↔ `IdentityFormula` ↔ wire format via the bridge, persists through `ComputeBridge`, and lets `MutationResultHandler` emit events (no manual event emission here).
- **Structured-ref updater** is now a set of intentional no-op stubs; the real rewriting on table/column rename/delete runs inside Rust (`compute-core/src/storage/structured_ref_updater.rs`). The TS functions exist only to keep call sites compiling.

## Improvement objectives

1. **Eliminate the hand-rolled wire conversion duplication and the latent correctness bug it hides.** `mapRustNamedRange` (wire→contract) and the inline `wireRefs` builder inside `create` (contract→wire) reimplement, with `any` types, logic that already exists and is unit-tested in `compute-wire-converters.ts`. The `create` copy is **incomplete**: it handles `Cell/Range/FullRow/FullCol/RowRange/ColRange` but **omits `RectRange`** (full rectangular range keyed by row/col id), whereas `mapRustNamedRange` handles it. A defined name whose `refersTo` is a `RectRange` therefore falls through `create`'s `return ref` passthrough and is shipped to Rust in camelCase rather than the snake_case wire shape — a silent serialization failure. Route both directions through the canonical converters so the variant set can never drift again.
2. **Make `importNames` correct and honest.** It uses fire-and-forget `void ctx.computeBridge.setNamedRange(...)`, never awaits, swallows per-name failures, and returns an optimistic count that can exceed what actually persisted. It also omits the `raw_expression` fallback that `create` relies on for cross-bridge deser resilience. Await each write, surface/aggregate failures, return an accurate imported count, and apply the same `raw_expression` resilience as `create`.
3. **Fix the scope-ambiguous delete in `removeByScope`.** It deletes via `removeNamedRange(name.name)` (by *name*) while `remove` deletes via `removeNamedRangeById(existing.id)` (by *id*). When a sheet-scoped and a workbook-scoped name share a name, by-name removal can delete the wrong scope. Delete by id consistently.
4. **Remove the dead `evaluateValue` stub and decide the value-display contract.** `evaluateValue` always returns `undefined` (all evaluation moved to Rust), yet it still imports `IKernelContext` and anchors a whole "Value Evaluation" section, and `formatValueForDisplay`/`formatSingleValue` format values that nothing in this module produces. Either remove the dead stub and route Name-Manager value display through a real bridge evaluation call, or remove the orphaned formatting helpers — without leaving a misleading API that callers might believe works.
5. **Reduce the N+1 `getAll` fan-out.** `validate`, `getByName`, `getById`, `resolve`, `exists`, `count`, and `createFromSelection` each call `getAll()` (a full bridge round-trip plus a full map of every name). A single logical operation can trigger several. Provide scoped/by-key/by-id lookups (ideally bridge-side; otherwise a single cached fetch per operation) so common paths don't re-fetch the entire name table repeatedly.
6. **Replace pervasive `any` with contract types.** The `any`-typed `rust`, `ref`, and `rawFormula` locals are exactly where the `RectRange` bug hid. Type the bridge boundary against the generated wire types and the `@mog-sdk/contracts/named-ranges` domain types.
7. **Decide the fate of `structured-ref-updater.ts`.** All five exports return `0` unconditionally; `domain/tables/operations.ts` and `domain/tables/core.ts` consume those zeros to gate `console.log("Updated N formulas…")` lines that therefore never fire — dead, misleading plumbing. Either surface the *real* rewrite count from the Rust mutation result so events/logs are accurate, or remove the stubs and the dead count-handling at the call sites.

## Production-path contracts and invariants to preserve or strengthen

- **`IdentityFormula` is the storage form, never A1.** All persistence must keep stable-id refs; A1 is display-only and regenerated via `toA1DisplayQualified`. (Preserve.)
- **Rust compute-core is the single source of truth** for evaluation and reference rewriting. TS must delegate, not duplicate, computation. (Preserve — and stop pretending to compute in `evaluateValue`.)
- **Atomic rename invariant:** `update` must remain a single `updateNamedRange` mutation — Rust rewrites dependent formula templates (Yrs storage + in-memory mirror) inside one transaction. The kernel must never split rename into remove+set (would orphan dependents into `#NAME?`). (Preserve — keep the existing comment and behavior; add a regression test.)
- **Event emission stays with `MutationResultHandler`** — this module must not emit events directly. (Preserve.)
- **Wire variant completeness:** the contract↔wire mapping must cover every `IdentityFormulaRef` variant (`cell`, `range`, `rectRange`, `fullRow`, `rowRange`, `fullCol`, `colRange`). Centralizing on `compute-wire-converters` makes this a single enforced surface. (Strengthen.)
- **Representation reconciliation (must verify before refactor):** `mapRustNamedRange` reads *camelCase* fields (`ref.Range.startId`) and its header comment claims NAPI/WASM transports normalize snake→camel at the boundary, while the canonical `wireToIdentityFormula` reads *snake_case* (`wire.RectRange.sheet_id`). These cannot both be right for the same `getAllNamedRangesWire` payload. The exact shape returned by `getAllNamedRangesWire`/`getVisibleNamedRanges` (raw wire vs. transport-normalized) must be confirmed before swapping in the canonical converter, or conversions will break at runtime. This is the single highest-risk unknown in the plan.
- **Scope precedence:** `resolve` must keep sheet-scoped > workbook-scoped precedence. (Preserve.)
- **No-throw read paths:** `getRefersToA1` must keep its constant-formula fallback (e.g. `=0.08`) so `exportNames`/list never throw. (Preserve.)

## Concrete implementation plan

**Phase 0 — Evidence (must complete before editing):**
- Confirm the wire shape returned by `getAllNamedRangesWire`, `getVisibleNamedRanges`, and `toIdentityFormula` (raw snake_case wire vs. transport-normalized camelCase). Inspect `compute-bridge.ts`, the transport `case-normalize.ts`, and the generated `compute-types.gen` types. This determines whether the canonical converters can be used directly or need a thin normalization adapter.
- Confirm `compute-bridge` exposes (or can cheaply expose) a by-id / by-name / by-scope named-range query, to decide whether objective 5 is satisfied bridge-side or with a per-operation fetch.

**Phase 1 — Centralize wire conversion (fixes the `RectRange` bug):**
- Replace the body of `mapRustNamedRange` with `wireToIdentityFormula` (plus the small `scope`/`comment`/`visible`/`id` envelope mapping), adding a normalization adapter only if Phase 0 shows the payload is camelCased.
- Replace `create`'s inline `wireRefs` builder with `identityFormulaToWire` applied to the `toIdentityFormula` result, so all seven ref variants (incl. `RectRange`) are covered.
- Delete the hand-rolled `any`-typed mapping blocks; type the boundary with generated wire types + contracts domain types.

**Phase 2 — Correct the write/import/delete paths:**
- `importNames`: await each `setNamedRange` (sequential or `Promise.all` with settled aggregation), count only confirmed successes, attach `raw_expression` like `create`, and return/report failures rather than swallowing them.
- `removeByScope`: switch to `removeNamedRangeById(name.id)` for each name in scope.
- Audit `create`'s comment round-trip (`getByName` read-back then `updateNamedRange`) against the reduced-fetch helpers from Phase 4 so it doesn't re-fetch all names.

**Phase 3 — Remove dead evaluation surface:**
- Remove `evaluateValue` and the now-unused `IKernelContext` import. If Name Manager needs a value column, add a thin bridge-backed evaluation accessor and keep `formatValueForDisplay`/`formatSingleValue` only if a real producer feeds them; otherwise remove them too. Update `api/workbook/names.ts` / `api/worksheet/names.ts` consumers accordingly.

**Phase 4 — Reduce `getAll` fan-out:**
- Add `getByIdDirect`/`getByKey`/`getByScope` paths backed by a bridge query (preferred) or a single fetch threaded through each public operation. Keep public signatures stable; change internals.

**Phase 5 — Resolve `structured-ref-updater.ts`:**
- Preferred: have the Rust table mutations return the real rewrite/`#REF!` count via their `MutationResult`, surface it through the bridge, and feed accurate counts into the `domain/tables` log/event lines — then delete the always-0 stubs.
- Fallback (if Rust does not yet return counts): delete the stubs and the dead count plumbing in `domain/tables/operations.ts`/`core.ts`, removing the misleading `console.log("Updated N formulas")` lines. **This edits files outside the folder — see Parallelization.**
- Also remove the unused `TableRangeInfo`/`convertStructuredRefsToA1` surface if no real wiring is planned, or wire it for real.

**Phase 6 — Tidy `createFromSelection`:**
- Replace the inlined `getDisplayValue` re-derivation with the canonical display helper used elsewhere (avoid drift), and confirm the `bottomRow`/`rightColumn` branches don't generate duplicate-key churn against `topRow`/`leftColumn` (they currently reuse the same data bounds). Replace the magic nil-UUID sentinel in `getRefersToA1` with a named constant.

## Tests and verification gates

> Per task constraints this worker does not run builds/tests; the following are the gates the implementing change must pass.

- **New unit tests (extend `__tests__/named-ranges.test.ts`):**
  - `create` round-trips a `RectRange` ref to the correct snake_case wire shape (the regression for the dropped variant) — and a parametric test asserting every `IdentityFormulaRef` variant survives contract→wire→contract.
  - `importNames` returns the count of *persisted* names, awaits writes, and reports a failed write rather than counting it; verify `raw_expression` is attached.
  - `removeByScope` calls `removeNamedRangeById` (not by name) for each in-scope name, and does not touch a same-named name in another scope.
  - `update` issues exactly one `updateNamedRange` (atomic-rename invariant) — guard against future remove+set regressions.
  - `resolve` sheet-scoped > workbook-scoped precedence; `getRefersToA1` constant-formula fallback still returns `=…` without throwing.
- **Type gate:** `pnpm --filter <kernel> typecheck` clean after removing `any`; contracts declaration rollup (`pnpm --filter @mog-sdk/contracts build`) if contract types change. *(Run by the implementer, not this worker.)*
- **Integration / eval:** named-range create/update/delete/import + create-from-selection via `api-eval`; a Name-Manager `app-eval` scenario if the value-display contract changes. Table rename/delete formula-count surfacing verified if Phase 5 preferred path is taken.
- **Regression sweep:** XLSX import/export of defined names (esp. full-row/full-col/rect-range and constant names) round-trips.

## Risks, edge cases, and non-goals

- **Highest risk:** the camelCase-vs-snake_case representation mismatch (see invariants). Swapping in the canonical converter without confirming the bridge payload shape will break all named-range reads. Phase 0 gates this.
- **Edge cases:** constant formulas (`=0.08`, no refs); full-row/full-col and rect-range refs; sheet-scoped vs workbook-scoped name collisions; concurrent imports racing the dedup snapshot; names that sanitize to cell-reference-like tokens in `createFromSelection`.
- **CRDT safety:** must not regress the identity-based storage; all refactors keep `IdentityFormula` as the persisted form.
- **Non-goals:** changing formula evaluation semantics (Rust owns that); altering the named-range contract types beyond what the `any`→typed migration requires; reworking `MutationResultHandler`; broad table-domain refactoring beyond the structured-ref stub resolution.

## Parallelization notes and dependencies on other folders

- **Independent within this folder:** Phases 1–4 and 6 are confined to `named-ranges.ts` (+ its test) and the read-only canonical converters; they can land as one PR.
- **Cross-folder dependency (Phase 3):** removing `evaluateValue` / value-format helpers touches `api/workbook/names.ts` and `api/worksheet/names.ts`. Coordinate with the api/* names work.
- **Cross-folder dependency (Phase 5):** resolving `structured-ref-updater.ts` edits `domain/tables/core.ts` and `domain/tables/operations.ts`, and the preferred path needs a Rust compute-core change to return rewrite counts. Sequence behind, or coordinate with, the tables-domain and compute-core owners; this is the one piece that cannot be done purely inside `domain/formulas`.
- **Shared surface:** changes that touch `@mog-sdk/contracts/named-ranges` must be ordered before consumers via the contracts declaration rollup build.
