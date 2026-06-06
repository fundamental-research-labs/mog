Rating: 8/10

Summary judgment

This is a strong, evidence-led plan for a high-risk public type surface. It correctly identifies that `types/api/src` is not just an internal declaration folder but the upstream source for the `@mog-sdk/contracts/api` public contract, and it treats source/dist declaration identity as a production-path requirement. The scope, current-state inventory, explicit invariants, and verification posture are all substantially better than a generic cleanup plan.

The main reason it is not higher is that several proposed contract replacements are still directional rather than specified. For a published API type package, "use the right named type" is not enough: each narrowed field needs the exact owning type, runtime producer, consumer impact, and declaration-output gate before implementation starts. The plan also under-specifies how to classify the many existing `Record<string, unknown>` / index-signature extensibility points, even though the README doctrine says opaque bags are a public contract problem.

Major strengths

- Correct architectural boundary: the plan distinguishes `@mog/types-api` as a private tier package from the public `@mog-sdk/contracts` facade, and it correctly calls out the `development` source path versus `dist` declarations as the real downstream compatibility hazard.
- Good systematic scope: it inventories the 133 files, 24.9k LOC, 131 export subpaths, no local tests, the major `any[]` holes, deprecation volume, import-path doc drift, and the two `containerId` TODOs.
- The invariants are well chosen: source/dist parity, no accidental public widening, reuse of branded/core types, no compatibility shims that preserve `any`, and downstream landing through contracts plus kernel.
- The plan recognizes that type narrowing is a breaking contract change, not merely an internal cleanup, and requires coordinated contracts/kernel/declaration rollup work.
- The phase structure is reasonable: inventory first, then type replacement, structural object migration, deprecation policy, tooling guards, and downstream landing.

Major gaps or risks

- The replacement contracts are not exact enough. `FilterSortState.criteria?: any` is especially risky: the generated compute-side sort state is `columnCellId/order/sortBy`, while the plan suggests typing `criteria` against `ColumnFilterCriteria`, which may conflate filter criteria with sort state unless proven by the runtime producer. Similar precision is needed for `GroupState`, `cloneForPaste` rules, and filter unique values.
- The `Record<string, unknown>` inventory is broader than the plan's eight `any` holes. Exported surfaces include intentional-looking extensibility points such as `ApiError.details`, app view configs, workflow custom fields, object updates, and pivot UI readback bags. The plan says to enumerate these, but the concrete worklist and lint allowlist only really address `any`.
- One evidence item appears loose: `api/worksheet/pivots.ts` has `detectFields(): Promise<any[]>`, while `compute()` already returns `PivotTableResult`; the claimed separate "pivot result any[]" readback should be rechecked or removed.
- The `containerId` migration is architecturally plausible but not specified. It needs the canonical owner type, affected public methods/receipts/handles, and compatibility behavior for existing object IDs before it is implementation-ready.
- The deprecation policy is underspecified around version source. `@mog/types-api` is private at `0.1.0`, while `@mog-sdk/contracts` is public at `0.8.0`; the plan should say which package version anchors `since` and `removed-in`.

Contract and verification assessment

The verification direction is good, but the gates need to be more executable and tied to existing public-package tooling. `tsc -b .` proves local compilation, but it will not prove source/dist identity, exported-surface cleanliness, or external consumer compatibility by itself. The plan should explicitly use the existing contracts build and publish-readiness checks, including declaration identity, declaration rollup, runtime export verification, and API snapshots where relevant.

The proposed anti-pattern check should be AST-based over exported declarations, not a regex for `: any` or `Record<string, unknown>`. It must distinguish type holes from comments, string literals like `network:any`, implementation-local casts, and intentional extensibility contracts. Allow annotations should require a justification and owning domain, or the check will either block valid app/workflow extension points or become too broad to protect the API.

The behavior coverage gate is directionally right, especially for `getUniqueValues`, `detectFields`, outline state, and conditional-format cloning. It should name the concrete API eval/app eval scenarios or fixture-level type tests expected to fail before the change and pass after it. For a type package, add consumer compile fixtures that import only from built `@mog-sdk/contracts/api` declarations, not from source.

Concrete changes that would raise the rating

- Add a contract matrix for every loose exported member: current declaration, runtime producer, downstream consumers, exact replacement type, type owner package, breaking-change classification, migration note, and required verification.
- Rework `FilterSortState.criteria` specifically: either remove it if unused, map the public API to the canonical generated/data `FilterSortState`, or define a real advanced-sort discriminated union. Do not map it to filter criteria without evidence.
- Classify all exported `Record<string, unknown>` and `[key: string]: unknown` cases before adding the lint. Split them into "replace now", "intentional schemaless JSON contract", and "private/internal but exported by accident".
- Specify existing verification commands: `pnpm --filter @mog-sdk/contracts build`, contracts declaration identity/runtime export checks, declaration rollup checks, API snapshots, targeted package typechecks for kernel/app/runtime consumers, and API/app eval scenarios for behavioral read paths.
- Define the `containerId` owner and exact public API changes before scheduling that migration in the same landing set.
- Add a deprecation version policy tied to `@mog-sdk/contracts` public releases, with a mechanical check for replacement, since-version, and removal target.
