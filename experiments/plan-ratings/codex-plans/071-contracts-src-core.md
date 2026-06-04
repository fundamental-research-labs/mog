# 071 - Contracts Core Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/contracts/src/core`

Queue item: 71

Scope: foundational public contracts for cell values, cell and range identity, sheet limits, command/event/test contracts, code execution result contracts, validation schema contracts, and small public runtime helpers exposed by `@mog-sdk/contracts`.

Files and integration points inspected:

- `contracts/src/core/core.ts`
- `contracts/src/core/index.ts`
- `contracts/src/core/commands.ts`
- `contracts/src/core/event-base.ts`
- `contracts/src/core/testing.ts`
- `contracts/src/core/disposable.ts`
- `contracts/src/core/result.ts`
- `contracts/src/core/formatted-text.ts`
- `contracts/src/core/execution.ts`
- `contracts/src/core/schema.ts`
- `types/core/src/**`
- `types/commands/src/**`
- `contracts/package.json`
- `tools/contracts-runtime-inventory.json`
- `tools/package-inventory.jsonc`
- `tools/check-contracts-declaration-identity.mjs`
- `tools/check-contracts-runtime-inventory.mjs`
- `fixtures/external/positive/contracts/**`
- `fixtures/external/positive/contracts-runtime-values/**`
- `kernel/src/bridges/schema-bridge.ts`
- `kernel/src/domain/schemas/schemas.ts`
- `kernel/src/bridges/wire/range-metadata-cache.ts`
- `kernel/__tests__/invariants/sheetid-boundary.test.ts`
- `compute/core/crates/types/cell-types/src/range_id.rs`
- `compute/core/crates/types/value-types/src/cell_value/**`
- `kernel/src/bridges/compute/compute-types.gen.ts`
- `kernel/src/document/state-mirror.ts`
- `file-io/xlsx/bridge/src/types.ts`
- `runtime/sdk/src/boot.ts`
- high-volume `@mog-sdk/contracts/core` consumers in `kernel`, `apps/spreadsheet`, `canvas`, `file-io`, and `runtime/sdk`

This plan does not cover:

- Implementing spreadsheet domain behavior in kernel, app, compute, canvas, or file I/O except where those production consumers must stop duplicating core constants or imports.
- Publishing private `@mog/types-*` packages or allowing private type shards to leak into compiled public runtime JS.
- Adding compatibility shims for stale import paths.
- Replacing branded identity types with runtime validation. The current contract is a compile-time brand plus explicit public factory boundary.
- Changing Rust range storage semantics unless a TypeScript/Rust parity check exposes a real enum or wire drift.

## Current role of this folder in Mog

`contracts/src/core` is the public facade for Mog's lowest-level spreadsheet contracts. It is part of the shipped `@mog-sdk/contracts` package and exposes both the root `@mog-sdk/contracts/core` entrypoint and public subpaths such as `@mog-sdk/contracts/commands`, `@mog-sdk/contracts/event-base`, `@mog-sdk/contracts/execution`, `@mog-sdk/contracts/schema`, `@mog-sdk/contracts/testing`, and `@mog-sdk/contracts/core/core`.

The folder currently has a split source-of-truth model:

- `commands.ts`, `event-base.ts`, `testing.ts`, `disposable.ts`, and `result.ts` are clean type-only re-export shims to `@mog/types-commands` or `@mog/types-core`.
- `core.ts` type-reexports `@mog/types-core/core`, but intentionally owns public runtime values: `MAX_ROWS`, `MAX_COLS`, `sheetId`, `rangeId`, and `RangeKind`.
- `formatted-text.ts` owns public runtime adapter functions, while its implementation is byte-identical to `types/core/src/formatted-text.ts`.
- `execution.ts` is byte-identical to `types/commands/src/execution.ts`, including both type declarations and the runtime constants `DEFAULT_EXECUTION_TIMEOUT` and `API_CALL_TIMEOUT`.
- `schema.ts` is byte-identical to `types/commands/src/schema.ts`, including all schema type declarations and the runtime value `ValidationErrorCodes`.
- `index.ts` re-exports all `@mog/types-core` and `@mog/types-commands` types, then locally exports the contracts-owned runtime values from `core.ts`, `formatted-text.ts`, `execution.ts`, and `schema.ts`.

Production consumers are broad. Kernel schema bridges consume `ColumnSchema`, `RangeSchema`, `CellSchemaType`, `ValidationErrorCodes`, and `SheetId`; runtime SDK code consumes `CodeExecutionOptions` and `CodeExecutionResult`; range metadata flows use `RangeKind`; UI and clipboard code consume `CellRange`, `CellValue`, `CellFormat`, `MAX_ROWS`, `MAX_COLS`, `FormattedText`, and formatted-text adapter helpers.

The cross-language contract is especially important for `RangeKind`. TypeScript `RangeKind`, Rust `cell_types::RangeKind`, and generated `kernel/src/bridges/compute/compute-types.gen.ts` must remain identical because range metadata drives data, format, named range, conditional format, validation, protection, print area, and table storage.

## Improvement objectives

1. Make the source-of-truth model explicit: type authoring lives in tier-0 type shards; public runtime values are owned and emitted by `@mog-sdk/contracts`.

2. Remove split-brain duplicated type bodies in `contracts/src/core/execution.ts` and `contracts/src/core/schema.ts` while preserving their public runtime exports.

3. Keep `contracts/src/core` self-contained at runtime. Built public JS must not import `@mog/types-core`, `@mog/types-commands`, or any other private workspace package.

4. Turn the core facade into a governed inventory with one recorded owner for every public subpath, type projection, and runtime value.

5. Add parity checks for duplicated runtime semantics: spreadsheet limits, execution timeouts, `ValidationErrorCodes`, `RangeKind`, branded factory behavior, and formatted-text adapters.

6. Strengthen declaration identity gates for branded symbols so `SheetId`, `RangeId`, `CellId`, `RowId`, `ColId`, `FormattedText`, and formula brands do not gain duplicate public owners.

7. Expand external package fixtures so the built artifact proves all important core runtime values and type surfaces work through public imports, not only through source-time aliases.

8. Audit wire-shape compatibility for the high-risk core structural types that cross Rust, generated bridge, app, file I/O, and renderer paths: `CellValue`, `CellRange`, `RangeAnchor`, `AxisIdentityRef`, `PayloadEncoding`, and `PrintSettings`.

9. Remove downstream local limit duplicates and route consumers through `@mog-sdk/contracts/core` for `MAX_ROWS` and `MAX_COLS`.

10. Preserve all existing public subpaths and root exports unless a separate public surface decision intentionally removes them with updated package inventory, snapshots, and fixtures.

## Production-path contracts and invariants to preserve or strengthen

Public package boundary:

- `@mog-sdk/contracts` remains the only public runtime package for this facade.
- Compiled contracts runtime JS must not import private packages matched by `@mog/*`, `@mog-sdk/types-*`, `@mog/types-*`, or `@rust-bridge/*`.
- `contracts/package.json` public subpaths for core, commands, event-base, execution, schema, testing, and core/core must continue to match `tools/package-inventory.jsonc`.
- `tools/contracts-runtime-inventory.json` must describe every retained runtime export from type-shard-backed sources.

Source-of-truth ownership:

- Type definitions are authored in `types/core/src/**` and `types/commands/src/**`.
- Contracts-owned runtime values are locally emitted by `contracts/src/**` so external consumers never load private type shard runtime modules.
- Exact duplicated implementations are allowed only when there is a recorded reason and a parity gate.

Identity and branding:

- `sheetId(id)` and `rangeId(id)` are public factory boundaries that cast raw strings to branded types. They must remain deterministic identity functions at runtime.
- `CellId`, `RowId`, `ColId`, `SheetId`, `RangeId`, `FormattedText`, formula brands, document brands, viewport brands, and layer brands must have a single declaration owner in bundled public `.d.ts` output.
- Production code should not add ad hoc `as SheetId` or `as RangeId` casts outside intentional public or wire seams.

Spreadsheet limits:

- `MAX_ROWS` is `1_048_576`.
- `MAX_COLS` is `16_384`.
- Consumers implementing selection, fill, clipboard, grid bounds, name box display, render bounds, and API validation must import these constants rather than hardcoding local alternatives.

Range metadata:

- TypeScript `RangeKind` values must exactly match Rust `cell_types::RangeKind` serde values and the generated bridge union:
  - `Data`
  - `Format`
  - `NamedRange`
  - `CondFormat`
  - `Validation`
  - `Protection`
  - `PrintArea`
  - `Table`
- Range IDs remain branded strings in TypeScript and hex/UUID-compatible strings at wire boundaries.
- `RangeAnchor` must preserve the externally tagged Rust serde shape with PascalCase variants and camelCase fields.
- `AxisIdentityRef` and `PayloadEncoding` must remain wire-compatible with generated bridge and snapshot types.
- Range metadata decoded from Rust mutation bytes must continue to feed range caches and event emission without lossy string or enum conversions.

Cell value and range shapes:

- `CellValue` must either align with all production Rust/generated variants that can cross the bridge or explicitly fence unsupported variants at the bridge boundary. The current TypeScript core contract is narrower than Rust value serialization, so this needs a deliberate audit before changing the public union.
- `CellRange` remains zero-based and inclusive, with `isFullColumn`, `isFullRow`, and optional `sheetId` intent flags.
- Structural subsets used by XLSX bridge or other import/export code must stay assignable to the public `CellRange` shape or be renamed as explicit adapter DTOs.
- `PrintSettings` must preserve nullable-vs-optional field semantics and bridge renames such as `cellComments` to `printComments` through state mirror normalization.

Execution contracts:

- `ExecutionStatus` remains `'success' | 'error' | 'timeout' | 'cancelled'`.
- `ChangeType` remains `'direct' | 'indirect'`.
- `CodeExecutionResult` preserves logs, change counts, edit ranges, dirty cell details, optional formatted summary, and timing fields.
- `DEFAULT_EXECUTION_TIMEOUT` remains `30000`.
- `API_CALL_TIMEOUT` remains `10000`.

Schema contracts:

- `CellSchemaType` remains the union of primitive, semantic, entity, and special schema types currently implemented by the schema bridge and domain schemas.
- `SchemaConstraints` keeps Excel validation parity fields, dynamic `IdentityRangeSchemaRef` enum sources, formula enum sources, custom validation formulas, and precedence semantics of `enumSourceFormula > enumSource > enum`.
- `RangeSchema` uses identity-backed ranges, not A1 strings, for CRDT-safe data validation.
- `ValidationErrorCodes` stays a stable runtime object and type source for public consumers.

Formatted text:

- `asFormattedText` is the producer-boundary adapter from string to `FormattedText`.
- `displayString` and `displayStringOrNull` are the only intentional rendering/display unwrap helpers.
- `FormattedText` must remain opaque enough that logic consumers do not accidentally treat display strings as semantic values.

## Concrete implementation plan

1. Build a core facade inventory.
   - Add a machine-readable or script-derived inventory for every file under `contracts/src/core`.
   - Classify each file as type-only shim, mixed type projection plus contracts-owned runtime, local runtime adapter, or obsolete duplicate.
   - Record the canonical type-shard source for each type projection.
   - Record public package subpath ownership for `./core`, `./core/core`, `./commands`, `./event-base`, `./execution`, `./schema`, and `./testing`.
   - Record every runtime value and its owner: limits, branded factories, `RangeKind`, formatted-text helpers, execution timeouts, and `ValidationErrorCodes`.
   - Wire the inventory into the existing public boundary tooling instead of leaving it as documentation only.

2. Refactor `execution.ts` into a clean projection.
   - Replace the copied type body in `contracts/src/core/execution.ts` with `export type * from '@mog/types-commands/execution'`.
   - Locally emit only `DEFAULT_EXECUTION_TIMEOUT` and `API_CALL_TIMEOUT`.
   - Add an ownership comment matching the pattern in `contracts/src/cells/cell-identity.ts`: type authoring lives in the type shard, public runtime values are emitted by contracts.
   - Add a parity check that fails if the private shard and public contracts disagree on the timeout constant names or numeric values.
   - Preserve public imports from both `@mog-sdk/contracts/core` and `@mog-sdk/contracts/execution`.

3. Refactor `schema.ts` into a clean projection.
   - Replace the copied schema type body in `contracts/src/core/schema.ts` with `export type * from '@mog/types-commands/schema'`.
   - Locally emit `ValidationErrorCodes`.
   - Keep `ValidationErrorCode` available through the public entrypoint without creating declaration conflicts or a second nominal owner.
   - Add an AST-based parity check that compares public `ValidationErrorCodes` keys and values with the canonical schema shard.
   - Keep `RangeSchema`, `ColumnSchema`, `CellSchema`, `SchemaConstraints`, `ISchemaValidator`, and `ISchemaRegistry` projected from the canonical type source.

4. Govern formatted-text runtime duplication.
   - Keep public runtime helpers in `contracts/src/core/formatted-text.ts`.
   - Add an ownership comment explaining that the helper semantics are public contracts-owned runtime, even if the private type shard exposes equivalent helpers for workspace use.
   - Add a small parity test for `asFormattedText`, `displayString`, and `displayStringOrNull` behavior so future edits cannot drift silently.
   - Do not make `@mog/types-core` depend on `@mog-sdk/contracts`; that would invert the current tier-0 dependency direction.

5. Strengthen `core.ts` runtime ownership.
   - Keep `export type * from '@mog/types-core/core'`.
   - Keep local runtime ownership for `MAX_ROWS`, `MAX_COLS`, `sheetId`, `rangeId`, and `RangeKind`.
   - Add `RangeKind` parity coverage against both `compute/core/crates/types/cell-types/src/range_id.rs` and `kernel/src/bridges/compute/compute-types.gen.ts`.
   - Add a constants parity check against `types/core/src/core.ts` for `MAX_ROWS`, `MAX_COLS`, and any future core runtime constants.
   - Add a repo scan that flags local hardcoded spreadsheet limits in production TypeScript when the code should import `MAX_ROWS` or `MAX_COLS`. The known downstream candidate is `apps/spreadsheet/src/domain/fill/types.ts` using `1_000_000` for max rows.

6. Make `index.ts` an intentional compatibility facade.
   - Preserve `export type * from '@mog/types-core'` and `export type * from '@mog/types-commands'` for current `@mog-sdk/contracts/core` compatibility.
   - Re-export only contracts-owned runtime values locally.
   - Add a source comment that documents why `@mog-sdk/contracts/core` is a combined core plus command compatibility entrypoint while narrower subpaths remain available.
   - Ensure root `contracts/src/index.ts` continues to expose core runtime values intentionally and does not accidentally re-export command runtime values unless that is a deliberate public decision.

7. Add core-local contract tests.
   - Add focused Jest tests under `contracts/src/core/__tests__/` or an equivalent package-level test location.
   - Test exact spreadsheet limits.
   - Test `RangeKind` keys and values.
   - Test `sheetId` and `rangeId` return the same string value at runtime while preserving compile-time branding.
   - Test formatted-text string round trip and null behavior.
   - Test execution timeouts.
   - Test `ValidationErrorCodes` exact keys and values, including any future schema constraint additions.
   - These tests should import through public package source entrypoints, not private type shard runtime modules.

8. Expand external public package fixtures.
   - Extend `fixtures/external/positive/contracts/smoke.ts` and `smoke.mjs` to import and exercise `@mog-sdk/contracts/core`, `@mog-sdk/contracts/execution`, and `@mog-sdk/contracts/schema`.
   - Cover `RangeKind`, `rangeId`, formatted-text helpers, execution timeout constants, and `ValidationErrorCodes` through built artifacts.
   - Add type-only fixture coverage for `CodeExecutionOptions`, `CodeExecutionResult`, `DirtyCell`, `ColumnSchema`, `RangeSchema`, `CellSchemaType`, `ValidationResult`, `Command`, event-base types, and testing interfaces.
   - Extend the runtime inventory fixture if new runtime values are added or ownership changes.

9. Add declaration and runtime drift checks.
   - Extend `tools/check-contracts-declaration-identity.mjs` if new branded core symbols are introduced.
   - Add a `check-contracts-core-facade` style script that:
     - verifies no non-type imports from private type shards in `contracts/src/core`;
     - verifies duplicated constants match their canonical or recorded public value;
     - verifies package exports match the core facade inventory;
     - verifies `RangeKind` parity across contracts, Rust, and generated bridge output;
     - verifies generated bridge and public contracts agree on externally tagged range metadata shapes;
     - verifies no stale runtime inventory entries remain.
   - Prefer AST or structured parsing over string comparison for TypeScript checks, and use generated bridge output as the primary TypeScript/Rust parity surface when direct Rust parsing would be brittle.

10. Audit high-risk core wire shapes.
    - Compare public `CellValue` against Rust `value-types` serialization and generated compute bridge values.
    - Decide whether additional variants such as arrays, controls, or images belong in the public `CellValue` union or must be converted/fenced before reaching public consumers.
    - Compare public `CellRange` against file I/O bridge structural subsets and ensure assignability is intentional.
    - Compare `PrintSettings` public contract fields against generated bridge/state mirror shapes and keep bridge normalization explicit.
    - Add tests for any conversion boundary that intentionally narrows or renames a public core shape.

11. Integrate downstream production consumers.
    - Replace local spreadsheet limit constants in production TypeScript with imports from `@mog-sdk/contracts/core` where the value is the Excel sheet bound.
    - Keep domain-specific smaller limits only if they are named as separate product limits and documented as intentionally not Excel sheet bounds.
    - Re-run and repair affected kernel/app/canvas/file-io consumers if the facade refactor exposes private runtime imports, declaration conflicts, or stale type imports.
    - Do not fix consumer issues by adding compatibility shims in `contracts/src/core`; fix the production import or contract ownership directly.

12. Update docs and snapshots.
    - Update public/internal docs that describe `contracts/src/core/schema.ts` or `contracts/src/core/core.ts` as the canonical type source so they instead explain the facade/type-shard split.
    - Update `docs/internals/spreadsheet/foundations.md` if implementation changes source locations or verification gates.
    - Update API snapshots only for intentional public declaration changes.
    - Keep runtime inventory and package inventory in sync with the implementation.

## Tests and verification gates

The implementation worker should run these gates. This planning worker did not run them.

Core package gates:

1. New `check-contracts-core-facade` inventory/parity gate.
2. `pnpm --filter @mog/types-core typecheck`
3. `pnpm --filter @mog/types-commands typecheck`
4. `pnpm --filter @mog-sdk/contracts test`
5. `pnpm --filter @mog-sdk/contracts typecheck`
6. `pnpm --filter @mog-sdk/contracts build`
7. `pnpm check:contracts-runtime-inventory`
8. `pnpm check:contract-runtime-imports`
9. `pnpm check:contracts-declaration-identity`
10. `pnpm check:declaration-rollups`
11. `pnpm check:api-snapshots`
12. `pnpm check:external-fixtures -- --skip-build` after public artifacts are built.

Rust and generated parity gates if `RangeKind`, range IDs, or generated bridge mappings are touched:

1. `cargo test -p cell-types`
2. The bridge generation or snapshot gate that owns `kernel/src/bridges/compute/compute-types.gen.ts`, if the implementation changes generation output.

Production consumer gates:

1. `pnpm --filter @mog-sdk/kernel typecheck`
2. `pnpm --filter @mog-sdk/kernel test`
3. Focused kernel tests around:
   - `kernel/__tests__/invariants/sheetid-boundary.test.ts`
   - schema bridge tests
   - range metadata cache and mutation result handler tests
4. `pnpm --filter @mog/app-spreadsheet typecheck`
5. `pnpm --filter @mog/app-spreadsheet test`
6. Focused app tests for fill bounds, selection bounds, formula bar name box display, and clipboard flows if local limit constants are removed.
7. Repo-wide `pnpm typecheck` for the final integrated TypeScript contract pass.

Focused tests to add or strengthen:

- Public fixture runtime assertions for all contracts-owned core runtime values.
- Type fixture assertions that root `@mog-sdk/contracts`, `@mog-sdk/contracts/core`, and narrower subpaths expose compatible branded types.
- Declaration identity tests for branded symbols after any facade or declaration rollup change.
- `RangeKind` parity tests across contracts, generated bridge TypeScript, and Rust source or Rust serde snapshots.
- Wire-shape tests for `CellValue`, `CellRange`, `RangeAnchor`, `PayloadEncoding`, and `PrintSettings` adapters when implementation changes those contracts.
- Drift tests proving `contracts/src/core/execution.ts` and `contracts/src/core/schema.ts` no longer carry copied type bodies.

## Risks, edge cases, and non-goals

- Runtime duplication is partly intentional. The public package must emit runtime values itself because private type shards are forbidden runtime dependencies for shipped packages.
- Removing copied type bodies can change declaration source locations. That is acceptable only if API snapshots and declaration identity checks still prove the public surface is stable.
- `export type *` plus local runtime exports can create name conflicts if a type alias and value share the same name incorrectly. The implementation should verify the generated `.d.ts` shape, not assume the TypeScript source shape is enough.
- `ValidationErrorCode` is derived from `ValidationErrorCodes`; the implementation must preserve that type relationship without accidentally deriving from a private runtime value.
- `RangeKind` ordering is not a public TypeScript runtime guarantee, but value parity with Rust serde strings is mandatory.
- `CellValue` has a known mismatch risk between the public TypeScript union and Rust/generated bridge variants. Do not widen or narrow it casually; decide the production boundary and test it.
- `PrintSettings` has bridge normalization details that are easy to break when moving type ownership. Preserve nullable fields and public names rather than copying generated wire DTOs into contracts.
- `CellRange` is used as both a user-facing range shape and a structural import/export shape. Keep subsets explicit to avoid accidental loss of full row/column intent.
- `sheetId` and `rangeId` should not start validating IDs unless the whole production path is ready for validation errors at public API and wire seams.
- Some production constants may look like spreadsheet limits but represent intentionally smaller algorithmic limits. Rename and document those rather than blindly replacing them.
- Do not move schema validation implementation into contracts. The folder owns contracts and small public runtime values, not validation behavior.
- Do not add test-only APIs, compatibility aliases, or mock-only import paths.
- Do not weaken package boundary checks to make private runtime imports pass.

## Parallelization notes and dependencies on other folders, if any

Recommended parallel work split:

- Agent A: Build the `contracts/src/core` facade inventory and implement the new source-of-truth/parity checker.
- Agent B: Refactor `execution.ts`, `schema.ts`, `formatted-text.ts`, `core.ts`, and `index.ts` ownership comments and exports.
- Agent C: Add package-level core contract tests and declaration identity coverage.
- Agent D: Expand external fixtures and runtime inventory fixture coverage for core, execution, and schema public subpaths.
- Agent E: Add `RangeKind` parity checks against generated bridge output and Rust `cell-types`.
- Agent F: Audit high-risk wire shapes for `CellValue`, `RangeAnchor`, `CellRange`, `PayloadEncoding`, and `PrintSettings`.
- Agent G: Audit downstream hardcoded `MAX_ROWS` and `MAX_COLS` duplicates, then update production consumers that should import from contracts.
- Integrator: Run the full verification sequence, update snapshots/inventory/docs, and confirm public artifacts have no private runtime imports or declaration-brand duplication.

Dependencies:

- `mog/types/core/src`: canonical type authoring for core cell, range, style, sheet, formatted text, and identity types.
- `mog/types/commands/src`: canonical type authoring for command, event-base, execution, schema, and testing contracts.
- `mog/tools`: package inventory, runtime inventory, declaration identity, runtime import, external fixture, and API snapshot tooling.
- `mog/fixtures/external`: public package import and runtime smoke fixtures.
- `mog/compute/core/crates/types/cell-types`: Rust range kind and range identity definitions.
- `mog/kernel/src/bridges/compute`: generated TypeScript bridge types and compute bridge mappings.
- `mog/kernel/src`: production implementation and high-volume consumer of sheet IDs, range metadata, schema contracts, and execution contracts.
- `mog/apps/spreadsheet/src`: production UI consumer of sheet limits, cell ranges, cell formats, schema contracts, and formatted text helpers.
- `mog/runtime/sdk`: public SDK code execution contract consumer.
- `mog/canvas`, `mog/file-io`, and `mog/views`: additional production consumers of core cell/range/format contracts.
