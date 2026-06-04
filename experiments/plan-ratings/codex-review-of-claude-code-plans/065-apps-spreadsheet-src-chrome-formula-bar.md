Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan. It correctly identifies the folder's real role, the highest-risk untested logic, and a concrete shipped bug: formulas in the multiline/expanded path can become transparent without a matching highlighter overlay. The plan is much better than a local cleanup ticket because it names behavioral contracts, preserves the editor/coordinator split, and sequences characterization tests before extraction.

The rating is held back by a few contract and verification gaps. The biggest issue is that O5's "always render a Textarea" direction conflicts with the stated stable `FormulaBarProps.inputRef?: (el: HTMLInputElement | null) => void` boundary and with existing app-eval selectors that still look for `[data-testid="formula-bar"] input[type="text"]`. The plan also labels the name-box resolver as pure even though the current priority chain includes an async `wb.names.get` fallback, and it does not name exact package-level test/typecheck commands.

Major strengths

- The plan is grounded in the actual production code: the highlighter gate, `text-transparent` textarea branch, dual async reads in `FormulaBarContainer`, eager all-sheet table scan, `any[]` named-range cache, and empty `useEffect` are all real.
- The objectives are architecturally aligned. Moving display derivation and name-box resolution into `domain/editor` matches the existing pure editor-domain utilities and reduces React-component business logic.
- The contract list is unusually useful. It captures subtle load-bearing behavior around focus layer ordering, keyboard delegation, IME composition, use of `useActiveCell()` instead of `useSelection()`, formula-hidden display, brace wrapping by `region.kind`, and read-only affordances.
- The sequencing is mostly right: isolate the visible multiline formula fix first, lock display/navigation behavior with characterization tests, then extract and consolidate.
- Verification coverage is broad and production-relevant: unit tests for pure derivations plus app-eval coverage for user-visible formula-bar/name-box paths.

Major gaps or risks

- O5 needs a precise contract decision. Rendering only a textarea would make the current `FormulaBarProps.inputRef` type inaccurate for the normal collapsed path, and several existing internal app-evals query `input[type="text"]`. The plan should either keep the input/textarea boundary, explicitly widen the prop and downstream refs to `HTMLInputElement | HTMLTextAreaElement`, and migrate selectors, or avoid always-textarea.
- The proposed `aria-label="Insert function"` for the fx button may break existing fallback selectors expecting `button[aria-label="fx"]` or `[data-testid="formula-bar-fx"]`. If the accessible name changes, the plan should add a stable test id or update existing evals deliberately.
- O3 describes a "pure" resolver but includes an async API fallback (`wb.names.get`) in the preserved priority order. That is not pure unless the resolver receives a fully materialized lookup result or becomes an async, side-effect-free resolver over an adapter.
- O4's atomic read is directionally correct but underspecified. It should define the exact state shape, version/cancellation behavior, and active-cell identity checks at commit time so a slow read cannot publish data for a stale sheet/cell after rapid navigation.
- Verification gates are not concrete enough. "tsc typecheck clean" and "lint clean" should be replaced with the actual relevant `pnpm` commands for the public repo package and any internal app-eval command for added scenarios.
- The app-eval work is cross-repo (`mog-internal/dev/app-eval`) while production code is in public `mog`. The plan should call out that implementation and verification touch separate git repos and must be tracked independently.
- The "no literal Excel in new source comments" rule is not visible in the inspected AGENTS files and the source tree already contains many such comments. If it is a real memory/convention, cite the source and scope it to newly authored comments rather than presenting it as a repo-wide static gate.

Contract and verification assessment

The plan's behavioral contracts are the strongest part of the document. C2/C4 are specific enough to drive tests, and C5-C8 protect the most likely regressions from refactoring. However, C1 and O5 currently conflict: a stable `HTMLInputElement` ref contract cannot coexist with an always-textarea editor unless the contract is formally widened and all consumers are audited.

The verification plan is comprehensive in categories but incomplete as an executable gate. It should name the exact unit-test command for `apps/spreadsheet`, the exact TypeScript gate, and the exact app-eval runner/scenario names. The app-eval scenarios should be explicitly required to use real UI input paths, especially for Ctrl+Enter, name-box Enter, IME, and read-only behavior.

Concrete changes that would raise the rating

- Resolve the O5/C1 mismatch by either keeping a hybrid input/textarea design or formally widening `FormulaBarProps.inputRef` and updating all refs, context-menu/autocomplete consumers, debug readbacks, and app-eval selectors.
- Split O3 into a synchronous pure resolver plus an async lookup adapter, or rename it as an async side-effect-free resolver and define its adapter contract.
- Specify the consolidated active-cell read algorithm, including stale-read guards keyed by sheet id, row, col, and refresh tick.
- Add exact verification commands and scenario paths, including whether changes must be made in both `mog` and `mog-internal`.
- Update the fx-button accessibility/test-selector contract so accessibility improvements do not accidentally break existing modal-dialog and insert-function evals.
- Replace implementation-detail visibility assertions with a user-observable/pixel/computed-style gate that proves multiline formula text is visible in the real rendered formula bar.
