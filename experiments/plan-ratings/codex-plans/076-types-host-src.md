# 076 - Types Host Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/types/host/src`

Queue item: 76

Scope: the `@mog-sdk/types-host` TypeScript source shard for trusted and untrusted host boundary contracts. The package is workspace-private, but it defines the contracts used by trusted host adapters, `@mog/kernel-host-internal`, the kernel host-backed document lifecycle, runtime SDK/test hosts, browser shell hosts, and iframe/embed boundary code.

Files inspected in this folder:

- `index.ts`
- `trusted.ts`
- `trust.ts`
- `untrusted.ts`
- `kernel.ts`
- `bindings.ts`
- `capabilities.ts`
- `diagnostics.ts`
- `fingerprints.ts`
- `identity.ts`
- `operations.ts`
- `runtime.ts`
- `shell.ts`
- `source.ts`
- `storage.ts`
- `view.ts`
- `__tests__/brand-construction.test.ts`
- `__tests__/canonical-fingerprints.test.ts`
- `__tests__/deterministic-test-host.ts`
- `__tests__/fingerprint-helpers.ts`

Adjacent production and contract paths inspected:

- `types/host/package.json`
- `types/host/tsconfig.json`
- `kernel/host-internal/src/validate.ts`
- `kernel/host-internal/src/index.ts`
- `kernel/src/document/host-storage-preflight.ts`
- `kernel/src/document/host-import-source.ts`
- `kernel/src/document/__tests__/host-integration.test.ts`
- `kernel/src/document/__tests__/host-operation-gate.test.ts`
- `kernel/src/document/__tests__/host-storage-preflight.test.ts`
- `kernel/src/document/__tests__/host-import-source.test.ts`
- `shell/src/host-adapters/standalone-browser-host.ts`
- `shell/src/host-adapters/standalone-browser-host.test.ts`
- `runtime/sdk/src/host-adapters/node-headless-host.ts`
- `runtime/embed/src/host-adapters/iframe-child-host.ts`
- `runtime/embed/src/host-adapters/iframe-parent-client-placeholder.ts`
- `runtime/embed/EXPOSURE.md`
- `runtime/test-host/src/index.ts`
- `runtime/test-host/src/storage.ts`
- `tools/eslint-plugin-mog/import-boundaries.cjs`
- `tools/package-inventory.jsonc`
- `fixtures/external/negative/types-star-import/smoke.ts`
- `fixtures/external/negative/types-host-import/smoke.ts`

This is a public Mog source folder. Implementation belongs in `mog`; this plan stays internal in `mog-internal`.

## Current role of this folder in Mog

`types/host/src` is the contract layer for host-backed document construction and host boundary security. It is intentionally a type shard, not an implementation package. It currently depends only on `@mog-sdk/types-document`, and production packages depend on it through explicit subpaths such as `@mog-sdk/types-host/kernel`, `/bindings`, `/trusted`, `/runtime`, `/diagnostics`, and `/fingerprints`.

The folder owns these contract families:

- Trusted host identity and branding: `TrustedDocumentHostContext`, `TrustedHostBase`, `TrustedHostKind`, and `HostTrustProfile`.
- Kernel host input and validated lifecycle output: `KernelHostContext`, `KernelHostDocumentInput`, `KernelDocumentLifecycleInput`, storage handoffs, export materialization handoffs, management handoffs, high-water proofs, and operation authorization bindings.
- Adapter binding registries: provider materializers, source handle resolvers, replay registries, and runtime transport bindings.
- Security-adjacent identity and capability contracts: `VerifiedPrincipal`, `KernelPrincipalHandoff`, capability requests/decisions, cross-tenant delegation proofs, trust enforcement owner profiles, and workbook access/materialization decision refs.
- Raw-byte and source-handle policy contracts: raw document bytes policy, source content identity, source handle issuance refs, source-handle document refs, and single-use resolver results.
- Runtime/view/shell slices: kernel runtime config, runtime asset/disposal policies, view focus/keyboard/sizing/theme/accessibility policies, and shell route/lifecycle/contribution/navigation policies.
- Diagnostics and canonical fingerprints: diagnostic event unions, security event refs, `HostCanonicalFingerprint`, canonical JSON stringification, and SHA-256 fingerprint helpers.
- Untrusted client placeholder: `UntrustedHostClient`, currently only `clientKind` plus `protocolVersion`.

Observed production path:

- Trusted adapters in `shell/src/host-adapters/standalone-browser-host.ts`, `runtime/sdk/src/host-adapters/node-headless-host.ts`, `runtime/test-host/src/document-host.ts`, and `runtime/embed/src/host-adapters/iframe-child-host.ts` construct `TrustedDocumentHostContext` using `as unknown as TrustedDocumentHostContext`.
- `@mog/kernel-host-internal` receives `KernelHostContext` plus `HostKernelAdapterBindings`, runs `validateKernelHostContextForDocument()`, then returns a narrowed `KernelDocumentLifecycleInput` before document lifecycle construction.
- Kernel validation enforces session/principal/storage/runtime presence, expiry, operation kind, document/resource consistency, tenant/workspace marker exactness, timezone policy, runtime transport binding, storage config safety, provider authorization joins, materializer/resolver availability, and replay nonce consumption.
- Kernel document import resolves source bytes only through validated source-handle resolvers after replay protection and content identity verification.
- Kernel operation gates use host authorization for export/share/delete/destroy and attach high-water/export materialization proofs before byte materialization.
- The ESLint import-boundary rule already treats `@mog-sdk/types-host` as subpath-sensitive: kernel and `kernel-host-internal` can import narrow kernel slices, views/shell/apps get only their slices, and runtime/host adapter files get broad access including `/trusted`.

Important current weaknesses visible from the source:

- `index.ts` re-exports trusted host types from the root entry even though the import-boundary policy says consumers should use narrow subpaths and kernel must not import `/index` or `/trusted`.
- `untrusted.ts` is only a placeholder and does not define the actual untrusted protocol envelope, nonce/origin model, request/response shapes, or redacted policy/effective-state contracts used by iframe/embed paths.
- `fingerprints.ts` is useful but underspecified for security proofs: canonicalization claims `jcs-rfc8785` while accepting non-JSON-ish values, fingerprint purposes are not domain-separated, field coverage is only test-helper-driven, and production packages still duplicate local canonical JSON helpers.
- Diagnostics reuse failure event kinds for success paths in production-adjacent code. For example, validation success is emitted as `hostConstruction.invalid`, storage preflight success as `storage.failure`, and import-source success as `documentAuthorization.denied`.
- Binding contracts still use `unknown` and stringly fields where production has discriminants: transport configs, provider materializer attach targets, provider kind/role, source kind, and runtime transport kind.
- Trusted document host construction relies on broad casts in production adapters. The unique-symbol brand prevents accidental structural construction at compile time, but there is no source-owned factory/input contract that makes trusted construction auditable and no separate bootstrap host type for the iframe child path that currently stores `kernel: null as unknown`.

## Improvement objectives

1. Make `types/host/src` the executable source of truth for host boundary contracts, not just a collection of imported shapes.

2. Preserve strict dependency direction: `types-host` stays workspace-private, depends only on approved leaf type shards, and is never exposed in public SDK/embed declaration output or packed manifests.

3. Replace the root trusted re-export with an explicit export-surface policy that makes every supported subpath deliberate, testable, and aligned with `package.json` and import-boundary rules.

4. Strengthen trusted construction so branded host contexts are created through typed trusted-adapter factories, not repeated `as unknown` casts, while still keeping construction authority limited to allowed runtime/adapter/test modules.

5. Split protocol bootstrap hosts from fully kernel-backed document hosts so iframe/embed code cannot construct a nominal `TrustedDocumentHostContext` with a null kernel.

6. Expand the untrusted host contract from a placeholder into a redacted, nonce-bound, origin-validated protocol contract for iframe parents, external clients, plugins, and agents.

7. Centralize canonical fingerprint and proof helpers with purpose/domain separation, exact field sets, JSON-safe canonicalization, direct byte hashing for byte identities, and no duplicated canonical JSON implementations in production packages.

8. Make adapter binding registries fully typed: transport configs, provider materializer targets, provider kind/role, source kind, replay keys, and resolver results should be discriminated contract values rather than `unknown` or free strings.

9. Make diagnostics outcome-aware. Success, denial, validation failure, storage failure, import-source resolution, and operation authorization should have distinct event kinds or an explicit `outcome` field, with stable machine-readable codes.

10. Add type-level and runtime-validation fixtures that prove untrusted callers cannot obtain trusted authority, raw bytes cannot cross the untrusted boundary, and all production host-backed document construction still enters through `@mog/kernel-host-internal`.

## Production-path contracts and invariants to preserve or strengthen

Package and import surface:

- `@mog-sdk/types-host` remains workspace-private and must not resolve for external consumers.
- Public SDK/embed declaration output and packed manifests must not mention `@mog-sdk/types-host`.
- Host consumers must import explicit subpaths. Kernel must not import the root entry, `/trusted`, `/view`, or `/shell`.
- `/trusted` imports remain restricted to trusted adapter factories, runtime facades, and test fixtures.
- Test-only deterministic host helpers must not leak into declaration output or public package exports.

Trusted vs untrusted boundary:

- Untrusted callers may declare identity, requested operations, capabilities, or source handles only through protocol messages that a trusted host validates; declarations from untrusted payloads are not authority.
- Trusted host contexts carry validated session, principal, trust, diagnostics, kernel/runtime/view/shell slices, and a disposal contract.
- A fully typed `TrustedDocumentHostContext` must always include a real `KernelHostContext`. Protocol-only iframe bootstrap contexts need a different type until kernel authorization/storage handoff exists.
- No public or untrusted path may import or construct `KernelHostContext`, `AuthorizedDocumentStorageHandoff`, `HostKernelAdapterBindings`, provider materializers, source resolvers, or trusted host brands.

Authorization and handoff:

- Storage handoffs for create/open/import must carry decision id, correlation id, session id, nonce, expiry, principal, resource context, source host id, storage intent fingerprint, raw-byte policy, authorized provider refs, and storage config.
- Export handoffs must carry high-water proof, export path id, destination, content policy, export sink refs, materialization nonce, and expiry.
- Share/delete/destroy handoffs must remain separate from storage and export materialization handoffs.
- Handoff replay protection must consume nonce keys before materializing providers, resolving source bytes, or authorizing destructive operations.
- Expired handoffs fail closed. `expiresAt === now` is expired.
- Tenant and workspace marker objects are exact markers, not wildcards.
- Principal/session/resource/provider/source-handle tenant/workspace identities must match structurally or by canonical fingerprint where the production gate permits that fallback.

Raw bytes, storage, and source handles:

- Raw provider bytes may never reach untrusted clients.
- Import bytes must be obtained through single-use source-handle resolvers after issuer/session/source-host/principal/resource/expiry checks and content identity verification.
- Storage provider configs must contain redacted fingerprints and materialization refs, not raw secrets, credentials, raw URLs, host paths, callbacks, or byte buffers.
- Durable storage must not be accepted without matching authorized providers and required materializer availability.
- Provider materialization requests must join to the authorized handoff by decision id, nonce, expiry, principal fingerprint, resource context fingerprint, provider/source refs, storage scope, raw bytes policy, kind, role, and redacted config fingerprint.

Runtime and environment:

- Host-backed paths must not use process timezone implicitly; `HostTimezonePolicy.processTimezoneMayBeUsed` stays `false`.
- Runtime configs must resolve through registered transport bindings, and each binding must return the authoritative transport config for the runtime kind.
- Browser/worker asset URLs, CSP policy, node native addon resolution, Tauri IPC namespace, HTTP service policy, Python/PyO3, Rust library, and test runtime variants remain explicit.

Diagnostics and auditability:

- Rejection paths emit diagnostics before throwing.
- Success paths must not be encoded as denial/failure kinds.
- Diagnostic events should preserve correlation id, decision id, source host id, timestamp, operation, target, provider ref, policy/security event refs, and stable error/success codes.
- Diagnostic payloads must not include raw secrets, raw bytes, full provider configs, or unredacted external credentials.

Canonical fingerprints:

- Principal, resource context, storage intent, document ref, content policy, high-water proof, provider config, source content identity, replay key, and raw materialization proof fingerprints need explicit purpose/domain labels.
- Canonicalization must reject or normalize non-JSON-safe values intentionally. It must not silently turn functions, `undefined`, `NaN`, `Infinity`, symbols, callbacks, or byte buffers into ambiguous hashes.
- Byte identities should hash bytes directly, not `Array.from(bytes)` payloads, unless the contract explicitly says it fingerprints the JSON byte-list representation.

## Concrete implementation plan

### 1. Add a source-owned host export surface manifest

Create a small manifest module in `types/host/src`, for example `export-surface.ts`, that lists every intended package subpath, owning source file, consumer layer, and exposure policy:

- Root entry: intentionally empty or explicitly forbidden for production consumers.
- Trusted-only: `/trusted`.
- Kernel slices: `/kernel`, `/bindings`, `/identity`, `/storage`, `/runtime`, `/operations`, `/capabilities`, `/fingerprints`, `/trust`, `/diagnostics`.
- UI slices: `/view`, `/shell`, `/diagnostics`.
- Untrusted protocol: `/untrusted`.
- Internal-only source primitives: decide whether `source.ts` should become an exported `/source` subpath or remain reachable only through `/kernel` and `/bindings`.

Use the manifest to drive or verify:

- `types/host/package.json` `exports`.
- `types/host/src/index.ts` root policy.
- `tools/eslint-plugin-mog/import-boundaries.cjs` host subpath rules.
- external negative fixtures for root and subpath resolution.
- public package declaration leak checks for SDK/embed.

Specific surface fix: remove the root re-export of `TrustedDocumentHostContext`, `TrustedHostBase`, and `TrustedHostKind` from `index.ts` unless a deliberate root API is designed. Today that root export conflicts with the narrow-subpath architecture.

### 2. Introduce host primitive aliases and branded ids

Create a primitives module or colocated exports for repeated boundary ids:

- `HostId`
- `HostSessionId`
- `HostCorrelationId`
- `HostDecisionId`
- `HostNonce`
- `HostProtocolVersion`
- `HostProviderRefId`
- `HostSourceHandleId`
- `HostDocumentId`
- `HostTenantMarker`
- `HostWorkspaceMarker`
- `HostEpochMillis`

Keep these as type contracts and pair them with runtime validation helpers where production code receives untrusted input. Do not require public SDK callers to manufacture brands directly; trusted adapters and validation gates own construction.

Apply the aliases across `kernel.ts`, `bindings.ts`, `source.ts`, `identity.ts`, `capabilities.ts`, and `diagnostics.ts` so request/response contracts share one vocabulary for ids, nonces, timestamps, resource markers, and source/provider refs.

### 3. Formalize trusted construction without broad casts

Add a typed trusted-construction input in `/trusted`, for example `TrustedDocumentHostContextInput`, that is structurally identical to the unbranded context body but excludes the private brand.

Add a source-owned constructor function or factory interface:

- `createTrustedDocumentHostContext(input: TrustedDocumentHostContextInput): TrustedDocumentHostContext`
- or `TrustedHostFactory.createDocumentHost(input): TrustedDocumentHostContext`

Then update allowed trusted adapter factories to use the constructor:

- `shell/src/host-adapters/standalone-browser-host.ts`
- `runtime/sdk/src/host-adapters/node-headless-host.ts`
- `runtime/test-host/src/document-host.ts`
- `types/host/src/__tests__/deterministic-test-host.ts`

Keep authority controlled by existing import-boundary rules: only trusted adapter/test modules may import `/trusted`. Add lint fixtures proving ordinary kernel, shell component, view, app, and public package files cannot import the constructor.

For iframe/embed, do not force a null-kernel cast. Add a separate `TrustedProtocolHostContext` or `TrustedRuntimeHostContext` for the iframe child bootstrap path. It should carry `hostId`, `kind: 'iframe-child'`, trust profile, diagnostics, runtime policy, protocol state, and disposal, but it must not claim to be a full `TrustedDocumentHostContext` until it has a valid `KernelHostContext` and storage handoff.

### 4. Expand `/untrusted` into the actual untrusted protocol contract

Replace the placeholder `UntrustedHostClient` with a full but redacted protocol contract family:

- `UntrustedHostClientKind`
- `HostBoundaryProtocolVersion`
- `HostBoundaryChannelNonce`
- `UntrustedHostPeer`
- `HostBoundaryMessageEnvelope`
- `HostBoundaryRequest`
- `HostBoundaryResponse`
- `HostBoundaryError`
- `HostBoundaryOriginValidation`
- `UntrustedCapabilityDeclaration`
- `RedactedHostPolicySnapshot`
- `RedactedEffectiveHostState`

The protocol contract should encode these rules:

- Browser `MessageEvent.origin` is authoritative; claimed origins inside payloads are never trusted.
- Every message carries protocol version, channel nonce, message id, correlation id, direction, and timestamp.
- Parent iframe clients, HTTP clients, plugins, agents, and external API clients are untrusted by default.
- Untrusted messages may request operations or present source/capability handles, but trusted adapters must validate and convert them into host handoffs.
- Protocol messages may carry redacted workbook/effective-state policy, never raw storage configs, provider materializers, source resolvers, raw bytes, trusted principal proofs, or kernel context.

Migrate `runtime/embed/src/host-adapters/iframe-parent-client-placeholder.ts`, `runtime/embed/src/host-adapters/iframe-child-host.ts`, and `runtime/embed/src/iframe/protocol` toward these host contract types instead of private embed-only protocol shapes where the semantics overlap.

### 5. Centralize canonical fingerprint and proof helpers

Turn `fingerprints.ts` from a generic helper into a purpose-aware host proof module.

Add explicit fingerprint purposes and helper functions:

- `createPrincipalFingerprintProof(principal)`
- `createResourceContextFingerprintProof(resourceContext)`
- `createStorageIntentFingerprintProof(intent)`
- `createDocumentRefFingerprintProof(ref)`
- `createContentPolicyFingerprintProof(exportDetails)`
- `createProviderConfigFingerprintProof(redactedProviderConfig)`
- `createHighWaterProofFingerprintProof(proofPayload)`
- `createReplayKeyFingerprintProof(key)`
- `createSourceContentIdentityFingerprint(bytesOrIdentity)`

Each proof should include:

- `version`
- `algorithm`
- `purpose`
- `digest`
- `canonicalization`
- `coveredFields`
- `issuedBy`
- optional `expiresAt` or `sourceDecisionId` where proof freshness matters

Make purpose/domain separation part of the hashed payload. A principal payload and a resource-context payload with coincidentally identical fields must never hash to the same security-relevant proof.

Tighten canonicalization:

- Decide whether the implementation is real JCS/RFC 8785 or Mog stable canonical JSON. If it is not full RFC 8785, rename the `canonicalization` value instead of claiming JCS.
- Reject functions, symbols, `undefined` properties, `NaN`, `Infinity`, `-Infinity`, cyclic objects, `ArrayBuffer`, and `Uint8Array` unless a helper explicitly handles bytes.
- Keep deterministic object key sorting and stable array ordering.
- Add parser/validator helpers for `HostCanonicalFingerprint` and proof objects.

Replace duplicated production canonicalizers in:

- `kernel/host-internal/src/validate.ts`
- `kernel/src/document/host-storage-preflight.ts`
- `kernel/src/document/host-import-source.ts`
- `runtime/sdk/src/host-adapters/node-headless-host.ts`
- any adapter helper that compares resource scopes or source identities through local canonical JSON.

### 6. Tighten binding registry types

Replace `unknown` and free strings in `bindings.ts` with discriminated contracts:

- `HostTransportConfig`: browser, headless/node, Tauri, HTTP service, Python/PyO3, Rust library, and test transport config variants.
- `HostTransportKindForRuntime<R extends KernelRuntimeConfig['kind']>` mapping runtime kind to transport config kind.
- `HostProviderMaterializationTarget`: the minimal attach target interface expected by provider materializers, replacing raw `unknown`.
- `ProviderMaterializerRequest.kind: StorageProviderKind`
- `ProviderMaterializerRequest.role: StorageProviderRole`
- `SourceHandleKind`: `file-url`, `uploaded-bytes`, `host-callback`, `remote-object`
- `HostSourceHandleResolverRegistry.has(sourceKind: SourceHandleKind)`
- typed registry failure/result objects where production currently throws opaque `Error`.

Then update production bindings in standalone browser host, node headless host, runtime test host, and kernel validation so compile-time checking proves each runtime kind resolves to the correct transport config shape.

### 7. Split host context input, validation output, and operation gate contracts

Refactor `kernel.ts` into clearer source modules or internal sections while keeping package subpath compatibility:

- `session.ts`: session, clock, timezone, markers.
- `resource.ts`: document refs, resource contexts, source-handle refs.
- `authorization.ts`: authorization requests/decisions, operation-specific handoffs.
- `storage-handoff.ts`: storage intent, authorized providers, storage handoffs.
- `export-handoff.ts`: high-water proof, export content policy, export materialization.
- `lifecycle.ts`: `KernelHostDocumentInput`, `KernelDocumentLifecycleInput`, validated storage/runtime/bindings.
- `workbook-links.ts`: persisted link target and resolver.

If file splitting is not worth the package surface churn, keep `kernel.ts` as the public subpath barrel and move details behind source-local modules.

Strengthen operation typing:

- Define operation-indexed request and handoff maps so `HostDocumentAuthorizationRequest` is not a broad union requiring casts in adapters.
- Ensure create/open/import decisions always return `AuthorizedDocumentStorageHandoff`.
- Ensure export decisions always return `AuthorizedExportMaterializationHandoff`.
- Ensure share/delete/destroy decisions always return `AuthorizedDocumentManagementHandoff`.
- Add reusable type guards/assertions used by `kernel/src/document/host-operation-gate.ts` and adapter tests.

### 8. Make diagnostics outcome-aware and code-stable

Replace success-as-failure diagnostics with outcome-specific events or an explicit outcome model.

Recommended shape:

- `HostDiagnosticBase` gains `severity: 'debug' | 'info' | 'warn' | 'error'` and `outcome?: 'succeeded' | 'denied' | 'failed' | 'rejected'`.
- Failure events remain precise: `hostConstruction.invalid`, `storage.failure`, `documentAuthorization.denied`, `capability.denied`, `access.denied`, `runtime.assetFailure`.
- Success events get separate kinds, for example `hostConstruction.validated`, `storage.preflightSucceeded`, `importSource.resolved`, `operationAuthorization.succeeded`, `principalProjection.succeeded`.
- Codes become stable unions per family: `HostConstructionDiagnosticCode`, `StorageDiagnosticCode`, `ImportSourceDiagnosticCode`, `OperationAuthorizationDiagnosticCode`.

Update diagnostics sinks in standalone browser host, node headless host, runtime test host, and kernel tests so warning-level logging only applies to actual warnings/failures. Success should be info/debug.

### 9. Integrate the stronger contracts through production adapters

Update production host adapters in one pass after the contract changes:

- Standalone browser host:
  - use trusted constructor instead of cast.
  - use purpose-aware fingerprint helpers for principal, resource context, storage intent, provider redacted config, import source identity, and storage-scope comparisons.
  - type transport config and provider/source registries.
  - retain IndexedDB durable-local and skip-local-persistence behavior.

- Node headless host:
  - remove local canonical JSON and SHA-256 helpers in favor of `types-host/fingerprints`.
  - use trusted constructor instead of cast.
  - preserve explicit timezone requirement and same-principal local raw-byte boundary.

- Runtime test host:
  - reuse the production helpers so tests exercise the same contract primitives as adapters.
  - keep deterministic IDs/clocks but stop inventing separate fingerprint proof logic.

- Iframe embed:
  - replace `TrustedDocumentHostContext` null-kernel bootstrap with protocol/runtime host type.
  - use `/untrusted` protocol contracts for parent/child messages.
  - keep parent-origin validation based on `MessageEvent.origin` and validated `event.source`.

- Kernel host validation and operation gates:
  - consume typed transport configs and binding targets.
  - emit outcome-aware diagnostics.
  - use centralized fingerprint comparison helpers.
  - keep fail-closed behavior and replay consumption ordering unchanged.

### 10. Add contract fixtures and leak checks

Add source-owned tests and fixtures that prove the boundary is enforced:

- Export-surface test comparing manifest, `package.json` exports, and import-boundary allowed subpaths.
- Type tests showing root import does not expose trusted construction and `/trusted` cannot be imported from disallowed layers.
- Runtime validation tests for fingerprint parser/canonicalization rejection of non-JSON-safe values.
- Domain separation tests for principal/resource/storage/document/content-policy fingerprints.
- Adapter construction tests proving trusted adapters use the constructor and iframe bootstrap uses the protocol/runtime host type.
- Untrusted protocol tests proving raw bytes, provider materializers, kernel contexts, trusted principals, and storage handoffs are not part of allowed untrusted message payloads.
- Declaration leak fixtures proving `@mog-sdk/types-host` remains absent from public SDK/embed declaration output and packed manifests.

## Tests and verification gates

Do not stop at typecheck. The implementation should run the package-level behavior and type gates for every production path touched.

Primary type-host gates:

- `cd /Users/guangyuyang/Code/mog-all/mog/types/host && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/types/host && pnpm typecheck`

Host lifecycle and validation gates:

- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog/kernel-host-internal typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog-sdk/kernel test -- host-integration host-operation-gate host-storage-preflight host-import-source`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog-sdk/kernel typecheck`

Adapter and runtime gates:

- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog/test-host test`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog/test-host typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog/shell test -- standalone-browser-host`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog/shell typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog-sdk/node test`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog-sdk/node typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog-sdk/embed test`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm --filter @mog-sdk/embed typecheck`

Boundary and public-readiness gates:

- Run the import-boundary ESLint tests or the package that owns `tools/eslint-plugin-mog/import-boundaries.cjs` after updating host subpath rules.
- Run external negative fixtures for `fixtures/external/negative/types-star-import` and `fixtures/external/negative/types-host-import` so workspace-private host types still fail externally.
- Run SDK/embed declaration leak checks that validate `@mog-sdk/types-host` does not appear in public declaration output or packed manifests.
- Run `pnpm typecheck` from `/Users/guangyuyang/Code/mog-all/mog` after package-level gates, unless a future implementation plan explicitly narrows the type gate with an equivalent public declaration check.

Security-specific assertions to add:

- Untrusted protocol payloads cannot include `KernelHostContext`, `TrustedDocumentHostContext`, `HostKernelAdapterBindings`, `AuthorizedDocumentStorageHandoff`, provider materializers, source resolvers, raw bytes, or unredacted provider configs.
- Source-handle resolution consumes replay before resolver invocation.
- Provider materialization rejects mismatched decision id, nonce, principal fingerprint, resource context fingerprint, storage scope, kind, role, raw bytes policy, and redacted config fingerprint.
- Diagnostics success events are not logged as failure/denial kinds.
- Every canonical fingerprint helper has a domain-separation test and covered-field regression test.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Removing the root trusted export may break hidden internal imports not caught by the initial grep. The export-surface test and full `pnpm typecheck` should catch this; do not add a compatibility root shim.
- The trusted constructor must not become a public authority leak. It is acceptable only if `/trusted` import restrictions remain enforced and public declaration leak checks stay green.
- Canonicalization changes can alter fingerprint values. Migrate all production helpers in one coordinated change and update tests intentionally. Do not mix old and new fingerprint schemes in the same handoff.
- Purpose/domain-separated fingerprints may require recomputing expected hashes in tests and adapters. That is correct; the goal is stronger proofs, not hash compatibility.
- Byte hashing must be explicit. Hashing `Array.from(bytes)` and hashing raw bytes produce different identities; choose one contract per source identity and test it.
- Diagnostics event renames can affect logger tests and external observability assumptions. Keep event-code migration systematic and update all sinks together.
- Tightening `unknown` transport/provider types may reveal real adapter mismatches, especially the iframe child bootstrap path and test transport configs. Fix the adapter contracts rather than widening the types back to `unknown`.
- `types-host` is private but production-critical. A type-only package change can still break runtime if declaration identity or imports move in a way that build tooling does not expect.

Non-goals:

- Do not make `@mog-sdk/types-host` public.
- Do not expose raw host storage/provider/source contracts through `@mog-sdk/contracts`, `@mog-sdk/node`, `@mog-sdk/embed`, or public docs.
- Do not add compatibility shims for root imports. Prefer explicit subpaths and fix consumers.
- Do not weaken kernel validation, replay protection, raw-byte policy, storage preflight, or source-handle resolution to make adapters compile.
- Do not move implementation authority into `types-host`; runtime enforcement remains in trusted adapters, `@mog/kernel-host-internal`, and kernel gates.
- Do not treat the deterministic test host as the production path. It should exercise the same contracts, not define looser ones.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the export manifest and primitive names are agreed.

Recommended parallel tracks:

- Track A, export and lint surface: `types/host/src/index.ts`, `types/host/package.json`, `tools/eslint-plugin-mog/import-boundaries.cjs`, external negative fixtures, and declaration leak checks.
- Track B, fingerprint/proof contracts: `types/host/src/fingerprints.ts`, type-host tests, and replacement of duplicated canonicalizers in kernel, shell, SDK, and import/preflight code.
- Track C, trusted/untrusted boundary: `/trusted` constructor/input types, `/untrusted` protocol contracts, iframe child bootstrap type split, and embed protocol tests.
- Track D, binding and lifecycle typing: `bindings.ts`, `kernel.ts` lifecycle/authorization handoff maps, kernel-host-internal validation, source import, storage preflight, and operation gate tests.
- Track E, adapter migration: standalone browser host, node headless host, runtime test host, and iframe child/parent code.
- Track F, diagnostics: `diagnostics.ts`, kernel validation/preflight/import/operation gate diagnostics, adapter sinks, and logging tests.

Dependencies:

- `types/document/src/storage/*` remains the source for storage provider config, provider identity, durability, open intent, and lifecycle storage types. `types-host` should import those rather than redeclare provider config shapes.
- `kernel/host-internal/src/validate.ts` is the production validation gate and must be updated with any contract change that affects `KernelHostContext`, bindings, fingerprints, or diagnostics.
- `kernel/src/document/host-import-source.ts`, `host-storage-preflight.ts`, and `host-operation-gate.ts` are production behavior gates for source bytes, storage providers, and export/share/delete/destroy authorization.
- `runtime/embed` owns the actual iframe protocol implementation today; `/untrusted` should converge with it rather than creating a second protocol vocabulary.
- `runtime/sdk`, `shell`, and `runtime/test-host` are the trusted adapter factories that must migrate off broad casts and duplicated fingerprint code.
- Public package leak checks in `runtime/sdk`, `runtime/embed`, fixtures, package inventory, and publish-readiness tooling must stay green because `@mog-sdk/types-host` is workspace-internal.
