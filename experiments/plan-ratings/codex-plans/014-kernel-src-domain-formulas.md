# Improve `mog/kernel/src/domain/formulas` Formula State and Reference Contracts

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/domain/formulas`

Scope this plan covers:

- `kernel/src/domain/formulas/named-ranges.ts`
- `kernel/src/domain/formulas/structured-ref-updater.ts`
- `kernel/src/domain/formulas/__tests__/named-ranges.test.ts`
- The production callers that make this folder observable: workbook and worksheet name APIs, table mutation APIs, XLSX/import/export named-range paths, compute bridge mutation/query methods, and Rust compute-core named-range and structured-reference mutation paths.

Scope this plan does not cover:

- Adding new spreadsheet formula functions or changing formula evaluation semantics unrelated to named ranges or structured references.
- Replacing the Rust parser, scheduler, or dependency graph.
- UI-only Name Manager redesign.
- Test-only adapters, compatibility shims, or mock-only behavior. The implementation must target the production bridge path that the app and SDK use.

## Current role of this folder in Mog

`kernel/src/domain/formulas` is the TypeScript kernel facade for formula-facing workbook state that is not a normal cell formula edit. It currently has two responsibilities:

- `named-ranges.ts` exposes Excel-style defined-name operations to workbook/worksheet APIs. It validates, resolves, lists, creates, updates, removes, imports, exports, formats, and creates names from selections. The storage contract is identity-based: named ranges are persisted as `IdentityFormula` data in Rust/Yrs, with A1 display regenerated through the compute bridge.
- `structured-ref-updater.ts` exports legacy table-reference update functions. The comments state that these functions are intentional no-ops because Rust compute-core rewrites structured references during table rename/delete/convert mutations.

Relevant production path observed during inspection:

- `kernel/src/api/workbook/names.ts` and `kernel/src/api/worksheet/names.ts` delegate public name API calls to `named-ranges.ts`.
- `kernel/src/domain/tables/core.ts` and `kernel/src/domain/tables/operations.ts` import `structured-ref-updater.ts` and still call the no-op functions for counts/logging around table rename, column delete, table delete, and convert-to-range behavior.
- Rust compute-core already has named-range CRUD/query entrypoints, scoped validation/resolution, and structured-reference mutation helpers under `compute/core/src/storage/workbook/named_ranges/*`, `compute/core/src/storage/engine/services/mutation_handlers/named_ranges.rs`, and `compute/core/src/storage/cells/structured_ref_updater/*`.
- `kernel/src/bridges/compute/compute-wire-converters.ts` already owns exhaustive `IdentityFormula` wire conversion, including `RectRange`, but `named-ranges.ts` duplicates conversion logic locally.

Main gaps found:

- `named-ranges.ts` hand-maps Rust wire data with `any` and duplicates identity-ref conversion. Its create path manually converts refs back to wire format and does not handle the `RectRange` variant even though the shared converter does.
- Several reads scan all names in TypeScript (`getByName`, `getById`, `getByScope`, `resolve`, `validate`) even though the bridge exposes direct scoped Rust queries such as `getNamedRangeByName`, `getNamedRangeById`, `getNamedRangesByScope`, `resolveNamedRange`, and `validateNamedRangeName`.
- `create` uses `setNamedRange`, an upsert-style identity endpoint that bypasses the Rust defined-name validation/create contract and drops comment metadata, then performs a second read/update to attach comments.
- `importNames` calls `void ctx.computeBridge.setNamedRange(...)` inside a loop, returns before writes are guaranteed complete, and does not use the Rust bulk import path.
- `removeByScope` resolves names in TypeScript and then calls `removeNamedRange(name.name)`. The Rust `remove_named_range` legacy path removes workbook and sheet-scoped names by name, so this is not a precise scope deletion contract.
- `evaluateValue` is a stub even though workbook API methods call compute bridge named-range value/type/array queries.
- `structured-ref-updater.ts` no-op functions still influence table-domain control flow and logging. Some table domain operations also use `void` bridge mutations, so callers can observe completion before Rust has necessarily performed the production rewrite.
- Local tests currently cover only named-range comment persistence around create. They do not cover all identity-ref variants, scope deletion, bulk import awaiting, Rust direct queries, create-from-selection contracts, or structured-reference mutation integration.

## Improvement objectives

1. Make this folder a thin, typed, awaited production facade over Rust compute-core, not a second source of truth.
2. Preserve identity-based named-range storage for CRDT-safe row/column edits while removing local ad hoc wire conversion.
3. Unify named-range create/update/import/remove APIs so validation, metadata persistence, raw-expression preservation, event emission, mirror updates, and dependency recalculation happen in one Rust mutation per user-visible operation.
4. Replace TypeScript all-name scans with direct scoped bridge queries wherever Rust already owns the query contract.
5. Remove misleading structured-reference no-op behavior from the table production path and route callers through Rust table mutations that perform the real rewrites.
6. Strengthen scope semantics for workbook-scoped and sheet-scoped names, especially duplicate names, resolution precedence, sheet deletion, and `removeByScope`.
7. Add contract tests that cover the complete named-reference shape family and the complete table structured-reference mutation family.

## Production-path contracts and invariants to preserve or strengthen

- Named ranges must store references as identity formulas, not position-only A1 strings, so concurrent row/column edits preserve the intended range.
- A1 display is derived from current identity positions via Rust. Constant names, external-workbook references, and unsupported references must retain raw text rather than throwing during list/export.
- Sheet-scoped names have higher precedence than workbook-scoped names when resolving from that sheet.
- Name lookup and duplicates are case-insensitive and scoped: workbook scope and each sheet scope are separate namespaces.
- Rename of a defined name must be atomic with formula-text rewrites in Rust. The kernel must not implement a separate TS formula scan.
- Updating a name reference must preserve metadata (`comment`, `visible`, macro-related flags, ordering, and raw/external text where relevant) unless the update explicitly changes it.
- Deleting a name must remove the correct ID/scope, dirty/recalculate dependent formulas, and emit mutation metadata through the compute bridge result handler.
- Sheet deletion must remove only names scoped to that sheet.
- Bulk import must be awaited, must create the backing Yrs map when absent, must preserve import order where available, and must return the actual number of imported names.
- Structured-reference rewrites for table rename, column rename, column delete, table delete, and convert-to-range must happen in Rust table mutations on the production storage path.
- Public workbook/worksheet APIs must not expose bridge implementation differences between NAPI/WASM transports.

## Concrete implementation plan

1. Define the bridge contract for named ranges before changing the facade.
   - Inventory the two current Rust/TS shapes: string-based `DefinedName`/`DefinedNameInput` and identity-backed `DefinedNameWire`/`NamedRangeDef`.
   - Decide the canonical bridge mutation input for kernel named-range writes: it must accept identity refs, `raw_expression` or equivalent raw A1 text, scope, comment, visible state, and any imported metadata that must round-trip.
   - Either extend the existing `createNamedRange`/`updateNamedRange`/`importNamedRanges` commands to preserve identity-backed storage, or add explicit identity-backed commands and retire TS use of `setNamedRange` for public defined-name creation.
   - Keep `setNamedRange` only as a low-level compute/internal command if it is still needed by non-public paths, and document that public kernel name APIs must not bypass validation through it.

2. Move named-range wire conversion to shared typed converters.
   - Add `definedNameWireToContract` and, if needed, `contractDefinedNameToWire` helpers near `compute-wire-converters.ts`.
   - Reuse `wireToIdentityFormula` and `identityFormulaToWire` instead of local `any` conversion in `named-ranges.ts`.
   - Cover every `IdentityFormulaRef` variant: `Cell`, `Range`, `RectRange`, `FullRow`, `RowRange`, `FullCol`, and `ColRange`.
   - Make unknown wire variants fail explicitly with a bridge error instead of falling through as untyped data.
   - Remove duplicated conversion code from `named-ranges.ts`.

3. Route reads to direct Rust queries.
   - Change `validate` to call `ctx.computeBridge.validateNamedRangeName(name, scope ?? null, excludeId ?? null)` after the bridge contract is aligned with the contracts-layer result shape.
   - Change `getByName`, `getById`, `getByScope`, and `resolve` to use direct bridge queries and map one response, not `getAll()` scans.
   - Keep `getAll` and `exportNames` for true all-name operations only.
   - Keep `getVisible` direct, but ensure it returns the same contract shape as `getAll`; do not mix string `DefinedName` and identity `DefinedNameWire` shapes at the facade boundary.

4. Make named-range writes single awaited production mutations.
   - Replace `create` with one awaited Rust mutation that validates, parses/stores identity refs, persists raw expression, persists comment/visible metadata, updates the mirror, recalculates dependents, and returns the created name in `MutationResult.data` or an equivalent typed result.
   - Replace update reference handling with a Rust mutation that reparses the new A1 expression into identity refs using the supplied context sheet, preserves raw text, and keeps rename formula rewrites atomic with the name update.
   - Make all bridge write calls awaited. No `void ctx.computeBridge...` in formula-domain write paths.
   - Keep `KernelError` mapping for not-found and invalid-name behavior, but surface Rust validation messages rather than duplicating rule drift in TypeScript.
   - Ensure create/update preserve comments without a follow-up read/update transaction.

5. Correct bulk import and scope deletion.
   - Replace `importNames` looped fire-and-forget `setNamedRange` calls with one awaited identity-aware bulk import bridge call.
   - Fix Rust `import_named_ranges` to create the `namedRanges` map when absent if it remains a possible empty-workbook path.
   - Return the actual imported count from Rust, not the optimistic TS loop count.
   - Replace `removeByScope` with direct `removeNamedRangesByScope(scope ?? null)` and ensure the Rust result removes only that scope and recalculates affected named-range dependents.
   - Add a regression for a workbook name and a sheet-local name with the same text where removing the sheet scope leaves the workbook name intact.

6. Specify and harden create-from-selection behavior.
   - Decide whether `createFromSelection` creates workbook-scoped names or sheet-scoped names for each public entrypoint, and encode that contract in the API wrappers and tests.
   - Generate fully sheet-qualified A1 references before identity conversion so names created from another active sheet do not depend on ambient sheet state.
   - Align label sanitization with Rust/Excel validation rules. If sanitization remains in TS, validate every sanitized candidate through Rust before creation.
   - Preserve batched range reads for label extraction, but batch or sequence writes through the unified create mutation so failures are deterministic and awaited.
   - Cover top row, bottom row, left column, right column, duplicate labels, blank labels, cell-reference-like labels, and non-ASCII labels according to the chosen validation contract.

7. Retire the structured-reference no-op facade from production behavior.
   - Refactor table callers so table rename uses `await ctx.computeBridge.renameTable(...)`, column rename uses `await ctx.computeBridge.renameTableColumn(...)`, column delete uses `await ctx.computeBridge.removeTableColumn(...)`, table delete uses `await ctx.computeBridge.deleteTable(...)`, and convert-to-range uses `await ctx.computeBridge.convertTableToRange(...)`.
   - Remove table-domain reliance on `updateFormulasForTableRename`, `updateFormulasForColumnRename`, `propagateRefErrorForColumnDelete`, `propagateRefErrorForTableDelete`, and `convertStructuredRefsToA1` return values.
   - If callers need counts for logs/API return values, have Rust table mutations include the updater count in `MutationResult.data` with a typed bridge shape. Do not compute counts in TS.
   - After callers are migrated, delete `structured-ref-updater.ts` or leave only a narrow deprecated wrapper that calls the real bridge command and is covered by tests. Do not keep silent no-op exports in production paths.

8. Wire or remove dead evaluation helpers.
   - Replace `evaluateValue` with a real bridge-backed helper if domain callers need it, using `getNamedRangeTypedValue`, `getNamedRangeDisplayValue`, `getNamedRangeType`, and `getNamedRangeArrayValues` as appropriate.
   - If no production caller needs `evaluateValue`, delete it from the domain module and keep value APIs in workbook/worksheet API classes.
   - Keep `formatValueForDisplay` only if it is used by production UI/API code; otherwise move it to the caller that needs display formatting.

9. Strengthen event and mutation-result contracts.
   - Ensure named-range create/update/remove/import/remove-by-scope and table structured-reference mutations all return `MutationResult` changes with enough metadata for `mutation-result-handler.ts` to emit meaningful events.
   - Replace placeholder change names such as `"N names imported"` or scope IDs with structured data if event consumers need per-name changes.
   - Add mirror/storage consistency checks after named-range mutation paths: Yrs storage, compute mirror variable registry, formula display, and dependency recalculation must agree.

## Tests and verification gates

Add focused tests before broad gates:

- Kernel TS unit tests for named-range wire conversion covering all identity-ref variants, including `RectRange`.
- Kernel TS unit tests for `validate`, `getByName`, `getById`, `getByScope`, and `resolve` proving direct bridge query usage and scope precedence.
- Kernel TS unit tests for create/update/remove/import/remove-by-scope proving all writes are awaited and no comment-only second transaction is needed.
- Kernel TS tests for `createFromSelection` covering all four label edges, duplicate handling, scoped behavior, fully qualified references, and invalid labels.
- Kernel API tests for workbook and worksheet name APIs proving scope names, readback references, comments, hidden names, `#REF!` filtering where intended, and value/type/array APIs.
- Rust compute-core tests for identity-backed create/update/import preserving raw expressions, comments, order, visibility, and dependency recalculation.
- Rust compute-core tests for sheet deletion and `remove_named_ranges_by_scope` preserving same-name workbook-scoped names.
- Rust compute-core structured-reference integration tests for table rename, column rename, column delete, table delete, and convert-to-range through engine table mutations, not direct helper calls only.
- Regression tests for formulas containing structured-reference-looking text inside string literals and escaped column names, so rewrite helpers only modify real references.

Run these gates after implementation:

1. `pnpm --filter @mog-sdk/kernel test -- domain/formulas`
2. `pnpm --filter @mog-sdk/kernel test -- api/workbook`
3. `pnpm --filter @mog-sdk/kernel test -- api/worksheet`
4. `pnpm --filter @mog-sdk/kernel typecheck`
5. `cargo test -p compute-core named_range`
6. `cargo test -p compute-core structured_ref_updater`
7. `cargo test -p compute-core --test sheet_scoped_named_range`
8. `cargo test -p compute-core --test stress_tables_named`
9. `cargo test -p compute-core --test range_dependency_tracking`
10. `cargo clippy -p compute-core`
11. Repo-wide `pnpm typecheck` after the TypeScript integration slice.

For any UI-facing Name Manager or table workflow touched by the implementation, also run the app dev server and exercise the real browser workflow for add/update/delete/list names and table rename/delete/convert actions.

## Risks, edge cases, and non-goals

- The repo currently has both string-based and identity-backed named-range bridge shapes. Collapsing them incorrectly could regress external references, constants, or import/export round-trip fidelity.
- `raw_expression` and `raw_refers_to` have different roles. The implementation must preserve the original text needed for evaluation/export while still using identity refs for CRDT-safe local references.
- `setNamedRange` is a low-level upsert and currently skips validation. It should not remain the public API create path unless Rust validation and metadata persistence are added to that same command.
- The legacy `removeNamedRange(name)` path removes all scopes with that name. Scope-specific APIs must avoid it.
- Some Rust structured-reference helpers are string rewriters. They must not rewrite string literals, escaped bracket syntax, external workbook references, or similarly named tables/columns.
- Counts returned from structured-reference updates are useful only if they come from the same Rust mutation that performed the rewrite.
- Do not add TS formula scans for named-range or structured-reference rewrites. Rust compute-core is the source of truth.
- Do not introduce compatibility aliases for old no-op updater behavior. Production callers should use real bridge mutations.
- Do not broaden this work into formula function accuracy, parser feature work, or UI redesign.

## Parallelization notes and dependencies on other folders, if any

This work should be split across parallel agents with explicit contracts:

- Agent A: named-range bridge contract design across `kernel/src/bridges/compute`, `domain-types/src/domain/named_range.rs`, and `compute/core/src/storage/workbook/named_ranges`.
- Agent B: typed conversion extraction and TS facade cleanup in `kernel/src/domain/formulas/named-ranges.ts`.
- Agent C: Rust named-range create/update/import/remove-by-scope mutation fixes, mutation-result data, and mirror/recalc tests.
- Agent D: structured-reference table integration, replacing TS no-op callers with awaited Rust table mutations and count metadata.
- Agent E: workbook/worksheet API tests and create-from-selection contract tests.
- Integrator: remove obsolete exports, align event handling, run all gates, and verify production API behavior end to end.

Dependencies:

- `mog/kernel/src/bridges/compute` for generated bridge methods, wire converters, and mutation result transport.
- `mog/kernel/src/api/workbook/names.ts` and `mog/kernel/src/api/worksheet/names.ts` for public name APIs.
- `mog/kernel/src/domain/tables` for structured-reference mutation callers.
- `mog/compute/core/src/storage/workbook/named_ranges` for Rust defined-name storage, validation, queries, and mutations.
- `mog/compute/core/src/storage/engine/services/mutation_handlers/named_ranges.rs` for atomic named-range update and formula rewrite behavior.
- `mog/compute/core/src/storage/cells/structured_ref_updater` and `mog/compute/core/src/storage/engine/services/tables/mutations.rs` for structured-reference rewrite behavior.
- `mog/file-io/xlsx` and compute export/import paths if the implementation changes raw/external named-range round-trip semantics.
