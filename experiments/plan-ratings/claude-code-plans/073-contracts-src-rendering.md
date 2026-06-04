# Plan 073 — Collapse the duplicated renderer contract surface in `mog/contracts/src/rendering` onto a single source of truth

## Source folder and scope

- **Folder:** `mog/contracts/src/rendering` (package `@mog-sdk/contracts`, public import paths `@mog-sdk/contracts/rendering`, `@mog-sdk/contracts/rendering/sheet-view-skin`, `@mog-sdk/contracts/rendering/coordinates`, `@mog-sdk/contracts/rendering/constants`).
- **In scope (files this plan changes the role of):**
  - `index.ts` — the public rendering barrel.
  - `grid-renderer.ts` — 549-line locally-authored copy of the `GridRenderer` interface (+ `GridRendererStats`, `RenderScheduler`, `ObjectBoundsUpdate`, `GridRendererConfig`, `RendererFactory`, `LayoutInvalidationMode`, `ViewportLayoutUpdateOptions`).
  - `data-sources.ts` — 400-line locally-authored copy of the data-source interfaces + the `DEFAULT_CHROME_THEME` / `DEFAULT_SHIMMER_CONFIG` value re-exports.
  - `sheet-view-skin.ts` — locally-authored copy of the resolved SheetView skin DTOs + the `DEFAULT_RESOLVED_SHEET_VIEW_OPTIONS` / `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` value tables.
  - `constants.ts`, `data-source-types.ts`, `grid-renderer-primitives.ts`, `visual-feedback.ts` — locally-authored copies that are currently byte-identical (or near-identical) to their canonical counterparts.
  - The existing one-line re-export shims (`coordinates.ts`, `coordinator-interfaces.ts`, `grid-region.ts`, `grouping.ts`, `hit-test.ts`, `hit-test-service.ts`, `interactive-elements.ts`, `primitives.ts`, `render-context.ts`, `text-measurement-service.ts`, `canvas-bridge-types.ts`) — the *target pattern* this plan extends to the remaining files.
- **Out of scope (referenced, not edited):** the canonical authoring packages `mog/types/rendering/src` (`@mog/types-rendering`) and `mog/types/viewport/src/rendering` (`@mog/types-viewport`); the contracts build/verify scripts (`mog/contracts/scripts/*`, `mog/tools/check-contracts-*.mjs`); and all consumers in `mog/kernel`, `mog/shell`, `mog/views`, `mog/runtime`, and the canvas-engine implementation of `GridRenderer`.

## Current role of this folder in Mog

`@mog-sdk/contracts/rendering` is **the** public, published entry point for renderer-facing state and viewport contracts. It is what the rest of Mog imports to talk to the grid renderer without depending on canvas internals: kernel (`domain/sheets/dimensions.ts`, `sheet-meta.ts`, `form-control-manager.ts`, `api/workbook/theme.ts`), shell (`machines/types.ts`), and the dev test-harness all import from `@mog-sdk/contracts/rendering`. The barrel exposes:

- The `GridRenderer` interface and its companions (the stable seam between the state/coordination layer and the canvas engine — `updateContext()`, the invalidation API, hit testing, coordinate/bounds queries, scene-graph + bounds readers, integration setters for ink/diagram/equation/text-effects, the interactive-element collector, the `RenderScheduler`).
- Data-source interfaces (`CellDataSource`, `SelectionDataSource`, `SheetDataSource`, `FloatingObjectDataSource`, `OverlayDataSource`, `GroupingDataSource`, `PageBreakDataSource`, `CollaborationDataSource`, `TraceDataSource`, `ChartRenderBridge`, …).
- Renderer-facing resolved skin DTOs (`ResolvedSheetViewSkin` + slices) and their default value tables.
- Layout constants (`DEFAULT_ROW_HEIGHT`, `DEFAULT_COL_WIDTH`, header/zoom/outline/buffer/hit-area constants), the `RenderPriority` enum, `LayerName`, and the chrome/shimmer defaults.

**The folder is in a half-finished migration.** The architecture intent (visible in the headers of `data-source-types.ts`, the shim files, and the `index.ts` line `export type * from '@mog/types-rendering'`) is that the *type* definitions live in the leaf packages `@mog/types-rendering` and `@mog/types-viewport`, and contracts re-exports them. Most files have already been reduced to one-line shims (`export type * from '@mog/types-rendering/...'`). But four heavyweight files were **never converted** and remain full local copies of definitions that also exist, verbatim-ish, in the leaf packages:

| Contracts file | Canonical twin | Status |
| --- | --- | --- |
| `grid-renderer.ts` | `mog/types/rendering/src/grid-renderer.ts` | **Drifted — stale** |
| `sheet-view-skin.ts` | `mog/types/rendering/src/sheet-view-skin.ts` | **Drifted — stale values** |
| `data-sources.ts` | `mog/types/rendering/src/data-sources.ts` | Diverged import paths only (shapes equal) |
| `data-source-types.ts` | `mog/types/viewport/src/rendering/data-source-types.ts` | Identical (latent duplicate) |
| `constants.ts` | `mog/types/viewport/src/rendering/constants.ts` | Identical (latent duplicate) |
| `grid-renderer-primitives.ts` | `mog/types/viewport/src/rendering/grid-renderer-primitives.ts` | Identical (latent duplicate) |
| `visual-feedback.ts` | `mog/types/rendering/src/visual-feedback.ts` | Identical (latent duplicate) |

This split-brain is the defect: `index.ts` pulls **types** from `@mog/types-rendering` (via `export type *`) but pulls **runtime values and a few re-export shapes** from the *local* copies (`DEFAULT_CHROME_THEME`/`DEFAULT_SHIMMER_CONFIG` from local `./data-sources`, `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` from local `./sheet-view-skin`, `RenderPriority` from local `./grid-renderer-primitives`). When the two copies disagree, the published contract becomes internally inconsistent.

The published `.d.ts` is produced by a non-trivial pipeline (`check-no-source-dts` → `tsc -p tsconfig.build.json` → `rollup-public-dts` → `fix-dts-extensions` → `check-contracts-declaration-identity` → `verify-runtime-exports` → `check-contracts-runtime-inventory` → `check-contract-runtime-imports`). The declaration-identity and runtime-inventory gates exist precisely to police drift like this, yet the value/shape drift below has shipped — so the gates are not currently catching cross-package divergence within `rendering`.

## Improvement objectives

1. **Eliminate the duplicated source of truth.** Convert the four remaining full-copy files into the same one-line re-export shim form already used by `coordinates.ts`/`hit-test.ts`/`render-context.ts`, so each renderer contract has exactly one canonical definition in a leaf package. A maintained second copy is a structural defect: every renderer-contract change must be applied twice, and the copy silently lags.

2. **Repair the drift that has already shipped on the public barrel** (concrete, evidence-backed — see invariants):
   - `grid-renderer.ts` (contracts) is **missing the `getCellRenderedSize(row, col)` method** that the canonical `@mog/types-rendering` `GridRenderer` has. Today this is masked only because `index.ts` re-exports `GridRenderer` *as a type* from `@mog/types-rendering`, so the local copy is dead-but-misleading — it documents an API surface that no longer matches reality and is a trap for anyone who imports `@mog-sdk/contracts/rendering/grid-renderer` deeply or edits the wrong file.
   - `sheet-view-skin.ts` (contracts) ships **stale default chrome colors**. `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` differs from canonical in: formula-reference fill opacity (`0.12`/`0.16` vs canonical `0.08`), `controls.commentIndicator` (`#d93025` vs `#fbbc04`), `controls.validationDropdown` (`rgba(32,33,36,0.62)` vs `#5f6368`), `controls.filterIcon` (same vs `#5f6368`), `controls.checkboxCheck` (`activeCellBorder` vs `#ffffff`), `controls.checkboxBackground` (`canvasBackground` vs `#1a73e8`), and `controls.hiddenIndicator` (`#999999` vs `#9aa0a6`). Because `index.ts` and the dedicated `./rendering/sheet-view-skin` subpath export re-export the **local** table, a consumer reading skin defaults from contracts paints different comment-indicator / checkbox / filter colors than a consumer reading from `@mog/types-rendering`. This is a live, user-visible chrome inconsistency.

3. **Make the declaration-identity / runtime-inventory gates catch this class of bug.** After consolidation the gates should fail if any `rendering` value or interface re-diverges from its leaf-package owner, so the drift cannot silently return.

4. **Preserve the published public surface exactly.** No exported name, subpath, or runtime value seen by current consumers may change — except the three drift fixes above, which intentionally converge contracts onto the canonical (newer) values.

## Production-path contracts and invariants to preserve or strengthen

**Must preserve (no consumer-visible change):**

- `@mog-sdk/contracts/rendering` continues to export, by the same names: `GridRenderer`, `GridRendererConfig`, `GridRendererStats`, `RenderScheduler`, `ObjectBoundsUpdate`, `LayoutInvalidationMode`, `ViewportLayoutUpdateOptions`, `RendererFactory`, `LayerName`, the `RenderPriority` enum (value export), all data-source interfaces, all `ResolvedSheetView*` skin DTOs + `SheetViewSkinPatch`/`SheetChromeThemePatch`, `ChromeTheme`, the constant values (`DEFAULT_ROW_HEIGHT`, `DEFAULT_COL_WIDTH[_MACOS|_WINDOWS]`, `MIN_*`, header/zoom/outline/buffer/hit-area constants, `ZOOM_PRESETS`), `HeaderVisibility`, and the default value objects `DEFAULT_CHROME_THEME`, `DEFAULT_SHIMMER_CONFIG`, `DEFAULT_RESOLVED_SHEET_VIEW_OPTIONS`, `DEFAULT_RESOLVED_SHEET_VIEW_SKIN`.
- The `package.json#exports` subpaths must keep resolving: `./rendering`, `./rendering/sheet-view-skin`, `./rendering/coordinates`, `./rendering/constants` (and any others present). A file becoming a re-export shim must still emit a `.d.ts`/`.js` at the same dist path so these subpaths do not 404.
- Runtime value semantics: `RenderPriority` numeric values (`CRITICAL=0`…`IDLE=4`); `DEFAULT_ROW_HEIGHT === 20` (OOXML 15pt @ 96 DPI, asserted by `__tests__/constants.test.ts` and mirrored by the Rust compute engine's `points_to_pixels(15.0)`); the platform `DEFAULT_COL_WIDTH` navigator-detection branch (`72` macOS / `64` otherwise); `DEFAULT_SHIMMER_CONFIG` shape and values.
- The `__tests__/constants.test.ts` import `from '../constants'` must keep resolving and passing — a re-export shim preserves both the export and the asserted value.

**To strengthen:**

- **Single owner per renderer contract.** `grid-renderer.ts`, `data-sources.ts`, `sheet-view-skin.ts`, `constants.ts`, `data-source-types.ts`, `grid-renderer-primitives.ts`, and `visual-feedback.ts` in contracts should re-export their leaf-package owners rather than redefine them — matching the already-shipped shim files in the same folder.
- **Convergence on canonical values.** After consolidation the contracts barrel emits the *canonical* `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` (with `#fbbc04` comment indicator, `0.08` formula-ref fill, `#1a73e8` checkbox background, etc.) and the canonical `GridRenderer` including `getCellRenderedSize`.
- **Gate coverage.** `check-contracts-declaration-identity.mjs` / `check-contracts-runtime-inventory.mjs` should treat the `rendering` brand owners and runtime exports as single-owner and fail on re-divergence.

## Concrete implementation plan

> Direction of consolidation: contracts re-exports the **leaf packages**. The canonical owners are `@mog/types-rendering` (`grid-renderer`, `data-sources`, `sheet-view-skin`, `visual-feedback`) and `@mog/types-viewport` (`rendering/constants`, `rendering/data-source-types`, `rendering/grid-renderer-primitives`). This matches the existing shims, the `index.ts` `export type * from '@mog/types-rendering'` line, and the recorded fact that the canonical `GridRenderer` lives in `types/rendering`. No type-shape authoring happens in contracts.

**Phase 0 — Confirm provenance and value-convergence safety (read-only).**
- Read `mog/contracts/scripts/rollup-public-dts.mjs`, `check-no-source-dts.mjs`, `verify-runtime-exports.mjs`, `clean-dist.mjs`, and `mog/tools/check-contracts-declaration-identity.mjs` + `check-contracts-runtime-inventory.mjs` to confirm: (a) how a shim file flows into the rolled-up `.d.ts` and the dist `.js` for each subpath, and (b) whether value re-exports (`export { X } from '<pkg>'`) satisfy the runtime-inventory gate the same way the local definitions do.
- Confirm `data-source-types.ts`, `constants.ts`, `grid-renderer-primitives.ts`, `visual-feedback.ts` are byte-identical to their leaf twins at implementation time (they are today). For the three that differ — `grid-renderer.ts`, `data-sources.ts`, `sheet-view-skin.ts` — re-diff to capture every divergence so nothing is dropped silently.
- Identify every consumer that reads the three drift-affected surfaces and decide whether the value convergence (Objective 2) is purely a fix or needs a visual sign-off: enumerate readers of `DEFAULT_RESOLVED_SHEET_VIEW_SKIN`, the `./rendering/sheet-view-skin` subpath, and `getCellRenderedSize`.

**Phase 1 — Convert the identical files to shims (zero behavior change).**
- Replace the bodies of `data-source-types.ts`, `constants.ts`, `grid-renderer-primitives.ts`, and `visual-feedback.ts` with the established shim form, choosing `export *`/`export type *` + explicit value re-exports so runtime values (`DEFAULT_CHROME_THEME`, the constants, `RenderPriority`, `DEFAULT_SHIMMER_CONFIG`) still surface:
  - `constants.ts` → re-export from `@mog/types-viewport/rendering/constants` (values + `HeaderVisibility`).
  - `data-source-types.ts` → re-export `ChromeTheme` + `DEFAULT_CHROME_THEME` from `@mog/types-viewport/rendering/data-source-types`.
  - `grid-renderer-primitives.ts` → re-export `LayerName` + `RenderPriority` from `@mog/types-viewport/rendering/grid-renderer-primitives`.
  - `visual-feedback.ts` → re-export the shimmer types + `DEFAULT_SHIMMER_CONFIG` from `@mog/types-rendering/visual-feedback`.
- These four carry no value drift, so this phase is pure de-duplication and must produce a byte-identical published surface.

**Phase 2 — Converge and shim the drifted files.**
- `grid-renderer.ts` → re-export the interface + companions from `@mog/types-rendering/grid-renderer` (and `RenderPriority` as a value). This automatically adopts `getCellRenderedSize` and the canonical primitives import path, eliminating the stale local interface. Verify nothing imports the contracts `grid-renderer.ts` deeply for the old shape (grep showed only generated `api-spec.json` and archived plans reference the path string; `index.ts` already sources `GridRenderer` from the leaf package).
- `data-sources.ts` → re-export the data-source interfaces and the `DEFAULT_CHROME_THEME`/`DEFAULT_SHIMMER_CONFIG` values from `@mog/types-rendering/data-sources`. Shapes are equal; only import provenance changes.
- `sheet-view-skin.ts` → re-export the skin DTOs **and the default value tables** from `@mog/types-rendering/sheet-view-skin`. This converges the contracts barrel and the `./rendering/sheet-view-skin` subpath onto the canonical color/opacity values (Objective 2). Because this changes emitted runtime values, it must be called out in the change description and validated against the canvas chrome (see Tests).
- Leave `index.ts` exporting the same names; with the underlying files now shims, every re-export resolves to the single canonical owner. Audit `index.ts` so any explicit value re-export (`DEFAULT_*`) points at a shimmed file that in turn forwards the canonical value (no stale local literal remains anywhere in the folder).

**Phase 3 — Make the gates enforce single ownership.**
- Extend / configure `check-contracts-declaration-identity.mjs` and `check-contracts-runtime-inventory.mjs` (or their data files) so the `rendering` interfaces and runtime values are registered as single-owner against the leaf packages, causing the build to fail if a future edit re-introduces a local redefinition or a divergent literal. If the existing gate already supports an allow/owner list, add the `rendering` entries; if not, note the smallest extension needed.

**Phase 4 — Documentation coherence.**
- Each shimmed file keeps a one-line module banner identical in spirit to the existing shims (`Re-export shim. Source lives in @mog/types-rendering (...)`), so the provenance is explicit and the next maintainer edits the canonical file. Remove the now-misleading rich JSDoc that duplicated the canonical doc comments (the canonical files retain them).

## Tests and verification gates

- **Contracts build pipeline** (`pnpm --filter @mog-sdk/contracts build`): must pass end-to-end, including `check-no-source-dts`, `rollup-public-dts`, `check-contracts-declaration-identity`, `verify-runtime-exports`, `check-contracts-runtime-inventory`, and `check-contract-runtime-imports`. After Phase 3 this is the primary regression guard against re-divergence.
- **Declaration-identity diff:** capture the rolled-up `dist/rendering/*.d.ts` before/after. For Phase 1 the public `.d.ts` and dist `.js` must be structurally identical (de-dup only). For Phase 2 the only intended deltas are: `GridRenderer` gains `getCellRenderedSize`, and `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` literal values change to the canonical set. Any other delta is a defect.
- **Unit test:** `mog/contracts/src/rendering/__tests__/constants.test.ts` must still pass unchanged (`DEFAULT_ROW_HEIGHT === 20`) through the `constants.ts` shim. (Plan does not edit this test.)
- **Downstream typecheck:** typecheck the contracts consumers (`@mog-sdk/contracts` declaration rollup is a prerequisite — see the recorded gotcha that editing rendering types requires building contracts before consumers typecheck) for `mog/kernel`, `mog/shell`, and the canvas-engine `GridRenderer` implementation, to confirm the converged `GridRenderer` (with `getCellRenderedSize`) and the unchanged data-source/skin shapes still satisfy every implementor and caller.
- **Visual regression for the skin convergence (Phase 2):** because comment-indicator, checkbox, filter-icon, validation-dropdown, hidden-indicator, and formula-reference colors change for consumers that were reading the stale contracts table, run the app-eval rendered-state / chrome scenarios (and a manual screenshot of comment indicators, checkbox cells, filter buttons, and formula-reference highlights) to confirm the canonical colors are the intended ones and nothing now mismatches the rest of the chrome.
- **Grep gate:** confirm no remaining live import resolves to a deleted local definition (e.g. a deep import of `@mog-sdk/contracts/rendering/grid-renderer` expecting the pre-`getCellRenderedSize` shape).

## Risks, edge cases, and non-goals

- **Risk — skin value change is a behavior change, not pure refactor.** Phase 2's `sheet-view-skin.ts` convergence alters runtime color values emitted by the public barrel. The canonical (`@mog/types-rendering`) values are newer and assumed correct, but this must be verified visually before landing; if product intent is the *contracts* values, the fix direction inverts (update the canonical owner instead) — either way there must be exactly one owner. This is the one place the plan changes observable output, and it is deliberate (fixing a shipped inconsistency), not a silent side effect.
- **Risk — subpath resolution.** `./rendering/sheet-view-skin` and `./rendering/constants` are first-class `package.json` exports; a shimmed file must still emit dist artifacts at those paths. Validate the rollup keeps emitting them (Phase 0) before deleting local bodies.
- **Risk — runtime-inventory / declaration-identity gate semantics.** If the gates currently expect these values to be *locally owned* by contracts, naively re-exporting may trip "duplicate brand owner" or "runtime export not owned here" errors. Phase 3 addresses this; Phase 0 must confirm the exact gate behavior so Phase 1/2 don't deadlock against the very gate meant to protect them.
- **Edge case — `data-sources.ts` import path for `SearchHighlight`.** The contracts copy imports `SearchHighlight` from the relative `../document/search`; the canonical imports from `@mog-sdk/types-document/document/search`. Shimming to the canonical file is correct, but confirm the contracts `document/search` shim and the leaf path resolve to the same type to avoid a duplicate-identity error.
- **Edge case — `getObjectBoundsSync` vs `boundsReader` migration note.** The canonical `GridRenderer` already documents migrating off `getObjectBoundsSync()` to `boundsReader`. Adopting the canonical interface does not change that; this plan does not perform that consumer migration (separate work).
- **Non-goals:** (1) No reduction of the public surface, no compatibility shim layers, no test-only patches — this is a source-of-truth consolidation on the production path. (2) Not touching the canvas-engine `GridRendererImpl` beyond confirming it implements the converged interface. (3) Not reorganizing the leaf packages themselves (`@mog/types-rendering` / `@mog/types-viewport` internal layout is out of scope). (4) Not introducing a build-time codegen for the shims (the one-line shim is already the established, low-cost pattern; codegen would be over-engineering here). (5) Not addressing the unrelated `MIGRATE sheetId → containerId` TODO at the top of `data-sources.ts` (tracked separately; converging the file does not block it, but the rename should land in the canonical owner).

## Parallelization notes and dependencies on other folders

- **Hard dependency on the leaf packages.** All edits re-export from `mog/types/rendering/src` and `mog/types/viewport/src/rendering`. If a sibling worker is restructuring `@mog/types-rendering` or `@mog/types-viewport` (e.g. plans covering `types/rendering/src` or `types/viewport/src`), Phase 1/2 here must rebase onto their final module paths. Coordinate ordering: the leaf-package owners must be settled first; this folder then becomes pure re-exports.
- **Build-order dependency.** Per the recorded contracts-declaration-rollup gotcha, `pnpm --filter @mog-sdk/contracts build` must run before any consumer (`mog/kernel`, `mog/shell`, `mog/views`) typechecks against the changed rendering surface. Sequence verification accordingly.
- **Consumer-side, independent:** the canvas-engine `GridRenderer` implementor and the kernel/shell importers can be typechecked in parallel once the contracts declaration is rebuilt; they require no edits if the convergence preserves shapes (which it does, modulo the additive `getCellRenderedSize` the implementor already provides on the canonical interface).
- **Phase independence:** Phase 1 (identical-file shims) is fully independent and can land first as a no-risk de-dup. Phase 2 (drifted files + value convergence) depends on the Phase 0 visual sign-off but not on Phase 1. Phase 3 (gate enforcement) depends on Phases 1–2 being merged so the gate's expected owner set is stable.

---

### Evidence appendix (read-only findings backing this plan)

- `index.ts` re-exports **types** from `@mog/types-rendering` (`export type * from '@mog/types-rendering'`) but **values** from local files (`DEFAULT_CHROME_THEME`/`DEFAULT_SHIMMER_CONFIG` from `./data-sources`; `RenderPriority` from `./grid-renderer-primitives`; `DEFAULT_RESOLVED_SHEET_VIEW_*` from `./sheet-view-skin`) — the split-brain.
- `diff grid-renderer.ts` (contracts vs `mog/types/rendering/src`): contracts copy is missing `getCellRenderedSize(...)` and imports `RenderPriority`/`LayerName` from the local `./grid-renderer-primitives` instead of `@mog/types-viewport/rendering/grid-renderer-primitives`.
- `diff sheet-view-skin.ts`: `DEFAULT_RESOLVED_SHEET_VIEW_SKIN` color/opacity values diverge (formula-ref fill `0.12/0.16`→`0.08`; `commentIndicator #d93025`→`#fbbc04`; `validationDropdown`/`filterIcon`→`#5f6368`; `checkboxCheck`→`#ffffff`; `checkboxBackground`→`#1a73e8`; `hiddenIndicator #999999`→`#9aa0a6`).
- `diff data-sources.ts`: shapes equal; only import provenance differs (`../document/search` vs `@mog-sdk/types-document/...`, `./data-source-types` vs `@mog/types-viewport/...`).
- `diff -q` shows `constants.ts`, `data-source-types.ts`, `grid-renderer-primitives.ts`, `visual-feedback.ts` byte-identical to their leaf twins.
- `package.json#exports` exposes `./rendering`, `./rendering/sheet-view-skin`, `./rendering/coordinates`, `./rendering/constants`; build runs the `check-contracts-declaration-identity` / `verify-runtime-exports` / `check-contracts-runtime-inventory` / `check-contract-runtime-imports` gates.
- Consumers of `@mog-sdk/contracts/rendering` include `mog/kernel/src/domain/sheets/*`, `mog/kernel/src/api/workbook/theme.ts`, `mog/shell/src/machines/types.ts`, and the dev test-harness.
