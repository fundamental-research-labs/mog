Rating: 9/10

Summary judgment

This is an excellent plan for the formula-bar folder. It correctly treats `chrome/formula-bar` as a production contract boundary, not a small input widget: active-cell source projection, editor-machine ownership, autocomplete, name-box navigation, protected/read-only display, formula highlighting, focus/pane state, and chrome controls all meet here. The plan's observations match the source: projection and refresh logic are embedded in `FormulaBarContainer`, input/textarea typing is leaky, multiline formulas can be transparent without a highlighter, the autocomplete popup is function-gated despite computed name suggestions, and `NameBoxDropdown` owns loosely typed async directory state.

The rating is not 10 because several proposed contracts are still described as intentions rather than exact acceptance surfaces. A multi-agent implementation would need a few more tables and interfaces up front to avoid divergent interpretations of source-resolution precedence, invalidation events, flattened autocomplete indexing, and name-box reference formatting.

Major strengths

- Scope and architecture are well calibrated. The plan keeps durable workbook, worksheet, editor, formula, table, sheet, and name state out of React chrome while making the formula bar's projection and navigation responsibilities explicit.
- It preserves the right production invariants: `entryMode: 'formulaBar'`, document-level Enter/Tab/Escape ownership, no direct cell writes from the bar, hidden-formula display behavior, CSE/Data Table brace policy, focus-stack/pane-focus agreement, and `useActiveCell` render isolation.
- The plan systematically covers formula display families instead of fixing isolated bugs: blank, literal, date edit text, formula errors, forced text, hidden formulas, CSE arrays, dynamic arrays, Data Tables, calculated columns, multiline formulas, and cursor mapping.
- The proposed extractions are architecturally coherent: active-cell view model, unified text control, text command service, and typed name-box directory/navigator are real boundaries in the current code, not cosmetic refactors.
- Verification is production-path oriented. The plan asks for local unit/contract tests plus app-eval scenarios driven through keyboard, mouse, clipboard, and DOM-visible formula-bar controls.
- Parallelization notes are practical and slice along separable contracts: projection/source resolution, text control/highlighting/context menu, autocomplete, name box, and browser verification.

Major gaps or risks

- The formula source-resolution policy needs an exact precedence table. The plan names the families, but implementers still need deterministic answers for selected member versus anchor cells, structured-reference versus A1 calculated columns, hidden/protected formulas, Data Table members, dynamic-array spill members, and any cursor mapping when display text differs from edit text.
- The invalidation layer is directionally right but underspecified. It should name the actual Workbook/Worksheet event producers or required new events for table rename/update/delete, sheet structure changes, cell metadata changes, paste completion, formula rewrites, and same-cell refreshes. Otherwise agents may add local listeners that do not compose.
- Autocomplete needs a single flattened suggestion contract. Today the hook computes functions plus names, while `FunctionSuggestions` also filters functions and click selection of names can differ from `acceptCurrentSuggestion` formatting. The plan points at this but should require one ordered `FormulaSuggestionItem[]` model with shared accept semantics.
- Name-box reference formatting remains a risk. The plan says to use shared helpers, but it should identify the authoritative formatter/parser for quoted sheet names, absolute references, full row/column refs, whole-sheet refs, multi-ranges, table refs, and new-name `refersTo` strings.
- The sequencing is broad. Before large extraction work, the plan should require a behavior-capture milestone for current formula-bar display/readback and focus behavior, then make each refactor prove equivalence or an intentional contract change.
- Some verification entries are scenario names rather than runnable gates. The implementation plan should specify the exact app-eval command or scenario subset runners expected for the formula-bar path.

Contract and verification assessment

Contract quality is very strong. The plan names most of the contracts that matter for this folder and ties them to production APIs rather than mocks: Workbook/Worksheet readback, editor actions, formula autocomplete, focus coordination, ribbon/UI store visibility, and app-eval browser paths. It also correctly calls out performance as a contract by preserving granular active-cell subscriptions and avoiding selection-drag re-renders.

Verification coverage is also strong, especially the requirement to inspect `[data-formula-bar] input, [data-formula-bar] textarea` and to drive E2E coverage through real UI input. The missing piece is measurability: the plan should convert its inventories into concrete fixtures, expected view-model rows, and exact app-eval commands so completion is mechanically auditable.

Concrete changes that would raise the rating

- Add a concrete `FormulaBarCellViewModel` interface and a table mapping every source family to `durableSource`, `displayText`, `editText`, `formulaSourceKind`, `bracePolicy`, `hiddenPolicy`, `highlightPolicy`, and `displayToEditCursor`.
- Define the formula-bar invalidation API: event names, payload shapes, generation keys, and which Workbook/Worksheet/editor producers are responsible for firing them.
- Introduce a flattened autocomplete item contract with one ordering, one selected index, and one accept/click formatting path for functions, defined names, tables, and sheets.
- Specify the authoritative reference formatter/parser module for name-box creation and navigation, including quoted sheet names and full row/column cases.
- Break the implementation sequence into acceptance milestones with required tests per milestone, starting with an inventory/equivalence baseline before refactoring.
- Replace scenario lists with exact focused app-eval commands or runner filters for the browser-backed verification gate.
