Rating: 8/10

# Review of 082-kernel-src-domain-drawing.md

## Summary judgment

This is a strong, evidence-grounded plan for hardening the kernel drawing domain (`mog/kernel/src/domain/drawing`). Nearly every concrete claim it makes about the current code checks out against source, and the bugs it targets are real rather than speculative. It correctly separates the domain layer from rendering/UI, preserves the right persistence invariants (Rust storage as source of truth, runtime `Map` vs wire `Record`), and proposes a sensible tests-first sequencing with accurate verification gates. The main weaknesses are breadth and scope-bundling: it folds genuine domain-hardening (anchoring, codec, cache, hit-testing) together with larger product features (recognition-to-real-object conversion, cross-package spatial index unification) and some speculative items, without sharply ranking which are bug fixes vs. nice-to-haves. A few proposed contracts are sketched rather than fully specified.

I verified the plan's factual basis directly against the source. The accuracy is high, which is the single biggest reason for the rating.

## Major strengths

- **Claims are true to the code.** Spot-checks confirmed:
  - `drawing-manager.ts:110` persists `toCellId('__placeholder__')` as a fallback anchor with a `console.warn`, exactly as the plan describes (objective 1).
  - The worksheet creation path passes `null` as the resolver: `kernel/src/api/worksheet/operations/drawing-operations.ts:114` — `null, // Resolver not needed when position.from is provided by caller`. The plan's diagnosis of the caller mismatch is precise.
  - `moveDrawingStrokes`/`transformDrawingStrokes` live in worksheet operations (lines 172, 205), mutate stroke points inline, and manually call `invalidateSpatialIndex(drawingId)` after persistence (lines 198, 288) — confirming the "mutation split across layers" problem (objective 2).
  - `transformDrawingStrokes` derives `centerX/centerY` from `(minX+maxX)/2` where `minX=Infinity`/`maxX=-Infinity` when no strokes match → `NaN` center. The plan's "do not derive centers from Infinity/-Infinity" risk is a real, reachable defect (step 5).
  - `moveDrawingStrokes` returns `{ ...drawing, strokes }` with **no `updatedAt` change**, while `addStrokeToDrawing` sets `updatedAt: Date.now()` — confirming the inconsistent-`updatedAt` motivation (objective 2, invariant on `updatedAt`).
  - `drawing-operations.ts:32` is a module-level `spatialIndexCache = new Map<string, ISpatialIndex>()` keyed only by drawing ID, with no dispose/version signal — the stale-cache risk for remote hydration/undo is genuine (objective 4).
  - `ink-recognition-bridge.ts:83` accesses `if ('Handwriting' in window)` inside `recognizeText` with **no `typeof window` guard** (line 103 guards a *different* method), so the recognize path throws `ReferenceError` in Node — confirming objective 6 / the host-safety invariant.
  - `getDrawingAtPoint` iterates `drawings` in reverse array order, not z-index (line 399); `findStrokesInLasso` only tests points-inside-polygon, not segment crossings (line 168/283); `findStrokesInRect` does a bare `index.query` with no `intersects`/`contains` distinction (line 183); `getOrderedStrokes` sorts by `createdAt` with no stable tie-breaker (line 438). All four match the plan.
  - A duplicate grid spatial index exists in both `domain/drawing/spatial-index.ts` and `canvas/spatial/src/grid-index.ts`, supporting the "divergent kernel-only index" claim (objective 4 / step 6).
- **Correct architectural framing.** It treats the folder as domain-only, keeps Rust storage authoritative, and respects the `Map`(runtime)/`Record`(wire) split. The non-goals ("don't move rendering/React/DOM into kernel", "don't make mog depend on mog-internal") are the right guardrails.
- **Tests-first sequencing with honest acknowledgement of thin coverage.** The plan accurately notes existing coverage is mostly in `bridges/__tests__/ink-recognition-bridge.test.ts` and shape e2e, and front-loads pinning tests before refactors.
- **Verification gates are concrete and correct** — per-package `pnpm test`/`pnpm typecheck` from the right directories, root typecheck for cross-package contract changes, and `cargo test/clippy -p compute-core` gated specifically on wire/storage struct changes.

## Major gaps or risks

- **Scope is very large and bundles bug fixes with features.** Eleven implementation steps, six parallel workers, touching kernel domain, worksheet API, compute mapper, three canvas packages, app ink systems, and potentially Rust. The genuinely high-value, low-risk fixes (anchoring, `updatedAt` consistency, `NaN` transform center, window guard, codec validation, deterministic ordering) are buried alongside speculative work (full-containment lasso "for future selection behavior", migrating to a shared spatial index that the plan itself flags can change candidate ordering across charts/canvas/ink). There is no explicit priority ranking, so a worker could spend effort on the high-blast-radius items first.
- **Recognition-to-real-object conversion is a product feature, not domain hardening.** Steps 8 and 11 ask to make shape/text recognition create real worksheet objects "transactionally or undo-safe" through worksheet APIs. That is a meaningful feature with its own design surface (undo grouping, partial-failure rollback) being smuggled into a domain-cleanup plan. It deserves its own plan or at least an explicit "phase 2, separable" label.
- **Some proposed contracts are sketched, not specified.** The mutation result `{ drawing, changedStrokeIds, removedStrokeIds, affectedBounds, didChange }` and the codec functions (`serializeDrawingObject`/`deserializeDrawingObject` etc.) are named but their error model is left open ("reject or diagnose mismatches" — throw vs. return a diagnostic?). For a "verified boundary," the failure semantics (throw `KernelError`? drop bad strokes? quarantine?) should be pinned, since imported/legacy documents will hit them.
- **The shared-index migration risk is acknowledged but under-mitigated.** The plan says public query results need deterministic ordering "independent of map/set iteration" and offers contract tests comparing kernel vs. shared index — good — but doesn't state what the canonical ordering *is* (z-order? insertion? stroke id?), leaving the determinism contract itself unspecified.
- **The dependency chain is largely serial despite being sold as parallel.** Workers B–F mostly depend on Worker A's codec/mutation contracts landing first, so the "parallel workstreams" framing oversells achievable concurrency.

## Contract and verification assessment

- **Contract clarity: good, with gaps.** The invariants section (lines 91–109) is the strongest part — `position`/`anchor` equivalence, key-must-equal-`stroke.id`, no false negatives from broad-phase, drawing-local coordinate boundary, metadata survival across transform/serialize/undo/sync. These are testable and correct. What's missing is the *error contract* for the codec and the *ordering contract* for spatial queries (see gaps above).
- **Verification gates: strong.** Commands are specific, directory-scoped, and conditionally applied (Rust only on wire changes; canvas packages only when touched). UI changes correctly require real pointer/keyboard browser exercise. The plan respects the queue's prohibition on running commands during planning. One omission: it does not name a concrete acceptance check for the headline anchoring fix beyond "regression tests that no production create path persists `__placeholder__`" — a good assertion, but it should also assert the resolver-backed path produces a `from.cellId` that round-trips through the mapper.
- **Completeness: high for the domain folder, over-reaching beyond it.** Every file in the folder is addressed with a specific objective. The over-reach is into app/recognition feature territory.

## Concrete changes that would raise the rating

1. **Add an explicit priority tier** separating "confirmed bugs, land first" (placeholder anchor, `resolver:null` mismatch, `NaN`/Infinity transform center, missing `updatedAt` on move/transform, unguarded `window` in `recognizeText`, stale module-level spatial cache) from "improvements" (lasso full-containment mode, shared-index migration, recognition conversion). Tie each confirmed bug to its file:line.
2. **Carve recognition-to-real-object conversion (steps 8 partial, 11) into a separate dependent plan** or mark it explicitly as a separable phase with its own undo/rollback design, so the domain-hardening core can land independently.
3. **Specify the codec error model**: define whether `deserializeDrawingObject` throws, drops, or quarantines on key≠`stroke.id`, non-finite coordinates, or missing tool settings — and assert the chosen behavior for legacy/imported documents in tests.
4. **State the canonical spatial-query ordering contract** (the deterministic order callers can rely on) before proposing the shared-index migration, and gate the migration behind the comparison contract tests passing.
5. **Right-size the parallelization claim**: present Worker A (codec + mutation contracts) as a blocking prerequisite and the rest as a mostly-serial chain, rather than five independent streams.
6. **Tighten the anchoring acceptance gate** to assert the resolver-backed create path yields a real `CellId` that survives serialize → wire `Record` → mapper hydration, not only the negative "no `__placeholder__`" assertion.
