Rating: 9/10

# Review of plan 097 — `mog/apps/spreadsheet/src/systems/input`

## Summary judgment

This is an unusually strong, evidence-grounded plan. I independently verified the load-bearing factual claims against the live tree and every one held: the `forwardToSheet` no-op bridge (`useRendererSync.ts:212-216`), `handleInputEventAction` having zero non-test callers, the `enableKeyboard` ternary that constructs `KeyboardCoordinator` identically in both branches (`input-system.ts:187-190`), `focusEditor('')` hardcoded with the "cellId is typically set by the editor system" comment (`input-system.ts:279-283`), the untracked `scheduleZoomEnd` `setTimeout` that `dispose()` never clears while only `wheelEndTimeout` is cleared (`input-coordination.ts:954-962`, `1168-1170`), the wrong `HEADER_CLICK` bounds (`endRow:999`/`endCol:25`, `input-events.ts:82,88`), the `prefers-reduced-motion` guard present at the machine-state entry (`:637`) but absent from the two direct `startMomentum` calls (`:412`, `:501`), the 120-entry `READ_ONLY_ALLOWED_ACTIONS` set (`keyboard-coordinator.ts:226`), and the 1,752-line keyboard coordinator. The plan reads as written by someone who actually traced the code, not pattern-matched it.

The structure is exemplary: scope split into edit-targets vs. named-for-coupling, an Evidence section with file:line anchors, six objectives that map cleanly onto six phases, an explicit contracts/invariants section, per-phase verification gates, and a risks/non-goals section that pre-empts the obvious failure modes. The gating product decision (excise vs. complete the dead pointer path) is correctly identified as Phase 0 and correctly deferred to product sign-off with a sane default (excise).

## Major strengths

- **Diagnosis precedes prescription, and the diagnosis is verifiable.** Each defect is tied to a citation a reviewer can open. This is the single biggest differentiator from a weak plan.
- **Correct identification of the architectural through-line** ("machines own state, coordinators own execution") and the two places it is violated: the dead position math in `grid-input-machine.ts` and the hand-rolled non-XState chord machine in the keyboard coordinator. The objectives restore the pattern rather than inventing a new one.
- **Phase 0 is genuinely a gate, not theater.** It explicitly notes that the resolution changes how much of `input-coordination.ts`/`input-types.ts` survives, and preserves the alternative (complete the wiring) so the work isn't silently lost — while flagging it as a larger, separate plan.
- **Contract preservation is specific and behavioral**, not hand-wavy: the exact `ShortcutContext` cascade ordering, the Excel KeyTip parity invariants (alt-tap window, alt-up default commit, stray-key-after-half-chord), fail-closed read-only semantics, single-owner scroll position. These are the things a refactor silently breaks.
- **Cross-folder ripple is mapped** — selectors, the two live hooks (`use-scroll-state`, `use-input-state`), the contracts `.d.ts` rollup (correctly cross-referencing the declaration-rollup gotcha), and the KeyTip UI consumers — with the instruction to keep the public selector *shape* identical so call sites don't move.
- **Verification gates are per-phase and concrete**, including a regression-fence test (registry-derived read-only set must equal the old allowlist for every action) *before* deleting the inline set — exactly the right way to de-risk objective 5.

## Major gaps or risks

- **Phase 4's `readOnlySafe` metadata is the riskiest item and is under-sized relative to its blast radius.** Adding a field to the action/shortcut definition source in `@mog-sdk/contracts/actions` touches every action definition and forces a contracts rebuild for all consumers, not just the input folder. The plan acknowledges this and stages it, but treats it as a peer of the much smaller objectives. It should arguably be its own plan, or at minimum carry an explicit "this is the largest surface area; land independently" caveat. The regression-fence test mitigates correctness risk but not the coordination/review cost.
- **The `dispose()` crash framing is slightly imprecise.** The plan says `assertNotDisposed()` makes the late zoom-end callback "a latent crash, not just a leak," but the timer calls `this.inputActor.send(...)` directly after `inputActor.stop()` — that's a send-to-stopped-actor, not a guarded public-method call. The fix (track + guard the timer) is correct regardless, but the stated failure mode is marginally off. Cosmetic.
- **`focusEditor` resolution leans on a single `rg` result to decide delete-vs-extend.** "default to deletion if the only caller is dead" is reasonable, but the plan doesn't pre-state what it found, so the decision is deferred into implementation. A one-line `rg \.focusEditor\(` result captured in the plan would have closed this rather than leaving it open.
- **No rollback / landing-order safety for Phase 1's selector repointing.** The plan keeps the selector shape stable and gates on snapshot tests (good), but a hidden runtime consumer reading machine-context `scrollX` directly (rather than via the selector) would not be caught by shape-preserving selector changes alone. The risk is named; the detection (`rg` every consumer) is named; but "what if a consumer bypasses the selector" isn't explicitly closed.
- **Phase 2's a11y fix changes observable momentum behavior on touch/pan.** Worth a note that this is a deliberate behavior change (pan/touch flicks will now respect reduced-motion where they didn't), so it isn't mistaken for a regression in interaction evals. The plan calls it a defect-fix but doesn't flag the behavior delta for the eval reviewer.

## Contract and verification assessment

Strong. The invariants section is the best part of the plan: it enumerates the exact properties a refactor must not break and phrases several as "preserve bit-for-bit" (cascade ordering, `preemptChordIfNeeded` semantics). Verification gates are mapped phase-by-phase with named existing suites that must stay green, plus new assertions for each change. The separation of "tests this worker writes" from "repo gates run by the reviewer" (typecheck, unit suite, contracts build, app-eval keyboard/scroll/focus scenarios) is clean and respects the no-build constraint. The chord-parity suite as the immovable gate for objective 5, and the "metadata-derived read-only set == old allowlist" regression test, are precisely the right fences. The one soft spot is Phase 1: "assert machine context no longer carries scroll/zoom position" tests the type, but the harder guarantee — that no live consumer silently depended on that context — rests on `rg` discipline rather than a test.

## Concrete changes that would raise the rating

1. **Promote Phase 4's `readOnlySafe`/`mutating` contract change to its own plan (or a clearly-bounded sub-phase)** with the contracts-package reviewers named as approvers, and keep only the *consumption* side (read the metadata) inside this folder's plan. This is the single change that would most reduce execution risk.
2. **Capture the `rg \.focusEditor\(` result inline** so the delete-vs-extend decision is made in the plan, not punted to implementation.
3. **Add an explicit detection step for non-selector scroll/zoom consumers** in Phase 1 (e.g. `rg` for direct `\.context\.(scrollX|zoomLevel)` reads on the input actor snapshot), so the "hidden consumer" risk is closed by search, not just by selector-shape stability.
4. **Note the deliberate touch/pan momentum behavior change** in Phase 2 for the interaction-eval reviewer, to distinguish it from a regression.
5. **Tighten the dispose-crash wording** to "send to a stopped actor" rather than implying `assertNotDisposed` fires on that path.

None of these are blocking; the plan is already actionable and safe to execute as written. They would move it from a very good plan to an airtight one.
