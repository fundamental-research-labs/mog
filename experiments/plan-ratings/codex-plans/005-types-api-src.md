# Improve `mog/types/api/src` Public API Type Contracts

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/types/api/src`

Scope this plan covers:

- The `@mog/types-api` source package under `types/api/src`, including `api`, `apps`, `capabilities`, `diagnostics`, `extensions`, `feature-gates`, `kernel`, `performance`, `services`, `store`, `what-if`, and `workflows`.
- The production publication path that projects these types through `@mog-sdk/contracts`, generated API metadata, declaration snapshots, and external consumer fixtures.
- Type contract quality, package export/source parity, generated docs/spec alignment, and downstream compatibility gates.

Scope this plan does not cover:

- Implementing runtime workbook or worksheet behavior in `kernel`.
- Changing package branding, distribution policy, or public package names unless required by a verified contract mismatch.
- Adding temporary compatibility shims. If a contract is wrong, update the source of truth and all production consumers coherently.

## Current role of this folder in Mog

`types/api/src` is the workspace-internal source of truth for much of Mog's published TypeScript API surface. The package itself is currently `private: true` and classified as `workspace-internal` in `tools/package-inventory.jsonc`, but its declarations are re-exported by the public `@mog-sdk/contracts` package and consumed heavily by `kernel`, `apps/spreadsheet`, `runtime/sdk`, and public-facing generated metadata.

Observed contract path:

- `types/api/src/api/*` defines the canonical Workbook/Worksheet interfaces and sub-API types.
- `contracts/src/api/*` mostly acts as re-export shims to `@mog/types-api/*`, with a small set of runtime values owned locally by `contracts`.
- `tools/generate-api-reference.ts` reads `types/api/src/api` directly to emit `docs/generated/api-reference.json`.
- `runtime/sdk/scripts/generate-api-spec.ts` scans `contracts/src/api` plus `types/` to emit `runtime/sdk/src/generated/api-spec.json`.
- `tools/api-snapshots/@mog-sdk__contracts.api.txt`, declaration identity checks, runtime import inventory checks, and external fixtures are the public compatibility guardrails.

Inspection notes from this plan pass:

- `types/api/package.json` has 131 export subpaths.
- `types/api/src` has 133 TypeScript source files.
- All current `development`, `types`, and `import` export targets resolve on disk.
- Three source files are barrel-only rather than direct package subpaths: `src/api/workbook/index.ts`, `src/api/worksheet/index.ts`, and `src/kernel/floating-object-manager.ts`.
- No local `types/api` test/spec files were found.
- Broad `any`, `Record<string, unknown>`, and `[key: string]: unknown` shapes remain in important production-facing areas such as filter values, pivot readback/UI state, group state, conditional-format clone payloads, floating-object updates, services, capabilities, app view configs, workflow contexts, and some API DTOs.

## Improvement objectives

1. Make `types/api/src` an explicitly governed contract source rather than a large bag of workspace types.
2. Remove accidental type looseness from published Workbook/Worksheet, store, service, capability, and workflow declarations.
3. Preserve intentional extensibility by replacing anonymous `any`/`unknown` bags with named JSON/value DTOs and documented extension points.
4. Ensure every public `@mog-sdk/contracts` API declaration is traceable to exactly one source of truth and one generated metadata path.
5. Add automated export/source/shim parity checks so new sub-APIs cannot drift from package exports or `contracts` shims.
6. Align the two API metadata generators so docs and Node SDK introspection describe the same production contract.
7. Expand external fixture coverage to prove real downstream import, declaration identity, and runtime self-containment behavior.

## Production-path contracts and invariants to preserve or strengthen

- Public consumers import API types through `@mog-sdk/contracts/api`, not `types/api/src` or private workspace packages.
- `@mog/types-api` remains a private build-input package unless the package inventory and public docs are intentionally changed.
- `@mog-sdk/contracts` runtime JavaScript must not import private `@mog/types-*`, `@mog-sdk/types-*`, `@mog/*`, or rust-bridge packages.
- Runtime values exposed from the API surface must remain listed and owned in `tools/contracts-runtime-inventory.json`.
- Branded identity types such as cell, row, column, sheet, range, formatted text, document, viewport, and layer brands must have a single declaration owner in public `.d.ts` artifacts.
- Every exported package subpath must have matching source, declaration, and JS artifact targets.
- Every source file under `types/api/src` must be classified as one of: direct public subpath, barrel-only source, or internal implementation helper with an explicit reason.
- Workbook and Worksheet root interfaces must remain the canonical API graph for generated docs/specs and SDK introspection.
- API changes must be reflected in `contracts`, generated API reference JSON, generated SDK spec JSON/schema, declaration snapshots, and external fixtures in the same implementation slice.
- Deprecated methods may remain only when they represent a real production migration path and include replacement guidance in JSDoc.

## Concrete implementation plan

1. Establish a contract inventory for `types/api/src`.
   - Generate a machine-readable inventory of all source files, exported subpaths, `contracts/src` re-export shims, runtime value exports, and generated metadata consumers.
   - Classify each source file as public API, public-experimental API, workspace-internal API, or barrel-only glue.
   - Make the classification live in the public repo near existing package-boundary tooling, not in generated docs.

2. Add export/source/shim parity tooling.
   - Add a read-only checker that validates `types/api/package.json` exports against `types/api/src`, `types/api/dist`, and `contracts/src` shims.
   - Fail if an export points at a missing artifact, a public source file has no package or contracts path without an explicit allowlist entry, or a contracts shim points at a non-existent `@mog/types-api` subpath.
   - Include the currently intentional barrel-only files in the allowlist with explanations.

3. Systematically harden accidental loose types.
   - Audit every `any`, `Record<string, unknown>`, `unknown[]`, and `[key: string]: unknown` in `types/api/src`.
   - Split findings into intentional extensibility, JSON payload, producer-specific metadata, and accidental placeholder categories.
   - Replace accidental placeholders with concrete domain types from `types-core`, `types-data`, `types-formatting`, `types-objects`, `types-events`, and `types-document`.
   - Introduce shared `JsonValue`, `JsonObject`, `ExtensionMetadata`, and `ProducerMetadata` types only where the contract is genuinely schemaless.
   - Prioritize production API holes first: filters unique values, group state, conditional-format clone payloads, pivot readback/UI state, floating-object updates, capabilities gated API, services clipboard/table payloads, and workflow runtime/context payloads.

4. Normalize DTO ownership.
   - For each API shape, decide whether it is a re-export of a domain/generated type or a genuinely different DTO/projection.
   - Move hollow copies back to canonical domain types or make them explicit DTOs with JSDoc explaining why the shape differs.
   - Keep API ergonomics such as string A1 ranges where they are intentional, but ensure conversion contracts are documented and implementation consumers use the same DTO.

5. Align generated metadata paths.
   - Replace hand-maintained Workbook/Worksheet sub-API lists in `tools/generate-api-reference.ts` with AST discovery equivalent to the SDK spec generator, or derive both generators from a shared source module.
   - Ensure generated docs include current sub-APIs such as collections/handles and any newer workbook namespaces.
   - Add a comparison gate that confirms `docs/generated/api-reference.json` and `runtime/sdk/src/generated/api-spec.json` agree on root API members, sub-API accessors, method names, async model, deprecation status, and source locations.

6. Strengthen public declaration gates.
   - Extend API snapshots to capture the `@mog-sdk/contracts/api` root and relevant subpaths with enough detail to detect accidental narrowing, widening, missing exports, duplicate declarations, and private type leakage.
   - Add fixture assertions for common downstream imports: root `@mog-sdk/contracts/api`, workbook/worksheet subpaths, worksheet handles/collections, store shims, and runtime values listed in `contracts-runtime-inventory.json`.
   - Add negative fixtures proving direct public consumption of private `@mog/types-api` and non-exported `src` paths remains blocked.

7. Integrate implementation consumers after type hardening.
   - Update `kernel/src/api`, `apps/spreadsheet`, `runtime/sdk`, docs generators, and external fixtures to use the hardened contracts without casts.
   - Treat every new cast to `any` or broad `unknown` in these paths as a failed contract unless it is justified by an explicit JSON/metadata boundary.
   - Where implementation code currently depends on a loose contract, repair the production implementation path instead of adding API aliases or shims.

8. Document the contract rules in the public repo.
   - Update `types/api/src/api/README.md` or an adjacent contract-governance doc with the source-of-truth rules, allowed extensibility patterns, export requirements, and verification commands.
   - Link the package-boundary classification so future contributors know which `types/api/src` modules are public-facing through `@mog-sdk/contracts`.

## Tests and verification gates

Run these after implementation, in this order:

1. `pnpm --filter @mog/types-api typecheck`
2. New export/source/shim parity checker.
3. `pnpm --filter @mog-sdk/contracts typecheck`
4. `pnpm --filter @mog-sdk/contracts build`
5. `pnpm --filter @mog-sdk/node generate:api-spec`
6. `pnpm generate:api-ref`
7. New generated-metadata agreement checker between docs API reference and SDK API spec.
8. `pnpm check:contracts-runtime-inventory`
9. `pnpm check:contracts-declaration-identity`
10. `pnpm check:contract-runtime-imports`
11. `pnpm check:api-snapshots`
12. `pnpm check:external-fixtures -- --skip-build` after the relevant public artifacts have been built.
13. Repo-wide `pnpm typecheck` for the final integrated TypeScript contract pass.

If any generated artifact changes, review the diff as a contract diff, not as mechanical churn.

## Risks, edge cases, and non-goals

- Some `Record<string, unknown>` usage is legitimate for workflow payloads, app view configs, security templates, and producer metadata. The goal is to name and constrain those boundaries, not remove all extensibility.
- Tightening public API declarations can reveal production implementation gaps in `kernel` and `apps/spreadsheet`; those must be fixed in the implementation path.
- Declaration bundling can duplicate branded unique-symbol owners if a type is re-exported through more than one package path. Keep `check-contracts-declaration-identity` as a required gate.
- The package currently has both source exports under `development` and dist exports under `types`/`import`. The parity checker must validate both modes.
- The direct `@mog/types-api` package is workspace-internal despite having a large exports map. Do not document it as a public import path unless the package inventory changes.
- Do not introduce temporary aliases solely to avoid downstream type updates. Permanent aliases are acceptable only when they are part of the canonical public vocabulary and are tested through snapshots/fixtures.
- Do not optimize or test a mock-only API path. All verification should use `@mog-sdk/contracts`, generated SDK metadata, and external fixture imports.

## Parallelization notes and dependencies on other folders, if any

This work should be split across parallel agents with explicit ownership:

- Agent A: export/source/shim inventory and parity checker across `types/api`, `contracts/src`, and package manifests.
- Agent B: loose-type audit and DTO hardening for `types/api/src/api` Workbook/Worksheet/root/shared types.
- Agent C: loose-type audit and DTO hardening for `types/api/src/apps`, `capabilities`, `services`, `workflows`, `store`, and `kernel`.
- Agent D: generator alignment for `tools/generate-api-reference.ts` and `runtime/sdk/scripts/generate-api-spec.ts`.
- Agent E: external fixtures, API snapshots, runtime inventory, and declaration identity coverage.
- Integrator: update production consumers in `kernel`, `apps/spreadsheet`, `runtime/sdk`, and docs, then run the full verification gate list.

Dependencies:

- `mog/contracts/src` because it is the public projection of these types.
- `mog/kernel/src/api` because it implements the Workbook/Worksheet contracts.
- `mog/apps/spreadsheet/src` because it consumes the contracts heavily through the production UI.
- `mog/runtime/sdk` because generated API spec and public Node SDK declarations depend on these types.
- `mog/tools` and `mog/fixtures/external` because they own publication and downstream compatibility gates.
