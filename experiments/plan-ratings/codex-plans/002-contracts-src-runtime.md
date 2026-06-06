# Improve `mog/contracts/src/runtime`

## Source folder and scope

Source folder: `mog/contracts/src/runtime`

Queue item 2 covers the runtime-facing lifecycle and host integration contracts in the public Mog repository. The current folder contains:

- `asset-manifest.ts`
- `audit-event.ts`
- `error-envelope.ts`
- `service-config.ts`
- `index.ts`

The plan is scoped to the public contracts surface for runtime hosts, self-host deployments, runtime assets, service error envelopes, audit events, and host/service lifecycle metadata. It intentionally treats `mog/contracts/runtime-services/src` as an adjacent dependent workstream because it currently duplicates some of the same audit and error contracts while also defining service boundary, protocol version, and deployment health types.

## Current role of this folder in Mog

`contracts/src/runtime` is a public-source contract island for runtime configuration and host/service integration. It defines type-only interfaces for:

- Runtime asset delivery, including wasm, workers, native add-ons, fonts, and base URLs.
- Runtime error envelopes with categories, retryability, HTTP status, request IDs, trace IDs, and details.
- Runtime audit events with tenant/workspace/document scope, actor, operation, decision references, and redacted metadata.
- Self-host service configuration across auth, storage, collaboration, runtime assets, limits, observability, and security.

The folder is currently under-specified for its role:

- `@mog-sdk/contracts` does not appear to expose a `./runtime` subpath in `contracts/package.json`, so these contracts are not yet a clean public import target.
- `contracts/src/index.ts` does not re-export this folder, so consumers cannot rely on the top-level public package for these types either.
- The contracts are type-only and provide no runtime validation or normalization for host boundaries that receive JSON config, asset manifests, HTTP errors, or audit events.
- `contracts/runtime-services/src` duplicates `RuntimeErrorEnvelope`, `RuntimeAuditEvent`, `DeploymentProfile`, and related service lifecycle concepts, creating a source-of-truth risk between a public contracts folder and a private runtime-service-contracts package.

## Improvement objectives

1. Make `@mog-sdk/contracts/runtime` the canonical public runtime contract module for host integration, self-host configuration, runtime asset manifests, audit envelopes, error envelopes, service lifecycle, deployment health, and protocol handshakes.
2. Remove duplicated contract definitions between `contracts/src/runtime` and `contracts/runtime-services/src` by choosing `contracts/src/runtime` as the source of truth for public runtime contracts and migrating internal consumers to that surface.
3. Add executable, zero-dependency boundary validation for JSON-facing runtime contracts so production hosts can reject malformed configs, unsafe diagnostics, invalid asset manifests, and unsanitized error/audit payloads before they cross service or package boundaries.
4. Strengthen versioning and compatibility semantics for runtime contracts, including config schema version, protocol version, manifest version, and error/audit envelope versions.
5. Preserve public package runtime self-containment: generated `dist` artifacts must not import private workspace packages or runtime-only implementation helpers.
6. Make the contract surface easy to verify with package exports, declaration identity checks, import fixtures, validator unit tests, and downstream runtime host fixtures.

## Production-path contracts and invariants to preserve or strengthen

- Public runtime contracts must be importable from stable public specifiers, preferably `@mog-sdk/contracts/runtime` plus intentionally selected granular subpaths.
- Public `@mog-sdk/contracts` artifacts must remain self-contained at runtime and must not import `@mog-sdk/runtime-service-contracts`, private `@mog/types-*` shards, or implementation packages.
- Secret-bearing fields must remain references, not raw secret strings. `SecretRef` must keep credentials out of diagnostics, logs, audit metadata, and error details.
- `AssetLocation` must be explicit: an asset is either local-path based or URL based, not both silently, and not neither.
- Asset manifests must identify schema/version, base URL semantics, integrity algorithm, wasm feature requirements, worker type, native platform/arch/libc/ABI target, and font family/style/weight without ambiguity.
- Runtime error envelopes must preserve machine-readable `code`, retry semantics, category, request/trace correlation, and sanitized structured details. HTTP status and category must not contradict each other.
- Audit events must preserve immutable event ID, ISO timestamp, tenant scope, actor identity, service, operation, outcome, request/trace correlation, and capability/materialization decision references. Redacted metadata must never carry secrets, credentials, raw bytes, formulas, or PII beyond the configured redaction policy.
- Service configuration must make topology-sensitive requirements enforceable: horizontal collaboration needs a broker, TLS client auth needs CA material, secure cookies and `SameSite=None` require secure transport, air-gapped profiles cannot require remote asset URLs unless explicitly mirrored, and storage encryption requires a key reference.
- Duration and byte fields must have clear units and sane lower/upper bounds; existing `Seconds`, `Ms`, and `Bytes` suffixes should be preserved or added consistently.
- Deployment health/readiness/diagnostics must be safe for admin and ops surfaces and must not expose raw connection strings, secrets, or unsanitized config.
- Protocol handshakes must make major-version incompatibility explicit and must distinguish compatible, upgrade-required, and incompatible peers without free-text parsing.

## Concrete implementation plan

1. Establish the public module boundary.
   - Add a `./runtime` export to `contracts/package.json` pointing to `src/runtime/index.ts` in development and `dist/runtime/index` outputs in published builds.
   - Decide whether granular subpaths such as `./runtime/error-envelope`, `./runtime/audit-event`, `./runtime/asset-manifest`, and `./runtime/service-config` are needed by downstream hosts. Add only those that have real consumer value and fixture coverage.
   - Keep top-level `@mog-sdk/contracts` re-exports conservative to avoid polluting the broad root module; prefer the explicit `@mog-sdk/contracts/runtime` subpath for host/runtime contracts.

2. Make `contracts/src/runtime` the source of truth.
   - Move or recreate the richer documented concepts from `contracts/runtime-services/src` in `contracts/src/runtime`: service boundary contracts, protocol version handshake, service health, readiness, diagnostics, and deployment profile.
   - Replace duplicated `RuntimeErrorEnvelope`, `RuntimeAuditEvent`, and `DeploymentProfile` definitions with one canonical public definition in `contracts/src/runtime`.
   - Migrate internal references to import public runtime contracts from `@mog-sdk/contracts/runtime` once the subpath is exported.
   - Remove the private duplicate package if no longer needed. If package-project structure still requires it, change the architecture so it owns only truly private service-only contracts that are not public runtime contracts.

3. Introduce explicit runtime contract versions.
   - Add constants such as `MOG_RUNTIME_CONFIG_SCHEMA_VERSION`, `MOG_RUNTIME_ASSET_MANIFEST_SCHEMA_VERSION`, `MOG_RUNTIME_ERROR_ENVELOPE_VERSION`, and `MOG_RUNTIME_AUDIT_EVENT_VERSION`.
   - Add version fields to config/manifest/envelope shapes where JSON compatibility needs to be negotiated.
   - Define compatibility rules for protocol versions: same major version can be compatible subject to minimum minor/patch requirements; different major versions are incompatible unless explicitly declared.

4. Add zero-dependency validators and normalizers for JSON boundaries.
   - Add narrow runtime-value helpers in `contracts/src/runtime` rather than bringing in a schema library dependency.
   - Provide validators for `MogSelfHostConfig`, `RuntimeAssetManifest`, `RuntimeErrorEnvelope`, `RuntimeAuditEvent`, `ProtocolHandshake`, `ServiceHealth`, `ServiceReadiness`, and `ServiceDiagnostics`.
   - Return typed validation results with path-addressed failures, not boolean-only checks, so host code can surface actionable config and manifest errors.
   - Add normalizers only where they are contract-preserving, for example resolving manifest asset URLs against `baseUrl` or defaulting optional timeout values. Do not silently accept invalid shape variants.

5. Strengthen `service-config.ts` shape correctness.
   - Split broad config sections into discriminated unions where provider-specific requirements exist: object store providers, metadata DB providers, auth adapters, audit/log/metrics/trace sinks, and collaboration brokers.
   - Enforce profile-specific invariants in validators: `local-dev`, `single-node`, `horizontal`, and `air-gapped` each need different service discovery, TLS, storage, broker, and asset-source requirements.
   - Replace ambiguous `string` discriminants that represent fixed taxonomies with exported literal unions, for example service names, actor types, principal types, provider types, and diagnostics redaction levels.
   - Ensure all secret-adjacent fields use `SecretRef` or redacted values and that diagnostics snapshots cannot be typed as accepting raw secrets.

6. Strengthen asset manifest contracts.
   - Require every runtime asset entry to have a stable ID, kind, version or content fingerprint, source location, and optional integrity metadata with an explicit algorithm.
   - Model wasm variants as a discriminated set of feature requirements rather than loose `simd` and `threading` booleans only.
   - Model native add-ons with platform, arch, libc, ABI, and optional minimum runtime version so Node/Tauri hosts can reject incompatible assets before loading them.
   - Make worker assets specify module/classic type, entry role, and same-origin/CORS expectations where relevant.

7. Strengthen error and audit contracts.
   - Define a stable error-code taxonomy and category-to-status compatibility table for runtime services.
   - Add helper constructors or normalizers for safe error envelopes that require category, retryability, code, and correlation IDs while applying detail redaction.
   - Define audit event resource scope as a reusable contract instead of spreading tenant/workspace/document fields ad hoc.
   - Add redaction-safe metadata value constraints and validator checks for forbidden keys and forbidden value shapes.

8. Wire production consumers to the public surface.
   - Audit runtime consumers in `runtime/sdk`, `runtime/embed`, `runtime/spreadsheet-app`, `shell`, `kernel`, and self-host/server packages for locally defined config, manifest, error, audit, health, or protocol shapes.
   - Replace local duplicate types with imports from `@mog-sdk/contracts/runtime`.
   - Keep runtime implementation logic in the implementation packages; only contracts, constants, validators, and contract-preserving normalizers belong in `contracts/src/runtime`.

9. Update public package fixtures and release gates.
   - Add consumer fixtures that import `@mog-sdk/contracts/runtime` and granular subpaths if exported.
   - Extend `verify-runtime-exports.mjs` or add a runtime-specific gate so public runtime validators and constants are present in built artifacts.
   - Ensure `check-contract-runtime-imports` still proves runtime artifacts are self-contained after adding validator runtime values.
   - Add declaration identity coverage for the new runtime subpath so `src` and `dist` public types remain aligned.

## Tests and verification gates

The implementation should run these gates before it is considered complete:

- `pnpm --filter @mog-sdk/contracts test`
- `pnpm --filter @mog-sdk/contracts typecheck`
- `pnpm --filter @mog-sdk/contracts build`
- `pnpm check:contracts-runtime-inventory`
- `pnpm check:contract-runtime-imports`
- `pnpm check:publish-readiness:fast` if package exports or declaration rollups changed
- `pnpm --filter @mog-sdk/runtime-service-contracts typecheck` while that package still exists
- Consumer fixture verification that imports `@mog-sdk/contracts/runtime`, parses representative self-host config JSON, validates a runtime asset manifest, creates a runtime error envelope, and validates an audit event
- Production-path smoke verification in the relevant runtime host after wiring consumers, using the actual runtime bootstrap/config path rather than direct state mutation

Validator-specific test coverage should include:

- Valid and invalid `SecretRef` variants.
- `AssetLocation` with path only, URL only, both, and neither.
- Horizontal collaboration without a broker.
- Air-gapped config with remote assets.
- TLS client auth without CA material.
- Secure cookie and `SameSite=None` combinations.
- Error envelope category/status mismatches and retryability expectations.
- Audit metadata containing forbidden secret-like keys or raw-byte-like payloads.
- Manifest wasm threading/SIMD/native ABI compatibility cases.
- Protocol handshakes for compatible, upgrade-required, and incompatible versions.

## Risks, edge cases, and non-goals

- Risk: making `./runtime` public freezes a long-lived API surface. Mitigation: ship explicit schema/protocol versions and declaration fixtures before wiring broad consumers.
- Risk: validators can drift from TypeScript interfaces. Mitigation: colocate validators with the contracts, test positive and negative fixtures, and include public import fixtures in publish readiness.
- Risk: duplicating public and private runtime-service contracts can create silent divergence. Mitigation: choose one source of truth in `contracts/src/runtime` and remove duplicate definitions instead of adding compatibility aliases.
- Risk: validators may accidentally permit unsafe diagnostics, audit metadata, or error details. Mitigation: make redaction invariants part of validator tests and production host tests.
- Risk: package export changes can break declaration rollups or external import maps. Mitigation: add fixtures before release and keep explicit subpath exports.
- Edge case: browser, Node, Tauri, and air-gapped deployments have different asset resolution rules. The manifest contract must represent those differences without assuming one host.
- Edge case: local development may intentionally use insecure origins or local object stores. Profile-aware validation should allow this only under the `local-dev` profile.
- Non-goal: implementing runtime services, storage providers, auth providers, or collaboration brokers.
- Non-goal: changing spreadsheet UI behavior except where runtime host configuration is exercised through the actual production bootstrap path.
- Non-goal: introducing a schema library dependency into `@mog-sdk/contracts` unless a separate architecture decision approves it.
- Non-goal: preserving duplicate private package contracts as long-term compatibility shims.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the source-of-truth decision is made:

- Agent A: audit consumers in `runtime/sdk`, `runtime/embed`, `runtime/spreadsheet-app`, `shell`, and `kernel` for duplicate config, asset, error, audit, health, and protocol shapes.
- Agent B: implement the `contracts/src/runtime` contract expansion, version constants, validators, and validator tests.
- Agent C: update public package exports, declaration fixtures, runtime export verification, and publish-readiness gates.
- Agent D: coordinate with queue item 4, `mog/contracts/runtime-services/src`, to remove duplicated audit/error/deployment/protocol definitions and keep only genuinely private service-only contracts if any remain.
- Agent E: wire production runtime hosts to `@mog-sdk/contracts/runtime` and exercise the real bootstrap/config paths.

Dependencies:

- Queue item 4, `mog/contracts/runtime-services/src`, is the main architectural dependency because it currently overlaps this folder.
- Queue items 58-60, `runtime/embed`, `runtime/sdk`, and `runtime/spreadsheet-app`, are production consumers for asset manifests and bootstrap/runtime options.
- Queue items 66-67 and 99, `shell/src/platform`, `shell/src/services`, and `shell/src/host`, are likely consumers for lifecycle, diagnostics, errors, and audit integration.
- Queue items 3 and 22, `contracts/src/security` and `kernel/src/security`, should align with audit decision references, redaction policy, and capability-related audit fields.
