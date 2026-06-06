Rating: 7/10

Summary judgment

This is a strong, source-aware plan with useful diagnosis of both files in `kernel/src/domain/formatting`. It correctly identifies that `merges.ts` is a thin bridge delegation layer that currently hides `MutationResult`, includes no-op compatibility stubs, performs client-side filtering for ranged reads, and is bypassed by nearby code. It also correctly flags that `format-registry.ts` is hand-maintained status data with no enforcement, even though its comments claim it drives tests.

The rating is held back because several contracts are underspecified or slightly misread. The plan overstates the production-path impact of `getInViewport`/`getInRange` because those functions currently have no repo callers, misses some direct merge bridge bypasses in `worksheet/structure.ts`, and does not take full advantage of existing bridge methods (`mergeAcross`, `mergeAndCenter`, `checkMergeDataLoss`, `validateAndCleanMerges`) that are already generated. The registry section is directionally right but conflates type-only package references with runtime re-exports and leaves the proposed enforcement test too vague.

Major strengths

- Good folder scoping: it identifies the two files in scope and names downstream consumers without proposing broad rewrites of unrelated formatting packages.
- Good architectural instinct: Rust remains the source of truth for merge validation, overlap checks, value clearing, storage, and event emission; the TS layer should expose bridge results rather than duplicate or hide them.
- Good issue inventory for `merges.ts`: discarded `MutationResult`, no-op `checkMergeDataLoss`/`validateAndClean`/`subscribe`, client-side ranged filtering, and sequential fan-out are real concerns.
- Good recognition of the `MergeRegion` versus `ResolvedMergedRegion` mismatch before replacing all-merges filtering with the spatial query.
- Verification is not just compile-oriented: it asks for read-path equivalence, write-path observability, consumer migration tests, dead-stub grep checks, registry drift checks, and type fidelity through the re-export/type chain.
- Sequencing is mostly sensible: spatial reads before consumer migration before deletion, and registry work can run independently.

Major gaps or risks

- The "single chokepoint" objective is incomplete. `kernel/src/api/worksheet/structure.ts` bypasses the domain module not only for `getAllMergesInSheet`, but also for `mergeRange`, `unmergeRange`, and `getMergeAtCellQuery`. The plan only names the read bypasses in `structure.ts` and `sorting.ts`, so an implementer could finish Step 2 while leaving public worksheet structure writes outside the new contract.
- The production-path relevance of Step 1 is weaker than stated. `getInRange` and `getInViewport` have no repo callers today, so making those wrappers spatial-backed does not improve production rendering unless real consumers are migrated to them. `sorting.ts` currently scans all merges for range overlap; that is a better concrete production read-path target than unused viewport helpers.
- Existing bridge capabilities are underused. The generated bridge already exposes `mergeAcross`, `mergeAndCenter`, `checkMergeDataLoss`, and `validateAndCleanMerges`. The plan says to "evaluate" batch support and to delete or replace stubs, but it should explicitly decide whether the domain module delegates to those existing Rust methods instead of retaining TS loops or deleting behavior outright.
- The plan's statement that contracts/types "re-export to" `format-registry.ts` appears inaccurate from the public repo: `contracts/src/formatting/index.ts` and `types/formatting/src/formatting/*` retain type-only definitions/comments, while the runtime registry value is only defined in kernel. That matters because dependency direction forbids making contracts depend on kernel runtime code.
- Deleting exported compatibility functions based only on zero repo callers may be unsafe if `@mog-sdk/kernel` exposes them to external users. The plan mentions hidden callers as a risk, but it does not define a package API audit gate or migration/deprecation contract.
- `mergeAndCenter` is treated as mainly a naming problem, but the generated bridge already has `mergeAndCenter` returning `MutationResult`, while `merge-operations.ts` separately applies center format via `setFormatForRanges`. The plan needs to specify whether the Rust bridge method is authoritative, whether TS should keep the separate format mutation, and how the two mutation results compose.
- Registry enforcement is underspecified. "Every `render:true` property has a corresponding case in the render path" needs a concrete mapping source, allowlist, and failure mode, otherwise the test risks becoming another hand-maintained mirror.
- The cited `[[no-excel-in-code]]` convention is not grounded in the inspected public repo context; there are many legitimate source/docs references to Excel-compatible semantics. The plan should distinguish prohibited trademark/product naming from necessary compatibility terminology.

Contract and verification assessment

The merge contract direction is good: keep `DocumentContext` first, delegate semantics to compute, preserve event emission in `MutationResultHandler`, and return bridge mutation data instead of optimistic API results. The plan should strengthen that into a precise return contract for each exported function: single writes return `MutationResult`, multi-row writes return either the Rust aggregate result or a documented aggregate type, and API operations derive receipts only from actual merge changes.

The spatial read contract needs more precision. `MergeRegion` lacks `rowSpan`, `colSpan`, and `merge` identity data that `ResolvedMergedRegion` carries. A local mapper can fill spans from coordinates, but it cannot recreate identity fields unless they are unnecessary or fetched elsewhere. The plan correctly flags the mismatch, but should require tests that compare shape and ordering, not just set membership.

The verification gates are directionally strong but need executable names and ownership. For TS changes, the plan should name the relevant kernel package tests and typecheck command. For UI/production behavior, it should name the exact API/app eval scenarios or add new ones if none exist. For registry drift, it should define a deterministic test contract instead of relying on broad "corresponding case" language.

Concrete changes that would raise the rating

- Expand the bypass audit to every direct merge bridge call under `kernel/src`, especially `worksheet/structure.ts` write and cell-lookup methods, and make the migration contract cover all of them.
- Replace Step 5's uncertainty with explicit use or rejection of existing bridge methods: `mergeAcross`, `mergeAndCenter`, `checkMergeDataLoss`, and `validateAndCleanMerges`.
- Reframe spatial reads around actual production consumers: make `sorting.ts` use a spatial/ranged merge query, and only keep `getInViewport` if a real rendering or viewport caller is migrated to it.
- Add an external/public API audit gate before deleting exported `merges.ts` functions, or specify a deprecation shim if package exports expose them.
- Correct the registry ownership/dependency description: contracts/types are type surfaces and comments, not runtime re-exporters to kernel. Any registry relocation must preserve public dependency direction.
- Specify the registry test mechanically: list the import/export/render files to inspect, the property-to-handler mapping source, and the explicit allowlist for intentional gaps such as `patternBackgroundColor`.
- Define exact verification commands and scenarios for the implementer, while keeping them scoped to the changed packages and production paths.
