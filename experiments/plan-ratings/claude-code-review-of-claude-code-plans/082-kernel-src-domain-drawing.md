Rating: 8/10

# Review of Plan 082 — Harden the Kernel Drawing/Ink Domain


## Summary judgment

This is a strong, unusually well-grounded plan. I spot-checked nearly every factual
claim it makes against the actual source in `mog/kernel/src/domain/drawing`, and they
hold up: `generateObjectId()` really is `drawing-${Date.now()}-${Math.random()...}`
(`drawing-manager.ts:57`), `normalizePosition` really fabricates a
`toCellId('__placeholder__')` anchor with a `console.warn` (`drawing-manager.ts:108-112`),
`spatialIndexCache` really is a process-global `Map<string, ISpatialIndex>` keyed only by
drawing id with no version (`drawing-operations.ts:32-59`), `recognizeText` really calls
`'Handwriting' in window` without the `typeof window !== 'undefined'` guard that
`isTextRecognitionAvailable()` correctly applies (`ink-recognition-bridge.ts:83` vs
`:103`), the serialization block really is duplicated in `createDrawing`
(`drawing-manager.ts:252-256`) and `persistDrawing` (`api/.../drawing-operations.ts:79-84`),
`findCorners` really iterates `i = 2 .. length-3` and drops endpoint corners
(`ink-recognition-bridge.ts:635`), rectangle/triangle `rotation` really is hard-coded `0`
(`:376`, `:433`), `getOrderedStrokes` really sorts only on `createdAt` (`drawing-operations.ts:438`),
`isStrokeInPolygon` really only tests stroke *points* for interior containment
(`drawing-operations.ts:283-291`), `getCellsForBounds` really enumerates every overlapped
50px cell with no guard (`spatial-index.ts:74-86`), the barrel really re-exports two
spatial-index factories (`index.ts:4,6`), and `SHAPE_RECOGNITION_THRESHOLDS` really is dead
relative to the analyzer — the bridge consumes only contracts'
`DEFAULT_RECOGNITION_THRESHOLDS`, and the constant is referenced only by its own file,
`internal.ts`, and a types file, never by `analyzeForShapes`. The hard-coded `< 0.3`
intermediate cutoffs are present in every analyzer. The referenced `errors/api` family and
`KernelError` exist (`mog/kernel/src/errors/`).

That accuracy is the plan's defining quality. It diagnoses real, specific defects, ranks
them honestly by production impact (1–5 correctness, 6–8 quality), preserves the storage
and interface contracts explicitly, and pairs each step with a targeted test. It is a
genuine production-path plan, not a test-only shim.

## Major strengths

- **Evidence-based diagnosis.** Every problem cited maps to a real line of code. The
  collaboration-staleness argument for the cache (a remote stroke add mutates
  `drawing.strokes` without any local `invalidateSpatialIndex` call) is correct and is the
  single most valuable insight in the plan.
- **Contract discipline.** The "contracts and invariants to preserve" section is precise:
  Map↔Record boundary as single source of truth, `DRAWING_OBJECT_SCHEMA` field/`valueType`
  immutability, `IInkRecognitionBridge`/`ISpatialIndex` method-shape stability, and the
  app-agnostic (no-DOM) invariant. It correctly flags that contracts edits force a
  `@mog-sdk/contracts` rebuild before consumers typecheck.
- **Test plan is concrete and 1:1 with steps.** The staleness test ("add a stroke to a new
  `DrawingObject` instance with the same id without calling `invalidateSpatialIndex`") is
  exactly the regression that would catch the bug it targets.
- **Honest risk register.** Calls out the recognition-snapshot regression risk, the
  optional-param arity risk, and the "don't hash all strokes per query" trap for the cache
  version signal.
- **Correct consumer mapping.** The lockstep worksheet caller (`persistDrawing`,
  `invalidateSpatialIndex` calls at lines 198/288) and the `floating-object-mapper.ts`
  inverse are correctly identified.

## Major gaps or risks

1. **Step 1 vs Step 2 are coupled, and the plan doesn't fully reconcile them.** Step 2's
   recommended cheap version signal is `updatedAt + strokes.size`. But Step 1 wants
   `updatedAt` to become an injected per-transaction `now`. Two mutations within one
   transaction (e.g. erase then re-add, or two adds offset by a delete) can share the same
   threaded `now` *and* the same `strokes.size`, yielding a colliding version → a stale
   index served as fresh. The plan mentions an "explicit revision counter" as an
   alternative but never commits to it. Given Step 1 deliberately removes the wall-clock
   monotonicity the size+timestamp scheme leans on, the revision counter should be the
   primary recommendation, not a parenthetical.

2. **Composite cache key (`${sheetId}:${id}`) has an unflagged call-site ripple.** Step 2
   proposes keying by sheet+id, but `invalidateSpatialIndex(drawingId)` is today called
   with a bare id from both `drawing-manager.ts` (lines 280/309/326) and the worksheet ops
   layer (lines 198/288), and `clearDrawingStrokes`/`addStrokeToDrawing` only have
   `drawing.id` in hand without guaranteed `sheetId` context at the invalidation point. A
   composite key silently breaks invalidation at any call site that still passes a bare id
   — the cache would keep a stale entry under the composite key while the bare-id delete
   misses. The plan should either change `invalidateSpatialIndex`'s signature (and audit
   all callers) or justify why bare-id invalidation still works. As written this is a
   latent correctness regression introduced by the fix.

3. **The recognition port (Step 5) is architecturally vague.** The immediate
   `recognizeText` guard fix is crisp and correct. But the `HandwritingRecognitionPort`
   injection — "via the existing bridge-construction path" — never names that path, where
   the bridge is constructed, or how the port threads through `kernel-context.ts`. The
   verification gate doesn't prove the port either. This step risks landing only the
   minimal guard while the "restore the app-agnostic invariant" objective quietly slips.

4. **Step 8 defers the actual decision.** "Decide one owner" with an external coordination
   dependency on the `@mog/ink-engine` folder owners is reasonable to defer, but it leaves
   the most architecturally consequential step non-actionable and at risk of stalling the
   whole track. A recommended default (e.g. "kernel grid index stays storage-side; stop
   re-exporting the engine index from this barrel") would raise actionability.

5. **Oversized-bounds remedy is under-specified.** Step 9 proposes an "oversized overflow
   list checked on every query" but gives no threshold and no analysis of the query-time
   cost of scanning that list on every `queryPoint`/`query`. For erase/lasso hot paths this
   tradeoff matters and should be quantified or bounded.

## Contract and verification assessment

The contract analysis is the best part of the plan and is accurate. The storage-schema
immutability constraint, the `IInkRecognitionBridge`/`RecognitionThresholds` preservation
(keeping `DEFAULT_RECOGNITION_THRESHOLDS` as the contract default), and the read-query
signature stability are all correctly stated and match the code. The new invariants
(stable total stroke order, no placeholder anchors, version-bounded cache entries) are
well chosen and each is independently testable.

Verification is solid at the unit level — ten new tests, each tied to a step, plus the
named existing suites to keep green. Two soft spots: (a) the app-eval/api-eval gate is
hedged ("if any exercise ink creation/erase end-to-end") rather than resolved by checking
whether such scenarios exist; and (b) no gate proves the Step 5 port wiring or the Step 8
consolidation actually removed the duplicate from the barrel — both are architectural
outcomes a unit test won't catch. The Step 1 determinism test ("identical objects across
runs") is good but should explicitly assert that the *default* path (no injected clock)
also does not silently fall back to `Date.now()`, otherwise the objective is only half-met.

## Concrete changes that would raise the rating

- Commit to a monotonic stroke-revision counter as the cache version signal and state
  precisely how it is bumped, resolving the Step 1/Step 2 coupling rather than leaving two
  options.
- Make the cache-key change in Step 2 include a call-site audit: change
  `invalidateSpatialIndex`'s signature to carry sheet context, or drop the composite key.
  Either way, name every current caller (drawing-manager lines 280/309/326; worksheet ops
  198/288) and how each is updated.
- Name the bridge-construction site and the `kernel-context` injection path for the
  `HandwritingRecognitionPort`, and add a verification step that constructs the bridge with
  a stub port in a non-DOM test.
- Pick a recommended owner for the spatial-index consolidation (with a fallback if owner
  coordination stalls), and add an assertion/grep gate that the barrel exports exactly one
  factory.
- Specify the oversized-stroke cell-count threshold and bound the overflow-list query cost.
- Strengthen the Step 1 determinism test to assert the no-injection default path is itself
  deterministic (no hidden `Date.now()`/`Math.random()` fallback).
