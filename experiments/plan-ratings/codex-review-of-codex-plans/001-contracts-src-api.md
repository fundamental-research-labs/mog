Rating: 8/10

Summary judgment

This is a strong plan for `contracts/src/api`. It correctly treats the folder as a governed public facade rather than a pile of local shims, and it identifies real architectural risks: split source ownership between `contracts/src/api/types.ts` and `types/api/src/api/types.ts`, private type-package leakage risk, unclear deep-subpath policy, weak public DTOs, runtime helper semantics, and generator/source-location drift. The plan is production-path oriented and does not stop at declaration cleanup.

The rating is not higher because several of the most consequential decisions are still left open or under-specified. In particular, the public subpath policy is framed as Option A versus Option B without a recommendation, the weak-contract hardening work spans many domains without exact target contracts, and the proposed new conformance/checker gates need concrete artifact schemas and failure examples before implementation agents can compose safely.

Major strengths

- The scope is accurate and complete for the folder. A source spot check confirms the package exposes `./api`, `./api/mutation-receipt`, `./api/worksheet/handles`, and `./api/worksheet/handles/index`, while many physical workbook and worksheet files are type-only shims.
- The plan correctly identifies the split-brain type risk. `contracts/src/api/types.ts` is still a large copied type body, and the canonical `types/api/src/api/types.ts` has additional symbols such as stable ID aliases, chart snapshot exports, `WorkbookSettingsPatch`, and the `cells:policy-preserved` event map entry.
- It preserves the right dependency direction: public contracts remain the boundary, `@mog/types-api` can remain a build-time/private source, and compiled runtime JS must not import private type shards.
- It distinguishes runtime values from type projections. The plan calls out the four local runtime enums, mutation receipt guards, and worksheet format helpers as the small intentional JS surface.
- It connects contract changes to production consumers: kernel implementations, spreadsheet app paths, sheet-view, SDK generation, docs generation, snapshots, and external fixtures.
- The verification posture is mostly aligned with existing repo gates. Several listed commands already map to real scripts such as `check:contracts-runtime-inventory`, `check:contracts-declaration-identity`, `check:contract-runtime-imports`, `check:api-snapshots`, `check:declaration-rollups`, and `check:external-fixtures`.
- The parallelization notes are useful and match the repo's operating model. The proposed agent split has clear enough ownership boundaries for inventory, type drift, weak DTOs, runtime helpers, conformance, generation, fixtures, and integration.

Major gaps or risks

- The deep-subpath policy is a blocker-level decision, not an implementation detail. The plan should choose root-only or broad subpaths up front, with rationale, expected `contracts/package.json` exports, fixture coverage, and import-boundary behavior.
- The plan is very large for one implementation stream. That is acceptable for Mog velocity, but it needs explicit phase boundaries and merge contracts so agents do not concurrently change source ownership, public DTO shapes, generators, and kernel conformance in incompatible ways.
- The weak public type hardening objective is directionally correct but underspecified. It lists broad holes such as slicers, filters, pivots, conditional formats, table styles, floating objects, and arbitrary events, but does not state the exact replacement types, domain owners, or compatibility expectations.
- The source-of-truth refactor needs a more concrete target module design. "Small local runtime module plus type-only re-exports" is right, but the plan should name the files, exports, declaration ownership rules, and how generated source locations should resolve.
- The proposed implementation conformance checker is high value but risky if specified only as AST comparison. It should say which checks are compile-time `implements` or `satisfies` assertions, which require reflection, and how overloads, generics, deprecated members, optional sub-APIs, and internal-only members are handled.
- New checkers are described by intent rather than contract. The facade inventory, drift checker, subpath checker, weak-contract checker, conformance checker, and metadata agreement checker need schema names, repository locations, update/check modes, and sample failure messages.
- Runtime helper semantics need exact expected values. The plan lists `NaN`, infinities, fractional rotations, negative OOXML rotations, unknown pattern names, and indent bounds, but does not choose outputs or error behavior.
- Breaking-change handling is implicit. Hardening public types can narrow published contracts, so the plan should state whether this is allowed in the current release train and how public fixtures/snapshots distinguish intentional breaking changes from accidental drift.

Contract and verification assessment

Architecturally, the plan fits the folder well. `contracts/src/api` should be a public package facade with explicit runtime ownership and canonical type projection, not a second handwritten copy of `types/api/src/api`. The plan also correctly requires production implementation conformance instead of verifying only generated docs or SDK metadata.

The verification plan is strong but not yet fully executable. It combines existing package gates with needed new gates, and it requires downstream kernel/app/SDK checks plus external fixtures. To be implementation-ready, it should pin the new gate scripts and acceptance criteria before agents start editing. The strongest final gate sequence would include public package build, runtime inventory, runtime import leakage, declaration identity, API snapshots, external fixtures, kernel/app type and behavior checks, SDK generation/build verification, and repo-wide TypeScript typecheck.

The plan should also make generated artifact expectations sharper: public docs/specs should preserve `@mog-sdk/contracts/api` as the consumer import identity, while source locations should point to the canonical declaration or an explicit facade alias without leaking private package paths as the public API.

Concrete changes that would raise the rating

1. Choose the deep-subpath policy in the plan instead of leaving Option A and Option B open. Include the exact export-map diff and fixture matrix for the chosen policy.
2. Add a proposed `contracts/src/api` facade inventory schema with example rows for root API, mutation receipt, worksheet handles, a workbook shim, a worksheet collection shim, `types.ts`, and `format-mappings.ts`.
3. Specify the target file/module layout for splitting runtime values from type projections, including exact exported symbols and declaration ownership rules.
4. Turn the weak-contract audit into a table of concrete replacements: current field, owner domain package, replacement type, intentional escape-hatch type if any, production consumers, and required tests.
5. Define exact invalid-input behavior for each format helper before implementation.
6. Specify the conformance checker mechanism and edge cases, especially overloads, async/sync shape, event overloads, deprecated members, and internal-only exclusions.
7. Name the new check scripts and where they live, with check/update modes and sample failure output.
8. Break the implementation into ordered phases with acceptance gates after each phase, so parallel agents can land inventory/policy, source-of-truth cleanup, weak type hardening, runtime helper semantics, conformance, generators, and fixtures without stepping on each other.
