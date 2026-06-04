# 005 — Harden the `@mog/types-api` Public API Type Surface

## Source folder and scope

- **Source folder:** `/Users/guangyuyang/Code/mog-all/mog/types/api/src`
- **Package:** `@mog/types-api` (`mog/types/api/package.json`), `private: true`, Tier-2 integration package that depends on every other `types/*` tier package (`bridges`, `commands`, `core`, `culture`, `data`, `document`, `editor`, `events`, `formatting`, `machines`, `objects`, `rendering`, `viewport`).
- **In scope:** the 133 `.ts` source files under `src/` and the subtrees `api/` (83 files), `apps/`, `capabilities/`, `diagnostics/`, `extensions/`, `feature-gates.ts`, `kernel/`, `performance/`, `services/`, `store/`, `what-if/`, `workflows/`; plus the `package.json` `exports` map (≈131 subpaths) and `src/api/README.md` insofar as they describe and gate the published type contract.
- **Out of scope (non-goals):** changing runtime behavior in `mog/kernel`, the Rust compute core, or `@mog-sdk/contracts` value exports; renaming or un-privatizing the package; adding compatibility shims or test-only patches in lieu of fixing the contract at its source. This package is **types only** — there is no runtime logic to change here, only declarations.

This is a planning artifact in `mog-internal`. It references public source by path but introduces no internal terminology into `mog/types/api/src`.

## Current role of this folder in Mog

`types/api/src` is the canonical source of truth for Mog's spreadsheet automation API surface: the `Workbook` and `Worksheet` interface graphs, every sub-API (charts, filters, tables, pivots, comments, conditional formats, slicers, drawings, shapes, etc.), error classes, mutation receipts, the state mirror, store schemas, capabilities/grants, workflows, what-if analysis, diagnostics, and the performance profiler types.

It is **not** consumed directly. The public boundary is `@mog-sdk/contracts` (`mog/contracts/package.json` depends on `@mog/types-api`: `workspace:*`), which re-exports these declarations. Consumers (`mog/apps/spreadsheet`, `mog/views/sheet-view`, `mog/table-engine`, `mog/charts`, `mog/kernel`, `mog/runtime/spreadsheet-app`, and external SDK users) import via `@mog-sdk/contracts/...`. The `exports` map distinguishes a `development` condition (points at `./src/**/*.ts`) from `types`/`import` conditions (point at `./dist/**/*.d.ts` and `.js`). This makes the **emitted `dist` declarations** the actual published artifact; source and emitted `.d.ts` must stay in lockstep, and a declaration rollup build is required before consumers typecheck (cf. memory: contracts declaration rollup). That dual path is exactly where the "downstream compatibility risk" in this folder's description lives.

Observed facts from this pass:
- 133 `.ts` files, ~24.9k LOC. Largest: `api/types.ts` (2629), `api/worksheet.ts` (1170), `workflows/context.ts` (1012), `api/workbook.ts` (956), `api/worksheet/pivots.ts` (879).
- The package ships its own design doctrine in `src/api/README.md`: every type must be a re-export of a generated/core type or a *genuinely different* DTO; "hollow copies" and opaque `any`/`Record<string, unknown>`/`[key: string]: unknown` bags are explicitly forbidden because they "force `as any` casts downstream."
- That doctrine is violated in the live public surface. Eight concrete `any`/`any[]` holes remain (enumerated below).
- ~40 `@deprecated` members exist with replacement guidance but **no version-anchored removal policy** (no `@deprecated since x.y` / `@removed-in` markers).
- Two structural TODOs sit on store/object types (`store/store-types.ts`, `api/worksheet/objects.ts`): "Migrate … to use containerId-aware types."
- Import-path documentation has drifted three ways (see invariants).
- No `__tests__`/`*.test.ts` exist in the package (tsconfig excludes them; none present), so there is no type-level regression guard inside the package.

## Improvement objectives

1. **Eliminate the README-forbidden `any` holes** on the public API surface, replacing each with a concrete named type so downstream consumers stop being forced into `as any`.
2. **Resolve the structural `containerId`-aware migrations** the TODOs flag on store and worksheet-object types, so the canvas/floating-object contract is type-safe rather than loosely shaped.
3. **Institute a deprecation lifecycle policy**: every `@deprecated` member gets a since-version and a concrete removal target, and a single documented place to track removals, so the published surface can shrink predictably without breaking consumers unexpectedly.
4. **Fix and lock the published import-path identity** so the package's own docs, barrel, and `exports` map agree on one canonical import path and one source-of-truth per type.
5. **Add a declaration-parity / public-surface guard** so source ↔ emitted `dist` `.d.ts` drift and accidental re-introduction of `any` bags are caught mechanically, not by review luck.

## Production-path contracts and invariants to preserve or strengthen

- **Single import boundary.** Public consumers import through `@mog-sdk/contracts/...`, never `@mog/types-api` directly. Today the package's own docs disagree on what that path even is:
  - `src/api/index.ts` header: `@mog-sdk/contracts/api`
  - `src/api/README.md` ("File Layout"): `@mog/spreadsheet-contracts/api`
  - package name: `@mog/types-api`
  These must be reconciled to the one true public path (`@mog-sdk/contracts/api`, matching how `mog/contracts` consumes the package). Doc drift in a published package is itself a contract defect.
- **Source ↔ dist declaration identity.** For every `exports` subpath, the `development` (`./src/*.ts`), `types` (`./dist/*.d.ts`), and `import` (`./dist/*.js`) targets must describe the same shape. Hardening types in `src` must be matched by a declaration rollup so `dist` does not lag (memory: contracts declaration rollup — `pnpm --filter @mog-sdk/contracts build` is required before consumers typecheck; do not run it here, but the plan's verification gate depends on it).
- **No widening of the public contract by accident.** Replacing `any[]` with a concrete type is a *narrowing* and is the goal; it is a breaking change for any consumer that was relying on `any`'s permissiveness, so each replacement must be paired with the matching kernel implementation and contracts re-export in the same change set (no shim, no half-migration).
- **Branded identity types stay single-owner.** Cell/row/column/sheet/range/document/viewport brands must keep one declaration owner across the published `.d.ts`; the `any[]` replacements must reuse existing branded/core types (e.g. group, filter-value, pivot-field types) rather than minting parallel definitions.
- **Deprecated members remain only with a real migration path.** Keep `@deprecated` members that map to a live replacement (the filters/comments/pivots/tables/diagrams/sparklines facades and the `workbook` iterative-calc options all do); attach a removal target so they are not load-bearing forever.
- **The README doctrine is the enforced spec.** The "What should never exist" / "Anti-Patterns" tables in `src/api/README.md` are promoted from advice to a checked invariant.

## Concrete implementation plan

### Phase 1 — Inventory and classify the loose types (read-only, produces the worklist)
Enumerate every `any`/`any[]`/`Record<string, unknown>`/`[key: string]: unknown` on the **exported** surface. Confirmed public holes from this pass:

| File:line | Member | Current | Target |
|---|---|---|---|
| `api/types.ts:2118` | `GroupState.rowGroups` | `any[]` | named `RowGroup[]` (outline group shape) |
| `api/types.ts:2120` | `GroupState.columnGroups` | `any[]` | named `ColumnGroup[]` |
| `api/types.ts:2163` | `FilterSortState.criteria` | `any` | typed advanced-sort criteria |
| `api/worksheet/conditional-formats.ts:145` | `cloneForPaste(... rules: any[])` | `any[]` | concrete CF rule type |
| `api/worksheet/filters.ts:255` | `getUniqueValues(): Promise<any[]>` | `any[]` | `Promise<CellValue[]>` (or filter-value DTO) |
| `api/worksheet/filters.ts:318` | `getFilterUniqueValues(): Promise<any[]>` | `any[]` | same DTO as above (deprecated alias) |
| `api/worksheet/pivots.ts:520` | `detectFields(): Promise<any[]>` | `any[]` | `Promise<PivotField[]>` |
| `api/worksheet/pivots.ts` (compute readback) | pivot result `any[]` | `any[]` | typed pivot-field/result type |

For each, record: does a correct type already exist in `types-core`/`types-data`/`types-objects`/this package? (`GroupState` already lives beside `OutlineSettings`/`SubtotalConfig` in `api/types.ts` and is consumed by `api/worksheet/outline.ts` — the group element types must be defined here or imported, not left `any`.) Classify each as *accidental placeholder* (fix) vs *genuinely schemaless* (replace with a single named `JsonValue`/`JsonObject` alias with a doc comment, never bare `any`).

### Phase 2 — Replace the placeholders with named types
- Define `RowGroup`/`ColumnGroup` (or a shared `OutlineGroup`) in `api/types.ts` next to `GroupState`, with the fields the outline sub-API actually returns; update `GroupState` to use them.
- Type `FilterSortState.criteria` against the existing `ColumnFilterCriteria` family already used in `filters.ts`.
- Type `getUniqueValues`/`getFilterUniqueValues` returns against the canonical cell-value type already re-exported by this package (`CellValue`), matching `getFilterDropdownData`'s already-typed `FilterDropdownData`.
- Type `pivots.detectFields` and the pivot compute readback against the pivot-field type that the pivot sub-API already references elsewhere.
- Type `conditional-formats.cloneForPaste` `rules` against the CF rule type the same interface already defines for `add`/`set`.
- Each replacement is made in `src` only; no `any`-preserving overload is added.

### Phase 3 — Resolve the `containerId`-aware structural TODOs
- `store/store-types.ts`: "Migrate SheetMaps floating object references to use containerId-aware types." and `api/worksheet/objects.ts`: "Migrate WorksheetObjects to use containerId-aware canvas object types." Trace the `containerId` concept to its owning package (`types-objects`/`types-document`), then thread the typed reference through `store-types`, `WorksheetObjects`, and the floating-object handles (`api/worksheet/handles/floating-object-handle.ts`). Remove the TODOs when the type is no longer loose.

### Phase 4 — Deprecation lifecycle
- Audit the ~40 `@deprecated` members (filters, comments, pivots legacy facades, tables `setShowTotals`/`setShowHeaders` aliases, diagrams `get`/`list` aliases, sparklines `clear`, `worksheet.sheetId` legacy, `workbook` iterative-calc options, `mutation-receipt` `FloatingObjectRemoveReceipt` rename, `api/types.ts` pivot legacy facade).
- Normalize every `@deprecated` JSDoc to include (a) the replacement (most already do) and (b) a `@deprecated since <version>` plus an intended removal version. Record the removal schedule in `src/api/README.md` (or a sibling `DEPRECATIONS.md` in the package) so the public surface has a documented shrink path.

### Phase 5 — Fix the import-path identity and promote the README doctrine to a guard
- Reconcile the three divergent import-path strings to `@mog-sdk/contracts/api` in `index.ts` and `README.md`.
- Make the README "Anti-Patterns" table enforceable: add a lint/check (lives in the public tooling area, e.g. `mog/tools`, not in generated docs) that fails CI when a `.ts` file under `types/api/src` introduces `: any`, `any[]`, `<any>`, `as any`, or `[key: string]: unknown` on an exported declaration without an explicit allow annotation. Seed its allowlist with the current intentional cases (the `network:any` capability *string literal* in `capabilities/types.ts`/`gated-api.ts` is a value, not a type hole — exclude it).
- Add a parity check that validates the `exports` map against on-disk `src` and `dist` artifacts (every subpath resolves; no orphan source file silently missing from exports). This directly guards the "downstream compatibility risk."

### Phase 6 — Coordinated downstream landing
Because consumers go through `@mog-sdk/contracts`, every narrowing in Phases 2–3 lands together with: the matching `@mog-sdk/contracts` re-export, the kernel implementation that now returns the concrete type, and a declaration rollup so `dist/*.d.ts` reflects `src`. No phase is "done" until the published `.d.ts` matches the source.

## Tests and verification gates

> Per task constraints this worker runs no build/test commands; the gates below define what the *implementing* change must pass.

1. **Package typecheck:** `tsc -b .` in `mog/types/api` (the package's own `typecheck` script) passes with zero new `any`.
2. **Declaration rollup + consumer typecheck:** `@mog-sdk/contracts` builds and `mog/kernel`, `mog/apps/spreadsheet`, and `mog/runtime/spreadsheet-app` typecheck against the narrowed types — proving the contract narrowing is implemented end-to-end, not shimmed.
3. **Public-surface lint:** the new anti-pattern check reports zero un-allowlisted `any`/`unknown`-bag occurrences under `types/api/src`.
4. **Exports parity check:** every `exports` subpath resolves to existing `src`, `dist/*.d.ts`, and `dist/*.js`; no orphan exported source file.
5. **Deprecation policy check:** every `@deprecated` member carries a replacement and a removal-version marker.
6. **API behavior coverage:** the narrowed read APIs (`getUniqueValues`, `pivots.detectFields`, outline `GroupState`, CF `cloneForPaste`) are exercised by existing `dev/api-eval` / `dev/app-eval` scenarios so the concrete shapes are validated against real workbook data, not just compiled (cf. memory: api-eval/app-eval usage). Add scenario coverage where a typed read path has none.

## Risks, edge cases, and non-goals

- **Narrowing is breaking.** Replacing `any[]` with a concrete type can break external SDK consumers that relied on `any`. Mitigation: land in a coordinated change with contracts + kernel, document in the deprecation/changelog, and choose the concrete type to be a *superset-accurate* description of what the runtime already returns (no new runtime behavior).
- **Group/pivot/CF element types may be data-dependent.** The runtime shapes behind the `any[]`s must be read from the kernel implementation, not guessed; if the implementation itself returns heterogeneous data, the correct fix is a discriminated union, not a fresh `any`.
- **`containerId` migration touches multiple packages.** It depends on `types-objects`/`types-document` owning the canonical id type; if that ownership is unsettled, the TODO resolution blocks on that package (see dependencies).
- **dist drift.** If the declaration rollup is skipped, consumers will see stale `.d.ts`. The parity gate exists precisely to catch this.
- **Non-goals:** no package rename/un-privatization, no runtime/Rust changes, no compatibility shims, no test-only "fix" that leaves the `any` in the published contract.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now:** Phase 1 inventory, Phase 5 import-path/doc reconciliation, the lint and exports-parity tooling, and Phase 4 deprecation-marker normalization touch only this package's declarations and docs.
- **Depends on sibling tier packages:** Phase 2/3 type definitions should reuse canonical types from `types-core` (cell value), `types-data` (filter/pivot), `types-objects`/`types-document` (`containerId`, canvas objects). If those canonical types are themselves being reworked (other queue items), coordinate so this package re-exports rather than re-defines.
- **Depends on `@mog-sdk/contracts` + `mog/kernel`:** Phase 6 landing requires the contracts re-export and the kernel implementation to move in lockstep; this is the gating cross-folder dependency for every narrowing.
- **Tooling placement:** the new checks belong in the public tooling area (e.g. `mog/tools`), not in `mog-internal` and not in generated docs.

### Evidence sufficiency
The folder exists and was inspected directly; the eight `any` holes, the deprecation set, the structural TODOs, and the three-way import-path drift are all confirmed from source. The one item requiring kernel-side confirmation before implementation is the *exact* element shape behind each `any[]` (group/pivot/CF/filter values) — readable from the kernel implementation during Phase 1, not blocking this plan.
