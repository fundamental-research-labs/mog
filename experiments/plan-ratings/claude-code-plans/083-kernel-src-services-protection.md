# Plan 083 — Consolidate and correctly home the protection runtime in `kernel/src/services/protection`

## Source folder and scope

- **Folder:** `mog/kernel/src/services/protection`
- **Contents (as imported):** a single file, `index.ts` (82 lines).
- **What it actually contains:** four `MutationResult` factory functions (`successResult`, `protectionError`, `invalidRangeError`, `sheetNotFoundError`) and two password helpers (`hashExcelPassword`, `verifyExcelPassword`). It contains **no enforcement logic** despite the queue description ("Workbook and worksheet protection enforcement services").

Scope of this plan is the production code in this folder and its direct coupling points:
- `mog/kernel/src/services/index.ts` (barrel that re-exports this folder).
- `mog/spreadsheet-utils/src/protection.ts` (a byte-for-byte duplicate of this folder, minus the header comment).
- The real consumers that import the duplicated functions: `mog/kernel/src/api/worksheet/protection.ts`, `mog/kernel/src/domain/workbook/workbook.ts`, `mog/apps/spreadsheet/src/systems/grid-editing/edit-entry-service.ts`, `mog/apps/spreadsheet/src/hooks/editing/use-editor-actions.ts`.

Out of scope: the Rust core enforcement, the `@mog-sdk/contracts/*/protection` type surface, and the OfficeJS-parity `WorksheetProtection` API surface (touched only where it reuses a helper).

## Current role of this folder in Mog

This folder is positioned as a "protection service," but the actual workbook/worksheet protection **enforcement** lives elsewhere:

- The enforcement decisions (`isSheetProtected`, `canEditCell`, `canDoStructureOp`, `protectSheet`, `unprotectSheet`, options storage) are made by the Rust core and reached through `ctx.computeBridge` in `kernel/src/api/worksheet/protection.ts` and `kernel/src/domain/workbook/workbook.ts`.
- This folder's `index.ts` only provides (a) the legacy XOR password hash used to round-trip the on-disk protection password, and (b) trivial `MutationResult` constructors.

Three concrete problems make this folder a liability rather than an asset:

1. **Exact duplication.** `kernel/src/services/protection/index.ts` and `spreadsheet-utils/src/protection.ts` are identical except for the doc-comment header (verified by `diff`). Two divergence-prone copies of a security-relevant hash and of the result contract factories.
2. **The kernel copy is dead.** Every real call site imports from `@mog/spreadsheet-utils/protection`, never from the kernel folder:
   - `kernel/src/api/worksheet/protection.ts:18` → `hashExcelPassword` from `@mog/spreadsheet-utils/protection`
   - `kernel/src/domain/workbook/workbook.ts:31` → same
   - `apps/spreadsheet/.../edit-entry-service.ts:8` and `.../use-editor-actions.ts:25` → `protectionError`, `successResult` from `@mog/spreadsheet-utils/protection`
   The only importer of the kernel folder is the `kernel/src/services/index.ts` barrel (lines 263–274), and **nothing imports those symbols back out of that barrel** (verified). The kernel module and its barrel re-export are unreferenced dead code.
3. **The code already flags itself as misplaced.** `kernel/src/services/index.ts:263–265` carries a standing TODO: *"hashExcelPassword/verifyExcelPassword belong in xlsx/bridge/. successResult/protectionError/etc. should live next to MutationResult. Deferred until XLSX package structure is finalized."* The XLSX packages now exist (`file-io/xlsx`, `file-io/xlsx-api`), so the deferral condition is satisfied.

Two secondary defects:

4. **`verifyExcelPassword` is effectively unused, and the real verification path re-implements it inline.** `kernel/src/api/worksheet/protection.ts:231` compares `inputHash === storedHash` by hand (and similarly at lines 178–182, 226–231); `verifyExcelPassword` is exported but only reachable via barrels. Two independent password-comparison implementations is exactly the drift risk de-duplication is meant to remove.
5. **Comment convention violation.** The doc comments name "Excel" repeatedly. Per the repo convention recorded for this codebase, product source comments should not reference "Excel"; describe the behavior as legacy/`.xlsx` on-disk compatibility instead. (See [[no-excel-in-code]].)

## Improvement objectives

1. Eliminate the duplicated, dead `kernel/src/services/protection` module so there is exactly **one** runtime implementation of the password hash and of the `MutationResult` factories.
2. Place each concern in its semantically correct home (separating the two unrelated concerns the TODO identifies), so future readers find protection password logic and result-contract factories where they expect them.
3. Make `verifyExcelPassword` the single sanctioned password-comparison path and route the kernel API's inline comparisons through it, removing the second hand-rolled comparison.
4. Remove the "Excel" naming from the surviving source comments while preserving the on-disk `.xlsx` compatibility note and the explicit "not cryptographically secure" warning.
5. Leave the public type surface (`@mog-sdk/contracts/*/protection`, `MutationResult`, `SheetProtectionOptions`) and the `WorksheetProtection` API behavior unchanged.

## Production-path contracts and invariants to preserve or strengthen

- **Hash output stability (preserve exactly).** `hashExcelPassword` must keep producing the identical 4-char uppercase hex string for any given input. This value is persisted in `.xlsx` files and stored in sheet/workbook settings (`protectionPasswordHash`); any change silently invalidates existing protected documents. The relocation must be a pure move with byte-identical logic — no "cleanup" of the arithmetic.
- **`verifyExcelPassword` semantics (preserve).** Empty stored hash ⇒ returns `true` (no password set); non-empty stored hash with empty input ⇒ `false`. The kernel API paths that this plan routes through it must continue to honor these exact cases (note: `pauseProtection`/`setPassword`/`checkPassword` treat a missing stored hash as "no password required" — confirm the consolidated helper matches each call site's expectation before swapping it in).
- **`MutationResult` factory shapes (preserve).** `successResult` → `{ success: true, affected }`; `protectionError` → `{ success: false, error: 'PROTECTED', reason }`; `invalidRangeError` → `{ success: false, error: 'INVALID_RANGE', reason }`; `sheetNotFoundError` → `{ success: false, error: 'SHEET_NOT_FOUND', reason }`. These are consumed by the grid-edit pipeline (`edit-entry-service.ts`, `use-editor-actions.ts`) and must keep matching the `MutationResult` interface in `types/core/src/document/protection.ts:134`.
- **No new import cycles.** The chosen home must not make `@mog/spreadsheet-utils` depend on kernel, nor kernel on a heavier package than it already uses. The kernel already depends on `@mog/spreadsheet-utils` (it imports `hashExcelPassword` from it today), so consolidating *into* `@mog/spreadsheet-utils` introduces no new edge.
- **Strengthen — single source of truth:** after this change there must be exactly one definition of each function in non-generated source (verifiable by `rg`).

## Concrete implementation plan

The cleanest production-path target — and the one that introduces zero new dependency edges — is to make the already-canonical `@mog/spreadsheet-utils/protection` the single home, delete the kernel duplicate, and split the two concerns inside `spreadsheet-utils` so the file reflects the TODO's intent.

### Step 1 — Make `@mog/spreadsheet-utils/protection` the single source of truth, split by concern
- In `spreadsheet-utils/src/`, separate the two unrelated concerns the TODO names:
  - `protection-password.ts` — `hashExcelPassword`, `verifyExcelPassword` (the legacy `.xlsx` on-disk password compatibility helpers).
  - `mutation-result.ts` — `successResult`, `protectionError`, `invalidRangeError`, `sheetNotFoundError` (the `MutationResult` contract factories).
- Keep `spreadsheet-utils/src/protection.ts` as a thin re-export barrel of both, so the existing `@mog/spreadsheet-utils/protection` subpath export (`spreadsheet-utils/package.json` `"./protection"`) and the package root re-export (`spreadsheet-utils/src/index.ts`) keep their current symbols and import paths. No consumer import statement needs to change in this step.
- Rewrite the surviving comments to drop "Excel": describe `hashExcelPassword`/`verifyExcelPassword` as the legacy `.xlsx`-format password hash and retain the "intentionally weak / not cryptographically secure / UI-level guard only" warning verbatim in spirit. (Renaming the exported symbols away from `Excel*` is explicitly a **non-goal** here — see Risks — because they are part of an import contract used across packages; only comments change.)

### Step 2 — Delete the dead kernel module and its barrel re-export
- Delete `kernel/src/services/protection/index.ts` (and the now-empty `kernel/src/services/protection/` directory).
- In `kernel/src/services/index.ts`, remove the protection section (the TODO comment block at lines 263–265 and the `export { ... } from './protection'` block at lines 267–274). Since nothing imports these symbols from the kernel services barrel, this removal is safe; confirm with a repo-wide `rg` for each symbol imported from a kernel/services path before deleting.

### Step 3 — Route the kernel API password comparison through the single helper
- In `kernel/src/api/worksheet/protection.ts`, import `verifyExcelPassword` from `@mog/spreadsheet-utils/protection` and replace the hand-rolled `inputHash === storedHash` comparison at line 231 (`checkPassword`) and the equivalent inline logic in `pauseProtection` (lines 178–182) and any sibling path, so all password verification flows through one function.
- Preserve each call site's exact branch semantics: `checkPassword` returns `!password` when no hash is stored; `pauseProtection` throws `API_PROTECTED_SHEET` on mismatch only when a hash is stored. Map `verifyExcelPassword`'s "empty stored hash ⇒ true" onto these without behavior change (add a focused unit assertion per branch — see verification).

### Step 4 — Confirm consumers and remove leftover references
- Re-run the symbol search to confirm `kernel/src/services/protection` and the `./protection` barrel export no longer resolve anywhere.
- Confirm `apps/spreadsheet/.../edit-entry-service.ts` and `.../use-editor-actions.ts` still resolve `protectionError`/`successResult` via `@mog/spreadsheet-utils/protection` (unchanged subpath).

### Optional follow-up (separate change, not required for this plan)
- If the team prefers the `MutationResult` factories to live with the `MutationResult` type, host them in a runtime module adjacent to `types/core/src/document/protection.ts` and have `spreadsheet-utils` re-export from there. Deferred because `types/core` is currently type-only; flagged so the consolidation here doesn't preclude it.

## Tests and verification gates

> Per task constraints this plan does not run any build/test/typecheck commands; the gates below are the acceptance criteria for whoever implements it.

1. **Hash golden test (must exist before deletion).** A unit test in `spreadsheet-utils/__tests__/protection.test.ts` (which already imports these symbols) must assert `hashExcelPassword` for a fixed set of inputs against known-good 4-char hex outputs, including the empty-string ⇒ `''` case and a case exercising the length-XOR (`^ password.length`) and `^ 0xce4b` steps. This locks the value so the move cannot silently change it.
2. **`verifyExcelPassword` branch table:** empty stored hash + any input ⇒ `true`; non-empty hash + empty input ⇒ `false`; matching/non-matching input ⇒ `true`/`false`.
3. **Kernel API parity:** unit tests for `checkPassword`, `pauseProtection`, and `setPassword` covering no-password and password-set sheets, confirming behavior is identical after routing through `verifyExcelPassword`.
4. **Single-definition gate:** `rg -n "function hashExcelPassword|function successResult"` returns exactly one match each in non-generated source.
5. **Dead-export gate:** `rg -n "services/protection"` returns no hits in non-generated source after deletion.
6. **Typecheck/build:** `@mog/spreadsheet-utils`, `@mog/kernel`, and `@mog/app-spreadsheet` typecheck and build; an `.xlsx` round-trip integration test that opens a password-protected sheet still verifies the password (no regression in persisted-hash compatibility).
7. **Comment-convention gate:** no "Excel" token remains in the surviving comments of the moved files.

## Risks, edge cases, and non-goals

- **Risk: changing a persisted hash.** The highest-severity risk. Mitigated by Step-1 being a pure move and by gate #1 locking the output before any code is touched. Do not "tidy" the bit arithmetic.
- **Risk: hidden barrel consumer.** A consumer could import the factories from the kernel services barrel through a deep path. Mitigated by the dead-export `rg` gate (#5) run before deletion; the search performed for this plan already found none.
- **Edge case: `verifyExcelPassword` vs inline semantics.** The inline comparisons treat `null` stored hash explicitly, while `verifyExcelPassword` keys off empty string. Confirm `protectionPasswordHash` normalization (`?? null`) maps cleanly to the helper's empty-string check at every swapped call site; add a regression test if the null/empty distinction matters.
- **Non-goal: renaming the `Excel*` exported symbols.** `hashExcelPassword`/`verifyExcelPassword` are an import contract spanning kernel, apps, and spreadsheet-utils; renaming them is a larger cross-package rename out of scope here. Only comments are de-Excel'd.
- **Non-goal: changing enforcement behavior.** This plan does not alter what is or isn't blocked on a protected sheet, the `WorksheetProtection` API surface, or the in-memory-only `allowEditRanges` storage (a known gap noted in `api/worksheet/protection.ts:275–281`, owned by that folder, not this one).
- **Non-goal: introducing real cryptography.** The legacy hash is intentionally weak for on-disk format compatibility; strengthening it would break round-trips and is explicitly not part of this consolidation.

## Parallelization notes and dependencies on other folders

- **Coordinates with** `kernel/src/api/worksheet` (Step 3 edits `protection.ts` there) and the two `apps/spreadsheet` editing call sites (verification only; no edits expected). A worker owning `kernel/src/api/worksheet/protection.ts` should be aware this plan touches `checkPassword`/`pauseProtection`; sequence to avoid a merge conflict on that file.
- **Depends on** `@mog/spreadsheet-utils` package layout (the new home) and its `package.json` `"./protection"` export staying stable.
- **Independent of** the Rust core, `file-io/xlsx*`, and the contracts type packages; no changes required there.
- This is a small, self-contained refactor (one delete + one barrel split + one helper-reuse edit) and can land as a single PR once gate #1 is in place.
