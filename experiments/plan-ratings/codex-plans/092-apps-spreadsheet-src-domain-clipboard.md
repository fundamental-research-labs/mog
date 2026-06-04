# 092 - Spreadsheet Clipboard Domain Production Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/domain/clipboard`

Scope reviewed:

- `types.ts`, `cell-value-contract.ts`, `clipboard-service.ts`, `index.ts`, and `utils.ts`: the app-local canonical `ClipboardPayload` contract, value normalization helpers, exported service, and cross-view payload utilities.
- `unified-paste.ts`: keyboard/toolbar/context-menu paste routing, system clipboard reads, image/text/HTML precedence, internal clipboard signature comparison, default paste option resolution, and system clipboard writes.
- `clipboard-parser.ts` and `serializers.ts`: TSV/CSV parsing, display serialization, HTML table import/export, inline style conversion, and external value inference.
- `clipboard-data-builder.ts`, `full-shape-ranges.ts`, and `conditional-format-paste.ts`: capture of internal rich cell data, formulas, formats, merges, validation, conditional formatting, comments, hyperlinks, column widths, sparse whole-row/whole-column copies, and hidden row/column policy.
- `paste-executor.ts`, `paste-preview-calculator.ts`, and `paste-defaults.ts`: paste transforms, paste-special behavior, core `copyRange` fast path, paste-link generation, arithmetic paste, skip blanks, skip hidden target rows, validation checks, secondary payload writes, preview calculation, and persisted paste defaults.
- Existing folder tests under `__tests__`, plus adjacent production call sites in `actions/handlers/clipboard.ts`, `hooks/editing/use-clipboard.ts`, `systems/grid-editing/machines/clipboard-machine.ts`, `systems/grid-editing/coordination/paste-integration.ts`, `infra/utils/clipboard-utils.ts`, and public actor clipboard contracts under `contracts/src/actors/clipboard.ts` / `types/machines/src/actors/clipboard.ts`.

This plan is for public Mog source work in `../mog`. The planning artifact stays only in `mog-internal`.

## Current role of this folder in Mog

`domain/clipboard` is the spreadsheet app's richest clipboard domain layer. It is supposed to be the production boundary for copy/cut capture, paste routing, external import/export, paste-special transformation, and paste execution. In practice, the production path crosses several representations and neighboring folders:

- Keyboard, toolbar, and action-dispatch paste use `unifiedPaste()` to read the browser clipboard, compare system text against the actor clipboard `textSignature`, route image-only payloads to floating pictures, and send `paste`, `pasteSpecial`, or `externalPaste` commands to the clipboard machine.
- Copy/cut handlers use `buildClipboardData()` or `buildSparseClipboardData()` to capture rich internal actor `ClipboardData`, but generate system TSV/HTML through `infra/utils/clipboard-utils.ts` rather than through the same domain serializer.
- Native DOM clipboard events in `hooks/editing/use-clipboard.ts` duplicate important parts of the action-handler path: prefetch, builder wiring, sparse exports, signature comparison, default paste resolution, external paste routing, and image handling.
- The clipboard machine parses external `text/html` through `infra/utils/clipboard-utils.parseHTML`, parses plain text through `domain/clipboard/clipboard-parser`, then builds actor `ClipboardData` locally.
- `paste-executor.ts` is the target-side write planner and effect executor. It owns paste-special transforms and delegates value/formula/format copies to compute-core `copyRange` when that production path is safe, while applying secondary payloads in TypeScript.
- `types.ts` defines an app-local canonical `ClipboardPayload` for cross-view copy/paste, but the active grid production path mostly uses actor `ClipboardData`. `ClipboardService` and its singleton are exported and tested for payload creation, but the source search shows no production consumer using `copyToSystem()` or `readFromSystem()`; the real state path is the grid-editing clipboard machine, optional kernel clipboard service, and the unified paste helpers.

The folder has good foundations: explicit cell value conversion, parser tests for quoted multiline fields and formula commas, promise-based `ClipboardItem` writes that preserve browser user activation, image-paste routing tests, paste default handling, conditional-format paste helpers, and a core-copy fast path that keeps formula rebasing in compute-core.

The main weakness is that the clipboard contract is not yet singular. There are overlapping codecs, overlapping copy/cut prefetch implementations, overlapping native-event and keyboard paste routers, overlapping `ClipboardPayload` and `ClipboardData` models, and several implicit invariants around geometry, signatures, blank clearing, source ranges, and secondary payloads. That makes it too easy for one path to preserve formulas, formats, hidden rows, images, or cut semantics while another path silently diverges.

## Improvement objectives

1. Define one spreadsheet clipboard transfer contract for the app production path.
   - Make the boundary between internal rich cell data, cross-view payloads, system `text/plain`, system `text/html`, files/images, and paste intent explicit.
   - Keep `ClipboardData` compatible with public actor contracts, but stop letting each caller rebuild geometry, signatures, external formats, and source metadata independently.

2. Consolidate copy/cut capture and system export.
   - Replace action-handler and hook-local capture/export duplication with a shared domain capture service that returns rich actor data, external TSV, external HTML, normalized signatures, dimensions, and capture diagnostics from the same prefetched worksheet snapshot.
   - Ensure sparse full-shape, normal rectangular, hidden row/column, merge, validation, conditional formatting, comment, hyperlink, and column-width capture all flow through one production implementation.

3. Consolidate external import codecs.
   - Move the effective HTML table parser, TSV/CSV parser, value inference, large-text truncation, formula text policy, style mapping, and image/text precedence into domain-owned pure codecs.
   - Replace `infra/utils/clipboard-utils.parseHTML`, `serializers.htmlToCells`, and clipboard-machine local `buildClipboardDataFromParsed()` with one tested importer that builds actor `ClipboardData` plus source ranges.

4. Make clipboard freshness and suppression robust.
   - Replace plain `textSignature` equality as the only rich-data detection input with normalized text and HTML signatures, source kind, payload version, stale status, and suppressed-signature state.
   - Preserve the current line-ending normalization and canceled-text suppression behavior, but make it a contract shared by native paste events and keyboard/action paste.

5. Turn paste execution into a planned operation.
   - Split `executePaste()` into a pure `PasteWritePlan` builder and an effect applier. The plan should enumerate value updates, format updates, core `copyRange` eligibility, secondary payload updates, merge operations, validation checks, skipped cells, hidden-row mapping, affected range, and expected undo grouping.
   - Keep production writes on the existing workbook/worksheet/compute-core paths. Do not introduce direct state mutation or test-only paste shortcuts.

6. Align paste preview with paste execution.
   - Make `paste-preview-calculator.ts` consume the same transform planner as `paste-executor.ts` so preview behavior cannot drift from real paste behavior for formulas, paste link, transpose, formats-only, skip blanks, hidden target rows, and secondary payload presence.

7. Make the system clipboard bridge a typed host boundary.
   - Keep `writeToSystemClipboard()`'s promise-based `ClipboardItem` reservation pattern for user activation, but expose reads and writes through one domain interface that can consume either `navigator.clipboard.read()`, `navigator.clipboard.readText()`, or native event `clipboardData`.
   - Route image-only clipboard payloads and text/HTML payloads through the same precedence rules in every paste entry point.

8. Add executable contracts and UI gates for real copy/paste flows.
   - Cover the pure codecs and planners with table/property tests, then add machine/integration tests and browser E2E tests that use real keyboard, mouse, and clipboard paths.

## Production-path contracts and invariants to preserve or strengthen

- Browser clipboard writes that are triggered by copy/cut must reserve the system clipboard synchronously during the original user activation. Async worksheet reads may resolve promised blobs later, but no abstraction may add awaits before the write reservation.
- Internal copy data remains reusable. Internal cut data is single-use only after paste commit succeeds; paste errors, overwrite-confirm deferral, and validation/protection blocks must keep cut data available for retry.
- System clipboard replacement wins over stale internal data. If the user copies from another app after a Mog copy, paste must import the system payload instead of using rich internal data.
- Canceled or consumed internal clipboard text must not be re-imported as external plain text. Suppression must work for keyboard/action paste and native DOM paste.
- Text/HTML/image precedence stays explicit: text or HTML spreadsheet data wins over image data when both are present, while image-only payloads route to floating picture insertion when that callback is available.
- `ClipboardData.sourceRanges` and clipboard geometry must describe the intended pasted rectangle, not merely the non-empty sparse cells. Blank source positions, whole-row/whole-column selections, and sparse captures need stable dimensions so blank clearing, selection-after-paste, size checks, and paste previews stay correct.
- Internal in-document paste must prefer compute-core `copyRange` when eligible so formula references, absolute/mixed references, cross-sheet formulas, value/formula/format writes, and blank clearing are handled atomically by the production engine.
- The TypeScript paste path must still layer secondary payloads correctly: comments, hyperlinks, data validation, conditional formatting, merges, column widths, validation violation summaries, skip protected cells, and hidden target row skipping.
- External import must be deterministic across TSV, CSV, Excel HTML, Google Sheets HTML, browser tables, quoted multiline fields, tabs inside quoted fields, formula commas, large cells, cell errors, booleans, dates, percentages, currency, empty cells, row/col spans, and style attributes.
- Cell values at clipboard boundaries must stay within the public `CellValue` contract. Raw `Date` values are normalized only through explicit boundary helpers; `CellError` values serialize to display strings for system formats and stay structured internally.
- Paste-special options remain stable: values, formulas, formats, validation, conditional formatting, comments, transpose, arithmetic operations, skip blanks, paste link, skip hidden rows, protected target skips, source column widths, and progress/cancel support.
- External formats-only paste with no usable external formats should no-op without mutating workbook state or claiming a successful paste.
- Preview must not be a separate behavioral implementation. The displayed preview must be derived from the same transform semantics as execution.
- Public `mog` code must not depend on `mog-internal`. Any shared clipboard contracts/codecs that need to leave the spreadsheet app should move to a lower public package, not to internal planning or private utilities.

## Concrete implementation plan

1. Add a spreadsheet clipboard transfer model.
   - Introduce domain types such as `SpreadsheetClipboardTransfer`, `ClipboardSourceKind`, `ClipboardSystemFormats`, `ClipboardRichCellData`, `ClipboardGeometry`, `ClipboardSignatureSet`, `ClipboardImportResult`, `ClipboardCaptureResult`, and `ClipboardPasteIntent`.
   - Map the new model explicitly to public actor `ClipboardData` and app-local `ClipboardPayload`; do not add a third unowned runtime representation. The goal is an envelope that explains the source, formats, signatures, geometry, and routing state around the existing public cell payloads.
   - Define invariant helpers: `normalizeClipboardGeometry`, `assertClipboardDataInvariants`, `deriveSourceRangeGeometry`, `computeClipboardSignatures`, `normalizeClipboardTextSignature`, and `isSameSystemPayload`.
   - Add tests for malformed geometry, empty/sparse ranges, full-row/full-column intent, mismatched source ranges, line-ending normalization, trailing newline normalization, and stale/suppressed signature handling.

2. Build one capture/export pipeline.
   - Create a domain capture service that accepts worksheet-prefetched data and selected ranges, then returns `ClipboardCaptureResult` containing actor `ClipboardData`, canonical geometry, source metadata, TSV, HTML, signatures, and capture warnings.
   - Move the duplicated prefetch-to-builder assembly from `actions/handlers/clipboard.ts` and `hooks/editing/use-clipboard.ts` behind this service. Both entry points should call the same production function.
   - Replace action/hook-local `sparseClipboardDataToTSV`, `sparseClipboardDataToHTML`, and `escapeHTML` with domain-owned exporters that understand sparse/full-shape geometry.
   - Replace copy/cut use of `infra/utils/clipboard-utils.rangeToTSV/rangeToHTML` with exporters derived from the same captured rich data. This removes the current mismatch where rich internal data and system formats are built by different code with different format coverage.
   - Ensure formula-hidden protection, comments, hyperlinks, merges, validation, conditional formatting, column widths, hidden row/column handling, and display values are all captured from one worksheet snapshot.

3. Own all external import codecs in this folder.
   - Add a `clipboard-codecs` module inside `domain/clipboard` or split existing `serializers.ts` into `text-codec.ts`, `html-codec.ts`, `style-codec.ts`, and `value-codec.ts`.
   - Merge the stronger parts of both current HTML parsers: `serializers.htmlToCells` handles colspans and value inference, while `infra/utils/clipboard-utils.parseHTML` handles richer style extraction, element formatting tags, MSO hints, and color normalization.
   - Add rowSpan handling, hyperlink extraction, number format metadata where public `CellFormat` supports it, merged-cell geometry hints, and a clear policy for styles that cannot be represented.
   - Make TSV/CSV parsing and value inference a single import path. Preserve `parseClipboardText()` performance characteristics for large delimiter-free payloads and quoted multiline fields.
   - Decide and document external formula policy in code: whether strings beginning `=` enter as formulas through normal cell input semantics, remain literal text, or depend on source metadata/user paste mode. Add tests and route the machine consistently.
   - Enforce `MAX_EXTERNAL_CELL_TEXT_CHARS` in the importer rather than inside the clipboard machine so all external paths get identical truncation and surrogate-pair safety.

4. Replace clipboard-machine local parsing with the domain importer.
   - Move `parseExternalData()`, `parseExternalText()`, `buildClipboardDataFromParsed()`, and `truncateExternalCellText()` out of `systems/grid-editing/machines/clipboard-machine.ts` into `domain/clipboard`.
   - The machine should receive an `ExternalPastePayload`, call one importer, then store the returned `ClipboardData`, source ranges, source kind, and signatures.
   - Keep UI-only machine state in the machine: copy/cut state, marching ants, paste preview target, paste options, stale flag, overwrite/mismatch retry state, and suppressed signatures.
   - If kernel clipboard service migration is available first, use the kernel payload version/signature data as an input to the domain importer instead of duplicating version state. Do not make the spreadsheet app depend on private/internal code.

5. Unify paste routing across action and native event paths.
   - Create a `SpreadsheetClipboardRouter` that accepts `ClipboardPasteIntent` from keyboard/action handlers, toolbar/context menu handlers, native DOM paste events, and programmatic hook calls.
   - It should read available system formats through a typed `ClipboardHost` interface, compare against current actor/kernel clipboard state, apply paste defaults, decide image/text/HTML/internal routing, suppress canceled signatures, show/hide paste preview, and await paste commit when requested.
   - Refactor `unifiedPaste()` to be a thin wrapper around the router. Refactor `use-clipboard.ts` native paste handling to use the same router instead of duplicating signature comparison and external paste logic.
   - Keep edit-mode behavior outside the router: editing a cell should still defer to native browser text selection/caret paste before the spreadsheet clipboard route starts.

6. Strengthen the system clipboard host boundary.
   - Replace direct feature checks scattered through `unified-paste.ts`, `clipboard-service.ts`, and hook code with `BrowserClipboardHost` methods: `reserveWrite(formatsPromise)`, `readAvailableFormats()`, `readTextFallback()`, and `eventFormats(event.clipboardData)`.
   - Preserve support for `text/plain`, `text/html`, and the current image MIME ordering (`png`, `jpeg`, `gif`, `webp`, `svg+xml`, `bmp`).
   - Add a deterministic test host for unit tests, but do not route production through a mock-only service.
   - Keep no-system-clipboard fallback behavior: if browser read fails and fresh internal data exists, internal paste can still proceed; if there is no internal data, paste no-ops without corrupting state.

7. Split paste execution into planning and applying.
   - Introduce `buildPasteWritePlan(data, target, sheetId, options, storeCapabilities)` as a pure or near-pure function. It should produce:
     - transformed data summary and dimensions,
     - core `copyRange` eligibility and copy type,
     - value updates,
     - format updates,
     - comments/hyperlinks/validation/conditional-format/merge/column-width operations,
     - hidden-row mapping,
     - protected/skip-cell omissions,
     - validation checks to perform,
     - affected range and cell count semantics,
     - progress/cancel metadata.
   - Keep `applyPasteWritePlan(plan, store)` as the side-effecting executor.
   - Preserve the existing core `copyRange` fast path and its safety gates, including dense full-shape safeguards, skipHiddenRows, skipCells, operation, and copy type restrictions.
   - Make secondary payload behavior explicit when core `copyRange` is used. The plan should show which parts compute-core owns and which TypeScript still applies.
   - Add property/table tests for all paste-special combinations, including values/formulas/formats/all, paste link, transpose, skip blanks, arithmetic operations, errors, protected cells, hidden rows, comments, hyperlinks, validation, conditional formatting, merges, and column widths.

8. Derive paste preview from the paste plan.
   - Replace `paste-preview-calculator.ts` transform duplication with `buildPastePreviewFromPlan(plan, context)`.
   - Preview should know when execution will no-op, when it will use core copy, when it will skip protected or hidden target rows, and when formats-only external paste has no usable formats.
   - Keep preview non-mutating and cheap, but do not let it use different option mapping or dimension logic from the executor.

9. Retire or narrow the app-local `ClipboardService`.
   - Audit whether `ClipboardService` should remain a public convenience for cross-view payload helpers or be replaced by the router/host/capture services.
   - If retained, make it delegate to the same codecs, signatures, and host boundary as the production path. It should not keep a parallel internal state model with different read/write semantics.
   - If no production owner uses the singleton, remove the singleton export in the same workstream after public export impact is checked, or narrow it to pure payload creation helpers. Do not leave a second service that looks authoritative but is not in the actual grid path.

10. Coordinate with the kernel clipboard service direction.
   - The adjacent kernel clipboard plan wants the kernel service to become the document-level clipboard authority. This folder should still own spreadsheet-specific capture, import/export codecs, paste-special planning, and image/cell routing.
   - Once the kernel service exposes canonical payload versions, normalized signatures, host read/write results, and cut session semantics, migrate spreadsheet state storage to consume that authority while keeping UI-only state local in the grid-editing machine.
   - Avoid a half-migration where both kernel and spreadsheet services store rich data with different freshness rules. Pick one owner per phase and assert the ownership in tests.

## Tests and verification gates

Required focused tests for the implementation work:

- Codec tests for TSV, CSV, HTML, inline styles, element styles, MSO attributes, colors, hyperlinks, row/col spans, merged cells, formulas, errors, booleans, dates, percentages, currency, empty cells, quoted multiline fields, formula commas, tabs in quoted fields, large cell truncation, and malformed HTML.
- Contract tests for `SpreadsheetClipboardTransfer` and actor `ClipboardData` invariants: dimensions, source ranges, sparse/full-shape geometry, source sheet IDs, signatures, suppressed signatures, source kind, payload version, and immutable or cloned payload behavior where applicable.
- Capture tests for normal rectangular copy, sparse whole-row/whole-column copy, hidden rows/columns, formula-hidden protected cells, comments, hyperlinks, merges, validation, conditional formatting, source column widths, empty selections, and large-selection guards.
- Router tests for internal copy paste, internal cut paste, stale internal data, changed system clipboard, read permission failure fallback, canceled internal text suppression, external text paste, external HTML paste, image-only paste, mixed image+text payloads, paste defaults, formats-only no-op, and wait-for-commit behavior.
- Paste plan/executor tests for every paste-special option and secondary payload class, including core `copyRange` eligibility and non-eligibility cases.
- Clipboard machine and paste-integration tests proving external import, paste options, overwrite confirmation, cut retry, cut consumed cleanup, protected cells, hidden-row skipping, validation summaries, and selection-after-paste use the new domain planner/importer.
- Browser E2E/app-eval scenarios that use real UI input paths: keyboard copy/cut/paste, toolbar paste, context menu paste, paste special values/formulas/formats/transpose/link, external HTML paste from the system clipboard, image paste, cut overwrite confirmation, paste into filtered rows, protected target paste, and edit-mode text paste deferral.

Verification gates to run when implementing:

- `pnpm --filter @mog/app-spreadsheet test -- src/domain/clipboard`
- `pnpm --filter @mog/app-spreadsheet test -- src/systems/grid-editing/coordination`
- `pnpm --filter @mog/app-spreadsheet test -- src/actions/handlers`
- `pnpm --filter @mog/app-spreadsheet typecheck`
- Repo-level `pnpm typecheck` when public actor contracts, app exports, or shared clipboard contracts change.
- Public API/publish-readiness checks if `exports.ts`, `contracts/src/actors/clipboard.ts`, or `types/machines/src/actors/clipboard.ts` change.
- A dev-server browser pass for real copy/cut/paste behavior after UI, host clipboard, or paste integration changes. E2E tests must seed clipboard through real browser clipboard/event paths, not direct actor mutation.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Browser clipboard APIs are timing-sensitive. The most important regression risk is accidentally moving system clipboard write reservation after an async worksheet read.
- Browser permissions and API support vary: `navigator.clipboard.read`, `readText`, `write`, `writeText`, `ClipboardItem`, native `event.clipboardData`, image MIME access, and DOMParser may not all be present.
- Excel, Google Sheets, browsers, and native apps emit different HTML. The importer should be table-driven against representative payloads rather than tuned to one source.
- Clipboard payloads can be large. Parser, serializer, signature, and HTML import work must avoid quadratic string behavior and avoid dumping large payloads into devtools or snapshots.
- Geometry is subtle for sparse full-shape copies. Computing dimensions from populated cell keys alone can break blank clearing, size mismatch checks, and selection-after-paste.
- Core `copyRange` is the right production path for internal formula rebasing, but only when its safety contract is satisfied. Fallback TypeScript writes must be explicit and tested so they do not silently skip formula adjustment cases that should have used core.
- Secondary payloads can drift from values/formulas/formats because they are applied after the core write. The plan/apply split should make ordering and failure behavior visible.
- Kernel clipboard migration may overlap with this work. Avoid introducing a new long-lived spreadsheet clipboard service that conflicts with the kernel authority.

Non-goals:

- Do not introduce test-only clipboard shortcuts, direct actor-state seeding for E2E verification, or mock-only production paths.
- Do not reduce format, formula, validation, comments, conditional formatting, hyperlink, merge, image, or paste-special coverage to simplify the migration.
- Do not move public spreadsheet behavior or contracts into `mog-internal`.
- Do not bypass workbook/worksheet APIs or compute-core for production mutations.
- Do not optimize parser or paste benchmark harnesses unless the same code runs in the production app.

## Parallelization notes and dependencies on other folders, if any

Natural parallel workstreams:

- Agent A: contract and invariant worker. Define `SpreadsheetClipboardTransfer`, geometry/signature helpers, payload assertions, and contract tests.
- Agent B: codec worker. Consolidate TSV/CSV/HTML/style/value import/export, merge the existing domain and infra parsers, and add representative external payload fixtures.
- Agent C: capture/export worker. Refactor action and hook copy/cut paths to one domain capture service, including sparse/full-shape export and system TSV/HTML generation.
- Agent D: router/host worker. Implement the typed clipboard host and shared paste router, then migrate `unifiedPaste()` and native event paste handling.
- Agent E: paste planner worker. Split `executePaste()` into plan/apply, align preview with the plan, and cover paste-special/secondary payload matrices.
- Agent F: integration/E2E worker. Update clipboard machine, paste integration, action handlers, hook callers, and real UI tests.

Dependencies:

- `mog/apps/spreadsheet/src/actions/handlers/clipboard.ts` and `mog/apps/spreadsheet/src/hooks/editing/use-clipboard.ts` for copy/cut/paste entry points that must converge on the new domain services.
- `mog/apps/spreadsheet/src/systems/grid-editing/machines/clipboard-machine.ts` and `coordination/paste-integration.ts` for actor state, external paste import, paste side effects, overwrite/mismatch dialogs, and cut lifecycle.
- `mog/apps/spreadsheet/src/infra/utils/clipboard-utils.ts` for parser/export code to migrate or delete after the domain codecs own production behavior.
- `mog/contracts/src/actors/clipboard.ts` and `mog/types/machines/src/actors/clipboard.ts` for public actor clipboard types, `ClipboardData`, `PasteSpecialOptions`, and external paste payloads.
- `mog/kernel/src/services/clipboard` and public service contracts if the kernel clipboard authority migration lands in parallel.
- Worksheet/workbook APIs for range reads, identity reads, formats, comments, validation, conditional formats, merges, pictures, copyRange, relocation, protection, hidden rows, and undo grouping.
