# 093 — Cell & Formula Editor Domain (`apps/spreadsheet/src/domain/editor`)

## Title
Consolidate and harden the cell/formula editor domain: one formula grammar, a correct
reference parser, and clean domain/DOM boundaries.

## Source folder and scope
- **Folder:** `mog/apps/spreadsheet/src/domain/editor`
- **Files in scope:**
  - `index.ts` — barrel re-exporting the public surface of the folder.
  - `formula-context.ts` — `analyzeFormulaContext` / `isInsideString`: pure cursor-context
    analyzer that drives function-name suggestions and argument hints.
  - `formula-range-parser.ts` — `extractFormulaRanges` / `findActiveReferenceIndex` /
    `updateFormulaReference`: regex-based cell-reference extraction + position tracking, used
    for range-highlight boxes and drag-to-edit.
  - `formula-metadata-cache.ts` — `FormulaMetadataCache` class, `getFormulaMetadataCache`
    WeakMap singleton, `createFormulaNameCompletionStore`: stateful loader/cache for named
    ranges, tables, and sheet names feeding autocomplete.
  - `name-completion.ts` — `getNameSuggestions` / `formatNameForInsertion` /
    `detectTableRefContext` / `getNameSuggestionIcon`: defined-name / table / sheet completion.
  - `cursor-position.ts` — `getAutoCompletePosition` / `getArgumentHintPosition` /
    `clampToViewport` / `calculateFlipPosition`: popup placement math.
  - `selection-manager.ts` — `RichTextSelectionManager` + `richTextSelectionManager` singleton:
    bidirectional DOM-Selection ↔ character-offset mapping for contentEditable rich-text cells.
  - `__tests__/` — Jest specs for `formula-context`, `formula-range-parser`,
    `formula-metadata-cache`.
- **Out of scope (but adjacent / referenced):** the XState editor machine
  (`systems/grid-editing/machines/editor/*`), the duplicate copies under
  `systems/shared/utils/`, and UI components (`InlineCellEditor`, `FormulaBarContainer`,
  `FunctionSuggestions`, `RichTextEditor`). These are consumers; this plan changes the domain
  contracts they depend on and lists the corresponding consumer updates.

## Current role of this folder in Mog
This is the **logic layer for in-cell and formula-bar editing**. It contains the pure,
framework-agnostic pieces that the editor state machine and the editor/formula-bar UI compose:

- **Autocomplete brain.** `analyzeFormulaContext` scans a formula left-to-right up to the
  cursor and reports the innermost function, current argument index, the function-name prefix
  being typed, and whether to show suggestions vs. an argument hint. The editor machine calls it
  on every `INPUT` event (`systems/grid-editing/machines/editor/autocomplete.ts:37`).
- **Reference highlighting & drag-to-edit.** `extractFormulaRanges` pulls every `A1`-style
  reference out of a formula with character positions and a cycling color, so the grid can draw
  colored range boxes and the formula bar can color tokens; `findActiveReferenceIndex` /
  `updateFormulaReference` back the drag-to-resize-a-reference interaction. Consumed by
  `InlineCellEditor.tsx`, `FormulaBarContainer.tsx`, `SidePanel.tsx`,
  `hooks/grid-mouse/use-formula-range-drag.ts`, `actions/handlers/editor.ts`, and the renderer
  (`systems/renderer/execution/render-context-coordination.ts`).
- **Name metadata supply.** `FormulaMetadataCache` loads named ranges, tables, and sheet names
  from the `Workbook` API, caches a versioned snapshot, invalidates on workbook structure
  events, and is wrapped by `createFormulaNameCompletionStore` into the shape `getNameSuggestions`
  expects. One cache per workbook via a `WeakMap`.
- **Rich-text caret/selection.** `RichTextSelectionManager` translates between the browser
  `Selection` (node + offset across segment `<span>`s) and flat character offsets so the editor
  machine can save/restore caret position in rich-text cells (`RichTextEditor.tsx`).
- **Popup geometry.** `cursor-position.ts` computes where suggestion/argument-hint popups go and
  flips/clamps them to the viewport.

It is an explicitly "pure utilities + thin services" layer, partially governed by
`tools/platform-dependency-allowlist.jsonc` (which lists `cursor-position.ts` allowances).

## Improvement objectives
1. **Eliminate the duplicate-source divergence hazard (highest priority).**
   `domain/editor/formula-context.ts` and `domain/editor/formula-range-parser.ts` are
   **byte-for-byte identical** to `systems/shared/utils/formula-context.ts` and
   `systems/shared/utils/formula-range-parser.ts` (verified via `diff` — "IDENTICAL"). The two
   halves of the app import from *different* copies: the editor/selection XState machines import
   `analyzeFormulaContext` from `systems/shared/utils` (e.g.
   `systems/grid-editing/machines/editor/autocomplete.ts:15`), while UI, formula bar, action
   handlers, and the renderer import the *same functions* from `domain/editor`
   (`exports.ts:549`, `InlineCellEditor.tsx:50`, `FormulaBarContainer.tsx:45`,
   `render-context-coordination.ts:40`, etc.). A correctness fix applied to one copy silently
   does not reach the other. Collapse to a single source of truth.
2. **Fix string-literal blindness in reference extraction.** `extractFormulaRanges` runs
   `CELL_REFERENCE_PATTERN` over the *entire* formula with no string-literal tracking, so
   `=CONCAT("A1:B2")` highlights the text inside the quoted literal as a live range. This is
   inconsistent with `analyzeFormulaContext`/`detectTableRefContext`, which both skip strings.
3. **Make the reference model grammar-correct, not regex-approximate.** The parser cannot see
   structured references (`Table[Column]`) or named ranges, and it produces false positives for
   defined names shaped like cell refs (e.g. a name `Q1`). Drive extraction and context from one
   shared formula tokenizer so highlighting, drag-to-edit, and autocomplete agree on token
   boundaries and string/structured-ref handling.
4. **Repair `updateFormulaReference` absolute-marker handling.** The `$`/absolute detection in
   `buildReferenceText` is buggy: `endColAbsolute` is computed and then immediately overwritten
   (`formula-range-parser.ts:286` then `:289`), and the per-axis `$` parsing uses ad-hoc regexes
   that do not round-trip mixed references like `A$1:$B2`. Replace with an explicit per-corner,
   per-axis absolute model.
5. **De-duplicate column-letter / A1 conversion and grid bounds.** `colLetterToNumber` /
   `numberToColLetter` and the hard-coded Excel bounds (`16383` / `1048575`) are re-implemented
   here and in ~20 other files. Route through one shared A1/coordinate utility (in
   `contracts/core` or `systems/shared`) and a shared bounds constant.
6. **Clarify the domain/DOM boundary.** `selection-manager.ts` and `cursor-position.ts` reach
   `window`/`document`/`window.getSelection()` directly, which conflicts with the "pure domain"
   intent and breaks under embedding (`infra/embed`), shadow DOM, zoom, and SSR. Make host
   surfaces (viewport, root node) injectable rather than globally assumed.
7. **Make metadata loading efficient and resilient.** `loadFormulaMetadata` does an N+1 fan-out
   (`getSheet(name)` then a redundant `getSheetById(id)` per sheet, plus a `tables.list()` per
   sheet) and reloads *everything* on every structural event with no coalescing; rapid edits
   (e.g. import, multi-sheet ops) thrash. Add debounced/coalesced invalidation and remove the
   redundant double sheet lookup.
8. **Improve `RichTextSelectionManager` algorithmic cost & host-awareness.** It re-walks the
   whole text-node tree multiple times per query (`getTextNodesInOrder` called inside
   `nodeOffsetToCharOffset`, `getTextLengthBeforeNode`, `charOffsetToNodePosition`), giving
   O(n²) behavior on long rich-text cells, and assumes the global selection/document.

## Production-path contracts and invariants to preserve or strengthen
- **Determinism of pure analyzers.** `analyzeFormulaContext`, `extractFormulaRanges`,
  `findActiveReferenceIndex`, `updateFormulaReference`, `detectTableRefContext`, and the
  `cursor-position` functions must remain pure and deterministic for given inputs (the existing
  tests and the editor machine assume this — context is recomputed on every keystroke).
- **Existing public exports.** `index.ts` and `exports.ts` (lines 549, 564) re-export named
  symbols and types; the package's `exports.ts` is a published surface. Consolidation must keep
  the same exported names/types (or land deprecation re-exports) so consumers and the
  `platform-dependency-allowlist.jsonc` entries stay valid.
- **`updateFormulaReference` round-trip invariant.** Replacing a reference must preserve the
  sheet prefix and per-axis absolute markers that the existing tests pin
  (`=$A$1` → `=$C$5`, range↔single-cell transitions, multi-reference targeting, and the returned
  `newCursorPosition`). Strengthen to also round-trip *mixed* absoluteness (`A$1`, `$A1`) on both
  endpoints.
- **`extractFormulaRanges` output shape.** `{ range, color, startPos, endPos, text, index }`
  with `endPos` exclusive, sequential `index`, and colors cycled from
  `FORMULA_RANGE_COLORS` (`types/machines/src/machines/types.ts:129`). Renderer and formula bar
  depend on `startPos/endPos` for token coloring; keep them exact.
- **`FormulaMetadataCache` snapshot semantics.** Tests pin: a single shared in-flight promise
  across concurrent `request()` calls; monotonically increasing `version`; `ready` snapshot
  returned synchronously; invalidation resets to `idle` with `metadata: null`; subscribers
  notified on every snapshot change; sheet-scoped name `scope` normalized to sheet **id**.
  Preserve all of these.
- **Cache disposal/lifecycle.** `dispose()` must unsubscribe all workbook listeners, drop
  in-flight work, and be idempotent; `getFormulaMetadataCache` must not hand back a disposed
  cache. Preserve the WeakMap-per-workbook identity so callers keep getting the same instance.
- **Bounds correctness.** Cell parsing must continue to reject out-of-grid coordinates
  (col > 16383, row > 1048575) — but via a shared constant, not an inline literal.
- **Caret restoration safety.** `RichTextSelectionManager.setCharacterOffsets` must continue to
  clamp out-of-range offsets and never throw on empty/zero-text-node content (it currently
  falls back to collapsing to end); keep that guarantee.

## Concrete implementation plan
Sequenced so the low-risk consolidation lands first and unblocks the correctness work.

### Phase 1 — Single source of truth for the formula analyzers
1. Pick `domain/editor` as the canonical home for `formula-context.ts` and
   `formula-range-parser.ts` (it is the `domain` layer and already the wider import target).
2. Convert `systems/shared/utils/formula-context.ts` and
   `systems/shared/utils/formula-range-parser.ts` into thin re-exports of the `domain/editor`
   modules (or update `systems/shared/utils/index.ts` to re-export from `domain/editor`), then
   migrate the editor/selection-machine imports
   (`systems/grid-editing/machines/editor/{autocomplete,formula-editing,types,events}.ts`,
   `machines/selection/*`) to the canonical path.
3. Once no machine imports the physical `shared/utils` copies, delete the duplicate `.ts` files.
   Verify the `platform-dependency-allowlist.jsonc` still resolves (no allowlist path points at
   the deleted files; the listed `cursor-position.ts` entries are unaffected).
4. **Acceptance:** `rg` finds exactly one physical definition of `analyzeFormulaContext` and
   `extractFormulaRanges`; all consumers resolve through it.

### Phase 2 — A shared formula tokenizer
5. Introduce a single tokenizer (e.g. `domain/editor/formula-tokenizer.ts`) that walks a formula
   once and emits typed tokens: `string-literal`, `cell-ref`, `range-ref`, `structured-ref`
   (`Table[...]`), `name`, `function-name`, `paren`, `comma`, `operator`, with start/end
   positions and string/structured-ref awareness. This becomes the common substrate.
6. Reimplement `extractFormulaRanges` on top of the tokenizer so it (a) skips `string-literal`
   tokens, (b) optionally surfaces structured/named references as their own highlightable
   spans, and (c) no longer false-positives on defined names that look like cell refs (a token
   classified as `name` is not a `cell-ref`).
7. Reimplement `analyzeFormulaContext` and `detectTableRefContext` to consume the same token
   stream, so the autocomplete view and the highlight view can never disagree about where a
   string starts/ends. Preserve the existing return types exactly; the change is internal.
8. Keep the cell-ref-vs-function-name disambiguation behavior (the `LOG10` / `CEILING.MATH` /
   `A1` cases the tests pin) as classification rules inside the tokenizer.

### Phase 3 — Reference parsing correctness
9. Replace inline `colLetterToNumber` / `numberToColLetter` with the shared A1/coordinate
   utility and the shared grid-bounds constant (objective 5). If no canonical util exists in
   `contracts/core`, add one there and adopt it here first (it is reused by ~20 files).
10. Rewrite `buildReferenceText` with an explicit model: parse the original reference into
    `{ sheetPrefix, start:{colAbs,rowAbs}, end?:{colAbs,rowAbs} }`, then emit the new range
    preserving each axis's absoluteness independently. Remove the double-assignment of
    `endColAbsolute`. Add round-trip coverage for `A$1:$B2`, `$A1`, and single↔range transitions.

### Phase 4 — Metadata cache efficiency & resilience
11. In `loadFormulaMetadata`, drop the redundant `getSheetById(id)` re-lookup (reuse the
    `Worksheet` already fetched via `getSheet(name)`), and keep the `Promise.all` fan-out but
    gate concurrency for large workbooks if needed.
12. Add coalesced invalidation: debounce/batch the `invalidate()` calls fired from the 11
    workbook event subscriptions so a burst (import complete, multi-sheet structural change)
    triggers at most one reload on the next `request()`. Preserve the `version` bump and
    `idle`/`null` snapshot semantics per event for observers that rely on them, or document the
    new batched semantics explicitly.
13. Confirm `error` recovery: after a failed load, the next `request()` must retry (it currently
    does, because `error` is not short-circuited); add an explicit test so this isn't regressed.

### Phase 5 — Domain/DOM boundary
14. `cursor-position.ts`: thread an injectable viewport/host-rect source (default to
    `window`/`visualViewport`) instead of reading `window.innerWidth/Height` inline, so embedded
    and zoomed hosts position popups correctly. Factor the duplicated flip/clamp math shared by
    `clampToViewport` and `calculateFlipPosition` into one helper. Keep the existing function
    signatures additive (new optional param) so callers and the allowlist stay valid.
15. `selection-manager.ts`: (a) accept an injectable root/selection source so it works under the
    embed iframe / shadow DOM rather than only the global `window.getSelection()`; (b) compute a
    single ordered text-node list per public call and reuse it across the offset/range
    computations, removing the repeated tree walks (O(n²) → O(n)).

### Phase 6 — Name completion polish (lower priority, production-path)
16. `getNameSuggestions`: keep `startsWith` semantics but make `sortSuggestions` non-mutating
    (sort a copy) and confirm scope filtering uses the normalized sheet **id** consistently with
    `createFormulaNameCompletionStore`.
17. `detectTableRefContext`: handle multi-bracket / nested structured references
    (`Table[[#Headers],[Column]]`) so completion works inside real structured-ref syntax, not
    just the first `[`.

## Tests and verification gates
Existing specs to keep green (and extend): `__tests__/formula-context.test.ts`,
`__tests__/formula-range-parser.test.ts`, `__tests__/formula-metadata-cache.test.ts`, plus the
editor-machine specs under `systems/grid-editing/machines/editor/__tests__`.

New/updated coverage required:
- **Consolidation guard (Phase 1):** a test or lint assertion that there is a single definition
  of `analyzeFormulaContext`/`extractFormulaRanges` and that machine + UI import paths resolve to
  it.
- **String-literal safety (Phase 2):** `extractFormulaRanges('=CONCAT("A1:B2")')` returns no
  range inside the literal; `=A1&"B2"` highlights only `A1`.
- **Tokenizer parity (Phase 2):** every existing `formula-context.test.ts` and
  `formula-range-parser.test.ts` case passes unchanged against the tokenizer-backed
  implementations; add structured-ref and named-range cases.
- **Absolute round-trip (Phase 3):** `updateFormulaReference` round-trips `A$1`, `$A1`,
  `A$1:$B2`, and the existing `=$A$1`→`=$C$5` / single↔range / multi-ref / cursor-position cases.
- **Cache (Phase 4):** add a debounce/coalescing test (N rapid events → 1 reload on next
  request), an explicit `error`-then-retry test, and confirm the existing shared-in-flight,
  versioning, disposal, and sheet-id-normalization tests still pass.
- **Geometry/selection (Phase 5):** unit tests for the extracted flip/clamp helper across the
  four quadrants; `RichTextSelectionManager` round-trip tests
  (`offset → DOM range → offset`) on multi-segment and empty content, asserting clamping and
  no-throw, plus an injected-root test.
- **Verification gates (run by reviewer, not in this planning task):** package typecheck, the
  spreadsheet app's Jest suite, and the editor app-eval scenarios covering inline editing,
  formula-bar reference highlighting, drag-to-edit, and autocomplete (per the team's app-eval
  workflow). No production behavior change should appear in app-eval beyond the fixed
  string-literal highlighting and corrected absolute markers.

## Risks, edge cases, and non-goals
- **Risk — silent divergence already exists.** Because the two copies are currently identical,
  any in-flight fix to one copy elsewhere could conflict with this consolidation; land Phase 1
  promptly and coordinate with anyone touching `systems/shared/utils`.
- **Risk — tokenizer rewrite regresses subtle autocomplete heuristics.** The cell-ref-vs-function
  disambiguation and operator-as-function-start rules are heuristic and test-pinned; port them
  verbatim and gate on the full existing suite before deleting the old scanners.
- **Risk — published surface.** `exports.ts` re-exports these symbols; renames would be breaking.
  Keep names/types stable; prefer additive optional parameters.
- **Risk — allowlist coupling.** `tools/platform-dependency-allowlist.jsonc` references
  `cursor-position.ts`; signature changes there must remain allowlist-compatible (additive).
- **Edge cases:** R1C1-style references (not currently supported — keep out unless the grammar
  layer already handles them), full-column/row refs (`A:A`, `1:1`), 3-D references
  (`Sheet1:Sheet3!A1`), quoted sheet names with embedded apostrophes, and very long rich-text
  cells (selection-manager performance).
- **Non-goals:** redesigning the XState editor machine itself; changing the suggestion-popup UI
  components; introducing fuzzy/substring matching in name completion (separate UX decision);
  replacing the emoji icons in `getNameSuggestionIcon` (UI concern); any change to the Rust core
  formula engine. This plan does not reduce scope to test-only changes or add compatibility
  shims beyond the temporary re-export bridge used to retire the duplicate files.

## Parallelization notes and dependencies on other folders
- **Phase 1** touches `systems/shared/utils/` and `systems/grid-editing/machines/editor` &
  `…/selection` import paths — coordinate with the owners of those folders (queue items covering
  `systems/grid-editing` / `systems/shared`). It must precede Phases 2–3 (they edit the canonical
  copy).
- **Phase 3 / objective 5** depends on a shared A1-coordinate utility; if one must be added to
  `@mog-sdk/contracts/core`, that is a cross-folder dependency (contracts build/rollup — recall
  that editing contracts/rendering types requires building `@mog-sdk/contracts` before consumers
  typecheck). Sequence the contracts change first.
- **Phases 4, 5, 6 are independent** of each other and of Phases 2–3 (they touch
  `formula-metadata-cache.ts`, `cursor-position.ts`/`selection-manager.ts`, and
  `name-completion.ts` respectively) and can proceed in parallel once Phase 1 lands.
- **Consumer follow-ups:** `FormulaBarContainer.tsx`, `InlineCellEditor.tsx`,
  `render-context-coordination.ts`, `use-formula-range-drag.ts`, `actions/handlers/editor.ts`,
  and `RichTextEditor.tsx` may need import-path updates (Phase 1) and can opt into the new
  optional host/viewport params (Phase 5); none require behavioral changes.

---
*Status: actionable. Evidence gathered by reading all seven source files, the three test specs,
the consuming editor machine, and confirming the exact-duplicate `systems/shared/utils` copies
via `diff`. No blocking gaps.*
