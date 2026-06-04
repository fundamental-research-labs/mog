# Plan 001 — Harden the public API contract surface in `mog/contracts/src/api`

## Source folder and scope

- **Folder:** `mog/contracts/src/api` (package `@mog-sdk/contracts`, public import path `@mog-sdk/contracts/api`).
- **In scope:**
  - `index.ts` — public API barrel.
  - `types.ts` — 2,616-line locally-authored module carrying public enums + a large mirror of API interfaces.
  - `mutation-receipt.ts` — runtime type guards for floating-object receipts.
  - `worksheet/format-mappings.ts` — runtime conversion helpers (rotation/pattern/indent) and `MAX_INDENT_LEVEL`.
  - `workbook.ts`, `worksheet.ts`, and the `workbook/`, `worksheet/`, `worksheet/collections/`, `worksheet/handles/` re-export shim trees.
- **Out of scope (referenced, not edited by this plan's investigation):** the canonical authoring package `mog/types/api/src/api` (`@mog/types-api`), the build/verify scripts in `mog/contracts/scripts` and `mog/tools`, and all consumers in `mog/kernel`, `mog/runtime`, `mog/views`.

## Current role of this folder in Mog

`@mog-sdk/contracts/api` is **the** public, published entry point for the unified spreadsheet API. Consumers (kernel `worksheet-impl`, the SDK runtime, sheet-view) import the `Workbook` / `Worksheet` types, the `CellType` / `CellValueType` / `NumberFormatCategory` / `RangeValueType` enums, the floating-object receipt guards, and the `./api/worksheet/handles` sub-entrypoint from here.

The folder is deliberately split by what it must ship:

- **Runtime-bearing modules are authored locally** in contracts: the four enums and supporting interfaces in `types.ts`, the guards in `mutation-receipt.ts`, and the conversion functions in `worksheet/format-mappings.ts`. These exist locally because they emit JavaScript values, not just types.
- **Type-only surface is authored in the private `@mog/types-api` package** and surfaced here through one-line re-export shims (`export type * from '@mog/types-api/api/...'`). `index.ts` does `export type * from '@mog/types-api/api'` for the bulk surface, and the `workbook/*` and `worksheet/*` shim files mirror the private package's module layout so the rolled-up public `.d.ts` keeps a matching subpath structure.

The published build is non-trivial: `pnpm --filter @mog-sdk/contracts build` runs `check-no-source-dts` → `tsc -p tsconfig.build.json` → `rollup-public-dts` → `fix-dts-extensions` → `check-contracts-declaration-identity` → `verify-runtime-exports` → `check-contracts-runtime-inventory` → `check-contract-runtime-imports`. Declaration identity and runtime-inventory gates police this surface against drift and duplicate brand owners.

## Improvement objectives

1. **Eliminate the hand-maintained type duplication that has already drifted.** `mog/contracts/src/api/types.ts` (87,247-byte canonical at `mog/types/api/src/api/types.ts` vs 86,838-byte local copy) is a near-verbatim duplicate of the `@mog/types-api` source. They are *not* identical: the local copy is already **stale**, missing exports the canonical source has shipped (see invariants below). A maintained 2,600-line manual mirror is a structural defect — every API addition must be applied twice, and the copy silently lags.
2. **Repair corrupted public doc comments.** A botched find-and-replace has left the nonsensical token string `spreadsheet special-cell type` embedded mid-sentence throughout `worksheet/format-mappings.ts` (11 occurrences) and `types.ts` (1), e.g. `"...spreadsheet special-cell typetext orientation angle..."`. This is public-facing API documentation and currently reads as garbage. (Per project rule, replacement wording must not reintroduce the literal product name "Excel" — see Risks.)
3. **Remove `any` from the public type surface.** `GroupState.rowGroups: any[]`, `GroupState.columnGroups: any[]`, and `FilterSortState.criteria?: any` ship untyped holes in a published contract, defeating consumer type-safety and the declaration-identity guarantees the build invests in.
4. **Reduce shim drift risk.** The `workbook/*` + `worksheet/*` mirror trees are hand-authored one-liners that must stay 1:1 with the private package layout. Make their provenance explicit and, where the build allows, generated rather than hand-kept.

## Production-path contracts and invariants to preserve or strengthen

**Must preserve:**

- `@mog-sdk/contracts/api` continues to export, by the same names: `Workbook`, `WorkbookInternal`, `Worksheet`, `WorksheetWithInternals`, `CalculateOptions`, `CalculateResult`, `CustomList`, `WorkbookLinkStatusScope`, `WorkbookCustomListInput`, `WorkbookCustomListUpdate`, the full `@mog/types-api/api` surface, the enums `CellType` / `CellValueType` / `NumberFormatCategory` / `RangeValueType`, the receipt guards (`isFloatingObjectReceipt` / `isFloatingObjectMutationReceipt` / `isFloatingObjectRemoveReceipt`), and the format-mapping runtime exports (`clampIndent`, `MAX_INDENT_LEVEL`, `officeJsAngleToOoxmlRotation`, `officeJsPatternToOoxml`, `ooxmlPatternToOfficeJs`, `ooxmlRotationToOfficeJsAngle`).
- The sub-entrypoints declared in `package.json#exports`: `./api`, `./api/mutation-receipt`, `./api/worksheet/handles`, `./api/worksheet/handles/index`.
- Runtime semantics of the conversion helpers (rotation clamps to 90/180, `255` ↔ `180` vertical-stacked, `MAX_INDENT_LEVEL = 250`, pattern fallbacks `'none'` / `'None'`) — these are behavioral contracts, not just types.
- The `unique symbol` brand owners guarded by `check-contracts-declaration-identity.mjs` must remain single-owner after any restructuring.

**To strengthen:**

- **Single source of truth for API types.** The local `types.ts` should stop being a manually-edited duplicate. Concretely: drive it from the canonical `@mog/types-api` source so the two cannot diverge — either by re-exporting the type-only portion (keeping only the runtime enums + their backing interfaces authored locally) or by generating the local mirror as a build artifact. The known drift to close: local copy is missing `WorkbookId` / `WorkbookSessionId` / `DocumentId` / `LinkId` / `ActorId`, the `WorkbookPolicyPreservedEvent` import + its `'cells:policy-preserved'` event-map entry, the `ChartExportOptionsSnapshot` / `ResolvedChartSpecSnapshot` re-exports, and `WorkbookSettingsPatch`.
- **No `any` in exported shapes** — replace with the real domain types.
- **Coherent, accurate public doc comments** — no machine-mangled phrases.

## Concrete implementation plan

> All type-shape edits land in the canonical authoring package `mog/types/api/src/api` first; the contracts mirror is then regenerated/synced. This ordering is mandated by the declaration-identity gate and the rollup pipeline.

**Phase 0 — Confirm provenance (read-only investigation).**
- Read `mog/contracts/scripts/rollup-public-dts.mjs`, `clean-dist.mjs`, `check-no-source-dts.mjs`, and `mog/tools/check-contracts-declaration-identity.mjs` to confirm exactly how `src/api/*` shims and `types.ts` feed the published `.d.ts`, and whether the shim tree is consumed by the rollup or is incidental.
- Confirm whether `index.ts`'s `from './worksheet'` / `from './workbook'` resolves to the `.ts` files or the directory `index.ts` (file-over-directory precedence), to determine which shim files are load-bearing for the barrel vs. only for sub-path d.ts structure.

**Phase 1 — Fix corrupted doc comments (lowest risk, immediate value).**
- In the canonical `mog/types/api/src/api/worksheet/format-mappings.ts` and `types.ts`, replace every `spreadsheet special-cell type` fragment with correct prose. The surrounding identifiers (`officeJsAngleToOoxmlRotation`, etc.) and the OOXML mapping tables make the intended meaning unambiguous; restore it as "the spreadsheet API" / "the Office.js-compatible representation" style wording that reads coherently and respects the no-"Excel" rule.
- Sync the same fix into the contracts mirror (or let Phase 3's generation carry it).

**Phase 2 — Type the `any` holes.**
- `GroupState.rowGroups` / `columnGroups`: introduce a `RowGroup` / `ColumnGroup` (or shared `OutlineGroup`) interface describing a group's start/end index and outline level, sourced from the existing outline/grouping domain types already used elsewhere in the API; type the arrays accordingly.
- `FilterSortState.criteria`: replace `any` with the established sort-criteria type (align with `SortOptions` / `SortColumn` already defined in the same file, or the data-layer sort criteria type) so advanced-sort criteria are checkable.
- Land in `@mog/types-api`, regenerate the mirror, and verify no consumer (`kernel/worksheet-impl`, grouping/outline call sites) breaks.

**Phase 3 — De-duplicate `types.ts` and make shims drift-proof.**
- Decide the single-source strategy in Phase 0's light:
  - **Option A (preferred): re-export.** Keep only the runtime enums and any interfaces that *must* be authored locally; replace the rest of the local `types.ts` body with `export type * from '@mog/types-api/api/types'` (mirroring how every other shim already works). This deletes ~2,500 lines of duplicated, drift-prone source in one move.
  - **Option B: generate.** If the declaration-identity/rollup pipeline requires a physical local mirror, add a generation step that emits the contracts mirror from the canonical source so it cannot be hand-edited out of sync, and document it.
- Apply the same provenance discipline to the `workbook/*` + `worksheet/*` shim trees: either generate them from the canonical package layout or add a guard that fails the build if the shim set diverges from `@mog/types-api`'s module set (closes the "new private module added but no shim created" gap).

**Phase 4 — Documentation.**
- Expand `index.ts`'s header comment into an accurate description of the runtime-vs-type split and the single-source rule, so future contributors edit `@mog/types-api` and never hand-edit the mirror.

## Tests and verification gates

- **Full contracts build is the gate** (run by the owning engineer, not by this planning agent): `pnpm --filter @mog-sdk/contracts build`. This must pass end-to-end, specifically:
  - `tsc -p tsconfig.build.json` (no type errors),
  - `rollup-public-dts` + `fix-dts-extensions` (public `.d.ts` still rolls up),
  - `check-contracts-declaration-identity` (no duplicate brand owners; declaration graph intact),
  - `verify-runtime-exports` + `check-contracts-runtime-inventory` + `check-contract-runtime-imports` (the four enums, the guards, and the format-mapping functions remain present as runtime exports).
- **Repo typecheck of consumers**: `pnpm --filter @mog/kernel typecheck` (and runtime/sheet-view) to confirm the de-`any`'d `GroupState`/`FilterSortState` and the re-exported `types.ts` introduce no breakage. (Memory: contracts type edits require a contracts build before downstream typecheck sees them.)
- **Targeted unit tests** for `format-mappings.ts` round-trips (`officeJsAngleToOoxmlRotation`/`ooxmlRotationToOfficeJsAngle` inverse on the boundary set {−90, 0, 90, 180/255}; pattern map fallbacks; `clampIndent` clamp/round) and for the three receipt guards — guard against accidental behavioral change while editing comments in those files.
- **Drift assertion**: after Phase 3, a check that `mog/contracts/src/api/types.ts` (or the shim set) is byte-identical to / generated-from the canonical source, so the stale-mirror class of bug cannot recur.

## Risks, edge cases, and non-goals

- **No-"Excel" rule (memory: `no-excel-in-code`).** The corrupted comments almost certainly originated from scrubbing a product name. Replacement wording must read coherently *and* must not reintroduce "Excel"; prefer "the spreadsheet API" / "Office.js-compatible" phrasing. Verify with a final `rg -i "excel"` over the touched files.
- **Declaration identity is brittle.** Collapsing the local `types.ts` into a re-export (Option A) changes the declaration graph the rollup consumes; it must not create a second owner of any guarded `unique symbol` brand, and the rolled `.d.ts` subpaths must stay stable for published consumers. If the rollup depends on a physical mirror, fall back to Option B (generate) rather than forcing Option A.
- **Public surface stability.** Every exported name in the "Must preserve" list is potentially imported by external SDK users; this plan is additive/clarifying only — no exported name is renamed or removed.
- **Typing the `any` holes is a tightening change.** Call sites currently relying on the unchecked `any` (e.g. grouping read methods, advanced-sort criteria) may surface latent type errors; treat those as bugs to fix in the consumer, not as a reason to keep `any`.
- **Non-goals:** no new API features; no reorganization of `@mog/types-api` beyond what single-sourcing requires; no change to enum numeric/string values; no test-only or shim workaround in place of the real single-source fix; no edits outside the production path.

## Parallelization notes and dependencies on other folders

- **Hard dependency on `mog/types/api/src/api` (`@mog/types-api`).** Because that package is the canonical author of the type surface, Phases 1–3 land their substantive edits there first, then sync/regenerate the contracts mirror. A worker assigned to the `types/api` folder should coordinate or sequence ahead of this one; doing both in one change is cleanest if the same engineer owns both.
- **Dependency on the contracts build tooling** (`mog/contracts/scripts/*`, `mog/tools/check-contracts-*`). Phase 3 Option B and the drift assertion add/modify a build step there — that is production tooling, so it belongs to whichever plan owns those scripts; this plan should hand off the generator/guard requirement rather than edit those files unilaterally if folder ownership is split.
- **Downstream verification only** on consumers: `mog/kernel` (`worksheet-impl`, grouping/outline, handles), `mog/runtime/sdk`, `mog/views/sheet-view`. No edits expected there beyond fixing any latent errors the de-`any` exposes.
- The comment-repair (Phase 1) and the `any`-typing (Phase 2) are independent of each other and can proceed in parallel; Phase 3 (de-duplication) should land last so it can absorb Phases 1–2 in a single regenerated mirror.
