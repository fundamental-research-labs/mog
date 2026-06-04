Rating: 7/10

Summary judgment

This is a strong, evidence-based plan for a real contracts problem. It correctly identifies the duplicated `contracts/src/api/types.ts` surface, the drift against `@mog/types-api`, the mangled public comments, the exported `any` holes, and the need to preserve the local runtime value owners for enums, receipt guards, and format mappings. The proposed sequencing is mostly sane: investigate the declaration pipeline, fix canonical types first, then sync or generate the contracts projection.

The plan is not yet implementation-ready as a contract. It crosses from `mog/contracts/src/api` into `mog/types/api`, build tooling, and downstream consumers without making the ownership boundary or handoff contract precise enough. It also under-specifies the exact replacement types for the public `any` fields and the exact de-duplication shape for `types.ts`, which are the two parts most likely to break declarations or consumers.

Major strengths

- The plan is grounded in real production-path defects. The local and canonical `types.ts` files differ in the named exports it calls out, and `GroupState` / `FilterSortState` really do publish `any`.
- It understands the important architectural split: `@mog-sdk/contracts/api` must own public runtime values while projecting type-only private shards into self-contained public declarations.
- It names the relevant package exports, runtime values, declaration-identity concerns, and package build chain instead of treating this as a local text cleanup.
- It treats de-duplication as the structural fix rather than just copying the missing exports into the stale mirror.
- It includes meaningful downstream verification for consumers that implement or consume the API contracts.

Major gaps or risks

- The plan says the corrupted comments are 11 occurrences in `worksheet/format-mappings.ts` plus 1 in `types.ts`, but the same mangled `spreadsheet special-cell type` phrase appears in multiple canonical `mog/types/api/src/api` files that are publicly projected into `@mog-sdk/contracts/api` declarations. If the goal is public API docs, the plan must enumerate and fix the complete public API doc-comment set, not only the local contracts instances.
- The source-folder boundary is blurry. The plan is nominally for `mog/contracts/src/api`, but the actual work requires edits in `mog/types/api/src/api`, and possibly `mog/contracts/scripts` / `mog/tools`. That may be the right architecture, but the plan should declare itself as a cross-folder change or define hard handoff criteria for the `types/api` and tooling owners.
- Phase 2 does not name the concrete replacement types. `GroupState.rowGroups` / `columnGroups` likely should align with the existing public `GroupDefinition` shape from the grouping contracts, and `FilterSortState.criteria` needs a specific persisted/API sort criteria contract. "Existing outline/grouping domain types" and "align with SortOptions / SortColumn" are too vague for a published API tightening.
- Phase 3 Option A is plausible but under-specified. Replacing most of local `types.ts` with `export type * from '@mog/types-api/api/types'` while keeping local runtime enum owners must explicitly cover enum name shadowing, generated `.d.ts` shape, private specifier rewriting, and whether `dist/api/types.d.ts` remains a supported internal declaration edge.
- The plan overstates one verification script: `contracts/scripts/verify-runtime-exports.mjs` currently checks number-format runtime constants, not the API enum/guard/format-mapping surface. The API runtime values are primarily covered by the runtime inventory and runtime import gates.
- It does not call out API snapshot and external fixture checks, even though this is a public package surface change and the repo has `check:api-snapshots` plus external fixtures for published importability/runtime values.

Contract and verification assessment

The "must preserve" export list is useful, but it should be converted into explicit acceptance tests or fixture imports for both type and runtime positions: `CellType` as a value, `CellType` as a type, `WorkbookId` / `WorkbookSettingsPatch` type imports, receipt guards, format mappings, and `./api/worksheet/handles` subpath imports.

The contracts build is a necessary gate, but not sufficient for this kind of public API contract hardening. The verification contract should include `pnpm --filter @mog/types-api typecheck` or the package's equivalent when canonical types are edited, `pnpm --filter @mog-sdk/contracts build`, targeted contracts unit tests for runtime helpers, downstream typechecks for kernel/runtime/sheet-view after rebuilding contracts, `pnpm check:api-snapshots`, and external fixture checks or an equivalent SDK publish-surface gate.

The de-duplication acceptance criteria should be more exact than "byte-identical to / generated-from". If Option A is selected, the guard should assert no stale locally-authored type mirror remains and that the public declaration graph has no private package imports or duplicate brand owners. If Option B is selected, the generated source path, generator owner, and "do not edit generated mirror" check need to be specified.

Concrete changes that would raise the rating

- Add a Phase 0 output contract that decides, with evidence from `rollup-public-dts`, whether `types.ts` can be a local runtime-owner facade plus `export type *`, or must be generated. Include the exact intended final contents pattern.
- Enumerate the full public doc-comment cleanup set with `rg "spreadsheet special-cell type" mog/contracts/src/api mog/types/api/src/api`, and require it to go to zero in all public API declaration sources.
- Replace the `any` objective with exact proposed types, including import paths and whether they are API DTOs, re-exports, or intentionally different projections.
- Add API snapshot and external fixture verification to the gates, and correct the description of which runtime gate covers API runtime exports.
- Clarify ownership: either make this a cross-folder plan spanning `contracts/src/api`, `types/api/src/api`, and contracts tooling, or split the generator/type-source/tooling work into explicit dependencies with blocking acceptance criteria.
