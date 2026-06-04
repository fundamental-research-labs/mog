Rating: 8/10

# Review of Plan 048 — Shape geometry and preset fidelity coverage (`@mog/shape-engine` source)

## Summary judgment

This is a strong, evidence-driven plan. Nearly every concrete factual claim I spot-checked against the source is accurate, and the bugs it targets are real, production-relevant correctness defects rather than cosmetic cleanup. The scope is precise (file-by-file), the invariants are well-chosen and testable, the staging is sensibly ordered by confidence, and the risk section is honest about cross-folder dependencies. It loses points for two notable investigation misses — both directly material to its two highest-effort stages (A and C) — that mean the plan reinvents or under-credits infrastructure that already exists in-tree. These don't invalidate the plan, but they would change how Stage A and Stage C are executed and they undercut the plan's own "blocking investigation" framing.

## Verification of claims (read-only)

Confirmed true against the source:
- **Coverage holes:** `preset-shape-data.json` has exactly 186 keys; `upArrow` and `textBox` are both absent (`jq has(...) === false`), while `leftArrow`/`rightArrow`/`downArrow` are present. The `ShapePreset` union in `bridge-ts/generated/ooxml-types.ts` does include both `upArrow` and `textBox`. The 188-vs-186 gap is real.
- **Dead guide evaluation:** `custom-geometry.ts:349` calls `evaluateGuides(guides, shapeWidth, shapeHeight)` and discards the return value; the "ISSUE 1 FIX" comment is present and the result is genuinely unused.
- **`compareShapes` tolerance gap:** `diagnostics/comparators.ts` applies the `1e-6` tolerance only to top-level scalars. For arrays it does `if (sv[i] !== tv[i]) compareShapes(sv[i], tv[i])`, and recursing two numbers hits the `typeof !== 'object'` branch, which does strict `!==` and pushes a `(root)` diff. Float noise in numeric arrays does produce spurious differences exactly as described.
- **Stub files:** `presets/{arrows,callouts,flowchart,math,stars}.ts` each contain only the stub comment.
- **Dead/incorrect metadata:** `cross` and `upArrow` are both registered in `spec-presets.ts` (ratio/category/text-inset lists at lines ~63/90/415/520/844) despite having no geometry. `getPreset`'s "Follows aliases" comment exists (`registry.ts:193`) with no alias mechanism. `drawing-object-output.ts:45` docstring uses `'roundedRectangle'`.
- **Connection data unused:** 172 of 186 catalog shapes carry a non-empty `cxnLst`; `JsonConnectionPoint`/`cxnLst` are typed in `spec-presets.ts` but never registered or exposed.
- **Text inset fallback:** `text-in-shape.ts` confirms a flat 5% `marginFraction` default for unconfigured shapes.

This level of corroboration is the plan's biggest asset — the diagnoses are trustworthy.

## Major strengths

- **High-confidence, correctly-diagnosed defects.** Objectives 1, 2, 7, and 8 are concrete, line-cited, and verified. The guide-discard and `compareShapes` array bugs are subtle and the plan reasons about them precisely (including *why* spec-presets are unaffected by the guide bug because they resolve upstream).
- **Good invariant design.** The two new gates — `ShapePreset` ⇒ generator totality, and "no metadata for non-shapes" — turn the exact drift that already exists (`upArrow`, `textBox`, `cross`) into hard CI failures. These are the right durable contracts for a "single source of truth" package.
- **Architectural discipline on purity.** It repeatedly insists new data (connection points, fill metadata) stay pure and that rendering decisions belong to consumers, and it names the `import-boundaries` lint. It correctly flags that objective-3 fill metadata touches `@mog-sdk/contracts` and may land typed-but-unconsumed.
- **Honest sequencing and parallelization.** Stages are ordered so independent, in-`src/` correctness fixes (B, F) land first; cross-folder/generator-dependent work (A, C) is isolated. The "land inert-but-correct data plus a typed accessor" fallback for connection points is pragmatic.
- **Verification gates map 1:1 to objectives**, including a catalog-reproducibility/byte-stability gate and downstream integration checks.

## Major gaps or risks

- **The plan's central "unknown" is already answered in-tree, and it missed it.** The plan devotes its entire "Blocking-investigation fallback" section to *finding where `preset-shape-data.json` is generated*, hypothesizing an in-tree script "since `fast-xml-parser` is a devDependency." In fact `mog/canvas/drawing/shapes/scripts/extract-preset-shapes.py` is the extractor. The inference was also wrong: `fast-xml-parser` is used by a *different* script (`extract-connection-points.ts`), not the preset extractor. This is good news for feasibility (Stage A's prerequisite is satisfiable), but it means the plan's risk framing is built on an investigation it didn't complete. Stage A should be rewritten to say "regenerate via `scripts/extract-preset-shapes.py` and confirm whether the ECMA source it reads contains `upArrow`," not "locate the generator."
- **Stage C reinvents existing connection-point infrastructure.** The plan declares `@mog/geometry` out of scope and proposes a *new* `ConnectionSite = {angle,x,y}` type plus a `connectionSites` registry map in `presets/registry.ts`. But `mog/canvas/drawing/geometry/src/connection-points.ts` already defines `ConnectionPointDef`, `ShapeConnectionData`, `resolveConnectionPoints`, `resolveConnectionPointsWithInfo`, and `snapToNearestConnectionPoint`, and `scripts/extract-connection-points.ts` already exists. Stage C as written risks a parallel, diverging type and duplicated extraction logic. It should instead integrate with the existing geometry module and extraction script — this is an architectural-fit miss that changes the shape of the work.
- **Objective 6 (geometry-derived text insets) is the weakest/most speculative item.** Computing "the largest axis-aligned inscribed rectangle" from an arbitrary `Path` via sampling is a non-trivial, potentially expensive subproblem with accuracy/performance trade-offs, and the plan treats it lightly relative to the verified bugs. It does retain hand-tuned overrides, but this objective could become a rabbit hole disproportionate to its fidelity payoff. It should be explicitly de-prioritized below the verified correctness fixes or scoped to a cheaper heuristic.
- **`textBox` resolution is a genuine open product decision** that gates the totality gate's allow-list. The plan acknowledges this but leaves the gate's final shape contingent on an unanswered question, which is a small soft spot in an otherwise crisp set of invariants.

## Contract and verification assessment

The contract section is above average: it pins the dependency boundary, the guide-formula operator/variable semantics (ECMA-376 §20.1.9.11), arc-fidelity behavior, determinism for the kernel `BoundedCache`, and backward-compatible normalization for `customGeometryToPath`. The totality and metadata-completeness invariants are precise and falsifiable, and the plan correctly predicts which gates fail today (`upArrow`/`textBox`, `cross`).

The verification plan is comprehensive and well-matched, with two caveats: (a) the connection-points test (gate 6) and Stage C should assert against the *existing* `@mog/geometry` resolution path, not a new map, or the test locks in a duplicated design; (b) the catalog-reproducibility gate (gate 10) is sound but now concretely depends on a Python extractor whose determinism (key ordering, formatting) should itself be confirmed before asserting byte-stability. The "do not run gates while authoring" instruction is appropriately observed.

## Concrete changes that would raise the rating

1. **Rewrite Stage A and the fallback section** to reference `scripts/extract-preset-shapes.py` as the known extractor, verify it is reproducible/deterministic, and confirm whether the ECMA source it parses actually contains `upArrow` (vs. a filter excluding it). Drop the "first blocking investigation" framing — it's resolved.
2. **Re-scope Stage C to integrate with existing infra:** reuse `@mog/geometry`'s `ConnectionPointDef`/`ShapeConnectionData`/`resolveConnectionPoints` and the existing `scripts/extract-connection-points.ts`, rather than introducing a parallel `ConnectionSite` type and `connectionSites` map. Explicitly reconcile what those scripts/modules already produce vs. what is still missing at runtime.
3. **Demote objective 6** below the verified correctness work, or replace the inscribed-rectangle computation with a cheaper per-category heuristic, with a measured performance budget noted.
4. **Resolve `textBox` up front** (geometry alias to `rect` vs. text container) so the totality gate's allow-list is concrete rather than conditional.
5. Minor: state explicitly that objective 3's per-subpath fill metadata will land behind the `@mog-sdk/contracts` owners' sign-off and name the follow-up that wires the renderer, so it isn't mistaken for completed shading fidelity.
