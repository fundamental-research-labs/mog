Rating: 8/10

Summary judgment

This is a strong, source-grounded plan with the right architectural instinct: make `@mog/drawing-engine` own a canonical drawing scene contract instead of leaving z-order, grouping, anchors, spatial queries, renderer traversal, and diagnostics as adjacent helper conventions. The plan accurately identifies current production sinks through `kernel/src/domain/drawing/spatial-operations.ts`, `canvas/drawing-canvas`, and the shape/ink/diagram/text-effects producers, and it correctly treats renderer parity and structured diagnostics as production contracts rather than unit-test cleanup.

The rating is not higher because the plan is still too broad in a few places where the implementation needs exact contracts before parallel agents can safely proceed. The scene model, render plan, support matrix, and migration path are directionally right, but they need sharper API shapes, acceptance criteria, and sequencing around existing callers.

Major strengths

- Correctly identifies the main architectural mismatch in this folder: the root package comment claims pure computation while renderer exports use Canvas/SVG/DOM concepts, including `document` access in Canvas effect support. The proposed pure-composition versus explicit-render-host boundary is the right framing.
- The plan is production-path relevant. It ties drawing-engine changes to the kernel wrapper, drawing-canvas scene graph, renderer consumers, and shape/ink/diagram/text-effects output rather than optimizing isolated helpers.
- The z-order and grouping objectives are well chosen. Current helpers use multiple local numeric sorts and flat `groupId` scene metadata, so a total ordering contract and first-class hierarchy would reduce real ambiguity across rendering, hit testing, and selection.
- The anchor section is concrete and evidence-backed. `positionToAnchor()` does hardcode XLSX row/column limits, and the plan correctly turns that into an explicit sheet-extent and edge-policy contract.
- The renderer/support-matrix section is systematic. It maps against the canonical `DrawingObject` fields and names the current silent approximations around pattern fills, image fills, compound strokes, reflection, text, child bounds, effects, and 3D wiring.
- Verification is broad and mostly aligned with risk: package tests, type gates, adjacent package tests, kernel wrapper tests, and UI/browser verification through real interaction paths.

Major gaps or risks

- The canonical scene model is underspecified. The plan needs exact decisions for object/group ID namespaces, whether groups are scene items or separate hierarchy nodes, how `DrawingSceneItem.group` metadata relates to `DrawingScene.groupHierarchy`, whether bounds are authoritative or derived from anchors, and how selection state represents drill-in without selecting both ancestors and descendants.
- The migration path is too abrupt. “Do not introduce compatibility shims” is reasonable as a long-term invariant, but existing production callers have flat scene objects and thin kernel wrappers. The plan needs explicit adapter boundaries and a staged adoption sequence that converts current state into the canonical model without preserving invalid state as a second source of truth.
- The render plan is directionally strong but not contract-complete. It should specify the normalized tree fields, traversal order, world-transform math, clip inheritance, child z-order rules, bounds inflation policy per stroke/effect/3D/text feature, deterministic SVG ID namespace inputs, and how Canvas/SVG/hit-test consume the plan without diverging again.
- “Complete fill, stroke, and effect support systematically” is scoped correctly but not sequenced tightly enough. Some fields may need external resolvers, geometry offset support, text layout ownership, image lifecycle handling, or visual regression harnesses. The plan should split “implemented”, “diagnosed unsupported”, and “known approximate with capability flag” into explicit milestone acceptance criteria.
- Diagnostics are well motivated but need a typed report schema in the plan, including stable issue-code names, severity semantics, object/group/path location format, safe-to-render/export/persist rules, and whether normalization operations are allowed to auto-fix versus only report.
- The verification gates list relevant packages but lacks concrete scenario names or golden fixtures for the highest-risk behavior: scene render order versus hit-test order, nested group selection, SVG viewBox/cropping, effect inflation, XML ID collision, and Canvas state isolation after errors.

Contract and verification assessment

The plan’s invariant list is the best part of the specification. It covers dependency direction, deterministic pure composition, total z-order, acyclic hierarchy, selection exclusivity, anchor sheet extents, layout immutability, render state isolation, SVG escaping/ID determinism, and unsupported-feature diagnostics. Those are the right contracts for this folder.

The remaining contract weakness is that many invariants are stated as goals rather than typed interfaces plus observable pass/fail behavior. Before implementation, the plan should add a short “contract spec” for `DrawingScene`, `DrawingSceneOperationResult`, z-order comparison, group operations, anchor options, render-plan nodes, support status, and diagnostic reports. Each contract should say which existing helper APIs remain low-level, which root exports become the production path, and what callers must stop doing.

The verification gates are appropriately production-oriented and obey the repo’s testing philosophy, especially the requirement for drawing-canvas UI/browser verification through real input paths. To make them verifiable instead of aspirational, the plan should name the exact unit suites, integration fixtures, and browser flows that prove the canonical contract end to end. For renderer parity, tests should include structured SVG/XML assertions plus canvas-pixel or visual-regression checks for selected effects and bounds inflation.

Concrete changes that would raise the rating

- Add an explicit API sketch for `DrawingScene`, `DrawingSceneItem`, group nodes, selection state, operation results, render-plan nodes, support status, and diagnostic reports, including stable issue codes and location paths.
- Insert a Phase 0 milestone that produces the written scene/render/support contracts and a small set of failing contract tests before broad implementation starts.
- Replace the broad implementation order with staged vertical slices: z-order total order, group hierarchy adapter, anchor extent options, one render-plan-backed object, then full support-matrix expansion.
- Define the migration path for `canvas/drawing-canvas/src/scene` and `kernel/src/domain/drawing/spatial-operations.ts`: which adapters are temporary, which source of truth wins, and what invalid states become compile-time or diagnostic failures.
- Specify acceptance tests for the production scene contract: one mixed scene containing grouped objects, anchors, duplicate z-index input normalization, hidden/locked objects, a transformed child, stroke/effect inflation, SVG output, Canvas rendering, and hit testing with the same topmost result.
- Clarify renderer ownership dependencies, especially text layout, image fill resolution, compound stroke geometry offsets, DOM-less Canvas filter hosts, and whether tight path bounds come from `@mog/geometry` before drawing-engine code depends on them.
