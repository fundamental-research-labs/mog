Rating: 5/10

Summary judgment

The plan correctly identifies the real local outlier: `contracts/src/bridges/ink-recognition-bridge.ts` duplicates the upstream bridge definitions while the sibling bridge files are type-only shims. It also correctly explains that `export type *` cannot carry `DEFAULT_RECOGNITION_THRESHOLDS`.

The problem is the proposed runtime fix. Re-exporting `DEFAULT_RECOGNITION_THRESHOLDS` from private `@mog/types-bridges/ink-recognition-bridge` would make `@mog-sdk/contracts` emit a runtime dependency on an unpublished `@mog/types-*` package. Existing contracts gates explicitly forbid that: the package build runs runtime-inventory and runtime-import checks, and `check-contract-runtime-imports` requires compiled contracts JS to be self-contained rather than importing private workspace shards. So the plan has a strong diagnosis but an architecturally unsafe implementation path.

Major strengths

- Accurately inventories the bridge folder and identifies the single non-shim file.
- Correctly distinguishes type-only re-exports from runtime value exports.
- Treats `@mog-sdk/contracts/bridges` as a public API surface and names real kernel consumers of the bridge value.
- Calls for API surface verification and a structural guard, which are the right classes of checks for a contracts cleanup.
- Keeps interface redesigns, bridge implementations, and unrelated contracts folders out of scope.

Major gaps or risks

- The central value re-export violates the existing public-runtime contract. `@mog/types-bridges` is private/unpublished, and `tsc` would emit `export { DEFAULT_RECOGNITION_THRESHOLDS } from '@mog/types-bridges/ink-recognition-bridge'` into `dist`, which is exactly what the runtime-import gate forbids.
- The plan treats the current local constant as accidental duplication, but `tools/contracts-runtime-inventory.json` currently records this runtime value as `contracts-owned` with source of truth in `contracts/src/bridges/ink-recognition-bridge.ts`. Changing that policy needs to be explicit, not incidental.
- The `grid-renderer.ts` precedent is not equivalent: that file re-exports a value from a local public contracts primitive, not from a private type shard.
- Step 2 leaves an implementation choice open (`./ink-recognition-bridge` versus direct package re-export). A contract plan should specify one code shape.
- The structural guard is underspecified and partly contradictory. It mentions a `mog-internal` test surface, but the durable guard belongs in the public `mog` repo CI path. Its rule also needs to distinguish the barrel from leaf shims and define exactly what runtime projection, if any, is allowed.
- The no-behavior-change claim overstates value identity. Moving the contracts export to the private upstream constant would change identity relative to the current local public constant and would only be valid if the private runtime dependency were intentionally made public or bundled.

Contract and verification assessment

The contract that needs preservation is not just "bridges are a facade over `@mog/types-bridges`"; it is "types may project from private shards, but the published contracts runtime must be self-contained." The plan covers the former and misses the latter.

A safer contract would allow `export type * from '@mog/types-bridges/ink-recognition-bridge'` for types while keeping `DEFAULT_RECOGNITION_THRESHOLDS` as a local public runtime projection typed from the upstream `RecognitionThresholds`, or moving the constant into a published/self-contained runtime module that both packages can use. Direct runtime re-export from `@mog/types-bridges` should not be accepted without a deliberate change to package publication and runtime-import policy.

The verification section is directionally good but should name existing gates precisely. The critical production gates are `pnpm --filter @mog-sdk/contracts build` because it runs declaration rollup, declaration identity, runtime inventory, and runtime import checks; `pnpm check:contracts-runtime-inventory`; `pnpm check:contract-runtime-imports`; `pnpm check:api-snapshots`; the relevant kernel ink bridge test; and external fixture coverage for retained runtime values. Generic "tsc -b" and "api-extractor/rollup" language is not enough for this package.

Concrete changes that would raise the rating

- Rewrite the implementation plan so the leaf file becomes a type shim plus a self-contained public runtime projection, for example using `import type { RecognitionThresholds }` from the private shard and a local `export const DEFAULT_RECOGNITION_THRESHOLDS` literal, unless the broader architecture intentionally publishes or bundles the private runtime source.
- State whether `tools/contracts-runtime-inventory.json` remains `contracts-owned` with a local source of truth or is intentionally updated as part of a larger runtime-source policy change.
- Remove the Step 2 either/or and specify the exact barrel export path.
- Define the structural guard as a public `mog` repo check, preferably AST-based, with explicit allowed forms for each bridge file and an assertion that the barrel still exposes the one runtime value.
- Add a negative guard fixture proving that a direct runtime import/re-export from `@mog/types-bridges` fails.
- Replace generic verification with exact repo commands and include the contracts build, runtime self-containment checks, API snapshot check, external runtime-value fixture, and relevant kernel test.
