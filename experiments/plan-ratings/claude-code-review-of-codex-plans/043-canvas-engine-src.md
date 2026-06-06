Rating: 8/10

# Review of 043 - Canvas Engine Source Improvement Plan


## Summary judgment

This is a strong, evidence-grounded plan. Every concrete technical observation I spot-checked against the actual source is accurate, not hallucinated:

- `worldPosition` is emitted identical to `position` with a "Caller must apply scroll/zoom transform" comment (`input/input-capture.ts:295,319`), confirming the public event-contract mismatch.
- `CRITICAL_LAYER_IDS = new Set(['background', 'cells', 'selection'])` is hardcoded into the supposedly generic engine (`loop/render-loop.ts:73`).
- `createCanvasEngine` proxies single-canvas layers via `Object.create(layer, { canvas: {value: 0} })` (`engine.ts:172`), the exact `this`-binding hazard the plan flags.
- `getStats()` copies `schedulerStats.fps / averageFrameTime / maxFrameTime` straight into `EngineStats` (`engine.ts:190-199`), conflating scheduler processing cost with rendered-frame cost.
- `PriorityScheduler.hasWork()` excludes IDLE tasks (`scheduler/priority-scheduler.ts:242-244`); `getStats()` synthesizes an FPS from task time (`:270`).
- Cache support is duck-typed (`getOrCreateCache?`/`clearCache?`) inside the render loop (`loop/render-loop.ts:399-441`), not in the `CanvasLayer` contract.
- `setVisibility()` mutates `entry.visible` only and never sets `sortedCacheDirty` (`registry/layer-registry.ts:64-69`), so the sorted/visible caches go stale exactly as claimed.
- Input uses `event.offsetX/offsetY` (`:123,277,307`), the target-relative source the plan wants replaced.

Because the diagnosis is real and specific, the plan earns trust. It correctly frames the engine's core invariant (zero-domain, single canonical coordinate formula, `Write = Invalidate`) and organizes the work around restoring contract/implementation consistency rather than chasing cosmetic refactors.

## Major strengths

- **Diagnosis is verifiable and precise.** Each improvement signal in section "Current improvement signals" maps to a real line of code. This is the difference between a plan and a wish list.
- **Invariants are stated as preservable contracts**, not vibes: the canonical formula `canvas = bounds + (doc - viewportOrigin - scrollOffset) * zoom`, the single time source (`FrameContext.timestamp`), conservative partial-dirty promotion, and idempotent dispose. These give implementers and reviewers concrete acceptance criteria.
- **Architectural fit is excellent.** The recurring theme — replace duck typing and domain leakage with explicit typed capabilities (`CacheableCanvasLayer`, `LayerErrorPolicy`, `getCanvasIndex` routing) — is the right structural move for a package whose stated purpose is being generic.
- **Strong non-goals.** Explicitly forbidding compatibility shims that preserve the broken `worldPosition`/visibility/proxy behavior is the correct call; it prevents the usual "wrap the bug" anti-fix.
- **Sequencing and dependencies are coherent.** Contract inventory first, typed capabilities before render-loop rewrite, dirty-mapper coordinated with `viewportLayoutToRegionLayout`. The parallelization split (A–F) is along genuinely disjoint contract boundaries.

## Major gaps or risks

- **Scope is very large for one plan.** Twelve implementation tasks spanning five-plus packages and six agents, including new browser/Playwright infrastructure. This is closer to a quarter of work than a single landable change. The plan would be stronger if it named a minimal first slice (e.g., tasks 1+2+3: contract inventory, typed capabilities, registry visibility) that can land and verify independently before the riskier dirty-mapper and host-policy rewrites.
- **Several tasks defer the actual design decision.** Task 7 ("decide whether `schedule()` is pure mutation or wakes the loop"), task 11 ("decide whether `EffectiveStateManager` is a map or render-aware"), and task 6 ("decide which stats are public vs debug") are framed as open questions. For a plan this detailed elsewhere, leaving the central contract undecided pushes the hard call onto the implementer. Each should commit to a recommended answer with rationale.
- **The breaking `worldPosition` migration is under-specified.** The plan names the consumers (sheet-view, grid-canvas, drawing/overlay) and correctly forbids a shim, but does not enumerate the concrete edit list or a staged sequence (introduce new payload → migrate consumers → remove old field). Coordinate-payload changes across this many packages are the highest-regression-risk item and deserve a step-by-step cutover, not a single "update all consumers" instruction.
- **The "static audit gate rejecting inline coordinate formulas" is vague.** This is asserted as a deliverable in task 1 but with no spec of how it detects an "inline formula," what the allow-list of sanctioned helper files is, or how it avoids false positives. Either specify the mechanism (lint rule? AST grep pattern? test?) or downgrade it to a manual review checklist.
- **Browser/pixel verification assumes infrastructure that may not exist.** The plan repeatedly requires "browser-backed canvas tests" and "Playwright pixel/screenshot checks" but does not confirm whether this harness exists in the repo today or whether standing it up is itself part of the work. If it's net-new infra, that is a substantial hidden task that should be scoped explicitly.

## Contract and verification assessment

Contract clarity is the plan's best dimension. It distinguishes engine-owned generic concepts from caller-owned domain behavior, proposes named TypeScript interfaces to replace duck typing, and ties each to its production consumers. The proposed `DirtyRegionMapper` with explicit clip→clamp→promote stages and enumerated full-promotion events is a genuinely testable contract.

Verification gates are thorough at the command level (per-package `test`/`typecheck`, downstream contracts, app-spreadsheet, repo-wide typecheck) and the "behavioral assertions that must be covered" list is excellent — frozen-pane conversions, no-stale-pixels, idle starvation, single-canvas identity preservation. The weakness is that these gates are correctly listed but cannot be evidenced by the planning worker (rightly, given the constraints), and the browser-tier gates depend on possibly-absent infrastructure. The plan would be more credible if it separated "gates that exist today" from "gates this work must build."

## Concrete changes that would raise the rating

1. **Define a minimal first landable slice** and mark the remaining tasks as follow-ups, so the plan has a verifiable initial increment rather than an all-at-once 6-agent rollout.
2. **Commit to answers** for the open "decide whether" questions in tasks 6, 7, and 11 (recommended design + rationale), since these are the load-bearing contracts.
3. **Add a staged cutover for the `worldPosition` payload change**: new field/shape, consumer-by-consumer migration list, then removal — with the exact files to touch in each consumer package.
4. **Specify the coordinate-formula audit gate** mechanism and its sanctioned-helper allow-list, or demote it to a documented review checklist.
5. **Confirm and scope the browser/Playwright/pixel harness**: state whether it exists, and if not, make "build the harness" an explicit task with its own estimate rather than an assumption embedded in every verification bullet.
6. **Add explicit rollback/feature-flag thinking** for the highest-risk runtime changes (single-canvas routing and dirty-mapper), since both can silently regress compositing/z-order in ways unit tests miss.
