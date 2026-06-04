Rating: 9/10

# Review of Plan 065 — `mog/apps/spreadsheet/src/chrome/formula-bar`

## Summary judgment

This is a strong, evidence-driven plan that I was able to verify against the live source almost line-for-line. Every structural claim it makes is accurate: the five refresh signals coalesced into one `structureVersion` counter (`FormulaBarContainer.tsx:148-249`), the two independent async fetch effects that can land out of order (`activeCellData` at `:263-276`, `cellData` at `:288-319`), the untyped `metadata.region` casts in `shouldBraceWrap` (`:360-364`), the `any[]`-typed `cachedNamedRanges` / `createStoreAdapter` (`NameBoxDropdown.tsx:82-83, 161`), the eager all-sheets `loadData` with per-sheet `ws.tables.list()` ungated by dropdown-open state (`:187-242`), the duplicated "resolve sheet → setSelection" navigation blocks (`:391, 420, 467, 519`), and the dead empty `useEffect` (`FormulaBar.tsx:89-98`).

Most importantly, the headline bug is real and I confirmed it: the highlight overlay is gated `isFormula && !isMultiLine` (`FormulaBar.tsx:295`) while the `<Textarea>` still applies `text-transparent` whenever `isFormula` (`:340`) with `caretColor` forced visible (`:347`). An expanded bar or any newline-containing formula therefore renders transparent text with no overlay — invisible formula, caret-only. This ties directly to the recorded `formula-edit-caret-occlusion` memory. Shipping O1 first and independently is exactly the right call.

The plan is correctly framed as targeted hardening, not a rewrite. Objectives are well-scoped, contracts are concrete, sequencing puts characterization tests before extraction, and non-goals are explicit. This is near the top of what a folder-level plan of this kind should look like.

## Major strengths

- **Verifiable specificity.** Line references resolve, file sizes match, and the data-flow diagram reflects the actual `useActiveCell → FormulaBarContainer → FormulaBar` path. This is not a hallucinated plan; it reads as if authored after real inspection.
- **Correct prioritization of the one user-visible defect.** O1 is isolated, low-risk, independently shippable, and has a named regression gate.
- **Strong contract section (C1–C10).** The output-stability invariant for `displayValue` (C2) enumerates every branch that actually exists in `:392-420` (edit passthrough, formula-hidden, cse/dataTable brace-wrap, arraySpill *no* wrap, forced-text apostrophe, date `editText`). C4's navigation priority chain matches the real order in `navigateToAddress` (colon fast-path → defined-name cache → `wb.names.get` fallback → table → A1 → inline define-name → invalid). C8 preserves the documented "591 re-renders" performance constraint and the `useActiveCell`/`useDebouncedSelection`/`memo` discipline.
- **Tests-before-extraction sequencing.** Step 2 locks behavior with characterization tests before Steps 3–4 move logic, which is the right way to make a "no observable behavior change" refactor safe.
- **Honest risk register.** It explicitly flags that O4 must preserve the `refreshActiveCellData`-before-read ordering and the `cellChanged` settle re-check (both real, at `:268` and `:209-215`), and that O5 (always-textarea) is the riskiest change.

## Major gaps or risks

- **O5 is under-de-risked relative to its blast radius.** Collapsing `<Input>`/`<Textarea>` into a single always-textarea touches caret restoration, IME wiring (C7), the `data-no-grid-pointer`/click-commit contract (the `formula-edit-click-commits` memory), and single-line visual baseline simultaneously. The plan acknowledges the risk but leans on a single app-eval visibility scenario as the gate. It should spell out the click-commit and IME re-validation as explicit, separate gates, and consider whether O5 is even required to fix O1 — O1's "fallback" (don't apply `text-transparent` without an overlay) ships the bug fix without remounting risk, so O5 could be deferred or dropped if it proves fragile.
- **The O1 verification gate is loosely operationalized.** "read back that the formula text is visible (non-transparent / overlay present)" is hard to assert deterministically. The recorded screenshot `caretColor:'initial'` gotcha and overlay-stacking subtleties in the caret-occlusion memory mean a naive screenshot/visibility check can pass while the text is still effectively invisible. The plan should specify *how* visibility is asserted (e.g. computed-style check on the overlay node and the textarea's `color`, or a DOM presence assertion on the highlighter), not just "visible."
- **C8's render-count gate is conditional.** "assert via the existing render-count instrumentation if available" leaves the most load-bearing performance invariant possibly unverified. The plan should confirm the instrumentation exists or define a concrete fallback assertion, since O4's refresh-coalescing rework is precisely the kind of change that can reintroduce re-render storms.
- **Boundary between extracted and retained logic is slightly fuzzy for the calculated-column path.** The `isStructuredReferenceFormula` / `resolveCalculatedColumnCellContext` formula selection lives in the `cellData` effect (`:300-305`), not in `displayValue`. O2's input contract (`{raw, computed, formula, region, …}`) correctly keeps that upstream, but the plan never states explicitly that this selection stays in the container — an implementer could mistakenly try to pull it into the pure function. One sentence drawing that line would remove ambiguity.
- **The "temporarily-exported pure helper" characterization approach (Step 2) is awkward.** Exporting current in-component logic just to test it, then re-extracting, risks a throwaway export leaking. Extract-then-test (with the extraction itself being behavior-preserving) is usually cleaner; at minimum the plan should note the temporary export is reverted.

## Contract and verification assessment

The contract set is the plan's best feature and is faithful to the code. C2, C3, C4, C5, C7, C8, C9, C10 each map to real, identifiable behavior I confirmed in source (graceful degradation via the `try/catch` at `NameBoxDropdown.tsx:234`; read-only affordance hiding at `FormulaBar.tsx:226, 270`; focus-layer push-before-startEditing at `FormulaBarContainer.tsx:503-519`). C3 freezing `name-box-display.ts` byte-for-byte with the existing test as the gate is appropriate — that file is genuinely pure already.

Verification gates are mostly well-chosen: existing unit test stays green, two new pure-module test files cover the C2/C4 surfaces (the real coverage win, since both are currently unit-test-dark), plus app-eval scenarios per behavior. The static-gate note correctly invokes the `no-excel-in-code` rule. Weaknesses are the three noted above: the O1 visibility assertion, the conditional C8 instrumentation, and the IME/click-commit re-validation for O5 being folded into a single scenario rather than enumerated. None of these undermine the plan; they are gaps in *how* gates are measured, not *whether* the right things are gated.

The O7 dependency on a typed `RegionMeta` from contracts is handled responsibly with a self-contained local-guard fallback, so it is not a blocking unknown.

## Concrete changes that would raise the rating

1. **Decouple O1 from O5.** State that O1 ships via the `text-transparent`-only-when-overlay-present fallback (or a textarea-capable overlay) independently, and treat O5 as an optional, separately-gated follow-up that can be abandoned if caret/IME/click-commit re-validation regresses. This removes the main residual risk from the critical bug fix.
2. **Operationalize the O1 visibility assertion.** Specify the exact check (computed `color`/`caret-color` on the textarea, presence and computed color of the `FormulaHighlighter` overlay node) and explicitly reference the `caretColor:'initial'` screenshot gotcha so the gate cannot pass on still-invisible text.
3. **Make C8 unconditional.** Confirm the render-count instrumentation exists (or name the concrete fallback) and assert a hard ceiling during a drag scenario, since O4 directly threatens this invariant.
4. **Enumerate O5's secondary gates.** List IME/CJK composition, click-inside-cell-does-not-commit, and caret-position-after-newline as distinct app-eval assertions, not one combined scenario.
5. **Clarify the O2 extraction boundary.** Add one line stating the calculated-column/`isStructuredReferenceFormula` formula selection remains in the container's fetch effect and only its *result* enters the pure function's input.
6. **Resolve the characterization-test mechanism.** Prefer extract-then-test, or explicitly note the temporary export is removed once the real module lands.
