# Improve `mog/contracts/runtime-services/src`

## Source folder and scope

Public source folder: `mog/contracts/runtime-services/src`

Scope for this plan is the workspace-internal package
`@mog-sdk/runtime-service-contracts`, specifically the TypeScript contract
surface in:

- `error-envelope.ts`
- `audit-event.ts`
- `service-contracts.ts`
- `protocol-version.ts`
- `deployment.ts`
- `index.ts`

The package is private, type-oriented, and referenced by the root TypeScript
project. It is documented as reserved service-boundary material, not as a
shipped HTTP service, OpenAPI contract, container, or self-hosted deployment
API. The plan therefore targets production service contracts that future
runtime/kernel service implementations can depend on without accidentally
claiming a public hosted API.

Adjacent surfaces that must be audited or updated during implementation:

- `contracts/src/runtime/*`, which currently duplicates `RuntimeErrorEnvelope`,
  `RuntimeAuditEvent`, and `DeploymentProfile` vocabulary.
- `types/host/src/*`, especially `identity.ts`, `capabilities.ts`, `kernel.ts`,
  `source.ts`, `diagnostics.ts`, and `bindings.ts`, because the production host
  operation path already has stronger principal, decision, replay, raw-byte, and
  materialization contracts.
- `kernel/src/document/host-operation-gate.ts`, `shell/src/host-adapters/*`,
  `runtime/sdk/src/host-adapters/*`, and `runtime/test-host`, which exercise the
  real authorization handoff path.
- `docs/guides/http-service.md`, `docs/guides/self-hosting.md`, and security
  trust-boundary docs, which must keep saying "reserved / not shipped" until an
  actual service distribution exists.
- `tools/package-inventory.jsonc` and contract/runtime inventory checks, which
  protect package disposition and public/private leakage.

Out of scope: implementing a runtime server, adding HTTP routes, generating an
OpenAPI spec, shipping self-hosting manifests, or weakening the existing host
operation gate to fit these lighter service contracts.

## Current role of this folder in Mog

`contracts/runtime-services/src` is the reserved contract package for service
boundary envelopes shared across runtime and kernel-adjacent services. It
defines:

- Uniform runtime error envelopes.
- Canonical audit event records.
- Service principals, sessions, tenant scopes, collaboration room grants,
  import/export handoffs, provider materialization references, and raw-byte
  materialization decisions.
- Protocol version and handshake shapes.
- Deployment profile, liveness, readiness, and diagnostics shapes.

The folder currently has no implementation and no package-local test script;
`package.json` only exposes `typecheck`. Generated `dist` declaration files
mirror the source and the emitted JavaScript files are effectively empty because
the exports are type-only.

The production path is stronger than this package today. Host/kernel
authorization handoffs in `@mog-sdk/types-host/kernel` and
`kernel/src/document/host-operation-gate.ts` already include fields such as
`decisionId`, `correlationId`, `sessionId`, `nonce`, numeric `expiresAt`,
`VerifiedPrincipal`, resource context sentinels, raw byte policy,
document/source references, high-water mark proofs, replay consumption, and
export materialization grants. The runtime-services package duplicates some of
the same concepts in weaker shapes: plain string principals, optional workspace
and document scope, ISO string expiry, untyped decision refs, no replay nonce,
and no canonical resource-context fingerprint.

The folder is also not widely imported by production code yet. That makes it a
specification staging area with high leverage: it can be corrected before
future services adopt a contract that under-specifies authentication,
authorization, auditability, protocol negotiation, or raw-byte handling.

## Improvement objectives

1. Turn `@mog-sdk/runtime-service-contracts` into the canonical internal
   contract package for future runtime service boundaries, not a parallel,
   weaker restatement of host/kernel contracts.
2. Remove duplicate type drift between `contracts/runtime-services/src` and
   `contracts/src/runtime/*` by assigning one source of truth for shared
   runtime error, audit, deployment, and service-config vocabulary.
3. Align service principals, tenant/resource scopes, decision refs, and handoff
   envelopes with the production `@mog-sdk/types-host` authorization model.
4. Require replay-safe, auditable handoffs for collaboration room entry,
   import, export, provider construction, and raw-byte access.
5. Standardize cross-service correlation, request identity, trace identity,
   time units, protocol versions, and service names so runtime, kernel, shell,
   SDK, and future sidecars do not invent incompatible local variants.
6. Strengthen error and audit contracts with explicit redaction, retry,
   status/category, outcome, and decision-causality invariants.
7. Make deployment, health, readiness, diagnostics, and protocol negotiation
   useful to real production service orchestration without claiming that Mog
   ships that orchestration today.
8. Add type fixtures and boundary tests that fail when future edits change the
   contract shape, public/private package disposition, or production handoff
   compatibility.
9. Keep docs and package inventory aligned with the reserved/private status of
   this package.

## Production-path contracts and invariants to preserve or strengthen

- `@mog-sdk/runtime-service-contracts` remains workspace-internal unless a
  separate service launch plan intentionally changes its disposition, package
  inventory, docs, examples, and release checks.
- `mog` must not depend on `mog-internal`, and public packages must not leak
  private-only imports in generated declarations.
- Service principals must be verified projections, not raw tokens or
  user-supplied identity. They must carry issuer, actor kind, subject id,
  tenant/workspace context, canonical tags or a documented tag projection, and
  enough fingerprint/provenance data to audit how authorization was derived.
- Tenant and workspace scopes must preserve the existing host sentinels:
  `string | { kind: 'single-tenant' }` and
  `string | { kind: 'no-workspace' }`. Plain optional strings are not sufficient
  for production tenant isolation.
- Every authorization handoff that enables room join, import, export, provider
  construction, or raw-byte access must include an operation discriminator,
  decision id, correlation id, session id, source host id, nonce, issued/expiry
  time, principal, resource context, and replay/audit proof fields.
- Expiry and replay checks must use the same time unit as the host operation
  gate. Existing production code uses epoch milliseconds for handoff expiry;
  the service contract should not require downstream adapters to translate ISO
  strings for security-critical checks.
- Raw-byte access must fail closed. A denied decision must not carry raw-byte
  capabilities, and an allowed decision must state an explicit MIME policy,
  byte limit policy, source/content identity, and redaction or materialization
  proof. Avoid ambiguous rules such as "empty allowlist means all" unless the
  type makes that rule a discriminated policy.
- Export materialization must align with the existing
  `AuthorizedExportMaterializationHandoff` and `HostExportMaterializationGrant`
  production path, including high-water mark proof, destination, export sink
  refs, raw snapshot/redacted content policy, and nonce consumption.
- Import handoffs must bind source MIME type, source content identity, byte
  limits, target resource context, source handle issuance, and authorization
  decision refs before bytes cross into file I/O.
- Collaboration room grants must bind room/document identity, principal,
  resource context, allowed capabilities, protocol/capability set, audience or
  origin constraints, nonce, and expiry before a WebSocket upgrade succeeds.
- Audit events must distinguish authorization outcomes from operation outcomes.
  `allowed`, `denied`, `failed`, and `succeeded` are useful, but the contract
  should make clear whether the event records a decision, an attempted
  operation, or completion of an operation.
- `correlationId` should be the required cross-service causal id. HTTP-specific
  `requestId` may remain optional, and distributed `traceId` should be optional
  but consistently named.
- Error envelopes must expose machine-readable `code`, broad `category`,
  retryability, HTTP status when applicable, correlation/trace identifiers, and
  sanitized details. They must not contain secrets, raw bytes, credentials,
  tokens, unredacted PII, formulas, or cell values unless a separate redaction
  policy explicitly authorizes them.
- Protocol compatibility must be deterministic and shared. Every service should
  use the same current/minimum version constants and compatibility logic rather
  than comparing `{ major, minor, patch }` ad hoc.
- Health, readiness, and diagnostics must include enough information for a real
  service orchestrator: service name, protocol version, build/version,
  deployment profile, dependency statuses with reasons, startup phase, redacted
  config fingerprint, uptime, and timestamp.
- If runtime values are added for protocol constants or compatibility helpers,
  the package must stop being treated as "types only" in docs/inventory and must
  get runtime import checks. Do not accidentally add value exports while leaving
  the package described as declaration-only.

## Concrete implementation plan

1. Establish canonical ownership for runtime service vocabulary.
   - Inventory every duplicate between `contracts/runtime-services/src` and
     `contracts/src/runtime/*`: error envelope, audit event, deployment profile,
     service diagnostics, service config, and asset/runtime service terms.
   - Decide whether the canonical source is the split runtime-services package,
     a neutral lower-level type shard, or the reserved `contracts/src/runtime`
     folder. Do not keep two editable copies.
   - If `contracts/src/runtime/*` remains unexported/reserved, convert duplicate
     files there into intentional re-export shims or remove them from the build
     surface if they are dead.
   - If any duplicate shape is intended to become public through
     `@mog-sdk/contracts`, extract the shared type into a neutral package rather
     than making public declarations import from a private package.
   - Update package inventory and declaration-leak checks to encode the chosen
     ownership rule.

2. Replace weak service principal and scope contracts with host-aligned
   projections.
   - Introduce a `RuntimeServicePrincipal` or re-export a serializable
     projection of `VerifiedPrincipal` from `@mog-sdk/types-host/identity`.
   - Include issuer, subject id, actor kind, tenant id, workspace id, canonical
     tags, and optional display fields that are explicitly marked as
     non-authoritative.
   - Replace `TenantScope` with a resource-context type that supports
     `single-tenant` and `no-workspace` sentinels and records the trusted
     resolution source.
   - Add branded or structured aliases for service names, session ids,
     decision ids, source host ids, correlation ids, trace ids, nonces,
     fingerprints, and security event refs where existing `types-host` shapes
     already provide them.
   - Add type fixtures that prevent a raw `ServicePrincipal` with only
     `{ principalId, principalType, tenantId }` from satisfying a production
     handoff.

3. Define a shared handoff base and specialize every service operation.
   - Add a `RuntimeServiceHandoffBase` containing operation discriminator,
     decision id, correlation id, session id, source host id, nonce, issued at,
     expires at, principal, resource context, optional document/source ref, and
     security event ref.
   - Make `RoomGrant`, `SourceImportHandoff`,
     `ExportMaterializationHandoff`, `ProviderMaterializationRef`, and
     `RawByteMaterializationDecision` extend or compose the base instead of
     each inventing partial fields.
   - Align export handoffs with `AuthorizedExportMaterializationHandoff` and
     `HostExportMaterializationGrant` rather than maintaining a weaker
     `outputFormat`-only contract.
   - Add import-specific fields for source content identity, source handle
     issuance, source kind, MIME policy, max bytes, and target document/workspace
     scope.
   - Add provider materialization fields for provider role, authority ref,
     storage scope, redacted config fingerprint, and raw-byte exposure policy.
   - Convert raw-byte access to a discriminated union:
     `denied` carries denial reason and audit refs; `granted` carries explicit
     MIME policy, byte limits, content identity, materialization proof, and
     child-policy resolution.
   - State that all handoff nonces are single-use and must be consumed before
     the operation executes.

4. Align runtime service contracts with the production host operation gate.
   - Compare every field of `AuthorizedDocumentStorageHandoff`,
     `AuthorizedExportMaterializationHandoff`, and
     `AuthorizedDocumentManagementHandoff` in `types/host/src/kernel.ts`
     against the runtime-services handoff set.
   - Add missing shared fields to runtime-services or intentionally reference
     the host type where it is already the exact production contract.
   - Avoid duplicate types with different names for the same production concept.
     If services and host adapters need separate names, make one alias or
     projection of the other and document why.
   - Update standalone browser, Node headless, and test-host adapters only after
     the contract shape is pinned so they produce the canonical handoffs.
   - Keep all verification on real host/kernel call paths; do not create a
     test-only authorization bypass just to satisfy fixtures.

5. Make protocol negotiation executable and deterministic.
   - Decide whether this package remains type-only. If services need shared
     compatibility behavior, add runtime exports such as
     `CURRENT_RUNTIME_SERVICE_PROTOCOL`, `MIN_RUNTIME_SERVICE_PROTOCOL`, and
     `evaluateRuntimeServiceProtocolCompatibility`.
   - If runtime exports are added, update the package description, docs,
     inventory, and runtime import checks so the value surface is explicit.
   - Define compatibility rules exactly: major mismatch is incompatible, lower
     peer minor may require upgrade, patch mismatch remains compatible unless a
     known bug floor is encoded.
   - Include advertised service capabilities, deployment profile, build id, and
     minimum supported version in `ProtocolHandshake`.
   - Add fixture tests for compatible, upgrade-required, and incompatible
     handshakes.

6. Strengthen error envelopes.
   - Add required `correlationId` while keeping `requestId` as an optional
     HTTP-boundary id if needed.
   - Define the category/status/retryable matrix for auth, permission,
     not-found, conflict, validation, quota, unsupported, runtime, and internal
     failures.
   - Add optional retry metadata such as `retryAfterMs` or backoff hints for
     quota/runtime errors.
   - Split safe developer/admin diagnostic details from user-facing messages if
     the same envelope crosses both user and operator boundaries.
   - Define a redaction contract for `details` and add fixture cases proving
     secrets, tokens, credentials, raw bytes, and unredacted document content are
     excluded.

7. Strengthen audit event contracts.
   - Add a required event kind or phase field that separates authorization
     decision events from operation lifecycle events.
   - Require correlation id, service name, operation, actor/principal
     projection, resource context, timestamp, and outcome.
   - Normalize decision reference names so capability, workbook access,
     materialization, raw-byte, import, export, and provider refs are typed
     rather than free strings.
   - Add fields for `sourceHostId`, `sessionId`, replay/nonce ref, and security
     event ref where applicable.
   - Define the redacted metadata policy and align it with diagnostics
     redaction levels used elsewhere in the repo.
   - Add audit fixtures for allowed, denied, failed, and succeeded flows,
     including export and raw-byte events.

8. Make health, readiness, and diagnostics production-useful.
   - Replace boolean-only dependency readiness with structured dependency
     states: ready/unready/degraded, reason code, last checked at, optional
     latency, and redacted endpoint/provider identity.
   - Include service version, build id, deployment profile, protocol version,
     startup phase, uptime, capabilities, and region/node identity where safe.
   - Keep diagnostics redacted by construction. Config snapshots should carry
     redacted values or fingerprints, never connection strings or secret refs.
   - Align `DeploymentProfile` with reserved self-host config and docs so
     `local-dev`, `single-node`, `horizontal`, and `air-gapped` have exact
     operational meanings.
   - Add fixtures for local-dev, horizontal, dependency-degraded, and
     air-gapped diagnostics shapes.

9. Add contract fixture and import-boundary tests.
   - Add package-local type tests or fixture files that import only public
     package entrypoints and use `satisfies` to pin every exported shape.
   - Add negative type fixtures with `@ts-expect-error` for weak principals,
     missing nonces, string-only tenant scopes, expired-at ISO strings in
     handoffs, and denied raw-byte decisions that accidentally expose grant
     fields.
   - Add generated declaration snapshot checks for `dist/*.d.ts` if the repo's
     contract tooling already supports declaration identity.
   - Extend package/disposition tooling so a public package cannot import this
     private package in emitted declarations.
   - Add consumer compile fixtures for kernel, shell, runtime SDK, and test-host
     handoffs once those consumers switch to the canonical types.

10. Update documentation without claiming a shipped service.
    - Update `docs/guides/http-service.md` and `docs/guides/self-hosting.md` to
      describe the corrected reserved contract scope.
    - Update security trust-boundary docs to state that these contracts are
      necessary for future services but not sufficient evidence that a hosted
      service is shipped.
    - Add an internal package note or README explaining how service contracts
      relate to `@mog-sdk/types-host`, capability decisions, document
      authorization decisions, raw-byte policies, and audit events.
    - Keep examples focused on contract shape and verification, not runnable
      HTTP endpoints.

## Tests and verification gates

Run these after implementation, not during this planning task:

- `cd mog && pnpm --filter @mog-sdk/runtime-service-contracts typecheck`
- `cd mog && pnpm --filter @mog-sdk/runtime-service-contracts test` after
  adding a package-local test script for contract fixtures.
- `cd mog && pnpm --filter @mog-sdk/types-host typecheck`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- host-operation-gate`
- `cd mog && pnpm --filter @mog-sdk/kernel typecheck`
- `cd mog && pnpm --filter @mog/shell typecheck`
- `cd mog && pnpm --filter @mog-sdk/node typecheck`
- `cd mog && pnpm --filter @mog-sdk/contracts typecheck`
- `cd mog && pnpm --filter @mog-sdk/contracts check:runtime-inventory`
- `cd mog && pnpm --filter @mog-sdk/contracts check:runtime-imports`
- `cd mog && pnpm check:publish-readiness:fast`
- `cd mog && pnpm typecheck`

Behavior verification should exercise the real production path:

- Create host authorization decisions through the standalone browser host,
  Node headless host, and test host adapters.
- Authorize export through `HostDocumentOperationGate`, verify the returned
  handoff satisfies the runtime service contract, consume the nonce, and prove a
  replay is rejected.
- Exercise denied and expired handoff cases and verify emitted diagnostics and
  audit events match the contract fixtures.
- Exercise import/source-handle and raw-byte materialization decisions through
  the actual kernel/file-io boundary once those consumers adopt the canonical
  contract.
- Exercise protocol compatibility cases through the shared compatibility
  helper if runtime values are introduced.

If a narrower type gate is used instead of repo-wide `pnpm typecheck`, record
why and list the behavior gates that covered the production authorization path.

## Risks, edge cases, and non-goals

- The largest risk is preserving a weaker duplicate contract because no service
  imports it yet. The correct fix is to align it with production host/kernel
  authorization semantics before adoption.
- A second major risk is accidentally converting private reserved service
  contracts into a public HTTP API signal. Docs, package inventory, declaration
  checks, and examples must keep the "reserved / not shipped" boundary clear.
- Adding runtime protocol helpers changes the package from type-only to a
  package with runtime values. That is acceptable only if the value surface is
  explicit, tested, and reflected in docs/inventory.
- Time-unit drift is security-sensitive. Handoff expiry should use epoch
  milliseconds consistently with the host operation gate, while human-readable
  audit/health timestamps can carry ISO strings only if the contract says so.
- Principal drift is security-sensitive. Display names and actor labels are for
  logs only; authorization must depend on verified issuer, subject, tags,
  resource context, and decision proofs.
- Raw-byte access must be modeled as a separate security capability, not a
  side effect of document read/write permission.
- Empty arrays and omitted fields are edge cases in security contracts. For
  allowlists, dependency statuses, scopes, and capabilities, the type should
  state whether empty means none, all, unknown, or inherited.
- Audit events must not include secrets, tokens, credentials, raw byte content,
  unredacted PII, formulas, or cell values. The type should make unsafe metadata
  hard to express.
- Do not introduce compatibility shims for obsolete handoff shapes. This is a
  single-developer, no-external-users codebase; correct the contract and update
  production consumers together.
- Do not implement a server, route table, OpenAPI schema, service binary,
  container, auth adapter, database adapter, or deployment manifest as part of
  this folder-level contract plan.
- Do not optimize benchmarks or test-only mocks. Verification must use the
  production host/kernel handoff path.

## Parallelization notes and dependencies on other folders, if any

This work can be split after the canonical ownership decision:

- Agent A: duplicate-contract inventory and canonical source cleanup across
  `contracts/runtime-services/src` and `contracts/src/runtime/*`.
- Agent B: principal, resource context, decision ref, nonce, and handoff
  alignment with `types/host/src/*` and `kernel/src/document/host-operation-gate.ts`.
- Agent C: error envelope, audit event, redaction, and diagnostics contract
  fixtures.
- Agent D: protocol version, service health, readiness, and diagnostics
  production-shape design.
- Agent E: consumer migration in shell, runtime SDK, runtime test-host, and
  kernel tests.
- Agent F: docs, package inventory, declaration-leak checks, and public/private
  disposition verification.

Dependencies:

- The canonical source decision must land before broad import rewrites.
- Handoff shape changes depend on `@mog-sdk/types-host` ownership decisions and
  should not fork the host operation gate contract.
- Runtime protocol value exports require package inventory and runtime import
  tooling updates in the same slice.
- Docs must be updated in the same change as any package-disposition or value
  export change so reserved service contracts are not mistaken for shipped
  service APIs.
- Consumer migrations should happen after fixture tests pin the new shapes; the
  final integration gate should prove real export/import/raw-byte authorization
  paths satisfy the new contracts.
