# Plan 092 — Unify the clipboard serialization/parse layer and decompose the paste executor in `mog/apps/spreadsheet/src/domain/clipboard`

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/domain/clipboard` (the spreadsheet app's domain-layer clipboard module: copy/paste parsing, serialization, and the system-clipboard bridge).
- **In scope (files in this folder):**
  - `index.ts` — public barrel for the module.
  - `types.ts` — the cross-view canonical `ClipboardPayload`, `ViewClipboardContract`, `PasteOptions`, `SystemClipboardData`.
  - `clipboard-service.ts` — `ClipboardService` + `clipboardService` singleton: system clipboard read/write, internal payload state, cut-consume lifecycle, legacy `execCommand` fallback.
  - `serializers.ts` — `cellsToTSV` / `tsvToCells` / `cellsToHTML` / `htmlToCells` / `inferValue` (the `ClipboardPayload`-side serialization).
  - `clipboard-parser.ts` — `parseTSV` / `parseCSV` / `parseClipboardText` / `detectFormat` (the formula-aware delimited-text parser the grid paste actually uses).
  - `clipboard-data-builder.ts` — `buildClipboardData` / `buildSparseClipboardData` + capture of merges, validation, conditional formats, comments, hyperlinks, column widths into the sparse `ClipboardData` model.
  - `paste-executor.ts` — `executePaste` (the 1,331-line monolithic in-document paste engine) + `PasteStoreOperations`, transpose/filter/arithmetic pure functions, `createDefaultPasteOptions`.
  - `paste-preview-calculator.ts` — `calculatePastePreview`, `pasteOptionToSpecialOptions`.
  - `unified-paste.ts` — `unifiedCopy` / `unifiedCut` / `unifiedPaste` / `writeToSystemClipboard` (framework-agnostic copy/cut/paste orchestration + image routing).
  - `paste-defaults.ts` — normal-paste default resolution (`resolveDefaultPasteOptions`, `shouldNoopExternalFormatsPaste`).
  - `conditional-format-paste.ts` — replay of clipboard CF payloads at the paste target.
  - `full-shape-ranges.ts` — full-row/full-column detection and `isDenseCoreCopyUnsafeForSource`.
  - `cell-value-contract.ts` — canonical cell-value ↔ text/typed conversions.
  - `utils.ts` — `ClipboardPayload`-side helpers (transpose, extract, type compatibility, schema conversion).
  - `clipboard-utils.ts` — `parseCellKey`, re-exported `normalizeRange`.
  - `__tests__/` — existing unit tests (cell-value-contract, clipboard-parser, conditional-format copy/paste, paste-defaults, unified-paste-image, write-to-system-clipboard).
- **Out of scope (referenced, not edited by this plan):** `src/systems/grid-editing/machines/clipboard-machine.ts` (the XState machine that consumes `parseClipboardText`/`parseHTML` and owns `externalPaste`), `src/infra/utils/clipboard-utils.ts` (`parseHTML`, `rangeToTSV`, `rangeToHTML`), `src/infra/state/paste-defaults-store.ts`, the view adapters under `src/views/*` and `src/coordinator/*` that implement/consume `ClipboardPayload`, the contracts package `@mog-sdk/contracts/actors` (owner of `ClipboardData` / `ClipboardCellData` / `PasteSpecialOptions`), and the compute-core `copy_range` Rust path.

## Current role of this folder in Mog

This folder is the spreadsheet app's domain layer for everything that happens between a copy/cut gesture and a committed paste. It is the bridge between three worlds: the in-memory selection, the OS clipboard, and the compute core.

Critically, it contains **two largely disjoint data pipelines that share a directory but not a model:**

1. **The cross-view canonical pipeline** (`ClipboardPayload`). `types.ts` defines a dense `cells.values[][]` + optional `tableContext` + `text`/`html` payload. `ClipboardService`, `serializers.ts`, `utils.ts`, and `cell-value-contract.ts` operate on it. View adapters (`GridViewAdapter`, `KanbanViewAdapter`, `CalendarViewAdapter`, `FormViewAdapter`, `TimelineViewAdapter`, `GalleryViewAdapter`) and the coordinator (`view-clipboard-data.ts`, `shell-coordinator.ts`) export to / import from this format. Its purpose is 2N (export+import per view) cross-view translation instead of N×N.

2. **The in-document grid paste pipeline** (`ClipboardData`, owned by `@mog-sdk/contracts/actors`). This is a *sparse* `Record<"row,col", ClipboardCellData>` model. `clipboard-data-builder.ts` builds it from the store; `paste-executor.ts` applies it (with a fast path that routes value/formula/format writes through compute-core `copy_range` for correct reference rebasing, then layers comments/hyperlinks/validation/CF/merges/column-widths on top in TS); `paste-preview-calculator.ts` previews it; `unified-paste.ts` orchestrates it through the `clipboard-machine`. This is what fires on Ctrl+C/X/V and the paste-special menu inside the grid.

`clipboard-parser.ts` is the delimited-text parser the *real* grid paste uses (via `clipboard-machine` → `parseClipboardText`). It is deliberately formula-aware: structural delimiters and row breaks are suppressed inside quoted fields **and** inside unquoted formula argument lists / string literals, so `=SUM(1,2)` is not fragmented on a comma. `serializers.ts:tsvToCells` is a *second, independent* TSV parser used by `ClipboardService` that lacks this protection and additionally performs lossy type inference via `inferValue`.

So the folder's real shape today is: one well-factored small parser (`clipboard-parser.ts`), one carefully-reasoned but enormous executor (`paste-executor.ts`), and a parallel serialization stack (`serializers.ts` + `inferValue`) that duplicates and diverges from both `clipboard-parser.ts` and the infra-layer `parseHTML`/`rangeToTSV`/`rangeToHTML`.

## Improvement objectives

1. **Eliminate the divergent third TSV/CSV parser.** `serializers.ts:tsvToCells` is a hand-rolled quote-aware splitter that does **not** carry the formula-protection logic of `clipboard-parser.ts:parseDelimitedText`. Any `ClipboardPayload` ingest path that runs CSV through `tsvToCells` (or the `ClipboardService.parseExternalClipboard` fallback) will mis-split unquoted formulas/text containing commas, while the grid's own machine path parses them correctly. There must be **one** delimited-text tokenizer, and it must be the formula-aware one.

2. **Make type inference a single, explicit, guarded step.** `inferValue` (in `serializers.ts`) is locale-blind and lossy: it strips `%` to a fraction, treats commas as thousands separators (so `1,234` → `1234`), coerces numeric-looking strings, and keeps ambiguous `MM/DD/YYYY` vs `DD/MM/YYYY` as opaque strings. This silently mangles IDs, zip codes, phone numbers, and account numbers on external paste, and it disagrees with how the grid-machine path types values. Inference should be one named, testable contract shared by both pipelines, with leading-zero / over-precision guards so identifier-like text is preserved.

3. **Decompose `paste-executor.ts`.** `executePaste` is a single 500-line function performing ~10 ordered phases (transpose → filter → fast-path decision → per-cell update synthesis → unmerge → core/TS write → merge recreate → comments → validation → hyperlinks → CF → column widths → post-paste validation check). The phase ordering, the `useCoreCopyRange` decision, and the "format-only entries must not take the All fast path" reasoning are correct and load-bearing — but they are untestable in isolation because they live in one closure with a single try/catch. Extract each phase into a named, individually-testable applier while preserving the exact ordering and the fast-path gating.

4. **Collapse the `getClipboardDimensions` name collision.** The barrel exports two different functions named `getClipboardDimensions` — one for `ClipboardData` (paste-executor) and one for `ClipboardPayload` (utils, re-exported as `getPayloadDimensions`). The collision is a direct symptom of objective-wide model duplication; name them by the model they operate on (`getClipboardDataDimensions` / `getClipboardPayloadDimensions`) so the two pipelines stop sharing ambiguous identifiers.

5. **Replace silent-failure error handling with structured outcomes.** `ClipboardService.copyToSystem`/`readFromSystem` and `unifiedPaste`'s clipboard read swallow failures into `console.warn` or bare `catch {}`. Callers cannot distinguish "permission denied" from "empty clipboard" from "parse failure." Surface a discriminated result so the coordinator can decide UX (toast, retry, fall back to internal), without changing the happy path.

6. **Sanitize the HTML serialization round-trip.** `cellsToHTML`/`formatToInlineStyle` interpolate externally-sourced `fontFamily`, `fontColor`, and `backgroundColor` straight into a `style="..."` attribute (and `font-family: "${fontFamily}"` can be broken out of with a `"` in the family name). Cell text is escaped, but style values are not. Validate/escape style values so a crafted external paste cannot inject attributes or break out of the style string when the payload is later re-serialized to the system clipboard.

7. **Retire the deprecated `execCommand` legacy clipboard write** (`legacyCopyToClipboard`) in favor of the async Clipboard API already used everywhere else, or confine it behind an explicit capability check with a structured "unsupported" outcome rather than `innerHTML` + `document.execCommand('copy')`.

## Production-path contracts and invariants to preserve or strengthen

**Must preserve (behavioral contracts):**

- **`ClipboardPayload` shape and `ViewClipboardContract`** — `cells.values` is always present; `cells.formulas[r][c]` strings carry the leading `=`; `tableContext` is optional; `text` (TSV) is always present; `html` is optional. Every view adapter and the coordinator depend on this exactly. Any serialization refactor must keep `ClipboardService.createPayload` producing identical `text`/`html` for the same input.
- **The `useCoreCopyRange` fast-path gating in `executePaste`.** All of these conditions must remain exactly as they are: internal single-range source only; at least one cell with real value/formula content for the relevant copy type (the format-only-entries guard that prevents `CopyType::All` writing `Null` over existing targets); `operation === 'none'`; not `skipHiddenRows`; not `skipCells`; not `isDenseCoreCopyUnsafeForSource` (full-row/full-column). Cross-sheet pastes **do** take the core path (engine reads its own mirror; naked relative refs rebind via the engine). The plan must not "simplify" away the comment-documented reasoning that a second TS blank-clear pass is wrong for cross-sheet paste.
- **Phase ordering in `executePaste`** — unmerge-before-write; values/formulas before formats; merges/comments/validation/hyperlinks/CF/column-widths after the core write; post-paste validation check last. Comments must be applied after values so target cells exist for attachment.
- **Paste-type semantics** — `filterByPasteType` (values vs formulas vs formats vs paste-all), `filterBlanks`, `transposeData` (including offset swaps for merges, validation, and CF on transpose), and the Excel-aligned arithmetic semantics in `applyArithmeticOperation` (`target − source`, `target / source`, divide-by-zero → `Div0`, skip-when-target-is-text via `SKIP_OPERATION`).
- **Cut single-use lifecycle** — `cutConsumed` gating in `ClipboardService` and the `isCut`/`suppressedTextSignature`/`isStale` routing in `unifiedPaste`. Internal-cut must never have a normal-paste default applied (`paste-defaults.ts` `'cut-move-preserved'`).
- **Signature-based own-clipboard detection** — `normalizeClipboardSignature` (CRLF/CR→LF, trailing-newline strip) and the `internalSignature === systemSignature` comparison that decides internal-vs-external routing. This is what preserves formulas/formats when the user pastes back our own copy.
- **Image-paste routing priority** — image paste fires only when there is no `text`/`html` on the clipboard (Excel-aligned: a range copied from another spreadsheet carries both an image and cells; the user wants the cells). Covered by `unified-paste-image.test.ts`.
- **`writeToSystemClipboard` user-activation contract** — the promise-based `ClipboardItem` blobs that reserve the clipboard slot synchronously within the user-activation window. Errors propagate (no swallowing) by design; preserve that.
- **`skipHiddenRows` default true** (`createDefaultPasteOptions`) and the relative-row→target-row visible-row mapping.

**To strengthen:**

- **One tokenizer, one inference contract.** After unification, exactly one formula-aware delimited-text parser exists, and exactly one `inferValue`-equivalent, both shared by the `ClipboardPayload` and `ClipboardData` ingest paths.
- **Structured failure outcomes** at the system-clipboard boundary (objective 5), strengthening the current best-effort-with-console.warn posture.
- **No unsanitized interpolation** into HTML style attributes (objective 6).
- **Each `executePaste` phase independently unit-testable** (objective 3).

## Concrete implementation plan

> Ordering note: objectives 1, 4, 5, 6, 7 are low-risk and independent; objectives 2 and 3 are higher-risk and should land last, behind their own test expansion. No production behavior change is intended except where explicitly called out (error surface, HTML sanitization, identifier-preservation in inference).

**Phase 0 — Confirm provenance and the two-model boundary (read-only).**
- Trace every caller of `serializers.ts:tsvToCells` and `ClipboardService.parseExternalClipboard` to confirm which production paths ingest external CSV/TSV through `serializers.ts` vs through `clipboard-machine` → `clipboard-parser.ts`. This determines whether `tsvToCells` is reachable with comma-delimited data (the formula-split divergence) in production or only via `ClipboardService`.
- Confirm whether `ClipboardService` is on a live cross-view paste path (it is referenced by `coordinator/shell-coordinator.ts`, `systems/shared/actor-manager.ts`, `systems/grid-editing/machines/clipboard-machine.ts`) and which of its methods are actually exercised, so the error-surface change in objective 5 targets real callers.
- Diff `serializers.ts` HTML emit/parse against `infra/utils/clipboard-utils.ts` (`parseHTML`/`rangeToHTML`/`rangeToTSV`) to enumerate behavioral deltas (style coverage, colspan handling, format inference) before merging.

**Phase 1 — Single delimited-text tokenizer (objective 1).**
- Make `clipboard-parser.ts:parseDelimitedText` the one tokenizer. Refactor `serializers.ts:tsvToCells` to consume `parseTSV`/`parseClipboardText` for tokenization, then apply `inferValue` per cell, rather than re-implementing quote handling. This immediately gives the `ClipboardPayload` path the formula-aware comma protection.
- Keep `cellsToTSV` (emit) as-is in behavior but verify its quoting (`"` doubling, escape on tab/newline/quote) round-trips through the unified tokenizer.

**Phase 2 — Single, guarded inference contract (objective 2).**
- Promote inference to one exported function (extend `cell-value-contract.ts`, which already owns cell-value↔text). It must: preserve leading-zero strings (`"001234"`) as text; preserve numbers whose round-trip changes the string (over-long integers, exponent reflowing); keep `%`/currency/thousands handling behind explicit, documented rules; and keep ambiguous date formats as strings (current behavior). Replace `serializers.ts:inferValue` with a re-export.
- Reconcile with how `clipboard-machine` types parsed `string[][]` so external paste through either path produces the same `CellValue`. If the machine has its own coercion, route it through the shared contract.

**Phase 3 — Resolve the dimensions name collision (objective 4).**
- Rename the two `getClipboardDimensions` to `getClipboardDataDimensions` (paste-executor) and `getClipboardPayloadDimensions` (utils), update the barrel and all in-folder callers (`paste-preview-calculator.ts`, internal executor uses). Keep the old exported names as deprecated re-exports for one change if external consumers reference them (Phase 0 confirms).

**Phase 4 — Structured failure outcomes (objective 5).**
- Introduce a discriminated result (e.g. `{ ok: true } | { ok: false; reason: 'permission-denied' | 'unavailable' | 'empty' | 'parse-failed' }`) for `ClipboardService.copyToSystem`/`readFromSystem`. Preserve the existing fall-back-to-internal behavior; only add the signal. Update the coordinator callers identified in Phase 0 to consume it (still defaulting to current UX if they choose to ignore the reason).
- Replace bare `catch {}` in `unifiedPaste`'s read with the same classification, keeping the "internal clipboard fallback when system read fails" path intact.

**Phase 5 — HTML style sanitization + legacy write retirement (objectives 6, 7).**
- In `formatToInlineStyle`, validate color values against an allowlist pattern (hex / `rgb()` / named) and strip/escape characters that could terminate the attribute; reject `"`/`;`/`<`/`>` in `fontFamily`. In `parseInlineStyle`, normalize on the way in too.
- Remove `legacyCopyToClipboard` (or gate it behind a capability check returning the structured `'unavailable'` outcome) once Phase 0 confirms no environment Mog targets lacks `navigator.clipboard`.

**Phase 6 — Decompose `executePaste` (objective 3, highest risk, last).**
- Extract each phase into a named function taking explicit inputs and the `PasteStoreOperations` slice it needs: `decideCorePath(...)`, `synthesizeCellUpdates(...)`, `applyUnmerges(...)`, `writeCoreOrCellByCell(...)`, `recreateMerges(...)`, `applyComments(...)`, `applyValidation(...)` (already partly extracted), `applyHyperlinks(...)`, `applyConditionalFormats(...)` (already in `conditional-format-paste.ts`), `applyColumnWidths(...)`, `checkPastedValuesAgainstValidation(...)`. `executePaste` becomes a thin orchestrator that calls them in the same order inside the same try/catch and assembles `PasteResult`.
- Preserve the abort-signal check, large-paste progress reporting (`LARGE_PASTE_THRESHOLD`, `PROGRESS_CALLBACK_INTERVAL_MS`), and `cellCount` derivation (geometry for core path, update-list length otherwise) exactly.

## Tests and verification gates

- **Existing tests must stay green:** `__tests__/clipboard-parser.test.ts`, `clipboard-cell-value-contract.test.ts`, `conditional-format-copy-paste.test.ts`, `paste-defaults.test.ts`, `unified-paste-image.test.ts`, `write-to-system-clipboard.test.ts`.
- **New unit tests (objective-aligned):**
  - Tokenizer unification: a CSV payload containing `=SUM(1,2)` and a text cell with an internal comma must tokenize identically through `tsvToCells` and `parseClipboardText`; assert no formula fragmentation.
  - Inference guards: `"001234"`, `"+15551234567"`, `"1,234"`, `"50%"`, `"1e3"`, ISO date, `MM/DD/YYYY` — assert identifier-like strings stay text and round-trip is lossless.
  - `getClipboardData/PayloadDimensions` rename: dimension parity on dense vs sparse inputs.
  - Structured outcomes: simulate `navigator.clipboard.read` rejecting (permission) vs returning empty vs returning unparseable — assert the right `reason` and that internal-clipboard fallback still fires.
  - HTML sanitization: a `fontFamily`/`fontColor` carrying `"` / `;` / `</style>` must not break out of the `style` attribute on re-serialize; round-trip parse→emit→parse is stable.
  - `executePaste` per-phase: with a stubbed `PasteStoreOperations`, assert phase ordering (unmerge before write, comments after values), the `useCoreCopyRange` decision table (internal/external, each copy type, format-only-entries guard, full-shape unsafe, skipHidden, skipCells, cross-sheet), transpose offset swaps for merges/validation/CF, and arithmetic semantics including `SKIP_OPERATION`.
- **Regression coverage via app-eval/api-eval** (do not run here; list as the gate the change must pass): copy/paste round-trips, paste-special (values/formulas/formats/transpose/link), cut-then-paste move, paste into filtered (hidden) rows, cross-sheet paste reference rebasing, external paste from a TSV/CSV/HTML payload, and image paste.
- **Standard gates:** typecheck (`@mog-sdk/contracts` rebuild first if any `actors` type is touched — though this plan does not edit contracts), lint, and the spreadsheet app test suite. The contracts-declaration rollup is **not** triggered unless a contract type changes; this plan keeps `ClipboardData`/`PasteSpecialOptions` ownership in `@mog-sdk/contracts/actors` untouched.

## Risks, edge cases, and non-goals

**Risks:**
- **`executePaste` decomposition is the highest-risk change.** The function's comments encode hard-won reasoning (cross-sheet blank-clear, format-only-entry fast-path exclusion, viewport-scoped source reads). A naive extraction that drops a guard will silently corrupt cross-sheet or cut-paste. Mitigation: land Phases 1–5 first; gate Phase 6 behind the per-phase decision-table tests above; keep the orchestrator's call order byte-for-byte equivalent.
- **Inference behavior change is user-visible.** Tightening number/identifier handling (objective 2) changes what external paste produces. This is intentional (preserving `"001234"`) but must be validated against the grid-machine path so the two ingest routes don't diverge in the *opposite* direction. If parity with the machine forces keeping current lossy behavior on one path, prefer fixing both rather than re-forking.
- **Tokenizer merge could regress `ClipboardService` consumers** if any relied on `tsvToCells`'s naive splitting. Phase 0 must enumerate them.

**Edge cases to keep covered:** empty clipboard; single empty cell; trailing tab → trailing empty cell; CRLF vs LF vs CR; quoted field with embedded newline; colspan in pasted HTML; merged regions only partially inside the selection (must not be captured); validation/CF refs that are cross-sheet (skipped) or non-`row:col` encoded (skipped); full-row/full-column copies routed through `buildSparseClipboardData`; large paste (≥ `LARGE_PASTE_THRESHOLD`) progress + abort.

**Non-goals:**
- **Not** merging `ClipboardPayload` and `ClipboardData` into one model. They serve genuinely different consumers (cross-view dense vs in-document sparse/engine-routed); unifying them is a much larger cross-folder effort and is explicitly out of scope here. This plan unifies only the *serialization/parse/inference* layer beneath them.
- **Not** moving `parseHTML`/`rangeToTSV`/`rangeToHTML` out of `infra/utils` into this folder (cross-folder relocation; out of scope), though Phase 0 diffs them to inform deduplication.
- **Not** changing the compute-core `copy_range` contract or any Rust.
- No compatibility shims, test-only fixes, or feature-flag toggles as the deliverable — the production serialization path is changed directly, with the old divergent parser removed once callers are migrated.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:** Phase 1 (tokenizer), Phase 3 (dimensions rename), Phase 5 (HTML sanitization + legacy retirement) touch disjoint files and can proceed concurrently.
- **Cross-folder coordination required:**
  - Objective 2 (inference) and Phase 1 must reconcile with `src/systems/grid-editing/machines/clipboard-machine.ts` (owner of the external-paste typing) — a reviewer familiar with the machine should confirm parity.
  - Objective 5 (structured outcomes) changes `ClipboardService` method signatures consumed by `src/coordinator/shell-coordinator.ts` and `src/systems/shared/actor-manager.ts`; those call sites must be updated in the same change.
  - Phase 0's HTML diff touches `src/infra/utils/clipboard-utils.ts` (read-only).
- **No dependency on contracts rebuild** unless a future revision decides to relocate the inference contract into `@mog-sdk/contracts` (not proposed here). `ClipboardData`/`ClipboardCellData`/`PasteSpecialOptions` remain owned by `@mog-sdk/contracts/actors` and are not modified.
- **Sequencing dependency:** Phase 6 (executor decomposition) depends only on its own tests, not on Phases 1–5, but should land *after* them so the executor isn't being restructured while the serialization layer beneath it is also moving.
