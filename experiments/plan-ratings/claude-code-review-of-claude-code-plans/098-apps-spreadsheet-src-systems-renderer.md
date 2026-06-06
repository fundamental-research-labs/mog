Rating: 9/10

# Review — 098 `mog/apps/spreadsheet/src/systems/renderer`


## Summary judgment

This is a strong, evidence-grounded plan. It correctly characterizes the folder's role (app-side renderer lifecycle owner + coordination glue over `@mog-sdk/sheet-view`), and its findings are precise rather than speculative. I spot-checked the load-bearing claims against the current tree and essentially all of them hold at the cited lines:

- **Dead-code band confirmed.** `setupLayoutCoordination`, `buildSparklineCoordination`, `buildCFCoordination` appear only as definitions + `coordination/index.ts` re-exports with no instantiation (verified). `syncOutlineGutter` has no callers outside the dead module + interface declarations. `renderer-actions.ts` exports (`mountRendererAction`, …) appear only as definitions — confirmed dead.
- **Error-recovery gap confirmed.** `executeStateTransition` has cases `unmounted/waitingForLayout/initializing/ready/suspended/switchingSheet/disposing` and **no `case 'error'`**. The `initializing` guard is exactly `if (!rendererContainer || !rendererDependencies || sheetView) break;` — so a surviving truthy `sheetView` after a failed init does block retry as the plan claims.
- **Page-break inertness confirmed.** `new PageBreakCoordinator()` at `render-system.ts:268`; no production `setDependencies(...)` call on it anywhere (only the docstring and test references). The facade methods all delegate to a deps-less coordinator.
- **Hygiene confirmed.** `ENABLE_LIFECYCLE_DEBUG = true`, `DEBUG_LOG_LEVEL = 2`, unconditional `Object.assign(window, { __lifecycleDebug })`.
- **Placeholder type confirmed.** `types.ts` `RenderContextConfig` is `{ [key: string]: unknown }` with the TODO.
- **Stalled deprecation confirmed.** `getRenderer()` still called from `sheet-coordinator.ts:208` and `use-renderer-actions.ts:290`; `INTERNAL_GRID_RENDERER_KEY` back-channel present at `renderer-execution.ts:45,138,267`.
- **Misfiled module confirmed.** `getSlicerCache`/`rebuildAllSlicerCaches` are consumed from `systems/grid-editing/`, not the renderer.
- **Follower magic timer confirmed.** `setTimeout(..., 120)` at `render-context-coordination.ts:687` with the generation guard (`generation !== contextUpdateGeneration`) and tracked-timer cleanup present as described.

The factual accuracy here is unusually high for a plan of this size, which is the main reason for the rating.

## Major strengths

- **Verifiable, line-anchored claims.** Nearly every assertion is pinned to a file:line and survives checking. This makes the plan directly actionable and low-risk to start.
- **Disciplined wire-vs-delete framing.** Rather than blindly deleting `layout-coordination.ts`, it forces an evidence-based determination and names the single highest-risk uncovered case (outline-gutter width on `group:*`/`outline:level-changed`). It even points at the corroborating evidence (`event-subscriptions.ts` no longer invalidating on row/col dimension events). This is the correct way to handle dead code that might mask a real gap.
- **Invariants section is excellent and specific.** Machine purity, single-owner lifecycle, "update only when ready" guard, transition-detection diffing to avoid render storms, `onScrollPositionReset` physics resync, user-intent viewport-follow gate — these are the real load-bearing contracts of this folder, and pinning them as preserve-or-strengthen constraints is exactly right.
- **Honest epistemics across the minified boundary.** Claims that depend on minified consumers (`use-grid-mouse.ts`, `useRenderContextConfig.ts`) are explicitly flagged "verify" rather than asserted, and Phase C/objective 6 are sequenced to confirm the consumer contract before destructive edits.
- **Sound sequencing.** A–D (folder-local, disjoint files, parallelizable) before E (cross-package/cross-folder), with `getRenderer()` removal explicitly staged last behind its own PR. Risk notes (double-free on the new `error` case, geometry-closure rebinding on sheet switch, Strict Mode double-mount) match the genuine hazards.

## Major gaps or risks

- **The largest decision is deferred, not made.** Objective 1's `layout-coordination` wire-vs-delete is the highest-value item and the plan cannot resolve it from static evidence alone — it depends on runtime behavior of SheetView's internal `ResizeObserver` and whether gutter width recomputes on outline changes. The plan handles this responsibly, but the reader should understand the plan delivers a *decision procedure*, not the decision. A reproduction recipe (e.g., an app-eval that collapses an outline group on a wide gutter and asserts gutter width) would have closed this rather than leaving it to the implementer's judgment.
- **`RenderContextConfig` typing may be harder than "import the real type."** The placeholder comment itself notes the intent is the *dynamically-updatable subset* (gridlines/headers/zoom/rtl), not the full contract `RenderContextConfig`. Aliasing the full contract type into `updateContext(config: Partial<...>)` and dropping the cast could surface many fields that `updateContext` does not actually support, or shift type errors into consumers. The plan says "or the dynamically-updatable subset," which is the right hedge, but it under-specifies which fields belong in the updatable surface — the actual work item is defining that subset, and that is left vague.
- **Phase C feature-existence ambiguity.** The plan offers both "inject deps" and "remove the inert seam if deprecated" without resolving which. Given hit-testing currently always returns `{hit:false}`, the feature is *already* dark in production; the plan should state how to tell intended-deprecation from regression (e.g., is there a Page-Break-Preview entry point in the UI at all?) rather than leaving a binary fork.
- **Verification can't be exercised here.** Per task constraints nothing is run, so the regression tests proposed (error-recovery retry-to-ready, page-break hit-on-known-break) are designs, not green gates. They look correct against the `renderer-simulator` harness, but their feasibility (can the simulator inject a creation failure?) is asserted, not demonstrated.

## Contract and verification assessment

- **Contract clarity: strong.** The capability-accessor surface, the opaque `access` layer, and the three coordination lanes are described accurately, and the "what must not regress" list is concrete and testable. The `getRenderer()` → capability-accessor migration is the one place where the *target* contract (which accessor replaces which call: `getGeometry`/`getHitTest`/`getViewport`) is named generically rather than mapped per-caller; enumerating the two known callers' exact needs would tighten it.
- **Verification gates: appropriate and well-scoped.** Typecheck (justified by placeholder removal + `getRenderer` deletion), contracts declaration rollup before app typecheck (correctly flagged as the cross-package gotcha consistent with project knowledge), targeted vitest of the eight named in-folder test files, a `knip`-style unused-export check to prove the dead band is gone, and an app-eval smoke set covering first-paint/sheet-switch/freeze-split/page-break-drag/forced-init-failure. This is the right battery. The dead-code/wiring guard (architecture assertion that `coordination/index.ts` has no unreferenced exports) is a nice durable regression net.
- **Gap:** no gate ties the `RenderContextConfig` change to a consumer-side typecheck of `useRenderContextConfig.ts` — the minified consumer most likely to break — beyond the generic app typecheck.

## Concrete changes that would raise the rating

1. **Convert objective 1 from a decision procedure into a decision** by specifying the exact runtime probe (app-eval or manual repro) that determines whether outline-gutter/recompute is covered, so the implementer isn't left to adjudicate the highest-risk item.
2. **Define the `RenderContextConfig` updatable subset explicitly** — list the fields `updateContext` actually supports and state whether the new type is `Pick<>` of the contract or a distinct subset interface, so dropping the cast doesn't just relocate the type hole.
3. **Resolve the Phase C fork** with a concrete signal for "feature live vs intentionally retired" (presence of a Page-Break-Preview UI entry point / live `use-grid-mouse` call), rather than offering both branches.
4. **Map `getRenderer()` callers to their replacement accessors** one-to-one (the two confirmed call sites + the `event-subscriptions.ts` internal uses), turning objective 6 from "enumerate and migrate" into a checklist.
5. **Add a consumer-side typecheck gate** for `useRenderContextConfig.ts` to the Phase E verification, since it is the most exposed minified consumer of the retyped surface.
