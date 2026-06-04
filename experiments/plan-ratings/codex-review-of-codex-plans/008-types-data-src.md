Rating: 8/10

Summary judgment

This is a strong plan for turning `types/data/src` into a governed contract surface instead of a loose collection of shared TypeScript declarations. It correctly identifies the high-value axes: private `@mog/types-data` ownership, public `@mog-sdk/contracts` projection, Cell Identity Model invariants, generated Rust bridge parity, declaration stability, chart contract layering, compatibility aliases, and production consumers across kernel, charts, canvas, apps, table-engine, runtime SDK, and sibling type packages.

The rating is held below 9 because the plan overstates a few current facts and leaves some critical implementation contracts underspecified. In the current tree, most `contracts/src/data/*` files are type-only re-export shims, but `contracts/src/data/grouping.ts` is a full duplicate contract file with a runtime `DEFAULT_SHEET_GROUPING_CONFIG` export, and `contracts/src/data/conditional-format.ts` is also bespoke. `contracts/package.json` exposes all short data subpaths such as `./filter`, `./pivot`, and `./tables`, but only a subset of `./data/*` subpaths: `./data`, `./data/charts`, `./data/slicers`, and `./data/named-ranges`. Those details matter because this plan is primarily about public projection parity.

Major strengths

- The plan is aligned with the production contract role of this folder. It does not treat `types/data` as an isolated type cleanup; it connects the work to public package exports, declaration identity, generated bridge DTOs, and real downstream consumers.
- The scope is systematically framed. It covers charts, filter, grouping, named ranges, pivot, slicers, sorting, sparklines, tables, trace arrows, package barrels, contracts shims, generated bridge parity, compatibility aliases, and consumer integration.
- The ownership-matrix idea is the right central abstraction. Classifying every exported type as canonical domain contract, generated mirror, API DTO, persisted DTO, render snapshot, manager interface, compatibility alias, or opaque payload would turn many current comments into enforceable policy.
- The plan correctly identifies high-risk areas in the source: manual "must stay in sync" generated DTO comments in pivot/grouping/slicers/sparklines, broad `unknown` payloads in chart and pivot contracts, deprecated aliases, and the 3,700+ line `charts.ts` mixed-layer surface.
- Verification is taken seriously. The plan includes package typechecks, contracts build, declaration identity, declaration rollups, API snapshots, external fixtures, targeted production consumer tests, and final repo-wide typecheck.
- The parallelization section has sensible work boundaries: ownership/export checks, generated DTO parity, chart split, Cell Identity contracts, compatibility audit, fixtures, and an integrator pass.

Major gaps or risks

- The projection model needs a factual correction before implementation. `contracts/src/data/grouping.ts` is not currently a shim to `@mog/types-data/data/grouping`; it duplicates the declarations and runtime default. A checker that assumes every `contracts/src/data/*` file should point at a `@mog/types-data/data/*` subpath would either fail immediately or push the implementation toward a runtime private-package leak.
- The public export surface is not the full `./data/*` matrix described by the plan. The plan should distinguish supported short subpaths from currently supported `./data/*` subpaths, and should make any export expansion an explicit public API decision.
- Runtime values are not handled precisely enough. `DEFAULT_SHEET_GROUPING_CONFIG` is imported as a value from `@mog-sdk/contracts/grouping` in production grouping code. Type-only re-export shims cannot project that value, while value re-exports from private `@mog/types-data` would risk public runtime imports of a private package. The plan mentions private runtime import leaks, but it needs a concrete strategy for runtime exports.
- The generated DTO parity section names the right problem but not the exact contract. It should list the mirrored type pairs for pivot, grouping, slicers, and sparklines, define whether parity is assignability, exact declaration equality, JSON wire-shape equality, or generated source identity, and specify where the checker lives so public packages do not acquire kernel implementation dependencies.
- The proposed chart split needs a path-preservation contract. `types/data/package.json` currently points `./data/charts` at `src/data/charts.ts` and `dist/data/charts.d.ts`. Moving the implementation to `data/charts/index.ts` either requires retaining `charts.ts` as a stable barrel or intentionally changing package export targets and built artifact paths with snapshot review.
- The ownership matrix is under-specified as an artifact. The plan should define its file location, schema, required fields, allowed classifications, how it maps to exported symbols, and what command fails when an export lacks a classification.
- "Harden discriminated unions" is directionally right but may be public-contract breaking. The plan needs compatibility rules for when type narrowing is allowed, when aliases remain, and what snapshot or external fixture evidence proves consumers are not broken.
- The manager-interface move is risky without a public/private boundary table. Interfaces such as `ISparklineManager` are imported through public contracts in app renderer paths. Moving them may be correct, but the plan should first classify whether each interface is public API, renderer bridge, kernel bridge, or internal implementation.

Contract and verification assessment

The verification philosophy is strong, but the new gates are not yet verifiable contracts. "Ownership/export/projection parity checker" and "generated DTO parity checker" need exact command names, owning package/tool location, input files, failure modes, and expected no-op baseline behavior. The export checker should assert the actual supported export matrix, including the `grouping` and `conditional-format` exceptions, instead of assuming a uniform shim pattern.

The generated DTO parity gate must also prove that no `kernel/src/bridges/compute/compute-types.gen.ts` imports leak into public declaration rollups or public runtime JavaScript. If the checker imports generated kernel types for compile-time comparison, it should be isolated in tooling or tests that are excluded from public package emission.

The existing gate list is broadly appropriate for a final integration pass. It should add an explicit public artifact build step before `check:external-fixtures -- --skip-build`, and it should name the targeted production tests expected for the first implementation slice rather than leaving that entirely to the implementer. Negative type tests should specify a framework or pattern, such as `tsd`, `expect-type`, or checked `@ts-expect-error` fixture files.

Concrete changes that would raise the rating

1. Add an exact projection table covering every `types/data/src/data/*` module, corresponding `contracts/src/data/*` file, short `@mog-sdk/contracts/*` export, supported `@mog-sdk/contracts/data/*` export, runtime exports, and known exceptions.
2. Define the ownership-matrix schema, storage path, allowed classifications, required fields, and checker behavior. Include fields for public import paths, runtime value status, parity target, compatibility/deprecation status, and opaque-payload reason.
3. Replace the generated DTO parity prose with a manifest of exact type pairs from `types/data` to `compute-types.gen.ts`, plus a checker design that is type-only/tool-only and cannot leak kernel paths into public declarations.
4. Specify the `charts.ts` split mechanics: either keep `src/data/charts.ts` as the public barrel or intentionally update package exports and declaration snapshots. Add a required before/after declaration diff gate for `@mog/types-data/data/charts` and `@mog-sdk/contracts/data/charts`.
5. Add a runtime export strategy for grouping defaults and any future public constants so contracts can remain publishable without private runtime dependencies.
6. Turn "harden unions and opaque payloads" into a compatibility policy: which changes must be non-breaking, which require snapshot updates, which need migrations, and which need public fixture updates.
7. Break sequencing into baseline no-op gates first, then generated parity, then chart split, then type hardening, then consumer migration. Each phase should have a stop/go verification list.
8. Name the type-test infrastructure and fixture layout for positive and negative examples, including how those fixtures are included in CI without entering production runtime paths.
