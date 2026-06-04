# 006: Improve `mog/types/app-platform/src`

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/types/app-platform/src`

Scope: the workspace-internal `@mog-sdk/types-app-platform` package source for app and plugin platform extension contracts. The package currently exposes subpaths for manifest, package, lifecycle, routing, services, capabilities, contributions, plugins, trust, and manifest validation. It is marked `private: true` and `workspace-internal`; the improvement should not turn it into a shipped third-party plugin SDK.

## Current role of this folder in Mog

This folder is intended to be the canonical, product-neutral contract package for Mog's future app/plugin platform. Its top-level comment explicitly limits it to TypeScript types, validators, and pure helpers with no React, shell implementation, kernel internals, or runtime-specific imports.

The package already has a good modular outline, but production shell platform code is not yet using it as the source of truth. `shell/src/platform/types.ts` still carries a local mirror "until `@mog-sdk/types-app-platform` is published", and that mirror has drifted from this folder in manifest shape, plugin identity fields, contribution fields, stability tiers, resource binding shapes, route snapshots, host service method names, timestamp types, and validator behavior. The result is that the package looks canonical, while the production activation, package registry, contribution resolver, and host service paths execute against a separate contract.

## Improvement objectives

1. Make `types/app-platform/src` the single source of truth for app/plugin platform contracts used by the shell production path.
2. Replace duplicated enum literals and shallow validation with shared contract constants plus complete pure validators for manifests, plugins, capabilities, contributions, package records, routing/resource bindings, lifecycle snapshots, and trust decisions.
3. Convert ambiguous structural contracts into discriminated or otherwise verifiable contracts, especially capability subjects, contribution declarations, plugin manifests, and app-facing versus host-internal resource binding records.
4. Add package-local contract tests and shell conformance tests that prove the canonical package, generated declarations, and shell production behavior agree.
5. Preserve the package boundary: workspace-internal, contracts-only, dependency-free, serializable across same-realm, iframe, worker, server, and remote bridge host modes.

## Production-path contracts and invariants to preserve or strengthen

- `@mog-sdk/types-app-platform` must not import React, shell implementation, kernel, views, runtime SDKs, or private app code.
- All app/plugin manifests accepted by the package registry must pass the canonical validators before registration, launch, activation, contribution resolution, or capability grants.
- Manifest validation must be deterministic, path-addressed, and machine-readable: stable diagnostic codes, severity, JSON-path-like locations, and no host-specific side effects.
- Branded IDs should be validated at construction boundaries, not just cast from arbitrary strings. App, package, plugin, capability, contribution point, and instance IDs need documented regexes and tests.
- Capability grants must identify exactly one allowed principal shape and must not allow impossible "empty subject" or multi-principal records unless the contract explicitly models composite subjects.
- Contribution resolution must remain deterministic and data-only. Ordering, override policy, duplicate IDs, shortcut conflicts, schema version compatibility, required capabilities, and contributor kind checks should all be contract-tested.
- Public app-facing snapshots must not expose lease IDs, grant internals, policy internals, or host-only resource references.
- Plugin isolation and runtime host modes may be declared beyond current implementation, but production activation must explicitly reject unsupported modes with canonical denial states and diagnostics.
- The package remains private/reserved; docs may describe internal scaffolding, but must not present a public plugin authoring flow until the runtime host, distribution, signing, and sandbox bridges exist.

## Concrete implementation plan

1. Inventory and freeze the canonical contract matrix.
   - Produce a table comparing `types/app-platform/src/**` against `shell/src/platform/types.ts`, `shell/src/platform/validation.ts`, `shell/src/platform/manifest-validator.ts`, `shell/src/platform/contribution-point-registry.ts`, `shell/src/platform/contribution-resolver.ts`, `shell/src/platform/plugin-activation-manager.ts`, `shell/src/platform/isolation-enforcer.ts`, and `shell/src/platform/host-services.ts`.
   - Decide each divergent field once, based on production semantics, then update the canonical package and shell together. Do not keep dual names such as `id` plus `pluginId`, `targetPointId` plus `targetContributionPointId`, or sync plus async storage APIs as compatibility shims.

2. Add shared contract constants and validated constructors.
   - Export readonly arrays/sets for app kinds, runtime host modes, stability tiers, risk tiers, subject kinds, contribution kinds, override policies, ordering policies, plugin isolation modes, extension targets, activation events, access modes, setup policies, lease states, package states, package sources, review statuses, trust sources, and validation severities.
   - Make `createAppId`, `createPackageId`, `createPluginId`, `createCapabilityId`, `createContributionPointId`, and `createAppInstanceId` validate format before branding, with package-local tests for accepted and rejected IDs.
   - Keep helpers pure and dependency-free; use shared constants in validators and generated declarations instead of duplicated literal arrays.

3. Complete the validation layer.
   - Keep `validateAppManifest` but expand it to validate nested `entry`, `compatibility`, `capabilities`, `routes`, `data`, `contributions`, `lifecycle`, and `runtimeHost` shapes fully.
   - Add validators/type guards for `PluginManifest`, `CapabilityMetadata`, `CapabilityGrant`, `ContributionPointRegistration`, `ContributionDeclaration`, `PackageInstallationRecord`, `RouteSnapshot`, `ResourceBindingDescriptor`, `AppInstanceSnapshot`, and trust policy decisions.
   - Validate semver ranges, ISO timestamps, duplicate IDs, duplicate route paths, capability dependency/implied-capability graph cycles, contribution schema versions, and disallowed host-internal fields in public app snapshots.
   - Standardize `ValidationResult` across the package as `{ valid, errors, warnings }` with canonical diagnostic codes; have shell adapters map only at UI display boundaries if needed.

4. Strengthen the type model where runtime invariants are currently under-specified.
   - Change `CapabilitySubject` into a discriminated union keyed by `kind: SubjectKind`, with required fields per subject kind.
   - Introduce an explicit union for concrete contribution declarations instead of accepting a base declaration that can omit kind-specific required fields.
   - Separate manifest-authored route declarations from resolved runtime `RouteSnapshot` and resource binding descriptors from resolved host leases.
   - Ensure `PluginManifest` contains the full activation contract needed by `PluginActivationManager`: identity, version, host compatibility, extension targets, entry descriptor, contributions, capabilities, activation events, and isolation mode.

5. Migrate shell production code to the canonical package.
   - Replace `shell/src/platform/types.ts` with a re-export surface from `@mog-sdk/types-app-platform` plus shell-only types such as `AppLoader` where they truly belong.
   - Update package registry, app registry, app instance manager, host context factory, host services, resource binding service, contribution registry/resolver, package boundary validator, trust integration, isolation enforcer, and plugin activation manager to import from the canonical package subpaths.
   - Delete or reduce shell-local manifest validation so it delegates to package validators. Runtime-host compatibility checks can remain shell-owned, but their inputs and diagnostics should use canonical types.
   - Update all shell test fixtures to the canonical manifest, contribution, plugin, route, and service shapes.

6. Add package-local tests, fixtures, and declaration gates.
   - Add valid and invalid fixture manifests/plugins under `types/app-platform/src/**/__tests__` or a package-local fixture directory.
   - Add tests for every validator, branded constructor, enum constant, duplicate detection rule, contribution conflict rule, capability subject variant, and public/private resource binding split.
   - Add package test tooling and script support without emitting test files into `dist`.
   - Regenerate `dist` from the package build and ensure package exports point to matching source, declaration, and runtime helper files.

7. Update boundary documentation and inventory only after production migration.
   - Keep `tools/package-inventory.jsonc` disposition as `workspace-internal` and `requirePrivate: true`.
   - Update `docs/guides/plugins.md` only to clarify the internal canonical contract status and current unsupported public plugin flow.
   - Ensure boundary tests continue allowing `@mog-sdk/types-app-platform` imports while rejecting shell/kernel/contracts internals for package/plugin code.

## Tests and verification gates

- `pnpm --filter @mog-sdk/types-app-platform test`
- `pnpm --filter @mog-sdk/types-app-platform typecheck`
- `pnpm --filter @mog/shell test -- src/platform`
- `pnpm --filter @mog/shell typecheck`
- `pnpm typecheck`
- `pnpm check:ci:public-boundaries`
- `pnpm check:publish-readiness:fast`

For the implementation worker, the package-local test script should be added before relying on the first command. Shell platform tests should exercise the real package registry, contribution resolver, plugin activation manager, host services, and boundary validator rather than direct state mutation shortcuts.

## Risks, edge cases, and non-goals

- The largest risk is silent contract drift during shell migration. Mitigate it by updating shell production imports and shell conformance tests in the same change as the canonical contract updates.
- Existing shell fixtures use local mirror shapes such as `PluginManifest.id`, `isolation`, `metadata.contributionId`, `targetPointId`, `toolbarItem`, `fileHandler`, and numeric timestamps. These should be migrated to the chosen canonical shape rather than tolerated with shims.
- The package currently has no tests. Adding validators without fixture coverage would only move drift into a different file.
- Do not expose a public third-party plugin SDK, marketplace, install command, formula-function extension point, or sandbox bridge as part of this work.
- Do not optimize or validate test-only paths. The important production paths are package registration, app launch, host context creation, contribution resolution, capability/trust enforcement, and plugin activation denial/activation.
- Generated `dist` and `tsconfig.tsbuildinfo` are build outputs; they should only be updated by the package build during the actual implementation, not hand-edited.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the canonical contract matrix is frozen.

- Agent A: app-platform constants, validators, branded constructors, package-local fixtures, and package tests.
- Agent B: shell `types.ts` re-export migration plus package/app registry, app instance, host context, and host service updates.
- Agent C: contribution registry/resolver and plugin activation/isolation/trust migration to canonical contribution and plugin contracts.
- Agent D: boundary tests, docs, package inventory verification, declaration/export checks, and generated artifact validation.

Dependencies: shell migration depends on the canonical field-name matrix from Agent A. Contribution and plugin work depends on final contribution declaration and plugin manifest shapes. Boundary/docs work should run last so it records the actual production state. No dependency on `mog-internal` or public website code is required.
