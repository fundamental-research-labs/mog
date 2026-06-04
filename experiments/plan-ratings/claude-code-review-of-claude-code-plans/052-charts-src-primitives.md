Rating: 9/10

# Review of Plan 052 — `mog/charts/src/primitives`


## Summary judgment
This is an unusually strong, evidence-backed plan. Every specific defect it names was verifiable in the source within minutes, and each cited the right file and the right line-level mechanism. It correctly frames the dominant production risk (a 6.3k-LoC render/scale/geometry subsystem with a single 19-line test file) and sequences the work so behavior is locked by tests before correctness edits land. It demonstrates real architectural awareness of the surrounding system — contract ownership in `@mog-sdk/contracts/bridges`, painter's-algorithm z-order in the batched renderer, Canvas/WebGL backend interchangeability, and the contracts declaration-rollup ordering gotcha. It is actionable and scoped without overreaching into the 40+ consumer files.

## Major strengths
- **Claims are true.** Spot-checks against source confirmed each headline bug:
  - `boundsForMark` returns `{x, y, width: 1, height: 1}` for path/symbol/text (`canvas-renderer.ts:123`), so gradient fills on those marks collapse — exactly as stated.
  - The batched `drawText` rotation block (`canvas-renderer.ts:188`) is unreachable because the guard at line 182 already routes `mark.rotation` to `renderMark`. Confirmed dead code.
  - `styleKey` serializes `s.shadow ?? s.effects ?? null` (`canvas-renderer.ts:78`) while paint applies `style.shadow ?? style.effects?.outerShadow` (`marks/rect.ts:160`). The key/apply divergence is real and would mis-batch on `innerShadow`-only differences.
  - `niceLinear` descending branch uses `Math.ceil(start * step) / step` (`scales/linear.ts:218`), dimensionally inconsistent with the positive branch's `Math.floor(start / step) * step`. Importantly, `tickStep` returns a *negative* step specifically for descending domains (`stop < start ? -step1 : step1`, line 196), so the `step < 0` branch genuinely fires for descending domains — the plan's interpretation is correct, not a misread of a D3-style sub-unit signal.
  - Hit-tester text uses the `length * fontSize * 0.6` heuristic (`hit-tester.ts:113`) and `pointInPathBounds` is bbox-only with an in-code admission that exact picking needs `isPointInPath` (`hit-tester.ts:266`).
  - WebGL has no `webglcontextlost` listener, an unclamped `gl_PointSize = a_size` (`webgl-renderer.ts:33`), and the 2D fallback inserted at `canvas.nextSibling` (line 448) — confirming the layering limitation.
- **Test-first sequencing.** Phase 0 explicitly introduces no behavior change and exists to pin current intended behavior before edits — the right discipline for a near-untested subsystem.
- **Contract/invariant section is concrete and correct**: IR ownership stays in contracts, batching preserves array paint order, `scale(invert(v)) ≈ v`, `nice()` only widens, never-throw color fallback. These are testable invariants, not platitudes.
- **Dependency sequencing is thought through**: Phase 2 (shared `getBoundingBox`) is flagged as a prerequisite for Phase 1's gradient-bounds fix to avoid a `canvas-renderer.ts` merge conflict, and cross-folder coordination (`interaction/pick.ts`, `chart-engine.ts` backend selection, `style-resolver`/`algebra/color` color-syntax alignment) is named.

## Major gaps or risks
- **Verification is entirely deferred.** Per task constraints the plan runs nothing, which is correct, but it leaves the gates as prose. It would be stronger if it named the existing test runner config and confirmed Vitest is the harness (the lone `font.test.ts` implies it) rather than assuming.
- **No coverage/acceptance thresholds.** "with new files covered" is vague for a plan whose central thesis is that this subsystem is under-tested. A target (e.g. per-file line coverage floor, or an enumerated must-cover branch list) would make the gate enforceable.
- **The visible-regression gate is under-specified.** The gradient-bounds fix is acknowledged as a *visible* output change, but "gate with app-eval visual review" gives no pass criterion (golden image? human sign-off? tolerance?). Since this is the one change most likely to alter shipped charts, the acceptance bar deserves to be pinned.
- **WebGL context-restore is the riskiest item and the least specified.** Re-initializing shaders/buffers on `webglcontextrestored` is genuinely involved (buffer re-upload, program relink, state reset). The plan correctly flags it but offers no decomposition or fallback-first ordering; an implementer could underestimate it. A "fallback-to-2D permanently on first loss" minimum viable step, with full restore as a follow-up, would de-risk it.
- **`niceLinear` fix prescription is slightly hand-wavy** ("mirror the positive branch with sign handling"). Given the plan already nailed the diagnosis, stating the corrected expression explicitly would remove ambiguity for the implementer.

## Contract and verification assessment
Contract clarity is high: the plan keeps the `ChartMark` IR owned by contracts, forbids forking a second mark shape, and routes any new paint-bounds field through contracts-first with a declaration rebuild (correctly citing the rollup ordering). The `Renderer` interchangeability and painter-order invariants are stated as preserve-not-break constraints. The verification section enumerates the right suites (scales round-trip, mark gating/gradient-bounds, renderer save/restore balance and z-order, WebGL `parseColor` table + point-size clamp + context-loss routing, hit-tester precise vs. bbox) and adds a compile-time `satisfies` check for `ChartScale` — a nice touch that turns the optional-method facade's looseness into a checked property. The weakness is purely on *thresholds and pass criteria*, not on *what to test*: the gates are listed but not quantified, and the visual gate has no defined bar.

## Concrete changes that would raise the rating
1. Add explicit acceptance criteria to each gate: a coverage floor (or enumerated must-cover branches) for the new tests, and a defined pass condition for the app-eval visual gate on the gradient change (golden snapshot + tolerance, or named reviewer sign-off).
2. State the corrected `niceLinear` descending expression inline, plus the expected result for the worked example so the test is unambiguous.
3. Split Phase 4's context-loss work into a minimum step (route permanently to 2D on first loss) and a stretch step (full shader/buffer re-init on restore), so the high-complexity item ships value incrementally.
4. Confirm and name the test harness/config (Vitest) and where per-subdir `__tests__` configs resolve, so Phase 0 does not stall on tooling discovery.
5. Quantify the perf guardrail for the `styleKey` shadow re-derivation (e.g. assert no new per-mark allocation on a 50k-mark micro-benchmark), since the plan itself flags the 50k hot path as a risk.
