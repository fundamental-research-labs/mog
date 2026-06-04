Rating: 8/10

# Review of 047 - Canvas Drawing Engine Source Improvement Plan

## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every concrete claim it makes about the current source is verifiable in the public `mog/canvas/drawing/engine/src` tree, which gives the architectural argument real credibility rather than the hand-wavy "add a canonical layer" gestures that weaker plans rely on. The plan correctly diagnoses a coherent class of problems — multiple subsystems each accepting a slightly different object shape with no shared scene contract, ad-hoc z-order sorting, flat-vs-hierarchical group divergence between this package and `drawing-canvas`, hardcoded sheet limits buried in the anchor resolver, a renderer that crops bounds and silently degrades features, and string-only diagnostics. The contract/invariant section is the best part: it is precise, testable, and production-aware.

The main reasons it is not a 9–10: it is a very large, multi-package refactor justified largely on architectural cleanliness, with a hard "no compatibility shims" stance layered on top of a big-bang scene-model migration. The sequencing and landing strategy are under-specified relative to the blast radius, and there is no explicit MVP cut or acceptance threshold to bound the work or prove value early.

## Verification of the plan's factual claims

I spot-checked the plan against the source and the claims hold:

- `positionToAnchor()` does hardcode `hi = 16384` and `hi = 1048576` (`anchor/anchor-resolver.ts:90,104`). ✓
- Ad-hoc numeric sorts are scattered: `spatial/spatial-query.ts:69`, `diagnostics/reporters.ts:65`, `diagnostics/validators.ts:79`, `layout/distribute.ts:44`, plus the z-order manager itself. No shared tie-breaker. ✓
- Renderer approximations are real comments, not invented: text "deferred" and reflection "deferred" (`renderer/canvas.ts:15,116,120`), pattern fill "Simplified" (`renderer/fills.ts:188`), compound stroke "simplified approximation" (`renderer/strokes.ts:31,38`), SVG bevel "simplified" (`renderer/effects/svg.ts:62`). ✓
- SVG viewBox uses only `computePathBounds(obj.geometry)` — root geometry, no children/stroke/effect inflation (`renderer/svg.ts:105-115`). ✓
- `renderDrawingObjectToSVG()` passes only `node.effects` to `compositeEffectsToSVGFilter`, not `scene3d`/`sp3d` (`renderer/svg.ts:59-61`). ✓
- `renderer/effects/canvas.ts` touches `document` directly (`:362,367,377`) despite the package header claiming "no DOM" — a genuine boundary violation. ✓
- `drawing-canvas/src/scene/types.ts:172` stores flat `groupId: string | null`, exactly the flat-metadata divergence the plan calls out. ✓
- Group validation codes are basic (`'cycle' | 'empty' | 'orphan' | 'inconsistent'`, `group-manager.ts:43`); diagnostics partly structured (`DiagnosticIssue`) but `generateDrawingSummary` returns `string` (`reporters.ts:21`). ✓
- 20 test files exist, matching the plan's stated footprint. ✓
- `kernel/src/domain/drawing/spatial-operations.ts` is indeed a thin delegating bridge to `@mog/drawing-engine`. ✓

This level of accuracy is the plan's strongest asset and is rare among the plans in this experiment.

## Major strengths

- **Evidence-based diagnosis.** The problems are real and located, not speculative. The latent defects it names (SVG viewBox cropping transformed/shadowed content, 3D filters defined but not wired through the SVG orchestrator, `document`-dependency crashing worker/SSR/test contexts, flat-group vs hierarchy drift) are concrete user-facing or stability bugs, not just tidiness.
- **Excellent contract clarity.** The "invariants to preserve or strengthen" section reads like acceptance criteria: z-order is a total order with stable tie-breaking; group hierarchy acyclic with single parent and bidirectional map agreement; render/hit-test/SVG/bounds share one geometry-inflation rule; Canvas state must balance save/restore; SVG IDs deterministic and collision-safe. These are directly testable.
- **Production-path awareness.** It names the actual consumers (kernel bridge, `drawing-canvas` shape renderer, ink/diagram/text-effects producers) and respects dependency direction and package ownership (`@mog/geometry` for tight path bounds, `@mog/canvas-engine` for layer lifecycle, `@mog/spatial` + hit-map for the live index). The non-goals correctly forbid pulling specialized engines into drawing-engine or making it depend on app state.
- **Concrete verification gates.** The `pnpm --filter` test/check-types matrix across the eight affected packages plus kernel wrappers and E2E is runnable and matches the real workspace layout.
- **Sensible parallel decomposition** with the scene contract explicitly named as the first milestone gating the rest.

## Major gaps or risks

- **Scope and big-bang risk.** Nine implementation sections spanning four-plus packages, introducing a brand-new `src/scene/` integration layer (`DrawingScene`, `DrawingSceneItem`, `DrawingSceneOperationResult`) and a `src/renderer/render-plan.ts` tree, plus a near-rewrite of `group-manager.ts`. This is a quarter-scale effort presented as one plan. There is no phased "land section X, ship, then Y" path and no explicit minimal viable cut, so the risk of a long-lived branch that never fully integrates is high.
- **"No compatibility shims" vs. multi-package migration.** The plan repeatedly forbids shims and says to "let TypeScript force updates." Combined with a new canonical scene type that callers in kernel and `drawing-canvas` must adopt simultaneously, this pushes toward a synchronized breaking change across packages. That fights the parallel-slices intent and makes incremental review/landing harder. The plan should reconcile these: either allow a temporary adapter at the boundary (it half-does, in objective 3's "cached projection") or accept a coordinated cutover and say so explicitly.
- **Motivation/priority is implicit.** For a recently imported package with reasonable test coverage, the plan justifies most work on "canonical contract" cleanliness. The genuinely user-visible bugs (viewBox cropping, unwired 3D SVG filters, `document` crash) are buried inside the larger refactor rather than called out as a high-value, low-risk first slice that could ship independently of the scene-model bet. A reader cannot tell whether the scene model is necessary or gold-plating.
- **New types specified in prose, not signatures.** `DrawingSceneItem`/`DrawingScene`/the render-plan node are described by field names but without exact types, optionality rules, or how they relate to the existing `ZOrderedItem`/`SpatialObject`/`GroupHierarchy`/`SelectionState`. The migration story for those four existing shapes (deprecate? alias? delete?) is the crux of the cost and is left vague.
- **Unstated acceptance thresholds.** The verification gates list commands but no pass criteria, no "no behavior change for existing rendered output" snapshot/golden strategy, and no perf budget despite flagging that bounds inflation can affect dirty rectangles. A render refactor of this size needs visual-regression anchoring.

## Contract and verification assessment

Contract clarity is high at the invariant level and adequate-to-weak at the type/signature level. The proposed APIs (`compareZOrder`, `normalizeZOrder`, `anchorToBounds`/`boundsToAnchor` with explicit target type, `validateDrawingScene` returning a typed `DrawingDiagnosticReport` with safe-to-render/export/persist flags) are the right shapes and are clearly better than the status quo. The diagnostics direction — structured report as the primary contract, human-readable summary layered on top — is correct and matches what the code already half-implements.

Verification is well-chosen but heavy and unscoped. The eight-package test matrix plus repo-level `pnpm typecheck` plus real-input E2E is appropriate for the blast radius, but the plan should add: (1) golden/snapshot tests pinning current Canvas and SVG output so the render-plan refactor proves no unintended visual change, and (2) an explicit "ship section 6/7 renderer fixes independently" gate so the verifiable bug fixes are not held hostage to the scene-model migration. The render-plan parity tests (Canvas vs SVG vs hit-test traversal) are exactly the right idea and the highest-value new tests in the list.

## Concrete changes that would raise the rating

1. **Add a phased landing plan with a high-value first slice.** Pull the independently-shippable bug fixes — SVG viewBox inflation, wiring `scene3d`/`sp3d` through the SVG orchestrator, and making the `document` filter host injectable — into Phase 0 that lands before the scene model. These are low-risk, verifiable, and prove value early.
2. **Resolve the shim-vs-migration tension explicitly.** State whether the cutover is a coordinated breaking change (and which PRs land together) or whether the `drawing-canvas` `groupId` projection adapter is a sanctioned transitional layer. Right now the plan asserts both "no shims" and "provide an adapter."
3. **Specify the new types as signatures**, including the disposition of the four existing shapes (`ZOrderedItem`, `SpatialObject`, `GroupHierarchy`, `SelectionState`) — replaced, aliased, or composed — since that mapping is where the real cost lives.
4. **Add golden-output regression tests** for current Canvas/SVG rendering as a precondition to the render-plan work, plus a stated "no visual diff except documented bounds expansion" acceptance criterion.
5. **State priority/justification.** One or two sentences on why this package warrants a large refactor now (e.g., which shipping feature or recurring bug class it unblocks) versus the smaller bug-fix subset.
6. **Bound the renderer support matrix per phase.** Decide up front which fields get full implementation vs. a typed "unsupported" diagnostic in the first pass, so objective 7 cannot expand without limit.
