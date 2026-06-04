Rating: 8/10

# Review — 043 `mog/canvas/engine/src`


## Summary judgment

This is a strong, evidence-grounded improvement plan for the generic canvas engine. Every substantive defect it cites was verified against the live source and is real, not speculative:

- `getStats()` sources `fps`/`averageFrameTime`/`maxFrameTime` from `PriorityScheduler.getStats()` (`engine.ts` ~line 198), and the scheduler's fps is `Math.min(60, Math.round(1000 / Math.max(16, avg)))` over its own processing frames (`priority-scheduler.ts:270`). The loop calls `this.scheduler.processFrame()` with no argument every frame on an effectively empty queue (`render-loop.ts:235`), and `scheduler.schedule()` has no external callers — confirmed. The telemetry-is-meaningless claim is accurate.
- `collectDirtyUnion` unions each doc-space rect into **every** region via `docToCanvas` in a nested `for (const region of regions)` loop (`render-loop.ts:~675`), with no intersection test — the cross-region inflation bug is exactly as described.
- `renderFrame` sets a single `scrollChanged` flag on *any* region's offset delta and calls `promoteAllToFull()` globally (`render-loop.ts:~282`) — the scroll over-promotion claim is accurate.
- `CRITICAL_LAYER_IDS = new Set(['background','cells','selection'])` is hardcoded at `render-loop.ts:73` inside a "zero domain knowledge" package — accurate, and a test even depends on it (`render-loop.test.ts:455`).
- The duck-typed inline `getOrCreateCache?` cast (`render-loop.ts:~399`), the no-arg `coalesce()` auto-path (`dirty-rect-accumulator.ts:48`, so the `FULL_PROMOTION_RATIO` guard at line 101 never fires automatically), `navigator.platform` Windows guard (`canvas-host.ts:156`), per-call `measureText('Mg')` (`text-measurer.ts:80`), and `parseHex` dropping the `#RRGGBBAA` alpha (`color-utils.ts`) are all confirmed.

The plan reads the code accurately at the line level, distinguishes the **live `RenderScheduler` interface** (`core/types.ts:131`, consumed by kernel/sheet-view) from the **dead `PriorityScheduler` class**, and frames its objectives as targeted fixes rather than a rewrite. That precision is its strongest feature.

## Major strengths

- **Diagnostic accuracy.** Claims are specific, line-anchored, and verifiable; I confirmed each major one. This is rare and is the single biggest reason for the high score.
- **Invariant ledger.** The "contracts and invariants to preserve or strengthen" section is genuinely load-bearing: it names the canonical coordinate formula (single source in `coordinate-space.ts`), branded-rect discipline, `RenderScheduler` interface stability, the `per-region` clip-after-translate subtlety in `renderPerRegion`, single-rAF ownership, resume=full-repaint, and deferred-resize atomicity. New logic is explicitly required to *compose* `docToCanvas`/`canvasToDoc` rather than re-derive — the correct constraint.
- **Backward-compatibility discipline.** Optional `coalesce(viewportArea?)`, optional `CacheableLayer`, optional `critical?` flag, and "no shape change to `RenderScheduler`" all preserve consumers in overlay/drawing-canvas/grid-renderer/kernel. The `coalesce` signature is already optional in source, so B7 is a pure call-site change — correctly low-risk.
- **Honest risk register.** It names B5 as highest-risk (stale pixels), flags the `critical`-flag transition window where no layer is critical, and the coalesced-pointer double-emit hazard — each with a mitigation.
- **Sequencing realism.** Correctly identifies that Phase A overlaps `RenderLoop` with B5/B6 and says to serialize A→B or assign one worker; B/C/D/E are genuinely disjoint files.

## Major gaps or risks

- **Objective 1 leaves the central decision unresolved.** The plan offers a "preferred wire path" and a "fallback excise path" without committing. The wire path explicitly requires out-of-scope changes in `views/sheet-view/viewport-wiring.ts` and `grid-renderer` to route invalidation through the scheduler — i.e., it cannot be completed within this folder's edit boundary. A single worker handed this plan cannot finish the preferred path alone, and the fork ("do A, or else B") reduces actionability. The plan would be stronger if it committed to **excision + honest rAF-cadence telemetry** as the in-scope deliverable and demoted wiring to a separate, explicitly-sequenced follow-up plan. As written, the most consequential objective is also the least decided.
- **Highest-risk change has the weakest automated gate.** B5 (region-intersection) is where under-unioning produces stale pixels, yet the only automated coverage proposed is a unit test asserting the union is confined to one region plus reuse of existing freeze-pane containment tests; the real "no stale pixels on scroll+freeze" check is a *manual* app-eval gate. The intersection predicate's correctness (especially around the `ceil(1/dpr)` snap margin and zoomed regions) deserves a dedicated property/regression test, not a manual smoke.
- **`critical`-flag regression window is real.** Removing `CRITICAL_LAYER_IDS` before grid-renderer sets the flag means *no* layer is protected from error-disable, including core layers. The plan offers two mitigations (config-inject the old ids during transition, or land the grid-renderer flag in the same change set) but does not pick one; since grid-renderer is out of scope, the config-injection default should be stated as the required path, not an option.
- **Minor: D11 (`userAgentData`).** `navigator.userAgentData` is unavailable in Firefox/Safari; the plan's "fall back to UA string parsing" is correct but the safeguard's whole purpose is a conservative Windows default — the fallback chain should be spelled out so the desync-off-on-unknown-Windows behavior is provably preserved, not just asserted.
- **Verification can't be self-run here (by constraint), so the gates are assertions.** That's acceptable given the task rules, but it means the plan's correctness ultimately rests on the named jest suites and consumer integration tests actually exercising these paths; the plan lists plausible suite names but does not confirm, e.g., that an existing test asserts cross-region union behavior (it does not — that test is *new* in the plan, correctly flagged).

## Contract and verification assessment

Contract clarity is high. The `CacheableLayer` interface is concretely specified with the `null`-returns-fallback semantics preserved; the `critical?` addition is typed and defaulted; the `RenderScheduler`-interface-vs-`PriorityScheduler`-class boundary is stated repeatedly and is the correct cut line. The branded-rect and single-coordinate-formula constraints give implementers an unambiguous "don't inline math" rule.

Verification gates are above average: existing suites enumerated, new unit tests specified per objective with concrete assertions (e.g., "union does **not** span all panes"; "critical layer never disabled after `MAX_FAILURES_BEFORE_DISABLE` with no literal `'background'/'cells'/'selection'`"), a typecheck gate across the five downstream packages, and a consumer-regression list. The weakness is the risk/coverage mismatch noted above — the change most likely to ship a visible defect (B5) is gated partly by manual app-eval. The scheduler test bullet is appropriately conditional ("if wired … if excised …"), but that conditionality again reflects the unresolved Objective 1.

## Concrete changes that would raise the rating

1. **Commit Objective 1 to the excision path** as the in-scope deliverable (delete `priority-scheduler.ts`, the `RenderPriority` enum, the `scheduler` field/accessor, re-source `getStats` from real inter-`onFrame` timestamp deltas), and split scheduler-wiring into a separate cross-folder plan. This makes the plan completable by one worker within the stated edit boundary. (+1)
2. **Add a dedicated automated regression for B5** — a fixture with main + frozen panes asserting that a main-pane dirty rect yields a canvas-space union that does not intersect frozen-pane bounds, including a zoomed and a non-1 DPR case — so the highest-risk change is not gated on manual smoke.
3. **Make the `critical` transition mitigation mandatory, not optional:** require `CanvasEngineConfig` to inject the previously-hardcoded ids as critical during the transition window, so error-disable can never reach a core layer before grid-renderer adopts the flag.
4. **Spell out the D11 fallback chain** (`userAgentData?.platform` → UA-string `/win/i` → conservative desync-off default) and assert the unknown-platform branch keeps desync off.
5. **State explicitly which existing jest assertions already cover each preserved invariant** (vs. which are net-new), so reviewers can tell coverage from aspiration — particularly for the `per-region` clip-after-translate note and the resume=full-repaint path.
