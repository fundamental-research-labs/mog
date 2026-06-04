# Improve `mog/contracts/src/security`

## Source folder and scope

Public source folder: `mog/contracts/src/security`

Scope for this plan is the public `@mog-sdk/contracts/security` subpath and the security contract types it exposes for workbook data access control: principals, tag matchers, access targets, access levels, access policies, policy metadata, policy explanation payloads, and document-session principal configuration. The plan also covers the contract edges that must be kept in lockstep with this folder: `types/document/src/security`, `types/api/src/api/workbook/security.ts`, Rust `compute-security` wire serde, kernel `WorkbookSecurityImpl`, SDK type generation, security events, and public security docs.

Out of scope for direct ownership by this folder: app/runtime capability registries in `contracts/src/capabilities`, host trust primitives in `types/host`, Rust policy enforcement internals, UI permission prompts, and implementation of bridge gates. Those remain dependencies whose contracts should be referenced and tested from this security surface, not reimplemented here.

## Current role of this folder in Mog

`mog/contracts/src/security` is the public package facade for workbook data policy contracts. `package.json` exports it as `@mog-sdk/contracts/security`, and kernel/runtime code imports `DocumentSecurityConfig`, `AccessPrincipal`, `AccessPolicy`, `AccessTarget`, `AccessLevel`, `AccessExplanation`, and `PolicyId` through that public subpath.

The current folder is a thin shim over `@mog-sdk/types-document/security`:

- `index.ts` re-exports all security types from `@mog-sdk/types-document/security` and locally redefines `ACCESS_LEVEL_ORDER`.
- `evaluator.ts` re-exports from `@mog-sdk/types-document/security/evaluator`.
- `types.ts` is byte-identical to `types/document/src/security/types.ts` today, but it is bypassed by the public `index.ts` and can drift silently.

The production enforcement path is Rust-first. `compute-security` owns the actual policy engine and serde wire shape; kernel `WorkbookSecurityImpl` forwards public API calls through `ComputeBridge.wbSecurity*`; the SDK re-exports the contract surface and generates public API docs from it. This folder is therefore a contract boundary, not an implementation location.

## Improvement objectives

1. Make `@mog-sdk/contracts/security` the obvious, stable public authority for workbook security contracts while preserving the existing dependency direction from contracts to lower-level public type packages.
2. Remove or neutralize the duplicate `contracts/src/security/types.ts` drift hazard by making every exported type flow from one canonical source.
3. Align the TypeScript `AccessExplanation` contract with the actual Rust `compute_security::engine::AccessExplanation` payload.
4. Add explicit contract types for structured explanation diagnostics instead of untyped strings where Rust already emits enumerated shapes.
5. Clarify the boundary between workbook data policy, host trust/principal verification, and app capability gates without merging those systems.
6. Pin the public wire contracts with type-level and runtime serde fixture tests so future Rust or TypeScript edits fail fast when they change the external shape.
7. Ensure SDK generated docs and public security docs describe the same contract that production code executes.

## Production-path contracts and invariants to preserve or strengthen

- `AccessLevel` remains the ordered five-level linear lattice: `none < structure < read < write < admin`. TS `ACCESS_LEVEL_ORDER` must match Rust `AccessLevel::{None,Structure,Read,Write,Admin}` discriminants `0..4`.
- `AccessTarget` wire shape remains the tagged union `{ kind: 'workbook' } | { kind: 'sheet', sheetId } | { kind: 'column', sheetId, colId }` with camelCase IDs.
- `TargetMatcher` keeps the same target shapes and only allows `'*'` wildcards in IDs, never in the `kind` discriminator.
- `TagMatcher` remains a string pattern with exactly the Rust matcher semantics currently supported: exact, suffix `*` prefix-glob, and global `*`.
- `TagSpecificity` stays aligned with Rust serde names and ordering: `wildcard`, `prefix-glob`, `exact`.
- `AccessPolicy` wire keys stay `id`, `principalTag`, `target`, `level`, `priority`, `enabled`, `metadata`.
- `AccessPolicyMetadata` must match Rust `PolicyMetadata`: `createdBy`, `createdAt`, optional `templateId`. If `description` remains TS-only, either remove it from the public policy wire contract or formally add it to Rust serde; do not leave it as an undocumented field that callers may believe is persisted.
- `PolicyId` stays a UUID string on the wire. If the TS fallback ID generator remains, it must produce parseable UUIDs, not timestamp/random strings that Rust may reject.
- `DocumentSecurityConfig.resolvePrincipal` continues to mean session principal initialization. The contract should state whether it is synchronous only or may be async, whether empty tags differ from `null`, and whether callers can rely on the principal being installed before workbook APIs are usable.
- `AccessExplanation` must describe the actual Rust payload: effective tags, candidate policies, sorted policies, matched policy, resolved level, ambiguity details, owner-lockout clamp state, and structured reason.
- `WorkbookSecurity.addPolicy`, `updatePolicy`, `applyTemplate`, `removeTemplate`, `getEffectiveAccess`, and `explainAccess` remain async because they cross the compute bridge.
- Security events that expose `AccessPolicy`, `AccessTarget`, `AccessLevel`, and `PolicyId` must import the same canonical public shapes and stay in lockstep with Rust `SecurityEvent`.
- Public contracts must not import private/internal packages, and `mog` must not depend on `mog-internal`.

## Concrete implementation plan

1. Establish canonical ownership for the public security surface.
   - Decide whether `types/document/src/security` remains the source of truth with `contracts/src/security` as a facade, or whether the canonical declarations move into `contracts/src/security` and `types-document` re-exports them.
   - Prefer a single-source facade pattern consistent with the rest of `contracts/src/*` shims only if contract drift tests are added.
   - Delete or convert `contracts/src/security/types.ts` into an intentional re-export shim so it cannot diverge from `types/document/src/security/types.ts`.
   - Update direct imports from `@mog-sdk/types-document/security/types` in public contract/event surfaces to import through the chosen canonical public path where dependency direction allows it.

2. Correct `AccessExplanation`.
   - Replace the current stale TS shape `{ level, matchedPolicy, reason: string, candidatePolicies, warnings }` with the Rust payload shape from `compute-security/src/engine.rs`.
   - Add exported TS types for `ExplainReason`, `AmbiguityWarning`, and `PrincipalTag`/effective tag wire values as needed.
   - Preserve the Rust serde naming exactly: snake_case Rust fields become camelCase only if the bridge actually converts them. If the bridge returns snake_case today, either update the bridge serialization intentionally or expose the snake_case shape and document it. Do not guess.
   - Update `types/api/src/api/workbook/security.ts` docs so `explainAccess` promises the real fields, not generic warnings.

3. Resolve policy metadata drift.
   - Audit whether `AccessPolicyMetadata.description` is accepted, persisted, ignored, or dropped by Rust.
   - If product requirements need descriptions, add `description?: string` to Rust `PolicyMetadata` serde and pin it with Rust and TS fixtures.
   - If descriptions are not a production contract, remove the TS field from the public policy shape and update docs/examples accordingly.

4. Tighten policy update contracts.
   - Introduce an explicit exported `AccessPolicyPatch` / `PolicyUpdate` type matching Rust `AccessPolicyPatch`.
   - Use that type in `WorkbookSecurity.updatePolicy` instead of `Partial<Omit<AccessPolicy, 'id'>>` if metadata is not patchable and `id` must remain immutable.
   - Document no-op patch behavior and whether it is accepted or rejected.

5. Pin PolicyId generation to the Rust contract.
   - Replace the non-UUID fallback in `kernel/src/api/workbook/security.ts` with a valid UUID v4-compatible fallback or move ID generation entirely to Rust with a bridge payload that omits `id`.
   - Reflect the chosen behavior in the public `addPolicy` contract.
   - Add tests that prove every generated `PolicyId` is accepted by Rust serde.

6. Clarify principal/session semantics.
   - Update `DocumentSecurityConfig` docs to distinguish `AccessPrincipal` from host `VerifiedPrincipal`.
   - State that `mog:*` reserved tags must come from trusted host projection, while the workbook policy engine treats tags as already verified.
   - Decide and document whether `resolvePrincipal` may return `null`/anonymous or only `{ tags: [] }`; align with kernel `setActivePrincipal(null)` and SDK `principal` shorthand.
   - If session setup must be fail-closed, replace fire-and-forget principal installation paths with awaited initialization in the relevant production context factories, then make the contract say APIs are usable after initialization.

7. Make security contract fixtures executable.
   - Add TS fixture tests that import only `@mog-sdk/contracts/security` and assert the exported names, access ordering, discriminated target shapes, patch shape, and explanation shape.
   - Add Rust serde fixture tests, or extend existing `compute-security` tests, with JSON samples generated from the TS contract fixtures.
   - Add a small cross-language fixture file under an appropriate public test/fixtures location so TS and Rust tests share the same policy and explanation examples.
   - Regenerate SDK API spec/docs after the contract shape is corrected, and verify stale `@mog-sdk/types-document/security/evaluator` imports are rewritten to the contracts subpath in SDK output.

8. Update public documentation.
   - Update `docs/guides/security-and-governance.md` and lower-level access-control docs to name the public `@mog-sdk/contracts/security` exports and the exact `explainAccess` fields.
   - Add examples for workbook, sheet, and column targets; exact, prefix-glob, and wildcard tag matchers; owner/non-owner behavior; and ambiguity diagnostics.
   - Keep non-goals explicit: no row/range policies until those target types exist, no hostile same-page sandbox guarantee, no durable audit-log claim unless implemented elsewhere.

9. Clean up import boundaries.
   - Ensure public consumers use `@mog-sdk/contracts/security` rather than deep `@mog-sdk/types-document/security/*` imports unless they are inside the lower-level type package itself.
   - Keep `contracts/src/security` free of runtime implementation and free of imports from kernel, runtime, shell, apps, or `mog-internal`.
   - Add a lint or package-boundary test if the repo already has a mechanism for forbidden deep imports.

## Tests and verification gates

Run these after implementation, not during this planning task:

- `cd mog && pnpm --filter @mog-sdk/contracts test`
- `cd mog && pnpm --filter @mog-sdk/contracts typecheck`
- `cd mog && pnpm --filter @mog-sdk/types-document test`
- `cd mog && pnpm --filter @mog-sdk/types-document typecheck`
- `cd mog && pnpm --filter @mog-sdk/types-api test`
- `cd mog && pnpm --filter @mog-sdk/types-api typecheck`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- security`
- `cd mog && pnpm --filter @mog-sdk/kernel typecheck`
- `cd mog && cargo test -p compute-security`
- `cd mog && cargo clippy -p compute-security`
- `cd mog && pnpm --filter @mog-sdk/node test` or the repo's SDK build/verify script that regenerates and checks `runtime/sdk/src/generated/api-spec.json`.
- For a final integration gate, create a workbook through the public SDK, install a principal through the real session path, add workbook/sheet/column policies, call `getEffectiveAccess` and `explainAccess`, and verify the returned explanation payload matches the contract fixture.

If a narrower package-specific gate is substituted for repo-wide typecheck, record the rationale and list the type and behavior gates that were run.

## Risks, edge cases, and non-goals

- The largest risk is silently changing public wire names while trying to make TypeScript names more idiomatic. Contract fixtures must pin the exact JSON shape before refactoring.
- `AccessExplanation` may currently be consumed as the stale TS shape by generated SDK docs or downstream users. Because this project has no compatibility period requirement, correct the contract to production truth rather than adding a compatibility shim.
- `description` in `AccessPolicyMetadata` is an edge case with security/audit implications. Either persist it end-to-end or remove it from the public wire type.
- `PolicyId` fallback generation can fail under runtimes without `crypto.randomUUID` if Rust requires UUID parsing. This must be fixed on the production path, not only in tests.
- Anonymous, empty-tag, and non-owner principals need explicit examples because Rust derives `mog:non-owner` internally and explanation diagnostics distinguish `no_tags`.
- Reserved `mog:*` tag authority belongs to host principal verification. The workbook policy contract should document the expectation but must not claim it verifies issuer trust by itself.
- Do not introduce row, range, cell, object, table, or field-level targets in this plan unless the compute-security engine implements and gates them in the same workstream.
- Do not merge app capability grants with workbook data policies. They answer different trust questions and should remain separate contract surfaces.
- Do not optimize benchmark-only or test-only paths; all verification must exercise public SDK/kernel/bridge calls.

## Parallelization notes and dependencies on other folders, if any

This work decomposes cleanly across parallel agents once the canonical ownership decision is made:

- Agent A: contract surface cleanup in `mog/contracts/src/security`, `types/document/src/security`, and `types/api/src/api/workbook/security.ts`.
- Agent B: Rust serde and explanation fixture alignment in `mog/compute/core/crates/compute-security`.
- Agent C: kernel bridge/session semantics in `mog/kernel/src/api/workbook/security.ts`, `kernel/src/context/*`, and relevant security tests.
- Agent D: SDK generation and public docs updates in `mog/runtime/sdk` and `mog/docs`.
- Agent E: import-boundary audit for deep `@mog-sdk/types-document/security/*` imports in public consumers.

Dependencies:

- The canonical contract source decision must land before broad import rewrites.
- The `AccessExplanation` TS shape and Rust serde fixtures must land together.
- Policy metadata changes require both Rust serde and TS public type updates in the same integration slice.
- Session principal semantics depend on kernel context/lifecycle behavior and should be coordinated with host trust types in `types/host`.
