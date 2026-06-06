# 008 - Types Data Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/types/data/src`

Queue item: 8

Scope this plan covers:

- `@mog/types-data` source files under `types/data/src`, especially `data/charts.ts`, `data/filter.ts`, `data/grouping.ts`, `data/named-ranges.ts`, `data/pivot.ts`, `data/slicers.ts`, `data/sorting.ts`, `data/sparklines.ts`, `data/tables.ts`, `data/trace-arrows.ts`, and the package barrels.
- The public projection of those types through `@mog-sdk/contracts/data/*` and short subpaths such as `@mog-sdk/contracts/filter`, `pivot`, `tables`, `slicers`, `sparklines`, `grouping`, `named-ranges`, and `trace-arrows`.
- Domain type source-of-truth rules, declaration stability, generated Rust bridge DTO parity, public package exports, and downstream production consumers in charts, kernel, canvas, apps, table-engine, runtime SDK, and public contracts.

Scope this plan does not cover:

- Implementing table, pivot, filter, chart, slicer, sparkline, grouping, or named-range runtime behavior.
- Moving private generated bridge code into public packages.
- Optimizing benchmark-only paths or adding mock-only verification.
- Creating temporary compatibility shims to avoid repairing production callers.
- Publishing `@mog/types-data` as a public package unless the package inventory and public contract policy are intentionally changed.

## Current role of this folder in Mog

`types/data/src` is the workspace-internal source package for structured spreadsheet domain contracts. The package is currently `private: true` and classified as `workspace-internal` in `tools/package-inventory.jsonc`, but its declarations are projected into the public `@mog-sdk/contracts` package through re-export shims.

Observed package shape:

- `types/data/package.json` exports the package root, `./data`, and ten precise data subpaths.
- `src/index.ts` is documentation-only with `export {}`; the actual surface is under `src/data`.
- `src/data/index.ts` re-exports all data modules and re-exports conditional-format rule types from `@mog/types-formatting/conditional-format/rules` to preserve the old `@mog/types-data/data` surface without recreating a formatting/data dependency cycle.
- `contracts/src/data/*.ts` re-export these modules, and `contracts/package.json` exposes both `./data/*` and shorter legacy-style subpaths.

Observed domain roles:

- `charts.ts` is the canonical public chart type surface consumed by `@mog/charts`, kernel chart conversion/resolved-spec code, chart export, diagnostics, and public APIs. It is a 3,700+ line module that mixes input config, OOXML preservation metadata, style/theme contracts, render/export snapshots, and resolved-spec diagnostics.
- `filter.ts`, `sorting.ts`, `tables.ts`, `named-ranges.ts`, and `trace-arrows.ts` encode Cell Identity Model invariants such as stable `CellId`/`IdentityFormula` storage and position resolution at render or API boundaries.
- `pivot.ts`, `grouping.ts`, `slicers.ts`, and `sparklines.ts` state that they mirror Rust/generated bridge types in `kernel/src/bridges/compute/compute-types.gen.ts`, while also carrying TS-only manager, render, and UI helper contracts.
- Production consumers import the public projection heavily through `@mog-sdk/contracts/*` in `kernel`, `apps/spreadsheet`, `canvas`, `charts`, `table-engine`, and runtime SDK paths. Workspace-internal type packages also import `@mog/types-data/data/*` directly.

Inspection risks found in this pass:

- Several modules rely on manual "must stay in sync" comments for Rust/generated DTO parity instead of an automated parity gate.
- `charts.ts` and `pivot.ts` contain broad `unknown` payloads and deprecated aliases that may be intentional at import/preservation boundaries, but the intent is not classified in a machine-checkable way.
- Domain data, public API input DTOs, render snapshots, persistence DTOs, and manager/service interfaces live together in the same source package without an explicit ownership matrix.
- There are no local tests under `types/data/src`; current safety mostly comes from downstream package tests, contracts build checks, declaration identity checks, and public fixture gates.

## Improvement objectives

1. Make `types/data/src` a governed domain-contract package with an explicit source-of-truth classification for every exported type.
2. Replace manual Rust/generated DTO sync comments with automated parity checks against `compute-types.gen.ts` or a generated public-safe DTO source.
3. Preserve the public `@mog-sdk/contracts` projection while making export, shim, declaration, and source parity mechanically verifiable.
4. Split the largest mixed contract surfaces into smaller ownership-focused modules without changing public import paths by accident.
5. Strengthen discriminated unions, branded IDs, identity-based ranges, and schema-versioned snapshot contracts so invalid combinations fail at the type boundary.
6. Replace accidental `unknown`/opaque payloads with named preservation, generated-wire, JSON, or diagnostic payload types where the data is intentionally schemaless.
7. Separate persisted state, API input, render snapshot, and manager interface contracts so runtime implementations cannot depend on loose or wrong DTO layers.
8. Add compile-time and fixture coverage that proves real public consumers can import the same contracts through the supported `@mog-sdk/contracts` paths.

## Production-path contracts and invariants to preserve or strengthen

- Public consumers import through `@mog-sdk/contracts`, not directly through `@mog/types-data`.
- `@mog/types-data` remains private/workspace-internal unless package inventory, docs, and publication gates change together.
- `mog` must not depend on `mog-internal`; all contract tooling and tests for this package belong in the public repo.
- `types/data` may depend on `types-core`, `types-commands`, `types-formatting`, and `types-objects`, but must not introduce dependency cycles with formatting, API, rendering, kernel, charts, or contracts.
- `contracts/src/data/*` and short `contracts` subpaths must continue to project the same public declarations unless an intentional contract change updates snapshots and external fixtures.
- Cell Identity Model contracts remain authoritative: durable table/filter/sort/named-range/trace-arrow state uses `CellId`, `CellIdRange`, or `IdentityFormula`; position-based shapes are API inputs, render projections, or explicitly deprecated migration fields.
- Rust-generated bridge DTOs are authoritative for compute-owned persisted or wire shapes. Handwritten TS mirrors must either be generated from the same source or covered by parity checks.
- Chart resolved-spec, export, render snapshot, and package-authority shapes are public diagnostic/export contracts; changes require intentional schema review and snapshot/fixture updates.
- Conditional-format re-export through `@mog/types-data/data` must not recreate a `types-formatting` <-> `types-data` cycle.
- Runtime JavaScript emitted by type packages and `@mog-sdk/contracts` must remain free of private runtime imports and declaration identity duplication.

## Concrete implementation plan

### 1. Build a data contract ownership matrix

Create a machine-readable inventory for every exported type in `types/data/src/data` with these classifications:

- Canonical public domain contract owned by `types/data`.
- Rust/generated mirror owned by compute/domain-types.
- Public API input DTO.
- Persisted storage DTO.
- Render/export/diagnostic snapshot.
- TS-only manager/service interface.
- Compatibility alias or deprecated migration field.
- Intentional opaque preservation payload.

Use the inventory to drive checks and documentation. Every `unknown`, deprecated field, alias, and generated mirror must have an owner and reason, not just an inline comment.

### 2. Add export and projection parity checks

Add a checker that validates:

- `types/data/package.json` exports resolve to existing `src` and `dist` targets.
- `contracts/src/data/*` shims point at valid `@mog/types-data/data/*` subpaths.
- `contracts/package.json` short subpaths and `./data/*` subpaths project the same source files.
- `types/data/src/data/index.ts` exports exactly the intended module set plus the conditional-format compatibility re-export.
- Declaration rollups do not leak private generated kernel paths or duplicate branded identity declarations.

This checker should run in the public repo with the existing contracts/package-boundary gates.

### 3. Replace manual generated DTO mirrors with a verified bridge contract

For pivot, grouping, slicer, and sparkline shapes that mirror `compute-types.gen.ts`, choose one production source-of-truth path:

- Prefer generating public-safe TypeScript DTO declarations from the Rust/domain-types bridge source into `types/data/src/generated` or an equivalent public package location.
- If generation is not immediately available, add type-level parity tests that compare exported handwritten contracts against `kernel/src/bridges/compute/compute-types.gen.ts` for the mirrored subset.
- Keep generated-wire-only details out of public contracts unless they are intentionally public storage or API DTOs.
- Replace comments like "MUST be updated manually" with a failing parity gate.

Do this systematically for all mirrored categories, not one type at a time.

### 4. Split `charts.ts` by contract layer while preserving public paths

Refactor the 3,700+ line chart module into focused files under `data/charts/`:

- `config.ts` for public chart config and series input contracts.
- `formatting.ts` for chart colors, fills, lines, fonts, theme, and style context.
- `ooxml-preservation.ts` for deliberate raw/preserved OOXML payloads.
- `resolved-spec.ts` for public resolved-spec and diagnostic snapshots.
- `geometry.ts` for rendered geometry and chart-family support snapshots.
- `export.ts` for image/export option snapshots.
- `index.ts` as the stable public barrel for `@mog/types-data/data/charts`.

Keep `@mog/types-data/data/charts` and `@mog-sdk/contracts/data/charts` import paths stable. Add snapshot and import-fixture gates before and after the split so the refactor is contract-preserving unless an intentional schema change is made.

### 5. Harden discriminated unions and opaque payloads

Systematically audit broad shapes across `charts.ts`, `pivot.ts`, `slicers.ts`, and filter/sort/table DTOs:

- Convert optional-field bags into discriminated unions where the discriminator already exists, such as filter criteria variants, chart fills, slicer source variants, pivot mutation receipts, and table style choices.
- Replace generic `unknown` fields with named types such as `PreservedOoxmlPayload`, `GeneratedWirePayload`, `OpaqueBridgeResult`, `JsonValue`, or `ProducerDiagnosticDetails` when the payload is intentionally opaque.
- Brand stable identifiers where the runtime already treats them as non-interchangeable, especially pivot placement/member/tuple keys, table IDs, slicer IDs, sparkline IDs, chart IDs, and trace-arrow IDs.
- Define ranges as identity, API position, or render projection types explicitly rather than using `CellRange`/plain row-col shapes interchangeably.

The goal is not to remove all opacity; it is to make every opaque boundary named, owned, and tested.

### 6. Separate domain data from manager interfaces

Review `ISparklineManager`, `ISlicerManager`, `ITableManager`, `IFilterManager`, `IGroupingManager`, and `IPivotEngine`:

- Decide which interfaces are public API/bridge contracts and which are internal implementation service contracts.
- Move or re-export them from the package that owns the runtime boundary when appropriate, while preserving public `@mog-sdk/contracts` import paths through intentional barrels.
- Keep persisted data DTOs independent from manager interfaces so storage/schema changes do not accidentally widen service contracts.
- Add package-boundary checks to prevent implementation packages from importing private manager shapes through `types/data` when a public bridge/API interface is the correct dependency.

### 7. Normalize compatibility aliases and deprecated fields

Create a compatibility inventory for existing aliases and deprecated fields, including chart axis aliases, trendline aliases, table `range`, pivot legacy calculated fields, pivot legacy expansion maps, slicer storage config, and conditional-format data-barrel re-exports.

For each item:

- Mark it as permanent public vocabulary, active migration field, or removable stale compatibility.
- If permanent, include it in declaration snapshots and public examples.
- If migration-only, define the production migration path and remove it once production callers no longer require it.
- If stale, remove it with coordinated updates to downstream kernel/apps/charts consumers and public fixtures.

Do not add new compatibility aliases as a substitute for updating production callers.

### 8. Add domain contract tests and fixtures

Add focused type tests and fixture imports for:

- Public imports through every supported `@mog-sdk/contracts` data subpath and short subpath.
- Declaration identity for `CellId`, `SheetId`, `CellRange`, `CellFormat`, `ObjectPosition`, and generated mirror DTOs.
- Generated DTO parity for pivot, grouping, slicer, and sparkline mirrored types.
- Type-negative examples for invalid filter criteria, sort color criteria without target color, table style preset/custom conflicts, malformed pivot mutation receipts, and unsupported chart type strings.
- Positive examples for identity-based table/filter/sort/named-range/trace-arrow storage and API position-to-identity input DTOs.
- Resolved chart snapshot schema imports used by kernel chart diagnostics and runtime export code.

Prefer compile-time assertions and external fixture builds over tests that instantiate mock-only runtime paths.

### 9. Integrate production consumers after contract hardening

Update consumers in dependency-safe order:

- `types/events`, `types/rendering`, `types/api`, `types/bridges`, and `types/machines` for internal package imports.
- `contracts/src/data`, contracts exports, declaration rollups, and runtime import inventory.
- `kernel` domain/API bridges for filters, tables, pivots, charts, grouping, slicers, sparklines, and trace arrows.
- `charts` for chart config/resolved-spec split imports.
- `canvas` and `apps/spreadsheet` render/UI consumers.
- `table-engine`, `runtime/sdk`, and external/public fixtures.

Treat new casts to `any` or broad `unknown` in these production paths as a failed contract unless they point to a named opaque boundary from the inventory.

## Tests and verification gates

Run these after implementation, in dependency order:

1. New `types-data` ownership/export/projection parity checker.
2. New generated DTO parity checker for compute-owned mirrored data types.
3. `pnpm --filter @mog/types-data typecheck`
4. `pnpm --filter @mog/types-events typecheck`
5. `pnpm --filter @mog/types-rendering typecheck`
6. `pnpm --filter @mog/types-api typecheck`
7. `pnpm --filter @mog/types-bridges typecheck`
8. `pnpm --filter @mog-sdk/contracts typecheck`
9. `pnpm --filter @mog-sdk/contracts build`
10. `pnpm check:contracts-declaration-identity`
11. `pnpm check:declaration-rollups`
12. `pnpm check:api-snapshots`
13. `pnpm check:external-fixtures -- --skip-build` after public artifacts are built.
14. Targeted production consumer tests changed by the contracts, including relevant kernel bridge/domain tests, chart resolved-spec/export tests, table-engine conversion tests, canvas render type tests, and spreadsheet UI tests for slicer/sparkline/filter/table/pivot type paths.
15. Repo-wide `pnpm typecheck` for the final integrated TypeScript contract pass.

If generated declarations or public API snapshots change, review the diff as a contract change, not mechanical output.

## Risks, edge cases, and non-goals

- `types/data` currently contains both canonical public contracts and mirrors of generated compute DTOs. Changing one side without a parity gate can silently break kernel bridge conversions or public declarations.
- Splitting `charts.ts` is high leverage but high blast radius because `@mog/charts`, kernel chart diagnostics, chart export, and public contracts all depend on it.
- Some opaque chart and pivot fields are legitimate preservation boundaries for OOXML, generated bridge payloads, or diagnostics. The risk is anonymous opacity, not opacity itself.
- Conditional-format rule re-export exists to avoid a package cycle while preserving public surface. Do not move those types back into `types/data`.
- Existing deprecated fields may still be required by production import, migration, or public API paths. Remove only after the compatibility inventory proves the production path no longer needs them.
- Manager interfaces may be useful public contracts, but they should not force persisted storage DTOs to carry implementation-only concerns.
- Do not add runtime validators to this type package unless a production caller needs runtime validation at the boundary. The first improvement target is authoritative type contracts and declaration gates.
- Do not change public import paths casually; if a path is removed or narrowed, update snapshots, fixtures, docs, and consumers in the same implementation slice.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable:

- Agent A: build the ownership matrix and export/projection parity checker for `types/data`, `contracts/src/data`, and `contracts/package.json`.
- Agent B: implement generated DTO parity for pivot, grouping, slicer, and sparkline contracts against `compute-types.gen.ts` or the Rust bridge source.
- Agent C: split and harden chart contracts while preserving `@mog/types-data/data/charts` and `@mog-sdk/contracts/data/charts` public paths.
- Agent D: harden filter, sorting, tables, named-ranges, trace-arrows, and Cell Identity Model invariants with type tests.
- Agent E: audit and classify compatibility aliases, deprecated fields, and named opaque payloads.
- Agent F: add external fixtures, declaration snapshots, and contract import tests.
- Integrator: update production consumers across kernel, charts, canvas, apps, table-engine, runtime SDK, and public contracts, then run the full verification gate list.

Dependencies:

- `mog/contracts/src` and `mog/contracts/package.json` because they are the public projection.
- `mog/kernel/src/bridges/compute/compute-types.gen.ts` and Rust/domain-types bridge generation because several DTOs mirror generated compute contracts.
- `mog/kernel/src/domain/{charts,tables,pivots,grouping,slicers,sparklines,sorting}` because those production paths implement or convert these contracts.
- `mog/charts/src` because public chart config and resolved-spec types are canonical here but consumed by the chart renderer/compiler.
- `mog/canvas/*` and `mog/apps/spreadsheet/src` because render context and UI flows consume table/filter/grouping/sparkline/slicer/trace-arrow contracts.
- `mog/table-engine`, `mog/runtime/sdk`, `mog/tools`, and external fixture directories because they own conversion, publication, snapshot, and downstream compatibility gates.
