# 009 - Kernel API Gateway Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/api`

Scope:
- The public and friend-facing TypeScript kernel API gateway: `api/index.ts`, `workbook/`, `worksheet/`, `document/`, `app/`, `namespaces/`, and `internal/`.
- The production path from SDK/runtime/shell/spreadsheet callers through `createWorkbook()`, `DocumentHandle.workbook()`, `WorkbookImpl`, `WorksheetImpl`, worksheet/workbook sub-APIs, app capability gates, and bridge-backed operation modules.
- Contract-adjacent code that must move with this folder when implementation changes are made: `types/api/src/api`, `contracts/src/api` re-export shims, `runtime/sdk/scripts/generate-api-spec.ts`, API snapshot/declaration gates, shell/runtime/spreadsheet callers, and generated docs.

Out of immediate source scope:
- Rust compute implementation changes except where a kernel API invariant requires a bridge method or bulk preflight.
- Public marketing/docs. Internal plans may mention public facts, but implementation details remain in the public `mog` repo.

## Current role of this folder in Mog

`kernel/src/api` is the behavior gateway between Mog's public/friend contracts and the engine. It owns the object model that production callers actually use:

- `api/index.ts` classifies root exports into stable unified API (`createWorkbook`, `Workbook`, `Utils`), experimental namespace APIs (`Cells`, `Sheets`, `Records`), internal document lifecycle, introspection, and internal cell conversion helpers.
- `workbook/create-workbook.ts` dispatches blank workbook, XLSX bytes, options object, and power-user `WorkbookConfig` overloads. The bootstrap path creates a `DocumentHandle`, imports XLSX when needed, creates `WorkbookImpl`, and chains workbook close/dispose to document-handle disposal.
- `workbook/workbook-impl.ts` is the canonical workbook facade. It owns sheet lookup, active-sheet state, sheet metadata caches, dirty state, save/export, undo grouping, calculation settings, workbook sub-APIs, state mirror access, and document-scoped managers.
- `worksheet/worksheet-impl.ts` is the canonical worksheet facade. It owns A1/numeric overload resolution, cell/range I/O, formula/date/time entry, protection preflights, active edit source invalidation, event mapping, viewport access, and lazy worksheet sub-APIs.
- `worksheet/operations` and `workbook/operations` are internal mutation/query modules called from the facades and sub-APIs. Their current error model is mixed: some throw `KernelError`, while legacy modules still return `OperationResult`.
- `document/` owns direct document lifecycle and public SDK wrapper types. `MogDocumentFactory` and `MogDocumentImpl` wrap internal handles so public consumers do not receive `DocumentContext`, raw bridge, or raw event bus.
- `app/` is a friend/internal app API. Despite its README saying "no active consumers", shell/runtime paths build capability-gated APIs from trusted document handles, so this must be treated as a production friend path until product direction says otherwise.
- `namespaces/` exposes low-level experimental APIs that take an explicit `IKernelContext`. They are not the recommended public route, but they are exported and must not silently bypass write/protection/security invariants.

Production callers include `runtime/sdk` and `runtime/embed`, shell document manager and app host code, `runtime/spreadsheet-app`, and the spreadsheet UI. The spreadsheet app relies on stable lazy sub-API objects and sync reads such as workbook sheet metadata and worksheet viewport access.

## Improvement objectives

1. Make the API folder contract-driven, not reviewer-memory-driven.
   - Add executable coverage that proves every `types/api/src/api` workbook/worksheet root member and sub-API member has an intentional implementation path.
   - Prove public metadata generators and docs derive from the same contract source, instead of hand-maintained sub-API lists drifting.

2. Establish one execution policy for API calls.
   - Every public/friend mutation must pass the same disposed, write-gate, read-only, protection, principal/capability, error-normalization, undo-label, and event/cache invalidation policy appropriate to its layer.
   - Public/friend APIs should throw typed errors directly. Internal operation modules should not leak `OperationResult` into facade code.

3. Reduce `WorkbookImpl` and `WorksheetImpl` from large coordinators into thin, contract-shaped facades.
   - Preserve the public object shape and referential stability.
   - Move repeated overload parsing, guard checks, bridge decode, and cache invalidation into focused internal modules.

4. Strengthen lifecycle ownership.
   - All workbook-owned handles, internal registrations, event subscriptions, lazily created sub-APIs, worksheet instances, caches, and managers must have an explicit disposal owner.
   - Use-after-dispose should fail with the stable SDK error model across workbook, worksheet, sub-API, and handle surfaces.

5. Make document/workbook bootstrap semantics explicit and testable.
   - Reconcile the current timezone contract drift.
   - Honor or remove dead configuration paths such as `WorkbookConfig.writeFile`.
   - Preserve the distinction between public SDK wrappers and trusted internal document handles.

6. Treat app capability gating as a real friend surface.
   - Align `app/README.md`, app contracts, capability manifests, and shell/runtime usage.
   - Preserve the "denied interface is absent" contract while preventing partial side effects in capability-gated batched operations.

7. Target production-path performance only where the API layer is the actual bottleneck.
   - Replace per-cell protection checks for large ranges with vectorized bridge/domain checks.
   - Replace cell-by-cell cross-workbook range copy with a bulk production path if the API remains supported.

## Production-path contracts and invariants to preserve or strengthen

- The unified `createWorkbook()` and `Workbook`/`Worksheet` object model remains the primary stable API surface.
- Namespace APIs remain experimental or are explicitly narrowed; they must not be used as a backdoor around write gates, protection checks, or security policy.
- Root public exports must not leak `DocumentContext`, `DocumentHandleInternal`, raw `ComputeBridge`, raw `IEventBus`, app API construction, or internal host bypasses.
- `DocumentHandle.workbook()` without options returns a cached workbook for referential stability. Config-based workbook creation may return fresh workbooks. Close/dispose remains idempotent.
- `Workbook.activeSheet`, `Workbook.sheetCount`, `Workbook.sheetNames`, `Worksheet.sheetId`, `Worksheet.name`, and `Worksheet.index` keep their sync semantics and are backed by explicitly refreshed caches or state mirror data.
- Rust/compute remains the source of truth for spreadsheet state. JavaScript caches are metadata/read-model caches with defined invalidation.
- Public/friend facades throw errors; modern callers do not receive `OperationResult`.
- Read-only documents fail mutations with stable `MogSdkError` code `READ_ONLY` and operation names such as `worksheet.setCell`.
- Disposed workbook/document paths fail with stable disposed/bridge-disposed errors and do not continue to touch transport.
- A1 and numeric row/column overloads keep their existing contract, including bounds behavior and lower-case normalization.
- Date and time entry never depends on an arbitrary cloud/host local timezone. Explicit user timezone and per-call timezone overrides must be validated at the documented layer.
- Sheet metadata invariants hold across local and remote sheet CRUD: case-insensitive sheet-name lookup, case-insensitive rename conflict detection, active visible sheet reconciliation, and "at least one visible sheet" behavior.
- App capability gating exposes only granted interfaces. Denied capabilities do not produce callable properties that later throw permission errors.
- Consumer-scoped handles implement the disposable contract and are either caller-owned with documented cleanup or parent-tracked with deterministic cleanup.
- Workbook/worksheet barrel files must not reintroduce implementation-to-barrel cycles.

## Concrete implementation plan

1. Add an executable API contract inventory gate.
   - Build a kernel-side contract coverage test or script that reads `types/api/src/api/workbook.ts`, `types/api/src/api/worksheet.ts`, and their sub-API interface folders through the same AST discovery strategy used by `runtime/sdk/scripts/generate-api-spec.ts`.
   - Emit a normalized API matrix: canonical path (`wb.sheets.add`, `ws.setCell`), root (`workbook`, `worksheet`, `app`, `document`, `namespace`), kind (`method`, `property`, `subApiAccessor`, `handleFactory`), async model, visibility, deprecation, owner file, and implementation file.
   - Fail when a contract member lacks an implementation owner, when an implementation exposes a public-looking method not present in contracts, or when public/friend implementation returns `OperationResult`.
   - Replace the older hand-maintained sub-API maps in docs/reference generation with discovery from the contract source or generated API spec.
   - Update `kernel/src/api/README.md` after the executable inventory exists. The README is currently stale around `sheet/`, `unwrap.ts`, sub-API counts, and app API usage; docs should describe generated facts, not act as the source of truth.

2. Introduce a shared API execution envelope.
   - Add an internal helper layer, for example `api/internal/api-execution.ts`, that exposes `runRead`, `runMutation`, `runWorkbookMutation`, `runWorksheetMutation`, and `runAppMutation`.
   - Inputs should include canonical operation name, context, optional sheet/range target, write/protection policy, undo grouping metadata, and an invalidation hook.
   - The helper should perform disposed checks, write-gate checks, optional protection preflight, consistent `toMogSdkError` conversion, and consistent operation naming.
   - Refactor workbook sub-APIs and worksheet sub-APIs to call this helper instead of each class carrying its own `_ensureWritable` and error wrapping variant.
   - Keep the helper internal to `kernel/src/api`; do not add a public abstraction.

3. Normalize operation modules to throwing semantics.
   - Convert the complete legacy `OperationResult` set in one systematic pass, not one module at a time. Target at least:
     - `worksheet/operations/filter-operations.ts`
     - `worksheet/operations/format-operations.ts`
     - `worksheet/operations/grouping-operations.ts`
     - `worksheet/operations/hyperlink-operations.ts`
     - `worksheet/operations/merge-operations.ts`
     - `worksheet/operations/sheet-management-operations.ts`
     - `worksheet/operations/table-operations.ts`
     - `worksheet/operations/validation-operations.ts`
     - `workbook/operations/scenario-operations.ts`
   - Replace `wrapOp`, `validateAddress` result helpers, and `operations/types.ts` compatibility imports with direct validation plus `KernelError`/`MogSdkError` throwing.
   - Update tests from `result.success` assertions to `await expect(...).rejects` or direct return assertions.
   - Add a contract gate that rejects new `OperationResult` imports inside `kernel/src/api/workbook`, `kernel/src/api/worksheet`, and `kernel/src/api/app` unless explicitly marked as bridge-wire decoding.

4. Split the coordinator classes without changing the public object model.
   - Keep `WorkbookImpl` and `WorksheetImpl` as the concrete exported implementation classes, because callers and tests rely on identity and lazy sub-API stability.
   - Move groups of root methods behind private/internal delegates:
     - Workbook: sheet resolution/cache, save/export, calculation/settings, range copy, events/records/search.
     - Worksheet: cell I/O, range I/O, formula/date/time entry, query/describe/summarize, events, active edit source.
   - Inject a small runtime object containing `ctx`, `sheetId`, `workbook`, state provider, floating object manager, and execution envelope helpers.
   - Preserve direct sibling imports from implementation files. Do not import through `workbook/index.ts` or `worksheet/index.ts` from implementation internals.
   - Add contract coverage for referential stability: repeated `wb.activeSheet`, `wb.getSheetById`, and readonly sub-API property access should return stable instances where the contract and UI expect stability.

5. Strengthen lifecycle and cache ownership.
   - Create a single workbook-owned resource registry using `DisposableStore` semantics for internal registrations, viewport handles, worksheet instances, code executor, floating object manager, checkpoint manager, form control manager, event subscriptions, and sub-API resources that own cleanup.
   - Add worksheet-level disposed state and guard every worksheet root/sub-API/handle method that can touch context or bridge state.
   - Ensure workbook disposal cascades to worksheet caches and event subscriptions before context/transport destruction.
   - Add tests for use-after-dispose on workbook root methods, worksheet root methods, sub-APIs, app APIs, and handles.
   - Add mutation-result/state-mirror tests proving sheet metadata caches stay correct after local and remote sheet add/remove/rename/hide/show/move.

6. Reconcile document and bootstrap contracts.
   - Decide and enforce the headless timezone rule. The documented rule says headless callers must provide `userTimezone`; current behavior can default to UTC and defer invalid timezone errors until date operations. The correct production contract should reject missing or invalid headless timezone at document/workbook creation unless a trusted runtime supplies a session timezone.
   - Add SDK conformance tests for explicit timezone, invalid timezone, missing headless timezone, browser fallback, and per-call date/time override.
   - Wire `WorkbookConfig.writeFile` into `WorkbookImpl.save(path)` or remove it from the contract if all production hosts must provide `onSave` instead. The current type/factory path advertises injection while `save(path)` imports `node:fs/promises` directly.
   - Keep `DocumentFactory` root access through the public narrowed wrapper and preserve negative boundary tests for raw internal handles/context.

7. Graduate or intentionally retire the app API friend path.
   - Update `app/README.md` to reflect actual shell/runtime usage, or if the product decision is to remove it, remove shell/runtime wiring in the same workstream. Do not leave a "no active consumers" README next to production callers.
   - Generate capability-gated wrapper coverage from the app contracts and capability manifest so new app capabilities cannot be added without gating tests.
   - Preflight capability requirements for `undoGroup`/batch operations when possible, so a denied operation does not leave partial writes inside a group.
   - Preserve the absent-interface contract for missing capabilities and add regression tests across tables, columns, records, relations, events, clipboard, undo, network, and connections.

8. Fix API-layer production performance hazards.
   - Replace `WorksheetImpl.ensureRangeEditable` per-cell loops with a vectorized domain/bridge query that can answer range/table editability in one call, including protected sheet options and unlocked cells.
   - Add bridge/domain support only if the production kernel path needs it; do not optimize mocks.
   - Replace `WorkbookImpl.copyRangeFrom` cell-by-cell copying with a bulk copy path that preserves formulas, formats, metadata, array/spill/data-table membership, and identity-aware relocations across workbook contexts. If cross-document copy cannot preserve those contracts yet, make the API contract explicit and fail for unsupported cases rather than silently degrading.

9. Refresh docs and generated metadata last.
   - Regenerate API spec/reference artifacts only after implementation and contract tests pass.
   - Update architecture docs to state that `kernel/src/api` is the canonical TypeScript implementation, `types/api` is the contract source, and `runtime/sdk` generated metadata is the public introspection source.
   - Keep internal planning content in `mog-internal`; do not leak private process notes into public docs.

## Tests and verification gates

Minimum gates for the implementation workstream:
- `pnpm --filter @mog-sdk/kernel test`
- `pnpm --filter @mog-sdk/kernel typecheck`
- `pnpm --filter @mog-sdk/kernel build` when exports, declarations, or public/friend types move
- Targeted Jest paths for changed areas:
  - `kernel/src/api/document/__tests__/sdk-conformance/*.test.ts`
  - `kernel/src/api/__tests__/*.test.ts`
  - `kernel/src/api/workbook/**/__tests__/*.test.ts`
  - `kernel/src/api/worksheet/**/__tests__/*.test.ts`
  - `kernel/src/api/app/**/__tests__/*.test.ts`
- New contract/inventory tests proving implementation coverage, no unintended `OperationResult`, no internal leaks, and stable sub-API identity.

When public contracts or generated metadata move:
- `pnpm typecheck`
- `pnpm check:publish-readiness:fast`
- `pnpm check:api-snapshots`
- `pnpm check:declaration-rollups`
- `pnpm check:contracts-declaration-identity`
- `pnpm --filter @mog-sdk/node test` or the relevant SDK/runtime gate if `runtime/sdk` entrypoints change

When shell/spreadsheet/runtime callers are touched:
- `pnpm --filter @mog/app-spreadsheet test`
- `pnpm --filter @mog/app-spreadsheet typecheck`
- `pnpm --filter @mog/shell test`
- `pnpm --filter @mog/shell typecheck`
- `pnpm --filter @mog-sdk/spreadsheet-app test`
- `pnpm --filter @mog-sdk/spreadsheet-app typecheck`
- Run the spreadsheet dev server and exercise real UI paths for sheet CRUD, cell edit, formula edit, table edit, app-gated API use, save/close, and document reload.

Rust/bridge gates are needed only if vectorized protection or bulk range-copy bridge methods are added:
- `cargo test -p <affected-crate>`
- `cargo clippy -p <affected-crate>`
- TypeScript bridge generation and the relevant kernel tests that consume the generated bridge.

## Risks, edge cases, and non-goals

Risks:
- Contract inventory can become noisy if it treats intentional internal/friend members as public. Solve this by requiring explicit visibility metadata instead of broad name matching.
- Refactoring `WorkbookImpl` and `WorksheetImpl` can break React dependency stability if sub-API objects or worksheet instances stop being referentially stable.
- Error normalization can accidentally change public SDK error codes. Add assertion tests for stable code, operation, cause, and JSON serialization.
- Tightening timezone creation semantics may break callers that relied on implicit UTC. The implementation should update all production host paths to pass real session timezone before enforcing the new gate.
- Vectorized protection checks and bulk cross-workbook copy may require compute bridge changes; coordinate with compute API/core owners instead of faking behavior in TypeScript.
- App capability changes can create security regressions if broad scopes, managed table IDs, name-based scopes, and absent-interface behavior are not tested together.

Edge cases to cover:
- Lower-case A1 input, invalid A1 input, numeric out-of-bounds input, whole-row/whole-column ranges, merged cells, spills, data tables, array formulas, hidden rows/columns, filtered rows, protected-but-unlocked cells, protected table resize/delete/insert policies.
- Sheet deletion when active sheet is deleted, active sheet is hidden, only one visible sheet remains, or a remote mutation changes sheet order before local state reconciles.
- Workbook close/dispose while async import, save, viewport refresh, event subscription, or app API call is in flight.
- `DocumentHandle.workbook()` cached path versus configured fresh path, with multiple workbooks sharing a handle.
- Read-only mode across workbook root methods, worksheet root methods, workbook sub-APIs, worksheet sub-APIs, namespace APIs, app APIs, and undo/redo.
- Public Node, browser/embed, Tauri/shell, and headless agent runtimes.

Non-goals:
- Do not redesign the public Workbook/Worksheet API shape as part of this cleanup.
- Do not add compatibility shims to preserve internal `OperationResult` call sites. Convert the complete category.
- Do not optimize test mocks, benchmark-only harnesses, or non-production paths.
- Do not expand the third-party app platform feature set beyond making the existing friend path contractually safe.
- Do not make `mog` depend on `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

Parallelizable workstreams:
- Contract inventory worker: `types/api/src/api`, `contracts/src/api`, `runtime/sdk/scripts/generate-api-spec.ts`, docs/reference generation, and new coverage tests.
- Execution-envelope worker: `kernel/src/api/internal`, workbook/worksheet/app sub-API guard/error normalization, and operation naming.
- Operation-normalization workers: split by module families (`filter/format/grouping`, `table/sheet-management`, `merge/hyperlink/validation`, `scenario`) with a shared throwing-error contract.
- Coordinator-refactor workers: one for workbook root delegates, one for worksheet root delegates, one for lifecycle/disposal/cache ownership.
- App capability worker: `kernel/src/api/app`, `kernel/src/services/capabilities`, `contracts/src/apps`, shell/runtime app callers, and app API tests.
- Bridge/performance worker: vectorized protection and bulk cross-workbook copy across kernel API, compute bridge, compute API/core, and generated bridge artifacts.
- Verification worker: SDK conformance, shell/runtime/spreadsheet caller tests, API snapshot/declaration gates, and UI smoke testing.

Dependencies:
- Contract inventory should land before broad refactors so workers share a single API matrix.
- Execution envelope should land before operation normalization so modules converge on one guard/error policy.
- Operation normalization should land before coordinator extraction where possible, because delegates should call throwing operations directly.
- Lifecycle/cache refactor depends on knowing final delegate ownership boundaries.
- App capability work depends on a product decision to keep the friend path, but current shell/runtime usage means it cannot be ignored.
- Bridge/performance work depends on compute API/core ownership and generated bridge regeneration.
- Public docs/reference updates should be last, after generated metadata and gates prove the final surface.
