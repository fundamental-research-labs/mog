Rating: 9/10

# Review of Plan 042 — grid-canvas composition facade (`mog/canvas/grid-canvas/src`)


## Summary judgment

This is an unusually strong, evidence-grounded plan. I spot-checked the major factual claims against the live source and every one held up: `grid-renderer.ts` is exactly 2844 lines; the other file sizes match within ±1; the scheduler setters (`setPositionIndex`/`setMergeIndex`/`setCellExpander`) and the silent full-dirty fallback at `grid-render-scheduler.ts:66` exist as described; `totalFrames` is declared (`:965`) and read (`:2653`) but never incremented; `queueDepth` is hard-coded `0` (`:2654`); `needsFullDirty` is declared (`:1821`) and read (`:1949`) but never assigned `true`; the four `as`-casts in `buildSceneObject` (`shapeType as string`, `obj as unknown as {visible?}`, `fill.type as`, `verticalAlign as`) are all present; `updateContext` (`:2392`) silently drops keys without a handler (no `else`); the dual `gridCoords`/`coords` systems and the "kept for backward compat" comment are real (`:919`, `:933-934`); `getClippedCellContent` is a `null` stub (`:2662`); and the unconditional `markDirty('ui')` on selection (`:1114`) is there. The plan author clearly read the code rather than paraphrasing it.

The plan correctly identifies the central problem — a "thin facade" that has accumulated 2844 lines of non-facade responsibility — and proposes a sequenced decomposition (Phase A) that de-risks every subsequent correctness/precision objective by isolating each concern. It is explicitly a production-path plan, preserves the public contract, and is honest about which phases are cross-folder and which are behaviorally risky.

## Major strengths

- **Verifiable specificity.** Line-number citations are accurate, not decorative. This makes the plan auditable and lowers executor ambiguity dramatically.
- **Correct risk ordering.** Phase A (high-churn, low-semantic-risk) first to unblock parallelism; Phase G (coordinate convergence, "most behavior-sensitive") last behind golden tests. The A → (B,C,D,E,F parallel) → G dependency graph is sound and matches the actual coupling.
- **Strong invariant section.** The "over-paint safe, under-paint is a bug" framing for Phase E, the "allocation-free O(1) per field" hot-path constraint for `updateContext`, and the "`viewportLayoutToRegionLayout` is the only `RenderRegion` constructor" rule are the right load-bearing invariants and are tied to existing test suites.
- **Root-cause framing for the sheet-switch race (Phase C).** Correctly diagnoses that the click guards (`isObjectOnActiveSheet`) protect input but not the render frame, and proposes an epoch/generation guard at the source — the right fix, with a concrete interleaving regression test.
- **Honest cross-folder accounting.** Phase D (FloatingObject contract) and the `GridRendererStats` change in Phase F are flagged as contracts-owner-coordinated and gated on `pnpm --filter @mog-sdk/contracts build`, consistent with the declaration-rollup gotcha.

## Major gaps or risks

- **Several objectives defer specification to investigation.** Phase E ("Determine what the UI layer actually renders that depends on selection") and Phase G ("Either make `setScroll` a no-op… or route scroll through the region-layout path") leave the decision to the executor. This is defensible — the answer genuinely isn't derivable from this folder alone — but it means these phases are scoped as investigations, not specifications, and could balloon. The plan would be stronger if it named where that answer lives (the UI layer's render inputs in `@mog/grid-renderer`).
- **Phase D / F present "either A or B" forks without a decision criterion that the executor can apply unaided.** "Add the field to the contract OR add a narrowing helper" and "wire `totalFrames` OR remove from contract (pick wiring if a frame counter exists)" — the second gives a tiebreaker, the first doesn't. A consumer search for who reads `GridRendererStats.totalFrames`/`queueDepth` could have been done in the plan and would have resolved the fork.
- **Phase A's "< ~900 lines" target is an unjustified number.** With nine adapters, scene projection, and dirty-hint math extracted, the residual could land well above or below; the target reads as a guess. Better to define success by *what remains* (construction, registration, lifecycle, dispatch wiring, public methods) — which the plan does state — and drop the line-count figure or mark it indicative.
- **The compile-time exhaustiveness check for `RenderContextConfig` keys is marked "optional."** This is the single most valuable part of Phase F (it prevents the silent no-render class of bug permanently, vs. a runtime warning that only fires when the dev happens to exercise the key). It deserves to be the primary recommendation, with the `console.warn` as the fallback.
- **`computeContentSize` scrollbar-drift fix (cross-cutting) is hedged on an unverified assumption** ("if O(1)-available"). The plan doesn't confirm whether `positionIndex` exposes an accumulated custom-size delta. Left as a "consider," which is acceptable for a low-priority cleanup but means it may evaporate at execution.

## Contract and verification assessment

Contract clarity is excellent. The plan enumerates every `GridRenderer` method that must keep behavior, asserts `createGridRenderer` still returns the concrete subtype so `sheet-view` keeps reaching `getEngine()`/`getCellExpander()`/`getRenderScheduler()`, and commits to a byte-stable barrel export set. The dirty-hint superset invariant and WYSIWYG cell-style invariant are precisely stated and bound to named test files.

Verification gates are concrete and per-phase: existing suites stay green at each step; Phase A adds an exports/`tsc --noEmit` snapshot and re-points the projection test off prototype-poking to the extracted pure function; Phase B asserts in-facade wiring produces non-full hints and that the dev warning fires; Phase C has the interleaved-switch test; Phase D leans on `tsc` plus per-variant projection tests; Phase E extends the dirty-prevention suites with a rect-coverage property check; Phase G adds golden page-bounds/hit-test tests across single/freeze/split/overlay and zoom≠1. This is the right gate set. The one soft spot: the plan acknowledges dirty-rect bugs are "often invisible to unit tests" and prescribes a manual app-eval smoke, but doesn't specify capturing a visual baseline — for Phase E/G under-paint regressions a screenshot-diff smoke would be more reliable than a human eyeballing scroll/freeze/split.

## Concrete changes that would raise the rating

1. **Resolve the Phase F stats fork in-plan**: do the consumer search (`rg "\.totalFrames|\.queueDepth"` across `mog/views`, `apps/spreadsheet`) and state whether to wire or remove, rather than leaving it to the executor.
2. **Promote the compile-time `RenderContextConfig`-key exhaustiveness check to the primary Phase F deliverable**, demoting the runtime warning to the prod-safe fallback it already is.
3. **For Phase E, name the source of truth for UI-layer selection dependencies** (which package/file enumerates fill-handle / marching-ants / drag-fill render inputs) so the "determine what depends on selection" step is a lookup, not open-ended research.
4. **Replace Phase A's "< ~900 lines" with a residual-responsibility definition of done** (construction, layer/hit-test registration, lifecycle, dispatch wiring, public methods only) and drop or mark the number as indicative.
5. **Add a visual-baseline (screenshot-diff) step to the Phase E/G smoke**, since those are precisely the under-paint failure modes unit tests miss.
6. **Confirm (or explicitly defer with a flag) whether `positionIndex` exposes an O(1) custom-size delta** before listing the `computeContentSize` fix, so it doesn't silently drop at execution.

None of these are blocking; the plan is executable as written. They would move it from "excellent, with a few deferred decisions" to "fully specified."
