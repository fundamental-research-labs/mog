# Plan 048 — Shape geometry and preset fidelity coverage (`@mog/shape-engine` source)

## Source folder and scope

- **Folder:** `mog/canvas/drawing/shapes/src`
- **Package:** `@mog/shape-engine` (private workspace package, version `0.1.0`)
- **Scope of this plan:** every file under `src/`:
  - `index.ts` — public API surface (re-exports).
  - `shape-to-path.ts` — `generateShapePath`, scaling-mode dispatch, validity helpers.
  - `custom-geometry.ts` — OOXML guide-formula evaluator, OOXML path-command resolver, arc-to-Bézier approximation, SVG path parse, `customGeometryToPath`.
  - `drawing-object-output.ts` — `createDrawingObject` (geometry + fill/stroke/effects/3D/text → `DrawingObject`).
  - `text-in-shape.ts` — `computeTextInset`.
  - `presets/registry.ts` — registry maps (generators, defaults, categories, text insets, natural ratios, locked ratios, unfilled set, scaling modes) + adjustment helpers.
  - `presets/spec-presets.ts` — loads the 186-shape OOXML catalog from `preset-shape-data.json` and registers all shape metadata.
  - `presets/basic.ts` — 6 custom (non-OOXML) shapes: `circle`, `pill`, `lineArrow`, `lineDoubleArrow`, `curve`, `banner`.
  - `presets/primitives.ts` — `ellipsePath`, `ellipsePoint`, `regularPolygon`, `starPath`.
  - `presets/constants.ts` — `KAPPA`.
  - `presets/{arrows,callouts,flowchart,math,stars}.ts` — empty stub files (`// Stub — preset content consolidated elsewhere`), still imported for side effects by `shape-to-path.ts`.
  - `presets/preset-shape-data.json` — 686 KB, 186 OOXML preset shape definitions (`avLst`, `gdLst`, `pathLst`, `cxnLst`).
  - `diagnostics/{index,comparators,validators,reporters}.ts` — `compareShapes`, `validateShape`, report generators.

Out of scope: `@mog/geometry` (`PathOps`, `Transform`, `BoundedCache`), `@mog-sdk/contracts` (the `Path`/`SubPath`/`DrawingObject`/`GeometryPath*` types), the bridge-ts `ShapePreset` generated union, and downstream renderers — but contracts with each are called out explicitly below.

## Current role of this folder in Mog

`@mog/shape-engine` is the **pure, dependency-light geometry kernel for preset and custom shapes**. Its header guarantees: "Depends only on `@mog/geometry` and `@mog-sdk/contracts`. No Yjs, React, Canvas, or DOM dependencies." It converts a `(shapeType, width, height, adjustments)` tuple into a `Path`, and a fuller `(…, visualProperties)` tuple into a `DrawingObject` that the canvas/SVG/PDF renderers draw directly.

It is consumed broadly. Confirmed production code consumers:
- `mog/kernel/src/domain/shapes/shape-computation.ts` (`computeShape`, with a 500-entry `BoundedCache`) and `mog/kernel/src/floating-objects/object-store.ts`.
- `mog/canvas/drawing-canvas/src/{shape-rendering-info.ts,renderers/shape.ts}`.
- `mog/canvas/drawing/engine` (integration tests for hit-testing and the shape pipeline).
- `mog/canvas/drawing/diagram/src/output/layout-to-drawing-objects.ts` (SmartArt → shapes).

This package is therefore the **single source of truth for "what shapes exist and what geometry they have"** in the product. Its `ShapePreset` type (re-exported from bridge-ts, 188 OOXML members) is the typed contract the rest of the app trusts. The folder's review theme — *shape geometry and preset fidelity coverage* — is exactly its core responsibility, so the bar is: every typed-valid preset must produce correct geometry, and OOXML round-trip fidelity must hold.

## Improvement objectives

Evidence-ranked, highest-confidence production defects first.

1. **Close the preset coverage holes between the typed `ShapePreset` union (188) and the geometry catalog (186).** Two union members have **no generator and no JSON geometry**, so they are typed-valid yet throw at runtime:
   - `upArrow` — a core block-arrow shape. `isValidShapeType('upArrow') === false`; `generateShapePath('upArrow', …)` throws `Unknown shape type: "upArrow"`. `leftArrow`, `rightArrow`, `downArrow`, `leftRightArrow`, `upDownArrow` are all present — only the up arrow is missing. Inserting or importing an OOXML up-arrow renders nothing / errors.
   - `textBox` — present in the union, absent from the catalog, with no fallback generator.
   These were verified by diffing the union member list against `jq 'keys' preset-shape-data.json`.

2. **Stop discarding guide evaluation in the public `customGeometryToPath` API.** `custom-geometry.ts:348-349` calls `evaluateGuides(guides, shapeWidth, shapeHeight)` and **throws the result away**; the returned guide map is never used to resolve path-command coordinates. The comment claims "ISSUE 1 FIX: Evaluate guide formulas instead of just using static values," but the evaluation is dead. Any external caller passing OOXML custom geometry whose path coordinates reference guide names gets wrong geometry. (Spec presets are *not* affected because `spec-presets.ts` resolves coordinates upstream via `resolveOoxmlPath(commands, guideMap)`; this bug bites user-drawn / imported custom geometry that flows through the advertised public entry point.)

3. **Preserve OOXML path fill modes and per-subpath fill/stroke distinction.** `customGeometryToPath` flattens all subpaths into one `Path` with a single `closed` flag and ignores each path's `fill` (`norm`/`lighten`/`lightenLess`/`darken`/`darkenLess`/`none`) and `stroke` flag. `spec-presets.ts` partially compensates with `geometryPaths.filter(p => p.stroke !== false)`, but the shading and fill-vs-stroke-per-subpath information is lost. Multi-path shapes (`donut`, `noSmoking`, gears, action-button glyph overlays, `sun`, `moon`) lose their intended shading/holes fidelity.

4. **Carry connection points (`cxnLst`) through the engine.** 172 of 186 catalog shapes define connection sites in the JSON and they are typed in `JsonConnectionPoint`/`JsonShapeDef`, but the loader never registers or exposes them. Connector snapping/routing has no per-shape connection data to work from.

5. **Make shape metadata a single source of truth with a registration-completeness invariant.** Natural ratios, scaling modes, unfilled flags, categories, and text insets are hand-coded lists in `spec-presets.ts`, decoupled from the JSON catalog and the typed union. This has already drifted:
   - `cross` is registered with a natural ratio (`1`) **and** a category (Basic Shapes) although it has **no geometry, is not in the union, and is not an OOXML preset name** (the plus glyph is `plus`). Dead metadata pointing at a non-shape.
   - `upArrow` carries a registered natural ratio (`0.5`) and a 15% text inset while having no generator — metadata for a shape that cannot be drawn.
   There is no check that every registered preset has a category/ratio, nor that every typed-union member has a generator.

6. **Raise text-inset fidelity coverage.** Only ~30 of ~192 registered shapes have geometry-aware insets; the remaining ~160 fall back to a flat 5% margin (`text-in-shape.ts:67`), which overflows the visible region for stars, arrows, callouts, cylinders, hexagons, etc. The folder theme is "preset fidelity coverage," so insets should be derived from the actual generated geometry rather than a sparse hand-tuned table.

7. **Fix diagnostics correctness.** `compareShapes` applies its `1e-6` numeric tolerance only to top-level scalar properties; numeric **array elements** are compared with strict `!==` and then recursed as non-objects, so float noise in coordinate/adjustment arrays produces spurious "differences." This undermines the import/storage fidelity checker that exists specifically to catch real drift.

8. **Remove stale code and misleading contracts.** Empty stub files (`arrows/callouts/flowchart/math/stars.ts`) are still imported by `shape-to-path.ts`; `getPreset`'s "Follows aliases" comment describes an alias mechanism that does not exist; and `createDrawingObject`'s docstring example uses `'roundedRectangle'` (unregistered — the real name is `roundRect`), which would throw if copied.

Non-objective: do not change the public function signatures gratuitously, do not introduce DOM/Canvas/React/Yjs dependencies, and do not reduce the OOXML catalog.

## Production-path contracts and invariants to preserve or strengthen

- **Purity / dependency boundary.** Keep the package free of Yjs/React/Canvas/DOM. New work (connection points, fill metadata) must stay pure data; rendering decisions belong to consumers. `mog/tools/eslint-plugin-mog/import-boundaries.cjs` references this package — respect those boundaries.
- **`ShapePreset` ⇒ generator totality (strengthen).** New invariant: for every member of the bridge-ts `ShapePreset` union, `isValidShapeType(member)` is `true` (or the member is on an explicit, documented "rendered elsewhere" allow-list, e.g. `textBox` if it is intentionally a text container rather than a geometry). This is currently violated by `upArrow` and `textBox`.
- **No metadata for non-shapes (strengthen).** New invariant: every shape with registered metadata (ratio, scaling mode, unfilled, category, text inset) must be a registered generator. Violated today by `cross` and `upArrow`.
- **`generateShapePath` total over valid inputs.** Must never throw for a registered type; must clamp `w,h` to `≥ 0` (already does via `Math.max(0, …)`); `createDrawingObject` must keep its NaN/Infinity guards.
- **`Path`/`SubPath` contract.** `customGeometryToPath` already emits per-subpath `closed`. Extend faithfully: any new per-subpath fill/stroke metadata must conform to the `@mog-sdk/contracts/geometry` `Path`/`SubPath` shape (coordinate with that package's owners before adding fields — see dependencies).
- **OOXML guide-formula semantics (ECMA-376 §20.1.9.11).** Preserve the existing operator set (`val`, `*/`, `+-`, `+/`, `sin/cos/tan`, `at2/cat2/sat2`, `?:`, `min/max/abs/sqrt/mod/pin`) and the built-in variable table (`w,h,wd2…,ss,ls,ssd*,cd*` angle constants). The `at2`/`cat2`/`sat2` argument ordering and 60000ths-of-a-degree angle units are correct and must not regress.
- **Arc fidelity.** Keep the visual-angle → parametric-angle conversion and ≤90°-per-segment Bézier subdivision in `customGeometryToPath`. Tighten the degenerate `rx===0||ry===0` case so it degrades to a `lineTo` endpoint rather than silently dropping the segment and leaving a gap.
- **Determinism & caching.** Output must remain a pure function of inputs — `kernel` keys a `BoundedCache` on shape parameters. Any fix must not introduce nondeterminism (no time/random).
- **Backward compatibility of `customGeometryToPath` normalization.** Its `[0,1]` normalization fallback (when `targetWidth`/`targetHeight` are omitted) is depended upon; the guide-evaluation fix (objective 2) must not change behavior for callers that already pass pre-resolved numeric commands.

## Concrete implementation plan

Work is staged so the highest-confidence correctness fixes land first and independently.

### Stage A — Coverage holes (objective 1)

1. **Locate the generation path for `preset-shape-data.json`.** The file header says it is "extracted from ECMA-376 `presetShapeDefinitions.xml`." Find the extractor/generator (search the workspace and `package.json` scripts; `fast-xml-parser` is a devDependency of this package, which suggests an in-tree extraction script). **Do not hand-edit the 686 KB JSON** — fix at the source so the catalog stays reproducible.
2. **Add `upArrow` geometry** by ensuring the extractor includes it from the canonical OOXML preset definitions (it is a standard ECMA preset; its omission is an extraction gap, not a missing spec). Regenerate the JSON via the located generator.
3. **Resolve `textBox`.** Decide (product question — see Risks) whether `textBox` is geometry (a plain rectangle, alias to `rect`) or a pure text container rendered without engine geometry. If geometry: register a `rect`-equivalent generator. If container: add it to an explicit, documented allow-list excluded from the totality invariant, and ensure consumers never call `generateShapePath('textBox')`.
4. Verify post-fix that the union-vs-catalog diff is empty except for any documented allow-list.

### Stage B — Custom-geometry correctness (objectives 2, 3)

5. **Wire guide evaluation through `customGeometryToPath`.** Replace the discarded `evaluateGuides(...)` call with a real resolution step: evaluate guides into a map, then resolve any unresolved string/guide-referencing coordinates against it before scaling. Because the internal `CustomPathCommand` is already numeric, the fix is to make the public path that accepts OOXML guides actually resolve through the guide map (mirroring `spec-presets.ts`’s `resolveOoxmlPath(commands, guideMap)` usage), rather than computing the map and ignoring it. Preserve numeric-passthrough behavior for callers who pre-resolved.
6. **Degenerate-arc handling.** In the `arcTo` branch, when `rx===0||ry===0`, emit a `lineTo` to the arc endpoint instead of `break` (which currently leaves a discontinuity).
7. **Preserve per-subpath fill/stroke + fill mode.** Extend the subpath assembly so each `SubPath` carries its source path's `fill` mode and `stroke` flag (subject to the contracts-package coordination below). Where the `Path`/`SubPath` contract cannot yet hold this, define a minimal additive field and gate the renderer changes to a follow-up; do not silently flatten shading. Keep the current `closed` derivation.

### Stage C — Connection points (objective 4)

8. Add a registry map `connectionSites: Map<string, ConnectionSite[]>` and a `registerConnectionSites` / `getConnectionSites` pair in `presets/registry.ts`. A `ConnectionSite` is `{ angle, x, y }` where `x`/`y` are guide-resolved at generation time against `(w,h)` (the JSON stores them as formula strings, same evaluator as path coords).
9. In `spec-presets.ts`, parse `def.cxnLst` (already typed) and register resolved connection sites per shape. Export `getConnectionSites` from `index.ts`.
10. Coordinate with the connector-routing consumer (`straightConnector*`, `bentConnector*`, `curvedConnector*` live in this catalog; routing lives downstream) so the new data is actually consumed — otherwise land it as inert-but-correct data plus a typed accessor.

### Stage D — Metadata single-source-of-truth + invariants (objective 5)

11. Remove the bogus `cross` ratio/category registrations and the dead `upArrow` metadata (the latter becomes live once Stage A adds its geometry — keep the metadata then).
12. Derive metadata coverage from the catalog: after the registration loop, assert (in a dev-only/test path) that **every** registered generator has a category and a natural ratio, and that **every** metadata entry names a registered generator. This turns drift into a hard failure rather than silent `1.0`/`'fill'` defaults.
13. Keep ratios/scaling/unfilled as code (they are editorial choices, not in the OOXML XML), but colocate them next to the catalog load and validate them against `getAllPresetNames()`.

### Stage E — Text-inset fidelity (objective 6)

14. Add a geometry-derived default: compute the largest axis-aligned inscribed rectangle from the generated `Path` (using `@mog/geometry` `PathOps` for bounds/containment sampling) and use it as the inset when no explicit config exists, instead of the flat 5%. Keep the hand-tuned `compute`/`marginFraction` entries as overrides where they are intentionally better than the geometric default.
15. Ensure `computeTextInset` and `drawing-object-output.ts`’s inset mapping (`top/right/bottom/left`) stay consistent with the new defaults.

### Stage F — Diagnostics and cleanup (objectives 7, 8)

16. **`compareShapes`:** apply the `1e-6` tolerance to numeric array elements too (compare element-wise with the same tolerance branch used for scalars) before recursing.
17. **Delete the empty stub files** `presets/{arrows,callouts,flowchart,math,stars}.ts` and their side-effect imports in `shape-to-path.ts` (all content is consolidated into `spec-presets.ts`/`basic.ts`). Confirm nothing else imports them.
18. **Fix stale contracts:** remove or implement `getPreset`'s "Follows aliases" claim (decide whether a friendly-name→OOXML-name alias layer is wanted; if yes, add a real alias map and route `circle`/`pill`/etc. through it; if no, correct the comment). Fix the `createDrawingObject` docstring example from `'roundedRectangle'` to `'roundRect'`.
19. **`*/` (`muldiv`) semantics** and **guide-name vs built-in-variable shadowing**: audit against ECMA-376 and add focused tests; only change behavior if a real rendering discrepancy is demonstrated (lower confidence — keep as investigation, not a speculative rewrite).

## Tests and verification gates

This package uses **Jest / ts-jest** (`pnpm --filter @mog/shape-engine test`) and `tsc --noEmit` (`check-types`). All gates below are unit/CI gates; do not run them as part of authoring this plan.

1. **Totality gate (new):** parametrized test over the entire bridge-ts `ShapePreset` union asserting `isValidShapeType(member) === true` for every member (minus the documented allow-list). This test would currently fail on `upArrow` and `textBox` — it is the regression lock for objective 1.
2. **Metadata-completeness gate (new):** every `getAllPresetNames()` entry has a category and natural ratio; every ratio/scaling/unfilled/text-inset key is a registered preset. Locks objective 5; currently fails on `cross`.
3. **All-presets render gate:** for every registered preset at several aspect ratios (1:1, 2:1, 1:2, tiny, large), `generateShapePath` returns a non-empty, NaN-free, finite path with a non-degenerate bounding box. Reuse/extend `validateShape` + `generatePresetSummaryReport`; assert `Valid: N/N`.
4. **Guide-resolution test (objective 2):** a custom-geometry fixture whose path coordinates reference guide names produces geometry that depends on those guides (regression that fails against the current discard).
5. **Fill-mode / multi-path fidelity (objective 3):** snapshot the subpath structure (count, per-subpath `closed`, and new fill/stroke metadata) for `donut`, `noSmoking`, gears, and an action button; assert holes and shading distinctions survive.
6. **Connection-points test (objective 4):** representative shapes expose the expected number of connection sites at correct resolved coordinates; OOXML cxn count matches.
7. **Arc fidelity test:** degenerate `rx/ry` produces a connected path (line to endpoint), and a known quarter/half-arc matches expected sampled points within tolerance.
8. **Text-inset test (objective 6):** for a sample across categories, the inset box is fully contained within the generated path (point-in-polygon sampling), proving geometry-derived insets don't overflow.
9. **`compareShapes` tolerance test (objective 7):** two shapes whose numeric arrays differ by `< 1e-6` report `match: true`; differences `> 1e-6` still report.
10. **Catalog reproducibility (objective 1):** re-running the JSON generator yields a byte-stable file containing `upArrow`; CI check that the committed JSON matches a fresh generation.
11. **Downstream integration:** `mog/canvas/drawing/engine` shape-pipeline/hit-testing integration tests and `drawing-canvas/__tests__/integration.test.ts` still pass; add an up-arrow case to the insert/round-trip path if a fixture harness exists.
12. **Type + lint gates:** `check-types` clean; `import-boundaries` lint clean (no new disallowed deps).

## Risks, edge cases, and non-goals

**Risks / edge cases**
- **`preset-shape-data.json` is a generated artifact.** Hand-editing it would diverge from the source-of-truth and break reproducibility. The plan’s success hinges on locating the extractor; if it cannot be found in-tree, that is the first blocking investigation (see below) — the fix must still be upstream of the JSON, not a hand-patched blob.
- **`Path`/`SubPath` contract ownership.** Adding per-subpath fill-mode metadata (objective 3) touches `@mog-sdk/contracts/geometry`. If that type is frozen, the additive field must be coordinated with the contracts owners (cross-folder dependency) and the renderer updated in lockstep; otherwise shading fidelity lands as a typed-but-unconsumed field with a follow-up.
- **`textBox` semantics** are a genuine product decision (geometry vs text container) and gate whether the totality invariant lists an exception. Resolve before finalizing the totality gate.
- **Guide-resolution fix must be behavior-preserving** for the spec-preset path (which already resolves upstream) and for numeric-passthrough callers; the risk is double-resolution. Mitigate by resolving only unresolved/string coordinates.
- **Connection points** are only valuable if connector routing consumes them; landing inert data is acceptable but should be flagged so it isn’t mistaken for full connector fidelity.
- **Text-inset geometry derivation** (inscribed rectangle) can be expensive; keep it pure and cache-friendly, and retain hand-tuned overrides where the geometric default regresses a known-good shape.
- **Caching:** kernel caches `DrawingObject`s keyed on parameters; any change to default insets/fill changes cached output shape — ensure cache keys still capture all inputs.

**Non-goals**
- No new external runtime dependencies; no DOM/Canvas/React/Yjs.
- No reduction of the OOXML catalog, no test-only "fix" that masks the `upArrow`/`textBox` gap, no compatibility shim that maps `upArrow`→`rect`.
- No rewrite of the guide-formula evaluator beyond the demonstrated `*/`/shadowing audit.
- No renderer rework beyond what objective 3 strictly requires.

## Parallelization notes and dependencies on other folders

- **Independent, can start immediately:** Stage B (custom-geometry correctness), Stage F (diagnostics + stub/comment cleanup), and the test gates in Stage D that only read the registry. These are self-contained within `src/`.
- **Depends on the JSON generator (external to `src/`):** Stage A (`upArrow`, `textBox`) and Stage C (`cxnLst`) require the `preset-shape-data.json` extraction pipeline; finding it is the prerequisite.
- **Depends on `@mog-sdk/contracts` owners:** Stage C accessor types and Stage B objective 3 (per-subpath fill metadata) — coordinate type additions; see plans covering `types/` and `contracts/`.
- **Depends on / informs downstream consumers:** `mog/kernel` (`shape-computation`, `object-store`), `mog/canvas/drawing-canvas` (renderers), `mog/canvas/drawing/engine` (hit-testing/pipeline), and `mog/canvas/drawing/diagram` (SmartArt). Fill-mode and connection-point work should be sequenced with the renderer and connector-routing folders so new data is consumed, not stranded.
- **Bridge-ts dependency:** the totality gate reads the generated `ShapePreset` union (`mog/infra/rust-bridge/bridge-ts/generated/ooxml-types.ts`); a future union change (adding/removing a preset) should automatically pressure-test this package via that gate.

## Blocking-investigation fallback (if evidence proves insufficient mid-implementation)

The folder exists and evidence is strong, so this is not a blocked plan. The one genuine unknown is **where `preset-shape-data.json` is generated**. If the extractor cannot be located in-tree, the smallest investigation is: (a) grep build scripts and `package.json`s for the consumer of `fast-xml-parser` and `presetShapeDefinitions`; (b) if no in-repo generator exists, document the provenance of the JSON and treat re-generation as a new, owned tool before adding `upArrow`/`cxnLst` — never hand-patch the artifact. All other objectives have concrete, in-`src/` evidence cited above and do not depend on this.
