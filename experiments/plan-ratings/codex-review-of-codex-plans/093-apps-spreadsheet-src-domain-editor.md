Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly identifies `domain/editor` as the right canonical home for spreadsheet editor behavior, and its inventory matches the actual source shape: formula context and range parsing are duplicated under `systems/shared/utils`, formula range extraction is regex-based, the metadata cache lacks generation/disposal guards, cursor positioning does not use the cursor offset, and rich text selection/popup/name completion coverage is thin. The plan is also appropriately ambitious for Mog: it aims to make formula editing token-aware, contract-driven, and verified through real user input paths rather than patching individual parser failures.

The main reason it is not a 9 or 10 is that the highest-risk architectural dependency is still too abstract. The plan says to align with the compute parser, but it does not specify the concrete bridge/API needed to get parser-backed, span-preserving editor tokens into `@mog/app-spreadsheet`. The Rust `compute-parser` already exposes reference token collection with UTF-16 offsets and token classes, while the spreadsheet app does not currently depend on a compute parser package/API. That boundary must be made explicit before implementation, otherwise agents may independently invent a second editor lexer or add the wrong dependency.

Major strengths

- The source and consumer inventory is excellent. It names the relevant domain files and the production consumers: editor machine, autocomplete hook, formula bar, inline editor, renderer coordination, range dragging, action handlers, auditing, side panel, and rich text editor.
- The canonicalization goal is architecturally correct. Replacing duplicate `systems/shared/utils` implementations with `domain/editor` exports/re-exports addresses a real production-path split rather than optimizing a test-only helper.
- The plan defines meaningful behavioral contracts: function vs grouping parentheses, argument separators ignored in literals/arrays/structured refs, explicit sheet identity for range boxes, typed reference editability, sheet-scoped name visibility, monotonic metadata cache snapshots, and deterministic selection offsets.
- Verification expectations are much better than average. The plan includes focused unit tests, production consumer tests, typecheck gates, app-eval/E2E gates through real UI input, and manual browser checks for the visible editor behavior.
- Parallelization notes are plausible and composable. Canonical imports, token/context, reference rewrite, metadata/name completion, popup/rich text, and app-eval fixture work can be split cleanly if the shared token/reference contracts are finalized first.

Major gaps or risks

- The compute-parser integration is underspecified. The plan should choose whether `domain/editor` consumes an existing public token API, a new wasm/TS bridge, or an app-local tolerant lexer that is tested against compute-parser fixtures. It should also account for the existing `compute-parser` `collect_reference_tokens` API and decide whether to expose or reuse it rather than creating a brand-new reference scanner.
- The dependency boundary is not concrete enough. `@mog/app-spreadsheet` currently does not depend on a compute parser package, so using compute grammar may require a new public package/export, wasm binding, or contracts-level adapter. That affects package dependencies, build order, and verification gates.
- The type contract migration needs sharper acceptance criteria. The plan notes the parallel `FormulaContext` shape and the public actor contract, but it should state exactly which package owns `FormulaContext`, how `domain/editor` imports/returns it, and which contract build/type tests must pass.
- The public export decision is slightly ambiguous. Early sections say the domain index should export all editor behavior, while later sections say to decide whether formula range parsing is public. That should be resolved in the plan so implementers do not create another accidental API surface split.
- The work is broad enough to create a big-bang risk. Formula tokenization, range rewrite, structured refs, metadata lifecycle, popup anchoring, rich text selection, imports, and E2E scenarios are all valuable, but the plan should define phase boundaries with a passing production gate after each phase.
- Name completion and range rewrite contracts need more exact result shapes. The plan describes typed suggestions and typed references well, but does not provide a draft discriminated union, replacement-span contract, sheet-id resolver contract, or non-editable rewrite result type.

Contract and verification assessment

The contract direction is mostly right: make `domain/editor` canonical, keep the editor machine as the live edit-state source, use Workbook/Worksheet APIs for metadata, avoid string inspection for sheet filtering, and preserve JavaScript/DOM UTF-16 offsets. Those are the right contracts for this folder.

Verification is strong but incomplete for the proposed architecture. If compute-parser, wasm bindings, or parser package exports change, the plan needs Rust gates such as the relevant `cargo test -p ...` and `cargo clippy -p ...`, plus any wasm/package build needed to make the API available to TypeScript. If `@mog-sdk/contracts` actor types change, a contracts build/test gate should be explicit, not only repo-level `pnpm typecheck`.

The app-eval portion is directionally correct because it requires real keyboard, mouse, selection, and focus paths. It should be made more operational by naming exact scenario files or commands, especially for autocomplete acceptance, range-box drag editing, cross-sheet reference boxes, structured references, and rich text selection across segments.

Concrete changes that would raise the rating

- Add a "parser/token API decision" section that evaluates the existing compute-parser token/reference APIs, states the chosen integration path, and lists the exact package/export/binding changes required.
- Define the new editor-domain types before implementation: `FormulaEditorToken`, `FormulaEditorContext`, extended `FormulaRangeReference`, `ReferenceRewriteResult`, typed name suggestion insertion data, and the sheet/name/table resolver inputs.
- Split sequencing into phases with gates: canonical re-exports and duplicate removal; parser/reference-token bridge; formula context rewrite; reference rewrite and range-box consumers; name/cache hardening; popup/rich-text; app-eval coverage.
- Resolve the public export policy for formula range parsing up front, including whether it belongs in `exports.ts` or only internal app imports.
- Add verification gates for compute-parser/Rust, wasm/bridge generation, contracts build/tests, and exact app-eval scenario commands when those areas are touched.
- Add migration invariants for import cycles and dependency direction, especially if `domain/editor` starts importing public actor contracts or parser adapters.
