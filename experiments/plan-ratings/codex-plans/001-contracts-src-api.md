# Plan 001: Improve `mog/contracts/src/api`

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/contracts/src/api`

Required queue scope: public workbook and worksheet API contracts.

This plan covers:

- The `@mog-sdk/contracts/api` public entrypoint implemented by `contracts/src/api/index.ts`.
- The `@mog-sdk/contracts/api/mutation-receipt` public subpath implemented by `contracts/src/api/mutation-receipt.ts`.
- The `@mog-sdk/contracts/api/worksheet/handles` and `@mog-sdk/contracts/api/worksheet/handles/index` public subpaths.
- The physical workbook, worksheet, collection, handle, and shared-type shims under `contracts/src/api/**`.
- The local runtime-value surface owned by this folder: `RangeValueType`, `NumberFormatCategory`, `CellType`, `CellValueType`, mutation receipt guards, and worksheet format mapping helpers.
- The contract projection between this folder and the canonical `types/api/src/api/**` source package.
- The generated API metadata, SDK declaration output, public package snapshots, and external fixtures that consume this folder.

This plan does not cover:

- Implementing new spreadsheet behavior in `kernel` unless needed to make the existing public contract true.
- Adding temporary compatibility aliases or test-only contract shims.
- Publishing private `@mog/types-api` as a public package unless package inventory, docs, fixtures, and declaration gates are intentionally changed.
- Changing public package names or branding.

## Current role of this folder in Mog

`contracts/src/api` is the public facade for Mog's workbook and worksheet object model. Public and production code imports `Workbook`, `Worksheet`, API subtypes, receipts, event maps, and a small runtime helper set through `@mog-sdk/contracts/api`.

Observed structure:

- `contracts/package.json` exposes `./api`, `./api/mutation-receipt`, `./api/worksheet/handles`, and `./api/worksheet/handles/index`.
- Most files in `contracts/src/api/**` are four-line type-only re-export shims to `@mog/types-api/api/**`.
- `contracts/src/api/index.ts` re-exports root workbook/worksheet types, `export type * from '@mog/types-api/api'`, four local runtime enums from `./types`, three mutation receipt guards, and six format mapping utilities.
- `contracts/src/api/types.ts` is a large local shared-type file that exists mostly to provide runtime enum values, but it also contains copied API type definitions. It currently drifts from `types/api/src/api/types.ts`.
- `contracts/src/api/mutation-receipt.ts` re-exports receipt types from `@mog/types-api/api/mutation-receipt` and defines local runtime type guards.
- `contracts/src/api/worksheet/format-mappings.ts` defines local runtime conversions for Office.js-style angles/patterns and indent clamping.

Production consumers:

- `kernel/src/api` implements the contracts; `WorkbookImpl` implements `WorkbookInternal` and `WorksheetImpl` implements `Worksheet`.
- `apps/spreadsheet` consumes the contracts broadly for workbook, worksheet, receipt, validation, table, object, renderer, and accessibility flows.
- `runtime/sdk` re-exports selected contracts from `@mog-sdk/contracts/api` and generates API metadata from the contract graph.
- `views/sheet-view` intentionally imports viewport contracts from `@mog-sdk/contracts/api`.
- Public fixture and snapshot tooling treats this package as the shipped public declaration boundary.

Important current risks:

- `contracts/src/api/types.ts` has source drift from `types/api/src/api/types.ts`, including missing stable ID aliases, chart snapshot exports, `WorkbookSettingsPatch`, and the `'cells:policy-preserved'` workbook event map entry.
- The package export map exposes only a subset of the physical shims, so the project has a mixed public/development-only subpath policy that is not enforced by a dedicated API-folder gate.
- `types.ts` and canonical `types/api` contracts still contain weak public shapes such as `any[]`, `criteria?: any`, `Record<string, unknown>`, `position?: unknown`, and catch-all index signatures despite the API README explicitly rejecting hollow copies.
- Format mapping helper comments contain mangled generated wording such as `spreadsheet special-cell typeAPI`, and invalid numeric input semantics are not explicit.
- SDK/API metadata generation now follows re-export shims, but some generated source locations still point at stale local copies, which makes public contract diffs harder to trust.

## Improvement objectives

1. Make `contracts/src/api` a governed public facade with one explicit source of truth for each exported type and runtime value.
2. Remove split-brain drift between `contracts/src/api/**` and `types/api/src/api/**`.
3. Define and enforce a public subpath policy for every physical file under `contracts/src/api/**`.
4. Replace accidental `any` and broad `unknown` API contracts with generated/core/domain types or intentional named DTOs.
5. Preserve a small, self-contained runtime JS surface for `@mog-sdk/contracts/api` with no private runtime imports.
6. Tighten public helper semantics for mutation receipt guards and worksheet format mappings.
7. Add production-path conformance checks so the kernel implementation and generated SDK metadata cannot silently drift from the public API contract.
8. Improve public JSDoc clarity for agent, SDK, app, and docs consumers without changing behavior as a workaround.

## Production-path contracts and invariants to preserve or strengthen

- Public consumers use `@mog-sdk/contracts/api` for workbook and worksheet contracts.
- `@mog-sdk/contracts` remains the public package boundary; private `@mog/types-*` packages may be build inputs but must not leak into compiled runtime JS.
- `@mog-sdk/contracts/api` runtime exports remain explicitly inventoried in `tools/contracts-runtime-inventory.json`.
- Runtime API helpers stay self-contained: no compiled runtime import from `@mog/types-api`, other private type packages, rust bridge packages, or implementation packages.
- Branded identities and stable IDs have a single declaration owner in public `.d.ts` output.
- `Workbook`, `WorkbookInternal`, `Worksheet`, and `WorksheetWithInternals` are projected from the canonical API source and implemented by production kernel classes.
- Workbook and worksheet root interfaces remain the root graph for SDK/API metadata generation.
- A1 string ranges, numeric row/col overloads, `SheetId` identity, `CellId` identity, sync cached properties, async bridge calls, typed event overloads, and mutation receipt discriminants keep their documented semantics.
- Deprecated API members may remain only when they represent a real production path and have replacement guidance.
- Every physically present `contracts/src/api/**` shim is either a public package subpath, a development-only source file needed by generation/build tooling, or removed from the facade.
- Every API metadata artifact generated from these contracts maps back to the actual canonical declaration or to an explicit public facade alias.

## Concrete implementation plan

1. Build an API facade inventory.
   - Enumerate every file under `contracts/src/api/**`.
   - For each file, classify it as public package subpath, public root-only re-export support, development-only shim, runtime-value owner, or obsolete duplicate.
   - Record the canonical source target for each shim, usually `types/api/src/api/**`.
   - Record whether the file emits runtime JS and what runtime exports it owns.
   - Store this inventory beside the existing public package boundary tooling so it can be checked in CI.

2. Remove source-of-truth drift.
   - Stop maintaining a large copied shared-type body in `contracts/src/api/types.ts`.
   - Split local runtime enum ownership from type re-export projection. The target shape should be a small local runtime module plus type-only re-exports, not a second copy of the canonical API type file.
   - Ensure `WorkbookId`, `WorkbookSessionId`, `DocumentId`, `LinkId`, `ActorId`, chart snapshot exports, `WorkbookSettingsPatch`, and workbook event map entries are visible through `@mog-sdk/contracts/api`.
   - Add a drift checker that compares the facade projection against `types/api/src/api/**` for every canonical symbol reachable from the public root.
   - Make generated source locations prefer canonical declarations, while preserving the public import path in emitted docs/specs.

3. Enforce package subpath policy.
   - Decide the intended public policy for workbook and worksheet deep subpaths:
     - Option A: root-only API plus mutation receipts and worksheet handles.
     - Option B: expose all existing workbook/worksheet shim files as public subpaths.
   - Implement the chosen policy consistently in `contracts/package.json`, package inventory, fixtures, and import-boundary rules.
   - If root-only is chosen, add a gate that rejects production imports from non-exported `@mog-sdk/contracts/api/**` paths.
   - If broad subpaths are chosen, add package exports for all intended files and external fixtures for representative workbook, worksheet, collection, and handle imports.
   - Keep `@mog-sdk/contracts/api/worksheet/handles/index` and `@mog-sdk/contracts/api/worksheet/handles` either as documented public subpaths or replace internal consumers with root imports.

4. Harden weak public type contracts systematically.
   - Inventory every `any`, `unknown`, `Record<string, unknown>`, catch-all index signature, and hollow DTO under the API surface.
   - Classify each as intentional extension data, JSON payload, producer metadata, bridge escape hatch, internal-only API, or accidental placeholder.
   - Replace accidental placeholders with concrete types from `@mog/types-core`, `@mog/types-data`, `@mog/types-formatting`, `@mog/types-events`, `@mog/types-objects`, `@mog/types-viewport`, and `@mog-sdk/types-document`.
   - Prioritize the production-facing holes:
     - Slicer position and slicer updates.
     - Table style metadata and removal of broad index signatures.
     - Filter unique values and filter detail payloads.
     - Conditional-format clone payload rules.
     - Group state and filter sort criteria.
     - Pivot UI/readback state fields.
     - Generic floating-object update payloads.
     - Workbook arbitrary event escape hatches.
   - Introduce named `JsonValue`, `JsonObject`, `ExtensionMetadata`, or `ProducerMetadata` types only where the contract is truly schemaless.

5. Strengthen runtime helper contracts.
   - Define explicit invalid-input semantics for `officeJsAngleToOoxmlRotation`, `ooxmlRotationToOfficeJsAngle`, `officeJsPatternToOoxml`, `ooxmlPatternToOfficeJs`, and `clampIndent`.
   - Decide how `NaN`, infinities, fractional rotations, negative OOXML rotations, unknown pattern names, and out-of-range indent values behave.
   - Update helper JSDoc to describe Office.js/API compatibility in clear public language.
   - Add production package tests that import these helpers through `@mog-sdk/contracts/api`, not direct source paths.
   - Keep receipt guard behavior discriminant-based and prove it narrows all receipt unions used by app and kernel coordination paths.

6. Add public API implementation conformance checks.
   - Use the TypeScript compiler API or `ts-morph` to extract public `Workbook`, `WorkbookInternal`, `Worksheet`, sub-API, collection, and handle members.
   - Compare extracted contracts against production implementation classes in `kernel/src/api`.
   - Fail if a public method has no implementation, an implementation changes sync/async shape, overloads diverge, return types drift, or a public sub-API accessor is missing.
   - Include typed event overloads and mutation receipt return types in the conformance check.
   - Prefer compile-time `implements` and `satisfies` checks where the implementation can make the contract executable without reflection.

7. Align SDK and docs generation.
   - Update `runtime/sdk/scripts/generate-api-spec.ts` and `tools/generate-api-reference.ts` so they share contract discovery rules or a common extraction module.
   - Ensure both follow `contracts/src/api` facade shims to canonical declarations without reading stale duplicate type copies.
   - Add an agreement gate that compares root members, sub-API accessors, method names, async model, deprecation status, parameter names, return types, and source locations across generated API metadata artifacts.
   - Regenerate SDK API spec, API schema, API reference docs, and snapshots as one contract diff.

8. Expand public fixture and snapshot coverage.
   - Add positive external fixtures for:
     - `@mog-sdk/contracts/api` root type imports.
     - Runtime imports of the four enums, receipt guards, and format helpers.
     - `@mog-sdk/contracts/api/mutation-receipt`.
     - The intended worksheet handle subpaths.
     - Any newly exposed workbook/worksheet deep subpaths if the broad-subpath policy is selected.
   - Add negative fixtures for private `@mog/types-api` public consumption and non-exported `@mog-sdk/contracts/api/**` subpaths if the root-only policy is selected.
   - Extend API snapshots enough to detect accidental removal, widening, narrowing, private package leakage, or duplicated declaration ownership.

9. Clean public documentation and comments.
   - Replace mangled generated phrases in API JSDoc with precise terms such as "Office.js", "Excel-compatible", "A1 notation", "zero-based row/column", "OOXML rotation", and "public API".
   - Add a short `contracts/src/api` README or update the existing `types/api/src/api/README.md` to state:
     - where canonical API declarations live;
     - which runtime values are owned by contracts;
     - how deep subpaths are classified;
     - which weak-type escape hatches are allowed;
     - which verification gates must pass after API changes.

10. Integrate downstream consumers.
   - Update `kernel/src/api`, `apps/spreadsheet`, `views/sheet-view`, and `runtime/sdk` to use the hardened contracts without new casts.
   - Treat every new `as any`, broad `unknown`, or private source import in production API paths as a contract failure unless it is at an intentional JSON/metadata boundary.
   - Repair production implementation mismatches rather than narrowing the plan to declaration-only edits.

## Tests and verification gates

The implementation work should run these gates. They are listed here for the future implementation pass; this planning worker did not run them.

1. `pnpm --filter @mog/types-api typecheck`
2. New `contracts/src/api` facade inventory and source-of-truth drift checker.
3. New package subpath policy checker.
4. New weak-contract inventory checker for public `any`/`unknown` escape hatches.
5. `pnpm --filter @mog-sdk/contracts typecheck`
6. `pnpm --filter @mog-sdk/contracts build`
7. `pnpm check:contracts-runtime-inventory`
8. `pnpm check:contracts-declaration-identity`
9. `pnpm check:contract-runtime-imports`
10. `pnpm --filter @mog-sdk/kernel typecheck`
11. `pnpm --filter @mog-sdk/kernel test`
12. `pnpm --filter @mog/app-spreadsheet typecheck`
13. `pnpm --filter @mog/app-spreadsheet test`
14. `pnpm --filter @mog-sdk/node generate:api-spec`
15. `pnpm --filter @mog-sdk/node typecheck`
16. `pnpm --filter @mog-sdk/node verify-build`
17. `pnpm generate:api-ref`
18. New generated metadata agreement checker.
19. `pnpm check:api-snapshots`
20. `pnpm check:declaration-rollups`
21. `pnpm check:external-fixtures -- --skip-build` after public artifacts are built.
22. Repo-wide `pnpm typecheck` for the final integrated TypeScript contract pass.

Focused tests to add or strengthen:

- Runtime import tests for `@mog-sdk/contracts/api` enums and helper functions through the built public package.
- Contract tests for format helper invalid input behavior.
- Receipt guard narrowing tests covering floating object create, update, remove, and non-floating receipts.
- Compiler-level conformance tests that verify kernel workbook/worksheet/sub-API implementations satisfy the public interfaces.
- External fixture tests for the chosen deep-subpath policy.
- SDK/API metadata snapshot tests that fail on stale source locations or mismatched method metadata.

## Risks, edge cases, and non-goals

- Some broad types are legitimate, especially for user extension metadata, security template options, arbitrary event subscriptions, and JSON-like SDK details. The fix is to name and constrain those boundaries, not to pretend every payload is statically knowable.
- Tightening public contracts may expose real gaps in kernel or app implementation code. Those must be fixed in the production implementation path.
- Removing copied declarations from `contracts/src/api/types.ts` may affect tools that currently scan physical source files and source locations. Update the tools in the same implementation slice.
- Broadly exposing every physical shim as a public subpath increases public surface area. If that policy is chosen, it must be backed by snapshots, fixtures, and declaration identity gates.
- Keeping root-only API imports requires import-boundary enforcement so development source paths do not become accidental public API.
- Runtime enum ownership must not introduce private runtime imports into `@mog-sdk/contracts` dist output.
- Declaration bundling can duplicate unique-symbol brand owners when types are projected through multiple paths. Keep declaration identity checks mandatory.
- Do not add compatibility shims just to preserve stale private paths.
- Do not move implementation types into `contracts` if they belong in domain packages; the right outcome is either canonical domain re-export or a documented public DTO.
- Do not verify only generated specs or mocks. Public fixtures and kernel/app implementation tests must cover the production path.

## Parallelization notes and dependencies on other folders, if any

Recommended parallel work split:

- Agent A: Build the `contracts/src/api` facade inventory, package subpath policy checker, and source-of-truth drift checker.
- Agent B: Remove `contracts/src/api/types.ts` drift and split runtime enum ownership from type projection.
- Agent C: Audit and harden weak public shared types in `types/api/src/api/types.ts`.
- Agent D: Audit and harden workbook, worksheet, sub-API, collection, and handle contracts in `types/api/src/api/**`.
- Agent E: Add runtime helper semantics and tests for format mappings and mutation receipt guards.
- Agent F: Add kernel implementation conformance checks and integrate any production implementation fixes.
- Agent G: Align SDK/API metadata generators and update generated artifacts.
- Agent H: Expand external fixtures, API snapshots, declaration rollup checks, and runtime inventory coverage.
- Integrator: Resolve cross-agent contract decisions, run the full verification sequence, and ensure public artifacts and production consumers agree.

Dependencies:

- `mog/types/api/src/api`: canonical workbook/worksheet API declarations and most public shared types.
- `mog/kernel/src/api`: production implementation of workbook, worksheet, sub-APIs, collections, handles, and receipts.
- `mog/apps/spreadsheet/src`: high-volume production consumer of API contracts and runtime receipt helpers.
- `mog/views/sheet-view`: public view package that consumes viewport/API contracts.
- `mog/runtime/sdk`: Node SDK type re-exports and generated API spec.
- `mog/tools`: package inventory, runtime import checks, declaration identity checks, API snapshots, API reference generator, and public boundary tooling.
- `mog/fixtures/external`: downstream import and public package compatibility fixtures.
