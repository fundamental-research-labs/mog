# 022 - Kernel Security Improvement Plan

## Source folder and scope

Source folder: `mog/kernel/src/security`

Queue item: 22

Scope: kernel-side capability and protection enforcement for the public-experimental `@mog-sdk/kernel/security` subpath and the production app-launch and capability-gated API paths that consume it. The implementation work should treat `kernel/src/security` as the canonical security facade and policy home, while coordinating the older `kernel/src/services/capabilities` implementation, `kernel/src/api/app/capability-gated`, and `shell/src/services/capabilities` consumers where needed to remove duplicate enforcement logic.

Files inspected:

- `kernel/src/security/index.ts`
- `kernel/src/security/capability-subject.ts`
- `kernel/src/security/capability-registry.ts`
- `kernel/src/security/grant-service.ts`
- `kernel/src/security/trust-policy.ts`
- `kernel/src/security/legacy-adapter.ts`
- `kernel/src/security/__tests__/*`
- `kernel/src/services/capabilities/*`
- `kernel/src/api/app/capability-gated/*`
- `shell/src/app-launcher/launch-app.ts`
- `shell/src/services/capabilities/registry.ts`
- `shell/src/hooks/use-app-kernel.ts`
- `types/app-platform/src/capabilities/types.ts`
- `types/app-platform/src/trust/types.ts`

## Current role of this folder in Mog

`kernel/src/security/index.ts` is the `@mog-sdk/kernel/security` public subpath. It intentionally exposes a restricted capability API: capability metadata, taxonomy expansion, `AppId`, grant and registry interface types, scoped helpers, gated API types, first-party detection, and audit query types. It deliberately does not export registry factories, store implementations, requesters, sensitive handlers, re-auth providers, or audit implementations.

The rest of `kernel/src/security` is a newer but currently isolated model:

- `capability-subject.ts` defines multi-field principals across package, app, plugin, instance, workspace, tenant, and resource binding fields.
- `capability-registry.ts` defines namespaced capability registration, namespace ownership, core capabilities, manifest validation, and transitive implications.
- `grant-service.ts` defines subject-keyed grants with expiration, negative decisions, and implied capability checks.
- `trust-policy.ts` defines package trust decisions and first-party, marketplace, local-dev, and enterprise policy rules.
- `legacy-adapter.ts` bridges bare app IDs to `CapabilitySubject`.

Production consumers currently use the public `@mog-sdk/kernel/security` barrel, but that barrel mostly re-exports the older `kernel/src/services/capabilities` app-ID-based model. The shell also implements its own `InMemoryShellCapabilityRegistry` with grant expansion, scope matching, audit events, expiry cleanup, and permissive mode. The kernel gated API uses the registry interface from `services/capabilities`, and launch flow first-party auto-grant policy still relies on shell-local constants plus `isFirstPartyApp`.

The net result is a split security architecture:

- Public-facing security facade: `kernel/src/security/index.ts`.
- Production grant enforcement: `kernel/src/services/capabilities/registry.ts`, `kernel/src/api/app/capability-gated/*`, and shell's duplicate registry.
- Unexported next-generation subject/trust model: local files in `kernel/src/security`.

## Improvement objectives

1. Make `kernel/src/security` the canonical contract boundary for capability identity, subjects, grants, trust decisions, registry events, and security audit metadata.

2. Collapse app-ID-only and subject-based authorization into one production model. Bare `AppId` callers may remain supported through a first-class subject normalization layer, but the internal enforcement contract should be `CapabilitySubject`.

3. Replace shell-local capability enforcement with kernel-owned services or a thin shell composition over kernel-owned services. Shell should provide storage, audit sink, UI, and host policy inputs, not reimplement grant matching semantics.

4. Strengthen the public `@mog-sdk/kernel/security` subpath so exported types match the production enforcement model and cannot drift from `types/app-platform`.

5. Preserve the intentional public surface boundary: expose stable types, pure helpers, and host-safe registry interfaces; keep store implementations, privileged factories, host policy constructors, and sensitive handlers behind internal or app-platform entrypoints.

6. Turn trust policy into an input to grant decisions, not a parallel service that is accepted by `CapabilityGrantService` but not used.

7. Make capability metadata registration complete enough for manifest validation and UI consent: namespace ownership, scope schema, implied and dependent capabilities, risk tier, stability tier, allowed subject kinds, and consent behavior.

8. Ensure all capability checks that gate real app API access pass through the same enforcement engine used by launch, permission settings, audit history, and app introspection.

## Production-path contracts and invariants to preserve or strengthen

Capability identity:

- Capability IDs must be validated against a single registry before a manifest, grant, or gated API check is accepted.
- Namespaced capability ownership must be deterministic. Once a namespace is claimed, another owner cannot register into it in the same session.
- Capability implications must be transitive, cycle-safe, and deterministic.
- Composite capability expansion and dependency expansion must have one canonical implementation.

Subject matching:

- Grants are constraints. Every field set on the grant subject must match the query subject.
- Query subjects may be narrower than grant subjects, but missing a grant-required field must not match.
- Empty/universal subjects must not be created accidentally by missing identity data. Host-facing factories should reject empty subjects unless an explicit system principal is requested.
- A derived grant must be equal to or stricter than the parent grant across subject and scope.

Grant decisions:

- `denied` and `revoked` records must never satisfy `hasCapability`.
- Expired grants must not satisfy checks or appear in active listings.
- More specific deny/revoke records must override broader allow records for the same capability.
- When multiple matching grants exist, resolution order must be explicit: exact subject before broader subject, negative decisions before positive decisions at equal or narrower specificity, then most-specific positive grant.
- Scope checks must be monotonic. Narrower scopes can reduce access but never widen access relative to the stored grant.

Trust policy:

- First-party auto-grants must be derived from package trust records and capability policy, not scattered hardcoded app ID sets.
- Marketplace and enterprise decisions must make consent and deny lists explicit per requested capability.
- Local-dev auto-grants must be bounded by an allowlist and must not silently bypass restricted capabilities.
- Trust source records should be auditable and deterministic for a package installation.

Gated API enforcement:

- `createCapabilityGatedApi` must only expose APIs whose required capabilities are granted for the calling subject.
- Every scoped API operation must re-check capability and resource scope at execution time, because grants can change after API construction.
- Introspection must report the same effective capabilities that enforcement uses.
- Subscriptions must be disposable; no new security API should add listener leaks.

Audit and events:

- Grant, revoke, expiry, denied check, passed check, and auto-grant events should share one event model.
- Audit entries must include subject identity, capability ID, decision source, resource scope, and operation metadata where available.
- App-level event compatibility can be derived from subject events, but subject events must be the canonical source.

Package boundaries:

- `mog` must not depend on `mog-internal`.
- Public examples and website must not depend on private planning content.
- `@mog-sdk/kernel/security` should expose safe contracts and pure helpers only.
- Host-only factories and persistence stores should remain behind internal or app-platform-specific entrypoints.

## Concrete implementation plan

### 1. Define the canonical security contract in `kernel/src/security`

Create a single exported contract set for capability IDs, metadata, subjects, grants, checks, trust decisions, audit entries, and registry events. Reconcile the overlapping types in `kernel/src/security/*`, `kernel/src/services/capabilities/*`, and `types/app-platform/src/*` so the names and fields are not subtly different.

Concrete decisions:

- Adopt `CapabilitySubject` as the enforcement principal.
- Keep `AppId` as a branded convenience identity, represented internally as `{ appId }`.
- Add explicit subject constructors: `appSubject`, `packageSubject`, `pluginSubject`, `instanceSubject`, `workspaceSubject`, `tenantSubject`, and `systemSubject`.
- Reject empty subjects from generic constructors unless the caller uses an explicit `systemSubject` factory.
- Use one `GrantDecision` union across kernel security and app-platform types.
- Use one capability metadata shape that includes both `implies` and `dependsOn` semantics, or explicitly derive one from the other during registration.
- Add compile-time tests that `@mog-sdk/kernel/security` and `types/app-platform` agree on shared public structures.

### 2. Make registry registration validate the full capability graph

Extend `CapabilityRegistryService` from metadata storage into a complete capability definition registry:

- Validate capability ID format and namespace ownership.
- Validate owner package is present and stable.
- Validate allowed subject kinds against actual subject fields.
- Validate scope schema shape and reject grants whose scopes do not match registered schema.
- Validate implied and dependent capabilities are known by the end of boot registration.
- Detect cycles and report them as explicit graph errors unless the chosen semantics allow cycles for implication; if cycles remain allowed, cache traversal must remain bounded and deterministic.
- Provide immutable snapshots for consent UI and manifest validation.

Implementation detail: split registration into boot phases:

1. Core definitions registered.
2. Package definitions registered.
3. Graph finalization validates cross-references and freezes the registry.

This avoids accepting a manifest against a partially registered graph.

### 3. Replace app-ID-only grant storage with subject-keyed grant storage

Promote `CapabilityGrantService` into the production grant engine and make the old app-ID registry compose over it rather than duplicate it.

Required changes:

- Store grants by normalized subject key plus capability ID.
- Add a grant resolution algorithm that evaluates all matching grants and chooses the correct result by specificity, decision polarity, expiration, and scope.
- Add support for explicit denial records as first-class grants, not just absent permissions.
- Integrate registered capability metadata so unknown capabilities cannot be granted or checked as successful.
- Validate `allowedSubjectKinds` before granting.
- Validate scope against the registered capability schema before granting.
- Add `listEffectiveCapabilities(subject)` and `getEffectiveGrant(subject, capability)` so gated API and UI settings can share exactly the same computed view.
- Emit subject-level grant change events and derive app-level events for existing shell/hooks consumers during the migration.

The current `trustPolicy` field in `CapabilityGrantService` should become active. Grant creation should require either a user/admin decision, a trusted auto-grant decision, or an explicit migration/system source. The service should refuse auto-grants that trust policy does not allow.

### 4. Unify legacy `services/capabilities` with `security`

Move the production implementation boundary toward `kernel/src/security` and reduce `kernel/src/services/capabilities` to compatibility re-exports or lower-level helpers where they still make architectural sense.

Recommended end state:

- `kernel/src/security/index.ts` exports the canonical safe security API.
- `kernel/src/services/capabilities/index.ts` either re-exports from `kernel/src/security` or narrows to app-platform internals that have a documented reason to stay under services.
- `CapabilityRegistry` and `ICapabilityRegistry` become subject-aware internally.
- Old app-ID methods remain as thin overloads or adapters only where production callers still hold only `AppId`.
- `CAPABILITY_REGISTRY`, `CAPABILITY_IMPLIES`, and registered `CORE_CAPABILITIES` are reconciled into one source of truth.

Do this as a direct consolidation, not by adding another parallel facade.

### 5. Replace shell duplicate enforcement

Refactor `shell/src/services/capabilities/registry.ts` so it no longer owns independent grant matching, implication expansion, expiry filtering, audit event emission, or permissive semantics.

Target structure:

- Shell creates a kernel security registry/grant service using shell-provided storage and audit sink.
- Shell-specific audit log implementation remains in shell.
- Shell permission settings and consent UI consume `@mog-sdk/kernel/security` metadata and event contracts.
- Shell permissive mode, if still required for trusted host flows or tests, is implemented as an explicit kernel security policy object with a clear name and audit event, not a hidden bypass in shell registry code.

This removes the current risk that shell and kernel disagree about whether an app has a capability.

### 6. Route launch and gated API through subject-aware checks

Update `shell/src/app-launcher/launch-app.ts`, `shell/src/hooks/use-app-kernel.ts`, `shell/src/host/AppSlot.tsx`, and `kernel/src/api/app/capability-gated/*` to create and pass a `CapabilitySubject` that includes package, app, instance, workspace, and tenant where available.

Launch flow should:

- Validate manifest capability declarations against the finalized registry before consent.
- Evaluate package trust once per install/enable attempt.
- Apply auto-grants only through `CapabilityGrantService` with a trust decision.
- Record denials and cancellation decisions.
- Return denied capability IDs and reason metadata for UI and audit.

Gated API should:

- Accept a subject-aware registry/checker.
- Re-check operation capabilities through the same `hasCapability(subject, capability, scope)` path used by launch.
- Keep current API hiding behavior for missing interfaces.
- Preserve managed table restrictions as an additional scope constraint, not a separate authorization system.

### 7. Strengthen audit and event contracts

Extend audit entries and events to include:

- Subject key and structured subject fields.
- Capability ID.
- Decision source.
- Check result.
- Resource type and resource ID.
- Operation name.
- Trust source for auto-grants.
- Manifest/package identifiers when the event came from launch or install.

Provide query helpers for:

- app-scoped history;
- subject-scoped history;
- capability-scoped history;
- denied access attempts;
- auto-grant and trust-policy decisions.

Use the same event names for public app-level consumers only as derived compatibility events. The canonical event stream should be subject-aware.

### 8. Harden public exports and negative boundaries

Update `kernel/src/security/index.ts` and package export tests so:

- Safe public exports include canonical types, pure subject helpers, metadata lookup, manifest validation result types, readonly introspection interfaces, audit query result types, and host-safe event types.
- Unsafe exports are still absent from `@mog-sdk/kernel/security`: mutable stores, concrete grant store factories, sensitive handlers, re-auth providers, privileged trust-policy constructors, and host bypass/permissive factories.
- `@mog-sdk/kernel/services/capabilities` either remains an explicitly internal export or is documented and tested as a lower-level host integration surface.

Add negative boundary tests similar to existing SDK conformance tests that assert forbidden exports remain absent.

### 9. Update docs and architecture notes

Update public architecture docs after implementation:

- `docs/architecture/os/kernel.md` should describe `kernel/src/security` as the canonical capability and protection enforcement subpath, not just a public-experimental facade.
- Add a short security model document near the code that defines subject matching, grant resolution, trust decisions, scope narrowing, and public export boundaries.
- Document how shell, host lifecycle, and app-platform code are expected to construct subjects.

Docs should describe the production path, not a future-only model.

## Tests and verification gates

Unit tests in `kernel/src/security`:

- Subject construction rejects accidental empty subjects and preserves deterministic keys.
- Subject matching covers app, plugin, instance, workspace, tenant, and resource binding combinations.
- Grant resolution covers exact versus broad grants, denial override, revoked override, expiration, specificity ordering, implied capabilities, unknown capability rejection, and scope schema validation.
- Registry finalization covers namespace ownership, duplicate IDs, unknown implied/dependent capabilities, cycle handling, immutable snapshots, and manifest validation.
- Trust policy covers first-party, marketplace, enterprise, local-dev, unknown source, restricted capabilities, and auto-grant refusal.
- Audit/event tests cover subject-level event payloads and derived app-level compatibility events.

Kernel app API tests:

- `createCapabilityGatedApi` exposes only granted interfaces for subject-aware checks.
- Every scoped operation still re-checks grants at execution time after a revoke.
- Managed table IDs combine with capability scopes by intersection, never union.
- Introspection `has`, `list`, `getScope`, and `hasAccessTo` match the grant service effective view.
- Listener cleanup tests ensure no added subscription leaks.

Shell production-path tests:

- `launchApp` validates manifests before consent.
- First-party auto-grants are driven by trust policy rather than hardcoded shell sets.
- Marketplace apps require user consent and cannot receive restricted capabilities.
- Denied required capabilities block launch and record denial/audit data.
- `useAppKernel` rebuilds the gated API from subject-aware events.
- Permission settings and audit history render from the canonical security metadata and audit model.

Contract and boundary tests:

- Public `@mog-sdk/kernel/security` export smoke test includes the new safe contracts.
- Negative export tests assert stores, privileged factories, sensitive handlers, re-auth providers, and bypass policies are not exported from the public security subpath.
- Type-level compatibility tests assert kernel security shared types are assignable to `types/app-platform` shared types, or that `types/app-platform` directly re-exports the kernel security contracts.

Verification commands for the eventual implementation:

- `cd mog/kernel && pnpm test -- security`
- `cd mog/kernel && pnpm test -- capability-gated`
- `cd mog/kernel && pnpm test -- sdk-security`
- `cd mog/kernel && pnpm typecheck`
- `cd mog/shell && pnpm test -- capabilities`
- `cd mog/shell && pnpm test -- launch-app`
- `cd mog/shell && pnpm test -- use-app-kernel`
- `cd mog/shell && pnpm typecheck`
- Repo-level `pnpm typecheck` from `mog` after cross-package export changes.

Run browser or integration verification for UI-facing permission flows if the implementation changes consent dialogs, app launch behavior, or settings screens.

## Risks, edge cases, and non-goals

Risks:

- Public export changes can accidentally expose privileged factories or concrete stores.
- Changing the registry interface can break shell, app launcher, app gated API, fixtures, and SDK conformance tests at once.
- Subject matching can accidentally create broad grants if identity fields are missing.
- Denial precedence can be ambiguous without an explicit resolution order.
- Scope intersections can become too permissive if managed table restrictions and grant scopes are checked independently.
- Trust policy can silently become advisory if grant paths can still bypass it.
- Shell permissive mode can hide production bugs if it remains available outside explicit trusted contexts.

Edge cases to test explicitly:

- Empty subject construction.
- App-level allow plus instance-level deny.
- Package-level allow plus plugin-level deny.
- Workspace grant queried from a different tenant.
- Expired deny and expired allow records.
- Capability implication cycles.
- Unknown capability in manifest, grant, check, and implication metadata.
- Scoped grant with no scope query.
- Scope query against unscoped grant.
- Managed table ID outside declared grant scope.
- Revocation of a dependency capability that should revoke or invalidate dependents.
- Multiple packages trying to claim one namespace in the same batch.

Non-goals:

- Do not add a second security facade beside `kernel/src/security`.
- Do not optimize test-only registries or mocks.
- Do not preserve duplicate shell enforcement as a long-term compatibility shim.
- Do not expose privileged stores or host bypass factories from `@mog-sdk/kernel/security`.
- Do not introduce dependency from public `mog` code to `mog-internal`.
- Do not make app-facing APIs throw permission errors as the primary missing-capability UX; preserve the current interface-hiding model and use operation-time checks for revocation and scoped access.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the canonical contract is drafted.

Suggested parallel tracks:

- Contract track: own `kernel/src/security` shared types, subject helpers, registry metadata shape, and public barrel boundaries.
- Grant engine track: own subject-keyed grant service, resolution algorithm, denial precedence, scope validation, and event emission.
- Capability graph track: own registry finalization, namespace validation, implications/dependencies, and manifest validation.
- Gated API track: own `kernel/src/api/app/capability-gated` subject-aware integration and operation-time checks.
- Shell integration track: own `shell/src/services/capabilities`, launch flow, hooks, permission settings, and audit UI migration to kernel-owned enforcement.
- Type/package track: own `types/app-platform` reconciliation and package export boundary tests.
- Verification track: own cross-package test matrix, SDK conformance updates, and UI behavior checks.

Dependencies:

- `kernel/src/services/capabilities`: current production grant registry, metadata, taxonomy, scope, stores, audit, requester, and gated API types.
- `kernel/src/api/app/capability-gated`: production capability-gated API creation and scoped operation checks.
- `shell/src/services/capabilities`: duplicate production shell registry that must be retired or reduced to composition.
- `shell/src/app-launcher`: production consent and auto-grant path.
- `shell/src/hooks` and `shell/src/host`: app API rebuild and host app slot wiring.
- `types/app-platform`: overlapping capability and trust contracts that should be unified or made assignable.
- `docs/architecture/os/kernel.md`: architecture reference that should describe the final production security model.

Ordering:

1. Freeze the canonical contracts and public/private export boundary.
2. Implement registry graph validation and subject-safe constructors.
3. Implement grant resolution and trust-policy enforcement.
4. Adapt old app-ID registry interface over subject-based services.
5. Migrate gated API and launch flow.
6. Replace shell duplicate registry with kernel composition.
7. Reconcile type package exports.
8. Update docs and run the full verification matrix.
