# 083 - Kernel Services Protection Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/services/protection`

Queue scope: workbook and worksheet protection enforcement services.

The folder currently contains one file, `index.ts`, with pure helpers for `MutationResult` factories and Excel legacy password hashing. The improvement scope is broader than that file's current contents: make this folder the kernel's typed protection policy surface for sheet/workbook operation decisions, option normalization, error payloads, and public API adapters, while preserving compute-core as the production source of truth for persisted state and cell editability.

Out-of-scope for this plan: editing production code in this planning run, weakening protection into UI-only checks, adding test-only bypasses, or treating workbook/worksheet protection as cryptographic document security. Excel-style sheet/workbook protection remains an accidental-edit guard unless the security subsystem explicitly owns a stronger policy.

## Current role of this folder in Mog

`kernel/src/services/protection/index.ts` exports:

- `successResult`, `protectionError`, `invalidRangeError`, and `sheetNotFoundError` for the `MutationResult` shape from `@mog-sdk/contracts/protection`.
- `hashExcelPassword` and `verifyExcelPassword` for Excel's legacy XOR password hash.

The current implementation is not the actual enforcement service. The same helper code is duplicated in `mog/spreadsheet-utils/src/protection.ts`, and important call sites import `@mog/spreadsheet-utils/protection` instead of this kernel folder. Real enforcement is spread across:

- `kernel/src/api/worksheet/protection.ts`: public worksheet protection API, password hashing, pause/resume, config projection, and in-memory `allowEditRanges`.
- `kernel/src/api/worksheet/protection-guards.ts`: async/sync sheet operation guards and format-operation mapping.
- `kernel/src/api/worksheet/protected-table-operations.ts`: table/filter/slicer-specific protected operation checks.
- `kernel/src/api/workbook/protection.ts`, `kernel/src/domain/workbook/workbook.ts`, and `kernel/src/api/workbook/sheets.ts`: workbook structure protection and sheet structure operation guards.
- `compute/core/src/storage/engine/atomics.rs`: production `can_edit_cell` and `can_do_structure_op` decisions.
- `compute/core/src/storage/sheet/protection.rs` and `compute/core/src/storage/workbook/settings/protection.rs`: persisted sheet/workbook protection mutation and verification state.
- `file-io/xlsx/parser` and compute hydration/export: XLSX sheet/workbook protection import/export, including modern hash metadata and protected range XML structures.

Key gaps:

- No single exhaustive map from public/internal operation names to `SheetProtectionOptions` or `WorkbookProtectionOptions`.
- Public API operation types omit some persisted options (`insertHyperlinks`, `usePivotTableReports`, `editScenarios`) while compute accepts aliases such as `pivotTables`, `autoFilter`, and `editObjects`.
- `WorksheetProtectionImpl.getConfig`, `normalizeProtectionOptions`, `protection-guards`, table guards, and Rust atomics each encode parts of the same semantics independently.
- `allowEditRanges` is exposed publicly but stored only in a per-instance TypeScript `Map`; it is not persisted, imported/exported, or consulted by `canEditCell`.
- Password helper ownership is unclear. The kernel folder and `@mog/spreadsheet-utils/protection` duplicate code, while kernel source imports the utils package elsewhere.

## Improvement objectives

1. Make `kernel/src/services/protection` the kernel-owned protection policy module, not a duplicate utility dump.
2. Preserve compute-core as the single production authority for persisted protection state, cell locked/default semantics, formula-hidden decisions, and bridge mutation results.
3. Define one exhaustive TypeScript operation matrix for worksheet and workbook protection, including public API aliases and internal operations.
4. Replace scattered local option checks with shared policy helpers that return typed protection decisions and stable error context.
5. Make `allowEditRanges` real: persisted, bridged, imported/exported, and included in `canEditCell` decisions according to an explicit contract.
6. Resolve duplicated password and `MutationResult` helper ownership without introducing package cycles.
7. Add coverage that proves protected operations are blocked before mutation on the production API and UI input paths.

## Production-path contracts and invariants to preserve or strengthen

- Unprotected sheet means all sheet-level operations are allowed unless another production constraint blocks them.
- Protected sheet means cells are editable only when compute says they are editable. Empty cells default to locked, matching Excel.
- Protected sheet operation flags default to blocked, except `selectLockedCells` and `selectUnlockedCells`, which default to allowed.
- OOXML sheet protection attribute polarity must stay correct: parser raw booleans represent the OOXML value, while Mog domain options use intuitive "allowed" booleans.
- Formula hiding is effective only when the sheet is protected and the cell format has `hidden: true`.
- Workbook structure protection blocks add/delete/rename/move/hide/unhide/copy sheet operations when `structure` is true.
- Protection errors should surface as `KernelError('API_PROTECTED_SHEET', ...)` or `protectedWorkbook(...)` with stable machine-readable context, not ad hoc `Error` strings.
- All protection mutations must pass through the compute bridge and mutation result handler so collaboration, undo, mirror state, and events remain coherent.
- Password hashes must never expose plaintext. Legacy Excel hashes and modern OOXML hash metadata must be preserved on import/export even when Mog cannot verify every modern algorithm yet.
- Public apps should call worksheet/workbook APIs or low-level public utility packages, not deep private kernel internals.

## Concrete implementation plan

1. Reorganize `kernel/src/services/protection` into focused modules:
   - `password.ts`: legacy Excel hash/verify helpers or re-exports from the chosen canonical utility owner.
   - `mutation-result.ts`: `MutationResult` factories, or re-exports from the package that owns `MutationResult` runtime helpers.
   - `sheet-options.ts`: default merging, public `ProtectionOptions` alias normalization, `ProtectionConfig` projection, and OOXML/domain option polarity helpers.
   - `operations.ts`: exhaustive worksheet/workbook operation unions, alias tables, and operation-to-option mappings using `satisfies` so missing cases fail typecheck.
   - `decisions.ts`: pure `ProtectionDecision` helpers for allowed/blocked operations and standard reason payloads.
   - `guards.ts`: thin adapters that accept minimal reader interfaces, such as `canEditCell`, `getSheetProtectionOptions`, and `isWorkbookOperationAllowed`, without importing `api/`, `document/`, or `domain/`.

2. Settle helper package ownership:
   - Preferred direction: keep cross-package pure utilities in `@mog/spreadsheet-utils/protection`, make kernel declare the dependency if it imports those utilities in production, and remove byte-for-byte duplicate implementations from the kernel service.
   - If package policy rejects a kernel dependency on spreadsheet-utils, extract the pure runtime helpers into a lower-level public package or contracts runtime module used by both packages.
   - Do not keep two independent implementations of password hashing or mutation result factories.

3. Replace worksheet API local semantics with service helpers:
   - Move `normalizeProtectionOptions` from `api/worksheet/protection-options.ts` into `services/protection/sheet-options.ts`.
   - Replace `VALID_PROTECTION_OPS` in `WorksheetProtectionImpl` with the shared operation table.
   - Make `getConfig()` use the shared projection and include `hasPasswordSet` by calling `hasSheetProtectionPassword`.
   - Make `checkPassword`, `setPassword`, pause, and resume use shared password helpers and preserve the complete protection config, not only the password hash.
   - Fix `canPauseProtection` semantics so it cannot report true for an unprotected sheet; if it must remain sync, expose a separate async capability query and keep the sync property conservative.

4. Replace scattered sheet guards:
   - Rewrite `api/worksheet/protection-guards.ts` as a thin facade over service decision helpers.
   - Unify async and sync behavior so they use the same operation-to-option mapping.
   - Move repeated range editability loops from `WorksheetImpl`, `WorksheetInternalImpl`, and `protected-table-operations.ts` into a shared service helper that batches or short-circuits through compute as appropriate.
   - Keep the production decision on `ctx.computeBridge.canEditCell`; do not infer cell lock state in UI code.

5. Complete the worksheet operation matrix:
   - Add internal operation coverage for `insertHyperlinks`, `pivotTables`, and `editScenarios`.
   - Decide whether these become public `ProtectionOperation` members in `@mog/types-api` or remain internal-only operations with public convenience methods.
   - Align TypeScript aliases with compute aliases: `filter`/`autoFilter`, `editObject`/`editObjects`, and `pivotTables`/`usePivotTableReports`.
   - Add compile-time tests that every `SheetProtectionOptions` permission field is either mapped to an operation or intentionally non-operation state, such as selection flags.

6. Centralize workbook protection decisions:
   - Add a workbook operation table for `addSheet`, `deleteSheet`, `renameSheet`, `moveSheet`, `hideSheet`, `unhideSheet`, and `copySheet`.
   - Have `WorkbookSheetsImpl.ensureWorkbookOpAllowed` use the service adapter or compute bridge query directly, with one standard protected-workbook error payload.
   - Keep `WorkbookDomain.protect/unprotect` as compute-bridge mutation wrappers, but move default option merging and password hash preparation into the service.

7. Implement persisted allow-edit ranges:
   - Add a domain/snapshot representation for worksheet allow-edit ranges with title, normalized sqref, optional legacy password hash, optional modern hash metadata, and optional security descriptor.
   - Add compute bridge methods to list/add/remove ranges and to unlock a password-protected range for the current worksheet session.
   - Teach `can_edit_cell` to return true for cells inside an active allow-edit range even when the cell is otherwise locked.
   - Hydrate XLSX `<protectedRanges>` into the compute model and export them back. Reuse existing file-io protected range writer structures instead of inventing a parallel XML format.
   - Replace the in-memory `WorksheetAllowEditRangesImpl` map with compute-backed persistence.

8. Strengthen password verification:
   - Define a `ProtectionPasswordHash` model that distinguishes legacy Excel XOR, modern OOXML SHA-512 metadata, and unknown preserved hash metadata.
   - Keep legacy XOR verification for files Mog creates today.
   - Preserve modern hash fields and add verification where feasible using the same algorithm semantics as the XLSX parser/writer.
   - When verification is unsupported for preserved metadata, surface an explicit blocked reason instead of silently treating the password as wrong or absent.

9. Update app-facing call sites:
   - Keep UI action handlers using worksheet/workbook APIs for enforcement feedback.
   - Replace direct utility imports for protection result factories only after package ownership is settled.
   - Ensure edit entry, formula bar, object insertion, table/filter/slicer, layout, formatting, and sheet structure workflows all receive the same protected-sheet error shape.

10. Document the contract:
   - Add a concise `kernel/src/services/protection/README.md` that states compute is the state authority, this folder owns TypeScript policy adapters, and UI code must not bypass worksheet/workbook APIs.
   - Update `kernel/src/services/README.md` so it no longer describes protection as only "pure password hashing/verification".

## Tests and verification gates

Unit and type gates for TypeScript changes:

- `pnpm --filter @mog-sdk/kernel test -- protection`
- `pnpm --filter @mog-sdk/kernel test -- protected-table-operations`
- `pnpm --filter @mog-sdk/kernel test -- workbook-impl`
- `pnpm --filter @mog-sdk/kernel typecheck`
- `pnpm --filter @mog/spreadsheet-utils test -- protection` if helper ownership changes touch that package
- `pnpm --filter @mog/spreadsheet-utils typecheck` if helper ownership changes touch that package
- `pnpm --filter @mog/types-api typecheck` and `pnpm --filter @mog/types-core typecheck` if public operation or protection types change

Rust gates for compute and import/export changes:

- `cargo test -p compute-core protection`
- `cargo test -p compute-core roundtrip_sheet_protection`
- `cargo test -p xlsx-parser protection`
- `cargo test -p domain-types protection`
- `cargo clippy -p compute-core`
- `cargo clippy -p xlsx-parser` if parser/writer code changes

Behavioral and integration gates:

- Add kernel API tests proving each protected worksheet operation is blocked before the bridge mutation it would otherwise call.
- Add workbook API tests for each structure operation under protected/unprotected workbooks.
- Add roundtrip tests for sheet protection options, workbook structure protection, formula-hidden state, and allow-edit ranges.
- Add app E2E tests through real keyboard/mouse/clipboard paths for editing a locked cell, editing an unlocked cell, sorting/filtering a protected table, inserting an object, and attempting sheet add/rename while workbook structure is protected.
- For UI changes, run the dev server and exercise the protected edit flows in a browser.

## Risks, edge cases, and non-goals

- Risk: moving helper ownership can introduce package cycles. Resolve package direction first, then update imports.
- Risk: operation aliases can drift between TypeScript contracts and Rust bridge strings. The operation matrix must be exhaustive and covered by tests.
- Risk: sync guards based on mirror state can become stale. Sync paths must be conservative and must not allow a mutation that compute would block.
- Risk: allow-edit ranges with passwords introduce session state. That unlock state must be document/session scoped and must not leak across sheets, collaborators, or reloads.
- Risk: modern OOXML hashes may be preserved even before full verification support exists. Unsupported verification must be explicit.
- Risk: large range editability checks can become slow if implemented as one bridge call per cell. Prefer compute-side batch checks for range/table operations once the API surface is defined.
- Non-goal: making Excel sheet/workbook protection cryptographically secure.
- Non-goal: bypassing compute-core by enforcing protection only in React action handlers.
- Non-goal: compatibility shims that keep duplicate password or option mapping logic indefinitely.

## Parallelization notes and dependencies on other folders, if any

This work naturally splits into independent implementation tracks:

- Track A, kernel service and TypeScript policy: `kernel/src/services/protection`, `kernel/src/api/worksheet/*`, `kernel/src/api/workbook/*`, and kernel tests.
- Track B, public contract alignment: `types/api`, `types/core`, and `contracts` operation/config exports.
- Track C, compute enforcement and bridge: `compute/core` protection atomics, sheet/workbook settings, bridge generation, and mutation result wiring.
- Track D, XLSX import/export fidelity: `file-io/xlsx/parser`, `file-io/ooxml/types`, `domain-types`, and compute hydration/export.
- Track E, app behavior: spreadsheet edit entry, table/filter/slicer/object handlers, formula bar feedback, and E2E tests.

Dependencies:

- Track A can define pure policy helpers first, but public operation additions depend on Track B.
- Track C must land before Track A can make `allowEditRanges` production-backed.
- Track D must agree on the same protected range domain model as Track C.
- Track E should wait until Track A exposes stable errors and decisions, then verify through real UI input paths.
