# Plan 077 — Harden the canvas-objects contract package (`mog/types/objects/src`)

## Source folder and scope

- **Folder:** `mog/types/objects/src` (package `@mog/types-objects`, version `0.1.0`, Tier‑1 of the domain‑type graph; depends only on `@mog/types-core` and `@mog/types-viewport`).
- **In scope:** the pure-type/contract surface of floating objects, drawing, ink, equation, text‑effects, diagrams, and their shared 3‑D/geometry primitives, plus the package barrels and `package.json` `exports` map.
  - `objects/` — `canvas-object.ts`, `floating-object-types.ts`, `floating-objects.ts`, `floating-objects-view.ts`, `floating-object-manager.ts`, `object-bounds-reader.ts`, `object-mutator.ts`, `scene-graph-reader.ts`, `drawing-object.ts` (resolved rendering primitive), `index.ts`.
  - `drawing/` — `three-d.ts` (`Scene3D`, `Shape3D`, light/material/camera enums).
  - `ink/` — `types.ts` (ink `DrawingObject`, strokes, recognition), `spatial-index.ts`.
  - `equation/` — `types.ts`, `omml-ast.ts`, `templates.ts`, `errors.ts`.
  - `text-effects/` — `types.ts`, `effects.ts`, `presets.ts`, `bridge.ts`.
  - `diagrams/` — `types.ts`, `layouts.ts`, `styles.ts`, and six `ooxml-*-types.ts` files.
  - Root `index.ts` (currently `export {}`).
- **Out of scope (but coordinated, see dependencies):** the re-export shim layer in `mog/contracts/src/{objects,drawing,ink,equation,text-effects,diagram}/*` that forwards to `@mog/types-objects/*`; downstream consumers in `mog/types/{editor,data,machines,events}`, `mog/contracts/src/api/types.ts`, and `mog/contracts/src/rendering/*`; the Rust/wire counterparts (`kernel/src/bridges/compute/compute-types.gen.ts`, `file-io/xlsx/bridge/src/types.ts`).

## Current role of this folder in Mog

This package is the **single source of truth for the TypeScript contracts of every floating/canvas object** that overlays the grid. It is consumed in three directions:

1. **Kernel → renderer/React projection.** `IFloatingObjectsView` exposes the kernel's authoritative floating-object state synchronously (`FloatingObjectSnapshot = FloatingObject`, plus `FloatingObjectBoundsSnapshot`). `ISceneGraphReader` is the renderer-side read-only mirror used by devtools/app-eval. `IObjectBoundsReader` gives O(1) pixel bounds. The contracts encode the "kernel async, projection sync, renderer reads projections, writes go through the bridge" rule.
2. **App-facing command surface.** `IFloatingObjectManager` and the kernel-internal `IObjectMutator` define create/transform/order/group/duplicate operations as *intent* (Rust resolves anchor math), plus the per-kind `Create*Options`.
3. **Persistence/interop vocabulary.** The discriminated union `FloatingObject` (`PictureObject | TextBoxObject | ShapeObject | ConnectorObject | ChartObject | DrawingObject(ink) | EquationObject | FormControlObject | DiagramObject | OleObjectObject`), the OOXML/DrawingML‑aligned shape/fill/stroke/effect types, OMML equation AST, ink strokes, and the SmartArt/diagram OOXML data/layout/algorithm/style model. `ImportObjectStatus`/diagnostics describe degraded-import recoverability.

The package was recently "absorbed from `contracts/src/`"; `contracts/src` is now a thin re-export shim and this package is canonical. Because it is the canonical contract, every drift, name collision, or stale invariant here propagates to the renderer, the kernel bridge, file‑IO, and the public API types.

## Improvement objectives

1. **Eliminate exported-name collisions** that make the package ambiguous when types are pulled through more than one subpath. There are real duplicates, not just doc overlaps:
   - `DrawingObject` is exported by **two** modules with **incompatible** meanings: `ink/types.ts` (`DrawingObject extends FloatingObjectBase` — the ink "drawing" member of the `FloatingObject` union) and `objects/drawing-object.ts` (`DrawingObject` — the *resolved rendering primitive*: `geometry/fill/stroke/effects/text/children`). Both are reachable via package subpaths; `floating-objects.ts` imports the ink one. A consumer that imports "`DrawingObject`" can silently get the wrong contract.
   - `GradientStop` is defined **three** times (`objects/floating-objects.ts`, `objects/drawing-object.ts`, `text-effects/types.ts`) with different field sets (`{offset,color}` vs `{offset,color,opacity?}`).
   - `GradientType` (`'linear'|'radial'` vs `'linear'|'radial'|'path'`), `GradientFill`, `PatternFill`, `LineDash`, `TextRun` (`floating-objects` vs `diagrams/ooxml-data-model-types`), and the effect types `GlowEffect`/`BevelEffect`/`ReflectionEffect`/`Transform3DEffect` (each defined in **both** `diagrams/types.ts` and `text-effects/effects.ts`) are duplicated and already drifting.
2. **Consolidate the duplicated structural types onto canonical definitions** so DrawingML fills/strokes/effects/gradients/text runs have exactly one authority each, with subtype variants `extends`/`Pick`/`Omit`-ing the canonical type rather than re-declaring it.
3. **Finish the `sheetId → containerId` and `position`/`anchor` migration** that `FloatingObjectBase` and `FloatingObjectGroup` document as "removed in a future phase," replacing the dual-write aliasing with one canonical field plus a deprecation path.
4. **Strengthen and enforce the layering/cycle invariant.** `floating-object-types.ts` exists solely to break the `floating-objects ↔ ink/types ↔ diagrams/types` cycles; today the rule is only a prose comment. Make it machine-enforced.
5. **Remove the runtime side effect from a pure-type package.** `floating-object-types.ts` contains a module-level `const _typeCheck … ; void _typeCheck;` that emits JS and is hostile to `export type *` / `isolatedModules`. Replace with a type-level assertion.
6. **Make the public surface honest and navigable.** Fix the stale root `index.ts` header (says `diagram/`, the folder is `diagrams/`; omits `floating-object-manager`, `floating-objects-view`, `scene-graph-reader`; carries an obsolete dependency NOTE), and decide/document the root barrel policy (`export {}` is currently a deliberate "subpath-only" choice — make that explicit and collision-safe).
7. **Preserve every wire/Rust/OOXML alignment** called out in the source comments while doing the above.

## Production-path contracts and invariants to preserve or strengthen

- **`FloatingObjectKind ⊆ CanvasObjectType`** (the open `string` type). Keep the compile-time guarantee; convert the runtime `_typeCheck` const into a non-emitting type assertion (e.g. an exported `type _Assert = FloatingObjectKind extends CanvasObjectType ? true : never;` or a `satisfies` in a `.test-d.ts`).
- **`FloatingObjectSnapshot = FloatingObject` must stay the full union** (not narrowed) — the projection comment is explicit that narrowing would force the renderer back through a Rust round-trip to rebuild scene objects. Any consolidation must not drop type-specific subfields.
- **`SceneObjectSnapshot` is the *intersection* guaranteed on every renderer `SceneObjectBase`** plus the type discriminator and an opaque `data` payload. The discriminated payload deliberately stays in `canvas/drawing-canvas`; do not pull it into the public contract.
- **Layering rule:** `floating-object-types.ts` depends only on `canvas-object.ts` + `@mog/types-core` cell identity; it must never import `floating-objects.ts` or any subtype module. Subtype modules (`ink/types`, `diagrams/types`) import *from* `floating-object-types`, never from `floating-objects`. `floating-objects.ts` re-exports the base types for back-compat.
- **Package dependency ceiling:** only `@mog/types-core` and `@mog/types-viewport`. No new dependency (e.g. on `types-formatting`, `contracts`, kernel, or renderer) may be introduced.
- **Wire/OOXML parity comments are contracts, not prose.** `ink/types.ts` ↔ `compute-types.gen.ts` (`DrawingData`/`InkStroke`/…), `text-effects` `TextWarpPreset`/`ST_TextShapeType` ↔ generated `ooxml-types.ts`, diagrams ↔ ECMA‑376 `ST_ParameterId`, equation `omml-ast` ↔ OMML. Renames/consolidations must keep these structurally compatible; where a domain type intentionally differs from wire (branded ids, `Map<>` vs `Record<>`), preserve the difference and its note.
- **Anchor/identity model:** `CellAnchor` references `CellId` (survives row/col insert/delete); resolution is render-time via `CellPositionLookup`. `IObjectMutator` operations are intent (Rust owns anchor math). Keep these semantics untouched.
- **`exports` map ↔ barrels:** every public subpath in `package.json` must keep resolving; any file rename must update the `exports` map and the corresponding `contracts/src` shim in the same change.

## Concrete implementation plan

Sequence the work so each step compiles independently and the public surface stays resolvable at every commit.

**Phase 1 — Resolve the `DrawingObject` collision (highest risk, do first).**
1. Rename the *resolved rendering primitive* in `objects/drawing-object.ts` from `DrawingObject` to an unambiguous name (recommended: `ResolvedDrawing`; alternative `RenderableDrawing`). Update its self-referential `children?: DrawingObject[]`, all in-package importers (`objects/drawing-object.ts` is imported by renderer-side bridges via the `./objects/drawing-object` subpath), and the `contracts/src/objects/drawing-object.ts` shim.
2. Optionally rename the ink union member `DrawingObject` → `InkDrawingObject` (it `extends FloatingObjectBase`, `type: 'drawing'`). This is the member referenced in `floating-objects.ts`'s `FloatingObject` union and in `IDrawingObjectManager`. Lower urgency than (1) but removes the last same-name clash. If deferred, document explicitly in both files why the names differ.
3. Provide a deprecated type alias (`export type DrawingObject = ResolvedDrawing; /** @deprecated renamed … */`) for one release window only if external consumers demand it; prefer a clean rename since all consumers are in-repo.

**Phase 2 — Consolidate duplicated DrawingML structural types.**
4. Choose canonical homes. Candidates, kept inside this package to respect the dependency ceiling: gradient/fill/stroke/line primitives → a new `objects/drawing-primitives.ts` (or fold into `drawing/`), 3‑D and visual effects → `text-effects/effects.ts` + `drawing/three-d.ts` (already the richest definitions). 
5. For each duplicate (`GradientStop`, `GradientType`, `GradientFill`, `PatternFill`, `LineDash`, `TextRun`, `GlowEffect`, `BevelEffect`, `ReflectionEffect`, `Transform3DEffect`): pick the superset definition, move it to the canonical module, and replace the others with `import type` + re-export, or a documented variant (`extends`/`Pick`). Where field sets genuinely differ by domain (e.g. text-effects `GradientType` includes `'path'`), model the relationship explicitly (`type TextGradientType = GradientType | 'path'`) instead of two independent declarations.
6. Confirm `LightRigType`/`MaterialPreset`/`LightDirection` in `text-effects/effects.ts` remain thin re-export aliases of `drawing/three-d.ts` (they already are) — keep, but add `@see` precision so they aren't mistaken for independent definitions.

**Phase 3 — Finish the anchor/container migration debt.**
7. Decide the canonical field: keep `containerId` (the universal `CanvasObject` field) and `position` as the spreadsheet anchor; mark `sheetId` and the duplicate `anchor` on `FloatingObjectBase`/`FloatingObjectGroup` `@deprecated` with a removal note, or remove them outright if no production reader depends on the alias (grep `mog` for `.sheetId` reads on floating objects and for `.anchor` access on `FloatingObject*`). Do the same for `FloatingObjectGroup`.
8. If removal is chosen, stage it: (a) annotate `@deprecated`, (b) migrate readers, (c) delete in a follow-up — but the *plan target* is full removal of the alias, not a permanent shim.

**Phase 4 — Enforce invariants and remove the runtime side effect.**
9. Replace the `const _typeCheck`/`void _typeCheck` in `floating-object-types.ts` with a type-only assertion so the module emits no JS.
10. Add a dependency-cycle guard for the layering rule (eslint `import/no-cycle` or a dependency-cruiser rule scoped to this package; a CI grep that fails if `floating-object-types.ts` imports `floating-objects.ts` or any subtype module is the minimal version).
11. Add a duplicate-export-name guard (a small script over the package's exported declarations that fails on a repeated `export interface/type/const` name across modules) so future drift is caught.

**Phase 5 — Documentation & barrel hygiene.**
12. Rewrite the root `index.ts` header: correct `diagram/` → `diagrams/`, list the actual `objects/` modules (manager, view, scene-graph-reader), and remove the obsolete `types-formatting` NOTE (the package already depends on `types-core` + `types-viewport`).
13. Make the root barrel policy explicit. The current `export {}` means "import via subpaths only" and is in fact the safe choice given the (now-removed) collisions; document it in the header, OR — once Phases 1–2 remove collisions — provide a curated, collision-free root barrel that re-exports the high-traffic public types. Either way the decision must be stated in the file, not implicit.
14. Re-verify every `package.json` `exports` subpath still maps to an existing file after any rename, and that the `contracts/src` shims (note: contracts still uses the singular `diagram/` subpath while this package uses `diagrams/`) forward correctly — fix the `diagram`/`diagrams` naming inconsistency across the shim boundary or document it as intentional.

**Phase 6 — Cross-cutting `ImportObjectStatus` (investigate, then act).**
15. `ImportObjectStatus`/`ImportDiagnosticRef` are also defined in `file-io/xlsx/bridge/src/types.ts` and `kernel/.../compute-types.gen.ts` (wire). Determine whether the domain copy here should be the single TS authority (with file-io importing it) or whether it is intentionally mirrored for the wire boundary. If consolidation is safe within the dependency ceiling, make this package's definition canonical and have the non-generated copy import it; the generated wire copy stays generated.

## Tests and verification gates

> The plan must not run builds itself; these are the gates the implementer runs.

1. **Package typecheck:** `tsc -b` for `@mog/types-objects` (the package's `typecheck` script) — zero errors, and confirm `dist/` declaration emit still produces the same public subpaths.
2. **Contracts rollup:** `pnpm --filter @mog-sdk/contracts build` after any rename — the shim layer re-exports this package and the contracts declaration rollup must succeed (declaration emit must precede consumer typecheck; see the contracts declaration-rollup gotcha).
3. **Downstream typecheck:** build/typecheck the direct consumers — `mog/types/{editor,data,machines,events}`, `mog/contracts/src/api/types.ts`, `mog/contracts/src/rendering/*`, and the renderer bridges that consume `ResolvedDrawing`/`SceneObjectSnapshot` — to prove renames propagated.
4. **Type-level assertions (`.test-d.ts` / `tsd`):** `FloatingObjectKind extends CanvasObjectType`; `FloatingObjectSnapshot` is assignable to/from `FloatingObject`; each consolidated type is assignable from its former duplicates' shapes (catches accidental field loss).
5. **No-cycle gate:** the layering lint/dependency-cruiser rule passes; a deliberately introduced `floating-object-types → floating-objects` import fails it (one-time spike to confirm the guard bites).
6. **No-runtime-emit gate:** assert the compiled `floating-object-types.js` contains no executable statements (the `_typeCheck` removal), e.g. declaration-only emit check.
7. **Duplicate-name gate:** the duplicate-export script reports zero collisions across package modules.
8. **Wire parity spot-check:** diff the renamed/consolidated ink, text-effects, and diagram OOXML types against their generated wire counterparts to confirm structural compatibility is preserved.
9. **app-eval / api-eval smoke:** run the floating-object/drawing/diagram/equation rendered-state scenarios (`__dt.getRenderedDrawings` via `ISceneGraphReader`, object create/move/resize) to confirm no behavioral regression from the contract changes. (Per harness notes, watch for state-leak/async-overlay flakiness, not contract breakage.)

## Risks, edge cases, and non-goals

- **Rename blast radius.** `DrawingObject`, `GradientStop`, etc. are widely imported. Mitigate by doing renames atomically with shim + `exports` updates, and by leaning on the downstream typecheck gate. The empty root barrel actually *limits* blast radius (no bare-root importers exist), which is why Phase 1 can move quickly.
- **Silent field loss during consolidation.** Picking a "superset" wrongly could drop a field some consumer relies on (e.g. `GradientStop.opacity`). The `tsd` assignability assertions and the requirement that the chosen canonical is a true superset guard this.
- **Wire/OOXML drift.** The biggest correctness hazard is breaking structural parity with the generated bridge types. Treat the parity spot-check as a hard gate; never "clean up" a field that exists for wire compatibility.
- **`sheetId`/`anchor` removal.** Some readers may still use `.sheetId`/`.anchor` aliases; staged deprecation (annotate → migrate → delete) avoids a flag-day break. If migration proves large, the alias removal can trail the rest of the plan, but the target remains removal, not a permanent compatibility field.
- **`diagram` vs `diagrams` naming.** Resolve consciously: the contracts shim subpath is singular, the package folder is plural. Renaming the folder is a larger churn; documenting the intentional split is the lower-risk option, but the inconsistency must not be left silent.
- **Non-goals:** no behavioral/runtime change to the kernel mutation pipeline, renderer scene graph, or Rust core; no new object kinds or DrawingML features; no reduced-scope shims kept as the end state (deprecations are transitional only); no test-only or workaround fixes — the deliverable is the corrected production contract surface.

## Parallelization notes and dependencies on other folders

- **Internal ordering:** Phase 1 (collision rename) and Phase 4 (side-effect + guards) are independent and can run in parallel. Phase 2 (consolidation) should follow Phase 1 so the canonical-type moves don't fight the rename. Phase 3 (anchor migration) is independent of 1–2 but shares files (`floating-object-types.ts`, `floating-objects.ts`) so coordinate edits. Phase 5 docs/barrel must come last (depends on final file names). Phase 6 is an investigation that can run in parallel from the start.
- **Cross-folder dependencies:**
  - **`mog/contracts/src/*` (shim layer):** every rename/move here requires a matching shim edit — these are tightly coupled and should land in the same change. (Plan 0xx for `mog/contracts/src` should be aware this package is its upstream.)
  - **`@mog/types-core` / `@mog/types-viewport`:** consumed (`CellId`, `SheetId`, `CellFormat`, `ObjectBounds`, `AffineTransform`, `Path`). No changes required there, but the dependency ceiling must be respected — do not relocate consolidated types *into* core/viewport unless a separate plan for those folders agrees.
  - **`mog/types/{editor,data,machines,events}`** and **`mog/contracts/src/{api,rendering}`:** downstream typecheck consumers; coordinate the rename window with whoever owns those folders, but no design dependency.
  - **Generated wire types** (`kernel/src/bridges/compute/compute-types.gen.ts`) and **`file-io/xlsx/bridge/src/types.ts`:** parity targets for Phase 6; the generated file is owned by codegen and must not be hand-edited.
- A folder-review worker for `mog/contracts/src` and for the renderer `canvas/drawing-canvas` scene types should be informed that this package is the canonical contract so their plans treat it as the source of truth rather than re-defining types.

---
*Status: actionable. Evidence gathered by read-only inspection of `mog/types/objects/src`, its `package.json` `exports`, the `mog/contracts/src` shim layer, and consumer/duplicate-name scans across `mog`. No production code, tests, fixtures, or configs were modified.*
