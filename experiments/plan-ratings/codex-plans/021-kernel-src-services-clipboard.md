# Kernel Clipboard Service Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/services/clipboard`

In-scope source files observed:

- `clipboard-service.ts`: per-document XState service for copy, cut, paste lifecycle state.
- `types.ts`: kernel-local `ClipboardPayload`, snapshot, event, and service interfaces.
- `index.ts`: public barrel exports for the service.

This plan treats the folder as the kernel-owned clipboard authority, but the production behavior crosses these boundaries:

- `kernel/src/context/kernel-context.ts` creates the per-document service.
- `kernel/src/api/app/app-kernel-api.ts` exposes clipboard operations to apps and currently performs browser text clipboard writes.
- `types/api/src/services/index.ts` and `types/api/src/apps/api.ts` publish parallel clipboard contracts.
- `apps/spreadsheet/src/systems/grid-editing/machines/clipboard-machine.ts`, `apps/spreadsheet/src/domain/clipboard`, and `apps/spreadsheet/src/actions/handlers/clipboard.ts` own much of the current spreadsheet copy/paste, system clipboard, HTML import, image paste, paste special, and format transfer behavior.

## Current role of this folder in Mog

The kernel clipboard folder is a small per-document system service. It stores a `ClipboardPayload`, tracks whether the operation is copy or cut, exposes a snapshot to subscribers, marks data stale on focus loss, and clears cut data after a successful paste. It is created with other kernel services and survives app switches.

The current implementation is not yet the full production clipboard authority. It does not read or write the system clipboard, does not parse external text or HTML, does not validate or normalize payload dimensions, and does not own paste import semantics. The spreadsheet app still has a richer clipboard domain service and a separate grid-editing clipboard machine. Kernel app APIs bridge into the kernel service, but the bridge is lossy: it synthesizes column IDs, drops formulas and formats from app payloads, hard-codes `source.viewType` to `kanban`, exposes only a reduced app snapshot, and writes only `text/plain` to the browser clipboard.

## Improvement objectives

1. Make the kernel clipboard service the single production authority for clipboard state, payload freshness, cut single-use behavior, paste session lifecycle, and cross-app clipboard subscriptions.
2. Replace duplicated clipboard payload definitions with one canonical public contract and explicit adapters at app/view boundaries.
3. Preserve full spreadsheet fidelity through copy, cut, paste, import, and format transfer: values, formulas, formats, table context, source metadata, text, HTML, and non-cell system clipboard items that existing paste paths understand.
4. Move payload normalization and validation into the kernel boundary so callers cannot store malformed rectangular data, mismatched formulas/formats, lying row counts, or inconsistent table metadata.
5. Keep browser/system clipboard access in a production host port with deterministic fallbacks for headless tests, instead of scattered `navigator.clipboard` calls.
6. Make stale detection explicit and robust by using normalized text/html signatures and payload versions, not only focus-loss booleans.
7. Add focused executable contracts for the kernel service and end-to-end UI gates for real copy/paste input paths.

## Production-path contracts and invariants to preserve or strengthen

- Copy data remains reusable until replaced, cleared, or invalidated.
- Cut data is single-use only after the paste commit succeeds; paste errors keep the cut payload available for retry.
- Paste completion and paste error events must be tied to a paste session token or payload version so late async completions cannot mutate newer clipboard state.
- `getPayload()` must not expose mutable service-owned state. Return an immutable snapshot, a cloned payload, or a readonly payload object with documented identity semantics.
- `ClipboardPayload.cells.values` is always rectangular. `rowCount` and `colCount` are derived from normalized data. `formulas` and `formats`, when present, match the same dimensions.
- `tableContext.rowIds.length` matches `rowCount`; `tableContext.colIds.length` and `columnSchemas.length` match `colCount`; ordering matches `cells.values`.
- `source.viewType`, `source.viewId`, and `source.sheetId` must be preserved across conversions. No hard-coded source view type in generic app/kernel adapters.
- Text and HTML are not independent untrusted fields. They are either generated from canonical cell payloads or stored with signatures that prove which system clipboard contents match the rich internal payload.
- External HTML is preferred over TSV when it contains a table and carries format information. TSV/plain text remains the universal fallback.
- System clipboard writes should include `text/plain` and `text/html` when both are available, while preserving the user-activation timing required by browser clipboard APIs.
- `clipboard:read` and `clipboard:write` capabilities stay independent. Write-only apps cannot inspect payload contents or subscribe to read snapshots; read-only apps cannot mutate or clear the clipboard.
- The kernel service must not depend on `apps/spreadsheet` or private/internal packages. Shared codecs and contracts must live at a lower public layer or inside the kernel service.
- Headless environments must not throw because `window`, `navigator`, `ClipboardItem`, `DOMParser`, or `document` is absent.

## Concrete implementation plan

1. Contract inventory and deletion plan

   - Inventory all clipboard type definitions and conversion functions in `kernel/src/services/clipboard/types.ts`, `types/api/src/services/index.ts`, `types/api/src/apps/api.ts`, `apps/spreadsheet/src/domain/clipboard/types.ts`, `apps/spreadsheet/src/coordinator/view-clipboard-data.ts`, and `apps/spreadsheet/src/views/types.ts`.
   - Choose one canonical public payload contract under the public contracts/types layer. The kernel implementation should import that contract instead of redefining it locally.
   - Remove deprecated internal clipboard data types once their production call sites are migrated. Do not leave compatibility aliases except where they are pure export names over the same canonical type.

2. Define the kernel clipboard model

   - Add a normalized internal record that contains `payload`, `operation`, `payloadVersion`, `createdAt`, `sourceSignature`, `systemFormatsAvailable`, `isStale`, `lastError`, and active `pasteSession`.
   - Add `ClipboardPasteSession` events: `PASTE_START { target?, options?, payloadVersion }`, `PASTE_COMPLETE { sessionId }`, and `PASTE_ERROR { sessionId, message }`.
   - Preserve the existing copy/cut/clear/focus semantics, but reject or no-op stale session events that do not match the active session.
   - Decide whether fallible operations return `Result` or publish errors through snapshots. Apply one pattern consistently and document it in the service interface.

3. Add payload normalization and validation

   - Implement pure helpers in the kernel clipboard folder: `normalizeClipboardPayload`, `assertClipboardPayloadInvariants`, `deriveClipboardText`, `deriveClipboardHtml`, and `computeClipboardSignature`.
   - Normalize ragged rows, missing formula/format cells, empty arrays, row/column counts, and table context lengths before state storage.
   - Validate `CellValue` boundaries using the existing cell value contract used by spreadsheet clipboard serialization, including error values and explicit date normalization.
   - Freeze or deep-clone stored payloads so external callers cannot mutate kernel clipboard state after `copy()` or `cut()`.

4. Move system clipboard integration behind a host port

   - Introduce a `ClipboardHostPort` supplied by runtime/shell context with `write(formats)`, `read()`, and capability metadata for browser, Tauri, and headless hosts.
   - Keep the synchronous user-activation reservation behavior currently in `writeToSystemClipboard`: the production write call must happen during the UI input handler, while expensive format generation may resolve through promised blobs.
   - Store normalized signatures for `text/plain` and `text/html`; on paste, compare system contents with the kernel signature to choose internal rich data vs external import.
   - Keep headless behavior deterministic with an in-memory host port rather than `navigator` feature checks inside service logic.

5. Consolidate external import and format transfer codecs

   - Move or extract TSV, CSV, HTML table, inline style, and cell value display codecs from `apps/spreadsheet/src/domain/clipboard` into a public lower layer consumed by the kernel service and spreadsheet UI.
   - Preserve HTML-first import semantics for external spreadsheets and browsers.
   - Map all supported `CellFormat` fields systematically instead of only the current subset. Cover font family, size, weight/style, underline, strikethrough, text color, fill color, horizontal and vertical alignment, wrapping, number formats, borders, merged/table spans where representable, and conditional-format transfer where the production paste executor supports it.
   - Keep image-only paste as a typed non-cell clipboard read result so the existing floating-image paste path can continue to route images without pretending they are cell payloads.

6. Replace lossy app and spreadsheet conversions

   - Update `AppClipboardPayload` or replace it with a projection over the canonical clipboard payload so apps can preserve formulas, formats, source metadata, HTML, and real table column IDs when granted clipboard access.
   - Remove hard-coded `source.viewType: 'kanban'` from `AppClipboardAPIImpl.toKernelPayload`.
   - Replace synthetic `col-${i}` IDs with table/view-supplied column IDs or an explicit "external/no-column-id" representation.
   - Update `ShellCoordinator` and the grid-editing clipboard machine so the kernel payload is the primary stored payload. The shell machine should keep UI-only state such as marching ants, paste preview target, overwrite confirmation, and paste special options, but not duplicate rich clipboard storage.
   - Ensure copy/cut command handlers send one production command that stores internal rich data, starts the system clipboard write, and updates UI state.

7. Strengthen service observability

   - Expand snapshots to include `state`, `operation`, `hasData`, `isStale`, `error`, `payloadVersion`, available external formats, and active paste session status.
   - Preserve subscription disposal semantics through `Subscribable`.
   - Emit structured clipboard events for devtools without leaking large cell payloads by default; include payload dimensions, formats present, source metadata, and version IDs.

8. Migration order

   - Land the canonical contract and pure normalizers first with tests.
   - Update kernel service internals to use the canonical contract while preserving existing call signatures until all callers are migrated in the same workstream.
   - Migrate app API and spreadsheet UI call sites to the canonical payload and host port.
   - Remove deprecated `ViewClipboardData` and spreadsheet-only duplicate service code after production paths are on kernel-owned storage.

## Tests and verification gates

Required focused tests for the implementation work:

- Kernel service unit tests covering every state transition: empty, copy, cut, paste start, paste complete, paste error, clear, stale/fresh, replacement during active paste, and late session completion rejection.
- Property/table tests for payload normalization: ragged values, formulas/formats dimension mismatch, empty ranges, table context length mismatch, mutable input mutation after copy, and signature normalization across line endings.
- Codec tests for TSV, CSV, HTML, style import/export, cell error values, dates, numbers, booleans, blanks, quoted multiline cells, large text truncation, and formula text preservation.
- App API tests proving `clipboard:read` and `clipboard:write` stay independent and that app payload conversion is lossless for source metadata, table context, formulas, formats, text, and HTML.
- Spreadsheet integration tests for internal copy, internal cut, external text paste, external HTML paste with formats, paste special options, image-only paste routing, stale system clipboard replacement, canceled internal text suppression, and cut retry after paste error.
- Browser E2E tests that use real keyboard and clipboard paths for copy, cut, paste, paste special, external HTML paste, and cross-view paste. Do not seed clipboard state by direct actor mutation for E2E coverage.

Verification gates to run when implementing:

- `pnpm test` for the kernel package or the smallest package-level Jest/Vitest target that owns `kernel/src/services/clipboard`.
- `pnpm test` for the spreadsheet clipboard domain and grid-editing paste integration packages.
- `pnpm typecheck` for TypeScript contract and caller changes.
- Public API snapshot/publish-readiness check if exported clipboard contracts change.
- Browser dev server exercise of real UI copy/paste flows after UI or host clipboard changes.

## Risks, edge cases, and non-goals

- Browser clipboard APIs are timing-sensitive. The implementation must preserve synchronous write reservation during user activation.
- HTML clipboard payloads from Excel, Google Sheets, browsers, and native apps differ. The codec should enumerate and test representative payloads instead of assuming one table shape.
- Clipboard content can be very large. Normalization should avoid quadratic string work, expose dimensions in snapshots, and avoid devtools payload dumps.
- Shared mutable payloads can corrupt later paste behavior. This is a current risk and should be eliminated early.
- Late async paste completion can clear or error a newer clipboard operation without session tokens. This is a correctness risk to fix in the state model.
- Cross-app clipboard read access can expose table schemas and row IDs. Capability gating and app-level projection must be explicit.
- This plan does not propose a test-only clipboard harness, mock-only optimization, temporary compatibility shim, or reduced spreadsheet-only fix.
- This plan does not move UI-only concepts such as marching ants rendering, paste preview overlays, or overwrite confirmation dialogs into the kernel service. The kernel should expose state and contracts; UI layers should render and prompt.

## Parallelization notes and dependencies on other folders, if any

The work decomposes cleanly:

- Contract worker: canonicalize public clipboard types in `types/api/src`, `types/app-platform/src`, and contracts exports.
- Kernel worker: implement normalized state, paste sessions, immutable payload storage, and service tests in `kernel/src/services/clipboard`.
- Codec worker: extract and complete TSV/CSV/HTML/style/cell-value codecs from `apps/spreadsheet/src/domain/clipboard` into a lower public layer.
- App API worker: remove lossy conversions in `kernel/src/api/app` and update capability-gated tests.
- Spreadsheet integration worker: migrate `apps/spreadsheet/src/actions/handlers/clipboard`, `apps/spreadsheet/src/systems/grid-editing`, and `apps/spreadsheet/src/coordinator` to kernel-owned rich payload storage while keeping UI-only state local.
- E2E worker: add real keyboard/clipboard browser coverage after the production path is migrated.

Dependencies:

- `kernel/src/services/clipboard` must stay below apps and shell in dependency direction.
- Shared codecs must not depend on React, spreadsheet UI, or private/internal packages.
- API snapshot updates must land with public contract changes.
- The spreadsheet UI migration depends on the kernel service exposing payload versions, signatures, and host clipboard read/write results.
