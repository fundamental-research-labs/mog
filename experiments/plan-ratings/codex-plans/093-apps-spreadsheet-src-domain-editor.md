# 093 - Spreadsheet Domain Editor State Behavior Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/domain/editor`

Queue item: 93

Scope reviewed:

- `formula-context.ts`: pure scanner that computes function autocomplete context, current function, argument index, function stack, and string-literal state.
- `formula-range-parser.ts`: regex-based formula reference extraction, active reference lookup, and formula text rewrite for range box dragging.
- `name-completion.ts`: defined-name, table, table-column, and sheet-name suggestions plus insertion formatting and table-reference context detection.
- `formula-metadata-cache.ts`: workbook-scoped async cache for names, tables, and sheets consumed by formula autocomplete.
- `cursor-position.ts`: popup position and viewport clamping helpers for autocomplete and argument hints.
- `selection-manager.ts`: DOM selection to character-offset mapping for rich text editing.
- `index.ts` and the local tests for formula context, formula range parsing, and metadata cache.

Adjacent production paths inspected:

- `hooks/editing/use-formula-autocomplete.ts`, which consumes editor-machine formula context, function registry metadata, workbook name/table/sheet metadata, popup positioning, and suggestion acceptance.
- `systems/grid-editing/machines/editor/autocomplete.ts` and `formula-editing.ts`, which use identically named helpers from `systems/shared/utils`.
- `components/grid/editors/InlineCellEditor.tsx`, `chrome/formula-bar/FormulaBarContainer.tsx`, `hooks/grid-mouse/use-formula-range-drag.ts`, `systems/renderer/execution/render-context-coordination.ts`, `actions/handlers/editor.ts`, and `utils/formula-auditing.ts`, which parse formula ranges for highlighting, range boxes, drag editing, auditing, and action handling.
- `components/editor/RichTextEditor.tsx`, which uses `richTextSelectionManager` for contentEditable selection offsets.
- `exports.ts`, which exports part of the editor domain but does not expose formula range parsing through the `domain/editor` barrel.

This plan targets public Mog source work in `../mog`. The planning artifact stays only in `mog-internal`.

## Current role of this folder in Mog

`domain/editor` is the spreadsheet app's behavior layer for formula and rich-text editor state. It is not a visual component folder. It defines the pure and semi-pure contracts that let the editor machine, formula bar, inline editor, canvas range overlay, autocomplete popups, formula auditing, and rich text toolbar agree on what the user is editing.

The folder currently owns these user-visible contracts:

- Formula autocomplete context: whether the cursor is typing a function/name prefix, which function argument is active, and whether to show argument hints.
- Formula reference discovery: which A1 ranges appear in a formula, their source text spans, colors, active reference index, and rewritten text after range-box dragging.
- Name and structured-reference suggestions: workbook names, sheet-scoped names, tables, table columns, special table items, and sheet names.
- Formula autocomplete metadata: one workbook-scoped cache over async Workbook/Worksheet APIs for names, sheets, and tables.
- Popup geometry: mapping the active cell or input element to fixed-position autocomplete and argument-hint anchors.
- Rich text selection mapping: conversion between native DOM selection and character offsets used by the editor state machine and toolbar format state.

The current architecture has useful foundations:

- Most helpers are deterministic functions or small stateful wrappers, which makes them good candidates for contract-level tests.
- Formula metadata is already pulled through Workbook/Worksheet APIs instead of React component-local ad hoc calls.
- The autocomplete hook uses `useSyncExternalStore` against the metadata cache, which is the right shape for document-scoped external state.
- Formula range parser output already carries source spans, so UI highlighting and range-box editing can avoid reparsing in every component.

The main weakness is that these contracts are split and underspecified. `formula-context.ts` and `formula-range-parser.ts` are duplicated byte-for-byte under `systems/shared/utils`, so production code has two import paths for the same behavior. The formula parser and context analyzer are local scanners rather than a grammar-aware formula editor model. The range parser returns only grid coordinates and raw text, so cross-sheet filtering and rewrite behavior are inferred later from strings. Rich text selection, popup positioning, and name completion have little or no local test coverage. Metadata cache invalidation does not guard in-flight loads against stale writes after workbook events or disposal.

## Improvement objectives

1. Make `domain/editor` the canonical production contract for formula editor behavior, with one import path for formula context, range references, name completion, metadata cache, popup anchoring, and rich text selection.
2. Replace regex/string-scanner formula parsing with a token-aware editor model that aligns with Mog's compute parser and Excel formula grammar for strings, quoted sheet names, structured references, named ranges, arrays, grouping parentheses, whole row/column references, external references where supported, and cross-sheet ranges.
3. Strengthen formula context invariants so autocomplete and argument hints are correct inside nested functions, grouped expressions, array constants, strings, quoted sheet names, structured references, and after mid-string edits.
4. Strengthen formula range reference contracts so each parsed reference carries reference kind, source span, sheet qualification, normalized range, absolute marker policy, editable/rewrite eligibility, and display color.
5. Make name completion context-driven instead of prefix-only, including defined names, sheet names, table names, table columns, special table items, escaped names, sheet-scoped visibility, and structured-reference insertion rules.
6. Make formula metadata caching generation-safe, disposable, and explicit about workbook event coverage, stale async loads, errors, and reload triggers.
7. Add tested contracts for rich text DOM selection mapping and popup/caret anchoring across input, textarea, contentEditable, scroll, zoom, and viewport-edge cases.
8. Add production-path tests and E2E gates that prove editor behavior through real UI input paths, not only direct helper calls.

## Production-path contracts and invariants to preserve or strengthen

- The editor machine remains the source of live edit state: editor value, cursor position, text selection, formula context, suggestion selection index, formula point mode, commit/cancel behavior, and rich text selection offsets.
- `domain/editor` should be the canonical behavior module. `systems/shared/utils` may re-export it during migration, but it must not maintain separate implementations.
- Public repo dependency direction remains strict: `mog` must not depend on `mog-internal`.
- Formula parsing for editor UI must agree with compute parser grammar where the editor needs token boundaries. UI helpers can expose editor-specific metadata, but they must not invent a conflicting formula language.
- Formula context must distinguish function calls from grouping parentheses. Closing a grouped expression inside `SUM((A1+B1),C1)` must not pop the `SUM` function frame.
- Argument-index tracking must ignore commas and separators inside strings, quoted sheet names, array constants, structured references, and nested non-argument contexts.
- String handling must use formula semantics. Double-quoted string literals, escaped double quotes, quoted sheet names, and structured-reference brackets are distinct contexts.
- Formula range extraction must not highlight or edit references inside strings, comments/text literals, structured-reference column names that happen to look like A1, or unsupported reference syntax.
- Cross-sheet references must carry sheet identity explicitly. Downstream consumers should not parse `ref.text.includes('!')` to decide whether a range box belongs on the active sheet.
- Formula range rewrite must preserve intended absolute markers, sheet qualification, quoting, and single-cell versus range shape. Unsupported or ambiguous references should be non-editable rather than rewritten incorrectly.
- Name suggestions must respect workbook-level and sheet-scoped visibility. Sheet-scoped names should normalize scope through sheet ids, not only display names.
- Metadata cache subscribers must observe monotonic snapshot versions. In-flight loads invalidated by workbook events or disposal must not later publish stale `ready` snapshots.
- Autocomplete metadata failures should degrade to function-only suggestions without corrupting cache state or spamming reloads on every render.
- Popup placement should anchor to the actual caret where practical, not only the input or cell rectangle, and should clamp without covering the active text/control when there is available space.
- Rich text selection offsets must use the same character-offset convention as `RichTextSegment.text` and the editor machine. Empty segments, nested spans, multi-segment selections, root-node selections, collapsed selections, and out-of-range restoration must be deterministic.
- Tests for UI-sensitive behavior must drive the production keyboard, mouse, selection, clipboard, and DOM focus paths.

## Concrete implementation plan

### 1. Establish a single editor-domain contract

- Add an explicit `domain/editor` contract index that exports all editor-domain behavior used by production code: formula context analysis, reference parsing, reference rewrite, name completion, metadata cache, popup positioning, and rich text selection.
- Update production imports in grid-editing, formula bar, inline editor, renderer coordination, grid mouse range dragging, formula auditing, and action handlers to consume the canonical `domain/editor` exports.
- Replace `systems/shared/utils/formula-context.ts` and `systems/shared/utils/formula-range-parser.ts` with re-exports from `domain/editor`, then remove the duplicate implementations once all imports are migrated.
- Align `FormulaContext` and `FunctionStackEntry` with the public actor/editor contract type. If `@mog-sdk/contracts/actors` remains the public source, `domain/editor` should import and return that type instead of declaring a parallel structural shape.
- Add a no-duplicate-implementation test or static check that fails if formula context or range parser source files reappear under `systems/shared/utils`.

### 2. Introduce a formula editor token model

- Add a module such as `formula-editor-tokens.ts` that exposes a production editor tokenizer over formula text and cursor position.
- Prefer adapting the existing compute parser/tokenizer if it can expose source spans and partial-formula tolerance. If the compute parser cannot parse incomplete editor input, add a small editor-tolerant lexer that shares token definitions and grammar cases with compute rather than continuing with unrelated regexes.
- Tokenize formula constructs needed by editor behavior: functions, identifiers, defined names, sheet names, external workbook prefixes where supported, cell references, ranges, whole-row and whole-column references, structured references, array constants, string literals, operators, separators, grouping parentheses, and error tokens for partial input.
- Preserve source spans in UTF-16 string offsets because DOM input, textarea, and current editor machine cursor positions use JavaScript string offsets.
- Expose token context queries: token at cursor, editable reference at cursor, prefix before cursor, active function frame, active argument index, active table reference, and whether the cursor is in a literal/non-completion context.

### 3. Rebuild formula context analysis on tokens

- Rewrite `analyzeFormulaContext` to consume the token model and produce a stable `FormulaContext`.
- Track a stack of function frames and grouping frames separately. Only a closing parenthesis that closes a function call should pop that function.
- Count argument separators only at the current function-call depth and outside strings, array constants, structured references, quoted sheet names, and nested group contexts.
- Detect function/name prefixes from token context, not only from the previous character. Prefix detection should work after operators, after argument separators, inside nested calls, at the beginning of formulas, and after whitespace.
- Prevent suggestions for cell references, range endpoints, sheet references after `!`, structured-reference column tokens, quoted sheet names, strings, and invalid contexts.
- Add explicit handling for formulas that begin with `=`, `+`, or `-` if the editor machine treats them as formula starters. If only `=` should receive autocomplete, encode that rule in one place and test it.
- Keep the existing shape consumed by `use-formula-autocomplete`, but add fields only if they remove downstream string inspection, for example `completionKind`, `prefixStart`, `prefixEnd`, and `activeTableRef`.

### 4. Rebuild formula reference extraction and rewrite

- Replace `CELL_REFERENCE_PATTERN` extraction with token-based reference discovery.
- Define a `FormulaReferenceToken` or extended `FormulaRangeReference` with:
  - `kind`: cell, range, wholeRow, wholeColumn, structured, namedRange, external, unsupported.
  - `sheetName` or `sheetId` when resolvable, plus `isCurrentSheet` when the caller supplies active sheet context.
  - `range` for references that can be represented as `CellRange`.
  - `startPos`, `endPos`, original `text`, color, index, and `editable`.
  - absolute marker metadata for start/end row and column.
  - rewrite policy for preserving sheet prefixes and quoting.
- Keep `extractFormulaRanges(formula)` as a compatibility wrapper if needed, but have production callers that care about sheets or editability use the richer API.
- Support and test simple refs, absolute refs, cross-sheet refs, quoted sheet names with escaped apostrophes, ranges with sheet-qualified endpoints, reversed ranges, whole-column and whole-row references, and references adjacent to operators.
- Mark structured references and named ranges explicitly. Do not pretend they are A1 ranges unless the Workbook/Worksheet API can resolve them and rewrite them safely.
- Make `findActiveReferenceIndex` use source spans from the token model and define boundary behavior once: start-inclusive, end-inclusive only for the caret immediately after a completed reference if that is the intended Excel parity.
- Rewrite `updateFormulaReference` so it preserves absolute markers, sheet qualification, quoting, and endpoint qualification consistently. If a reference kind cannot be rewritten through range-box dragging, return a typed non-editable result instead of mutating text.
- Update range-box filtering and renderer coordination to consume explicit sheet qualification rather than parsing `ref.text`.

### 5. Make name completion context-driven

- Replace `detectTableRefContext` string scanning with token-context detection for structured references.
- Expand name completion to produce typed suggestions with insertion behavior, display label, lookup key, source scope, and optional replacement span. `formatNameForInsertion` should not be the only place that knows whether to add `!`, brackets, or quotes.
- Escape sheet names and table column names through shared formula/reference formatting helpers. Sheet names with spaces, apostrophes, punctuation, and names that look like references must round-trip.
- Keep defined-name visibility rules sheet-id based. Workbook names are visible everywhere; sheet-scoped names are visible only on the matching sheet unless explicit cross-sheet name syntax is supported.
- Sort suggestions by exact prefix, scope, suggestion kind, and stable lexical order. Preserve the current useful behavior of sheet-scoped names before workbook names.
- Replace `getNameSuggestionIcon` returning glyphs with semantic icon ids or suggestion kinds consumed by UI components. The editor domain should not own visual emoji selection.
- Add tests for defined names, sheet-scoped names, hidden/duplicate names if supported, tables, table columns, special table items, sheet names requiring quotes, name suggestions inside nested formulas, and no suggestions in literal contexts.

### 6. Harden formula metadata cache lifecycle

- Add a cache generation counter that is captured when a metadata request starts. If workbook events invalidate the cache before the request resolves, the stale result must not publish `ready`.
- Guard disposal. A request that resolves after `dispose()` must not resurrect a disposed cache or notify cleared subscribers.
- Decide whether invalidation during an in-flight load should cancel, ignore, or schedule a reload. Encode that as a state transition and test it.
- Preserve the single in-flight request guarantee for duplicate consumers when no invalidation occurs.
- Keep `useSyncExternalStore` compatibility by making snapshots immutable and version-monotonic.
- Expand workbook event coverage if needed for sheet reorder, table rename, table column changes, name scope changes, and import/replace operations.
- Add an explicit retry policy after errors so autocomplete does not request in a tight render loop but can recover after relevant workbook changes or a later user action.
- Add tests for in-flight invalidation, disposal during load, subscriber unsubscribe during notification, metadata load error, duplicate workbook cache reuse, and cache recreation after disposal.

### 7. Improve popup and caret positioning

- Replace the unused `_cursorOffset` parameter with real caret anchoring where possible.
- For input and textarea controls, compute a caret rect using a mirror element or browser selection geometry, including scrollLeft/scrollTop, multiline wrapping, font metrics, and zoom.
- For contentEditable rich text, expose an anchor rect from DOM `Selection`/`Range` when the editor surface owns focus.
- Fall back to input rect, then cell rect, then a safe fixed position only when caret geometry is unavailable.
- Make clamping placement-aware: suggestions should prefer below the caret but flip above when needed; argument hints should prefer the configured side without covering the formula bar or inline editor if an alternate side has space.
- Add unit tests under JSDOM for deterministic fallbacks and browser-backed component/app-eval tests for viewport edges, scrolled sheets, formula bar focus, inline editor focus, and multiline text.

### 8. Strengthen rich text selection mapping

- Add local tests for `RichTextSelectionManager` with contentEditable DOM trees matching `RichTextEditor`: multiple spans, empty text nodes, nested spans, root-level text nodes, collapsed selections, multi-segment selections, element-node selections, and out-of-range restoration.
- Define whether offsets are UTF-16 code units, Unicode code points, or grapheme clusters. Use the same convention as the editor machine and `RichTextSegment.text`; if moving to grapheme-aware behavior is needed, do it as a whole-editor contract change.
- Preserve selection direction only if downstream toolbar/editor behavior needs anchor/focus direction. If direction is intentionally discarded, document and test that `start <= end` is the contract.
- Make `setCharacterOffsets` clamp negative and over-large offsets before creating a DOM range.
- Verify that empty editors and single empty segments restore a caret in a deterministic location without throwing.
- Add integration coverage in `RichTextEditor` for selection-change reporting and toolbar format state after selecting across segments.

### 9. Update production consumers directly

- Update `use-formula-autocomplete` to use richer context fields instead of recomputing table context from raw formula text.
- Update formula bar and inline editor reference-color extraction to consume canonical reference tokens and skip non-highlightable references.
- Update range dragging and `UPDATE_FORMULA_RANGE` action paths to respect `editable` reference metadata and sheet identity.
- Update renderer coordination to show active reference and formula range boxes only for references belonging to the rendered sheet, using explicit qualification.
- Update formula auditing to use the richer parser or a compute/auditing parser if it needs semantic precedent coverage beyond editor-visible A1 ranges.
- Keep public app exports intentional. If formula range parsing is part of the public app surface, export it through `domain/editor`; if it is internal only, stop exporting duplicate shared utils.

### 10. Document the editor behavior inventory in tests

- Build a table-driven fixture set for formula editor behavior. Each fixture should include formula text, cursor position, expected tokens, formula context, suggestions context, references, active reference index, and rewrite expectations where relevant.
- Include incomplete formulas because editor behavior happens while the user is typing.
- Include regression cases from production consumers: formula bar editing, inline editor highlighting, range-box dragging, cross-sheet selection, structured references, name completion, and argument hints.

## Tests and verification gates

Required focused gates for implementation from `mog`:

- `pnpm --filter @mog/app-spreadsheet test -- src/domain/editor`
- `pnpm --filter @mog/app-spreadsheet test -- src/hooks/editing/use-formula-autocomplete.ts src/components/editor/FunctionSuggestions.tsx`
- `pnpm --filter @mog/app-spreadsheet test -- src/systems/grid-editing/machines/editor`
- `pnpm --filter @mog/app-spreadsheet typecheck`

Run repo-level `pnpm typecheck` if public actor contracts, app exports, Workbook/Worksheet metadata types, or formula parser package contracts change.

Focused unit tests to add or expand:

- Formula token model: strings, escaped quotes, quoted sheet names, escaped apostrophes, array constants, structured refs, external refs where supported, whole rows/columns, grouping parentheses, incomplete formulas, invalid tokens, and cursor-spanning token lookup.
- Formula context: nested functions, grouping inside function arguments, separators inside nested contexts, prefixes after operators and whitespace, no suggestions in strings/sheet names/structured refs/ranges, plus/minus formula starters if supported.
- Formula references: simple, absolute, cross-sheet, quoted sheet, reversed, sheet-qualified endpoints, whole row/column, references inside strings that must be ignored, structured references that must be typed separately, active reference boundaries, and rewrite preservation.
- Name completion: workbook and sheet-scoped names, table names, table columns, special table items, sheet names requiring quotes, replacement spans, sorting, and insertion formatting.
- Metadata cache: single in-flight load, invalidation during load, disposal during load, error and retry behavior, subscriber unsubscribe, workbook event coverage, and cache recreation.
- Cursor positioning: caret rect, input fallback, textarea fallback, cell fallback, viewport clamp, flip behavior, and no-window fallback.
- Rich text selection: DOM-to-offset and offset-to-DOM mapping across realistic contentEditable structures.

Production-path app-eval/E2E gates must use real UI input:

- Type `=SU`, navigate suggestions with ArrowUp/ArrowDown, accept with Tab, and commit with Enter from both inline editor and formula bar.
- Type formulas with nested calls and grouped expressions, verifying argument hint function and argument index.
- Insert and drag formula range boxes for same-sheet and cross-sheet references, verifying the formula text and range overlays.
- Edit formulas containing quoted sheet names, strings that look like references, array constants, structured references, and defined names.
- Accept workbook name, sheet-scoped name, table, table column, and sheet-name autocomplete suggestions.
- Select rich text across multiple formatted segments and apply toolbar formatting through real mouse/keyboard selection.
- Exercise popup placement near viewport edges, scrolled grid positions, formula bar focus, inline editor focus, and multiline formula text.

Manual browser checks for implementation:

- Run the spreadsheet dev server and verify formula autocomplete, argument hints, range highlighting, range dragging, name completion, and rich text selection in the actual UI.
- Inspect visible range boxes and formula-bar/inline-editor highlight spans while editing; they should agree on colors and source spans.

## Risks, edge cases, and non-goals

Risks and edge cases:

- The compute parser may not expose an editor-tolerant partial parse. If so, the right fix is a shared lexer/token model that agrees with compute grammar, not continued local regex parsing.
- Changing reference extraction can affect formula bar highlighting, inline editor highlighting, canvas range boxes, range dragging, side panel precedent display, formula auditing, and action handlers at once. Migrate consumers deliberately and keep fixture coverage broad.
- Cursor positions are currently JavaScript string offsets. Any move to grapheme-aware behavior affects DOM selection, editor machine state, formulas with emoji or non-BMP characters, and rich text offsets.
- Cross-sheet references need explicit identity. Sheet display names can be renamed or quoted; downstream behavior should not depend on raw text parsing.
- Structured references and named ranges are not always safely representable as `CellRange`. Treating them as editable A1 ranges can corrupt formulas.
- Metadata cache invalidation can cause extra workbook API calls if reload policy is too aggressive. Generation guards should prevent stale results without creating render-loop reloads.
- Popup caret measurement for textarea and contentEditable can be browser-sensitive. Keep deterministic fallbacks and add browser-backed tests for the UI path.
- Removing duplicate shared-utils implementations can reveal import cycles. Use narrow re-exports or contract files to preserve dependency direction while eliminating behavior duplication.

Non-goals:

- Do not move durable workbook, worksheet, formula, table, or name state into the editor domain.
- Do not bypass the editor machine, unified action path, Workbook/Worksheet APIs, or compute parser for production behavior.
- Do not add compatibility shims that preserve duplicate parser implementations.
- Do not optimize test-only helpers or benchmark-only paths.
- Do not reduce Excel formula/editing coverage to avoid parser complexity.
- Do not make `mog` depend on `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

Natural parallel workstreams:

- Agent A: canonical export/import migration and duplicate `systems/shared/utils` parser removal.
- Agent B: formula editor token model and formula context rewrite.
- Agent C: formula reference extraction/rewrite, range-box sheet identity, and renderer/action consumer updates.
- Agent D: name completion and formula metadata cache lifecycle hardening.
- Agent E: cursor positioning, rich text selection tests, and browser-backed UI verification.
- Agent F: fixture inventory and app-eval scenarios that drive real UI input paths.

Dependencies:

- `mog/apps/spreadsheet/src/systems/grid-editing/machines/editor` for editor-machine context, autocomplete state, formula point mode, and range update actions.
- `mog/apps/spreadsheet/src/hooks/editing/use-formula-autocomplete.ts` and `components/editor/FunctionSuggestions.tsx` for suggestion computation and UI acceptance.
- `mog/apps/spreadsheet/src/chrome/formula-bar` and `components/grid/editors/InlineCellEditor.tsx` for production text controls and range highlighting.
- `mog/apps/spreadsheet/src/systems/renderer/execution/render-context-coordination.ts` and grid mouse range-drag hooks for formula range boxes.
- `mog/apps/spreadsheet/src/actions/handlers/editor.ts` for action-dispatched formula range updates.
- Workbook/Worksheet APIs for names, sheets, tables, sheet ids, table columns, and structure events.
- Compute formula parser/tokenizer packages if they can expose editor-tolerant token spans or shared grammar definitions.
