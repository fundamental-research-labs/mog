Rating: 9/10

# Review of plan 063 — `mog/apps/spreadsheet/src/systems/grid-editing`

## Summary judgment

This is an unusually strong, evidence-grounded plan for one of the largest and most coupled subsystems in the app. Nearly every claim it makes is verifiable against the current tree at the exact line numbers cited, and I confirmed the load-bearing ones directly. It correctly identifies a genuine shipped correctness bug (a no-op `subscribeToCellPropertyChanges` with a finished, unwired fix sitting in the same folder), separates structural/quality work from behavior changes, and is disciplined about the boundaries that matter for this folder (machine purity, the `systems/ → ui-store/` DAG edge, the single `config.workbook` mutation pipeline, the seven-actor ownership, and the `accessor`-only `getSnapshot()` rule). The sequencing is sane (characterization net first, ship the correctness fix standalone, decompose before hardening), and the contract/invariant section reads like it was written by someone who understands the failure modes rather than just listing files.

I verified the headline evidence and it holds:
- `grid-editing-system.ts:590` is a `return () => {}` stub with the exact TODO; `subscriptions/cell-property-subscriptions.ts` is fully implemented and **never called** in `start()`; the live consumer at `hooks/settings/use-cell-properties.ts:135` exists. The correctness bug is real.
- `start()` ≈244 lines (700–943), `setupClipboardPasteIntegration()` ≈302 lines (1445–1746), `buildDragTerminator()` ≈130 lines (1174–1303) with twin `endDrag`/`cancelDrag` chains — all confirmed.
- The 11× `getActiveSheetId` thunk (lines 764…1891), the two `as any` casts at 1814/1834, the `if (result instanceof Promise) await result` sites at 357/379/391/400, the `void (async…)()` at `editor-commit-coordination.ts:320`, the `void resolveAndApply…` at `edit-entry-service.ts:186`, the `pending-clipboard-paste.ts` two-frame/32ms heuristic, the `named-ranges-integration.ts` no-op, the `types.ts:388/400` interface TODOs, and the `paste-integration.ts:508` / `clipboard-machine.ts:21` TODOs — all confirmed at the stated locations.
- The `getProtectionInfo` N² unbatched `canEditCell` loop with a single `await Promise.all` is real; `moveTablesForCutPaste` is ≈64 lines and `getProtectionInfo` ≈36, matching the plan's own figures.
- `testing/` ships under `src/` with the simulators and is not imported by any production module — confirmed.

## Major strengths

- **Evidence-to-objective traceability.** Each objective maps to a concrete observation with file:line. This is the rare plan where the "Evidence" section is auditable rather than aspirational, and it survives audit.
- **Correct prioritization.** Objective 1 (the subscription bug) is genuinely the highest-value item: a finished module, a live consumer, a silent stub. Shipping it first as a standalone PR is exactly right.
- **Behavior-preservation discipline.** Phase 0 characterization at the public-API boundary using the existing simulators, plus the explicit "keep call order identical" instruction for `start()` and the drag-terminator state→event mapping, shows awareness that this folder's bugs hide in ordering and timing.
- **Invariant section is load-bearing, not boilerplate.** It calls out the `anchor=null` sheet-switch guard, the "SOLE click-as-commit path," commit-state-machine completeness (every entry to `validating`/`committing` terminates in success/`VALIDATION_ERROR`/cancel), and LIFO `dispose()` discipline — the actual things a refactor here would break.
- **Honest scoping.** It explicitly declines to rewrite the machines or merge the word-boundary helpers, and flags the `SelectionActorRef` contracts-rollup tradeoff (`@mog-sdk/contracts` build vs. local adapter) as a decision to make at review.

## Major gaps or risks

- **One premise is overstated: the comment-hover timers are not actually untracked.** `comment-hover-coordination.ts` stores `showTimer`/`hideTimer` and has a `cancelAllTimers()` cleanup path. The plan's claim that they "are **not** tracked for cleanup" (Evidence §8, objective 4) is partly wrong — the real residual risk is whether `cancelAllTimers` is reliably invoked on dispose/sheet-switch, not that tracking is absent. The find-replace debounce concern appears more genuine. Objective 4's timer work should be re-scoped to "verify/route through `CleanupManager`" rather than "these timers leak."
- **The frozen-pane triplication claim is the weakest evidence.** The three scroll coordinators all consume `viewport.getViewportBounds()`, but I did not find ~100 LOC of literally duplicated frozen-pane offset math; much of it may already be abstracted behind the viewport API. The shared `calculateScrollTargetForCell()` extraction (objective 4 / Phase 4) is still defensible, but the plan should down-rank "near-identical ~100 LOC duplicated" to "shared geometry concern worth one helper," or the parity golden tests it promises may have little to diff against.
- **Phase/objective numbering drifts.** The "Concrete implementation plan" stops at Phase 6, folding objective 7 into Phase 5, but the sequencing note says "Phases 4–7 in parallel" and the tests section references a "Phase 7 coverage." Harmless, but a reader assembling the work order will trip on it. Reconcile to one numbering.
- **Objective 8 (coverage) is open-ended.** "Close the highest-leverage unit-test gaps" for `clipboard-machine` (1,265 lines), `cross-coordination`, `find-replace`/`fill`/`drag-drop` is a large, vaguely-bounded surface tacked onto the end. Without a concrete target list or stop condition it risks being either skipped or unbounded. Confirmed these units genuinely lack isolated specs, so the gap is real — it just needs a defined scope.
- **Editor-deps contract narrowing ripples cross-folder.** The plan acknowledges this (folder 061's `edit-entry.ts` consumes `EditorDependencies`), but tightening `setCellValue`/`setArrayFormula` toward `Promise<void> | void` and removing the four `instanceof Promise` sites is the riskiest behavior-adjacent change and depends on another team's signatures. It is correctly flagged but under-specified on *who owns* the coordinated change.

## Contract and verification assessment

The contract section is the plan's strongest part. It pins the right invariants and, importantly, frames objective 3 as *strengthening* the commit-state-machine completeness invariant rather than adding ad-hoc try/catch — that's the correct mental model. The `subscribeToCellPropertyChanges` strengthening (no-op → real, must stay idempotent and safe before async wiring resolves, must return a working unsubscribe) is well specified.

Verification gates are concrete and mostly testable: per-drag-state equivalence (parameterized over all states), the subscribe→mutate→callback→unsubscribe→no-leak regression, the "stub each validation/dialog callback to throw, assert machine never wedges" boundary test, and the 200×200 protection-precheck scale test with a tolerated individual rejection. These match the objectives well.

Two weaknesses: (1) the scroll-geometry "golden tests matching prior per-coordinator outputs" gate presumes the duplication is large enough to produce divergent goldens — see the frozen-pane caveat above; if the math is already shared via the viewport API, this gate is thin. (2) The plan correctly defers actual build/test/eval execution per this run's constraints and names the app-eval/api-eval scenarios to run, citing the right operational memories ([[app-eval-usage]], [[api-eval-usage]], [[app-eval-async-overlay-race]]) — good, but it does not name a concrete acceptance threshold for "no regression," leaving the eval gate qualitative.

## Concrete changes that would raise the rating

1. **Correct the comment-hover timer premise.** Re-state Evidence §8 and objective 4 as "verify `cancelAllTimers`/find-replace debounce are registered with `CleanupManager` and fire on dispose AND sheet-switch," not "untracked timers leak." Cite that `showTimer`/`hideTimer`/`cancelAllTimers` already exist.
2. **Re-scope or substantiate the frozen-pane duplication.** Either quote the duplicated offset-math blocks with line ranges from all three coordinators, or soften to "consolidate scroll-target computation behind one helper" and drop the "~100 LOC triplicated" framing so the parity gate isn't measuring nothing.
3. **Unify the phase numbering** (Phases 0–6 vs. the "4–7" and "Phase 7" references) so the work order is unambiguous.
4. **Bound objective 8.** List the specific machines/coordinators to cover with a target (e.g., "clipboard-machine paste sub-states + cross-coordination click-as-commit branch, ~N specs") and an explicit "rest is out of scope" line, so coverage doesn't expand without limit.
5. **Assign the editor-deps contract change an owner and a coordination step.** State that the `Promise<void> | void` narrowing lands in one PR co-reviewed with folder 061, with the call-site audit done before merge — this is the one change that can silently break a consumer.
6. **Give the eval gate a threshold.** State the concrete pass condition for the editing/clipboard app-eval scenarios (e.g., the named scenarios stay green vs. a pre-change baseline) rather than "confirm no regression."
