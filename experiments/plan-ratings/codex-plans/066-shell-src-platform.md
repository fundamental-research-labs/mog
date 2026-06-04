# 066 - Shell Platform Abstraction and Lifecycle Conformance

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/shell/src/platform`

Queue item: 66, `mog/shell/src/platform`, shell platform abstraction and lifecycle conformance.

This plan targets the public `@mog/shell/platform` implementation surface and the production shell paths that must consume it for the platform contract to matter:

- `mog/shell/src/platform`: app/plugin package registries, app instance lifecycle, host services, resource providers and bindings, contribution points, trust, isolation, plugin activation, package boundary validation, and manifest validation.
- `mog/shell/src/bootstrap/create-shell.ts`: the shell bootstrap graph that should create the per-shell platform runtime.
- `mog/shell/src/host/AppSlot.tsx`, `mog/shell/src/host/app-registry.ts`, and `mog/shell/src/app-launcher/launch-app.ts`: the current production app selection and launch path that still bypasses most of `shell/src/platform`.
- `mog/apps/spreadsheet/src/canonical-manifest.ts` and `mog/apps/spreadsheet/register.ts`: the current first-party spreadsheet app manifest and registration entrypoint.
- `mog/types/app-platform/src`: canonical app-platform contract types and validators that already exist and should be the public contract source.

This plan does not target the native OS platform implementation in `mog/infra/platform`, except where shell host services adapt to native/web platform services. It also does not add compatibility shims for the old app launcher as an independent launch path; the production goal is one platform lifecycle contract.

## Current role of this folder in Mog

`shell/src/platform/index.ts` exposes `@mog/shell/platform` as the shell app/plugin platform barrel. The barrel currently exports local manifest, registry, lifecycle, route, resource, host-service, contribution, plugin, trust, isolation, and boundary types plus implementation factories.

The folder already defines meaningful contracts:

- `PackageRegistryService` validates manifests during registration, rejects duplicate package IDs, keeps package state per service instance, and exposes enabled packages through `AppRegistryService`.
- `AppInstanceManager` maintains a strict instance state machine for `created`, `launching`, `running`, `suspended`, `closing`, `closed`, `launchDenied`, and `crashed`.
- `ResourceProviderRegistry` owns resource-kind registration with namespace checks, first-registered ownership, and core-reserved resource kinds.
- `ResourceBindingService` resolves descriptors into leases, tracks lease state, and produces app-facing snapshots without lease internals.
- `ContributionPointRegistry` and `ContributionResolver` keep contribution declaration validation and deterministic resolution data-only, without evaluating app or plugin entry code.
- `TrustIntegration`, `IsolationEnforcer`, and `PluginActivationManager` centralize plugin trust and isolation checks.
- `PackageBoundaryValidator` allows `@mog/shell/platform` and canonical app-platform type imports while rejecting broader shell/kernel/internal imports for third-party packages.

The folder is not yet the production source of truth. `createShell()` initializes the native/web `IPlatform`, document manager, project service, shell service, dispatcher, and capability registry, but it does not instantiate or return the app-platform registry/lifecycle graph. Active app rendering still uses the older mutable global host registry (`APP_IDS`, `APP_MANIFESTS`, `APP_LOADERS`) and launches through `launchApp()`, whose first-party trust is a hardcoded `TRUSTED_FIRST_PARTY_APPS` set. As a result, the platform folder is tested and exported but does not govern the real app launch, resource lease, contribution, trust, isolation, and teardown lifecycle.

There is also contract drift. `shell/src/platform/types.ts` says it locally mirrors `@mog-sdk/types-app-platform` until the canonical package exists, but `mog/types/app-platform/src` already exists. The shell-local `AppEntryDescriptor.export` is optional while the shell-local validator requires it. The local service and lifecycle shapes also diverge from the canonical package's route/service/lifecycle naming and validation diagnostics.

## Improvement objectives

1. Make `shell/src/platform` the production app/plugin platform runtime for shell app hosting, not a parallel test-only scaffold.
2. Use `@mog-sdk/types-app-platform` as the canonical public contract source for app/plugin platform types and validators, with shell implementation types only where they are implementation-specific.
3. Replace hardcoded first-party launch trust in `app-launcher/launch-app.ts` with `ShellTrustIntegration` and `IsolationEnforcer` as the single trust/runtime-host policy.
4. Store and enforce `manifest.runtimeHost` as declared. Registration may accept all structurally valid runtime modes, but enablement/launch must fail closed for modes the current host cannot execute.
5. Turn `AppInstanceManager` from state bookkeeping into the app lifecycle orchestrator: resolve capabilities and resources, build host context, load the app, track runtime handles, enforce suspendability, handle startup timeout/crash, and dispose exactly once.
6. Make resource bindings provider-aware and instance-scoped. Unknown resource kinds, unsupported access modes, and cross-namespace ownership should fail closed; instance suspend/close must update leases.
7. Couple contribution registration to package enable/disable and plugin activation/deactivation so resolved contributions represent the live platform state.
8. Preserve `@mog/shell/platform` as the only allowed shell import surface for third-party packages while making its exported contract complete enough for app/package authors.
9. Keep conformance tests focused on the production path: bootstrap -> registry -> enable -> launch -> render/host context -> suspend/resume -> close/dispose.

## Production-path contracts and invariants to preserve or strengthen

- Per-shell isolation: registries, resource providers, bindings, plugin activations, and contribution state are owned by one shell runtime instance. No shared module-global app/package lifecycle state.
- App registry visibility: only enabled app packages appear in `AppRegistryService` and user-facing app switcher data.
- Manifest truth: `manifest.runtimeHost`, `manifest.lifecycle`, `manifest.data`, `manifest.capabilities`, `manifest.routes`, and `manifest.contributions` are the source of lifecycle policy. Registration must not overwrite runtime host mode with a hardcoded value.
- Fail closed: unknown packages, disabled packages, untrusted packages, unsupported runtime hosts, missing resource providers, unsupported access modes, invalid contribution points, and forbidden imports do not launch or activate.
- Trust and isolation: same-realm app/plugin code executes only for bundled first-party packages. Sandbox, worker, server, and remote modes remain structurally valid manifest declarations but cannot enter `running` or `active` until their host bridges are implemented and tested.
- Lifecycle transitions: invalid state transitions throw or return typed denial results consistently. Terminal states stay terminal. State change events are emitted once per transition.
- Runtime disposal: app/plugin runtime handles are disposed exactly once on close/crash/deactivation, even when loader startup, host context creation, or app entry invocation fails.
- Suspend/resume: apps that do not declare `lifecycle.suspendable` cannot enter `suspended`; apps that do must have resource leases retained or downgraded according to descriptor policy and restored on resume.
- Capability grants: app host context and gated APIs expose only capabilities granted by the trust/consent path. Auto-grant is a trust decision, not a hardcoded app ID list.
- Resource lease privacy: app-facing binding snapshots must not expose lease IDs, grant subjects, provider internals, or mutable shell-owned data.
- Contribution determinism: contribution resolution remains data-only and stable by group, priority, source ID, and contribution ID; resolving contributions never imports app/plugin entry code.
- Boundary integrity: third-party apps/plugins can import `@mog/shell/platform` and canonical app-platform type subpaths, but not shell internals, kernel internals, spreadsheet-specific contracts, or app-specific packages.
- Canonical types: public app-platform types are exported from `@mog-sdk/types-app-platform`; shell implementation should not create a second incompatible contract.

## Concrete implementation plan

1. Align platform contracts with `@mog-sdk/types-app-platform`.
   - Replace shell-local duplicate public contract definitions with imports/re-exports from `@mog-sdk/types-app-platform` where the canonical package already defines the shape.
   - Keep shell-only implementation interfaces in `shell/src/platform` only when they are not public contracts, such as concrete registry service dependencies, launch adapters, clock/ID factories, or test helpers.
   - Resolve `entry.export` semantics by choosing one contract: either optional with a default of `default`, or required in both type and validator. Prefer optional with explicit defaulting because canonical `AppEntryDescriptor.export` is optional.
   - Export the complete public manifest/contribution/resource/plugin type surface from `@mog/shell/platform` if app authors are expected to use that subpath, including nested manifest declaration types.
   - Normalize validation diagnostics so package registration can report stable machine-readable errors from canonical validators, while preserving shell-friendly messages for tests and UI.

2. Introduce a per-shell `ShellPlatformRuntime`.
   - Add a platform runtime factory in `shell/src/platform` that owns `PackageRegistryService`, `AppRegistryService`, `PluginRegistryService`, `AppInstanceManager`, `ResourceProviderRegistry`, `ResourceBindingService`, `ContributionPointRegistry`, `ContributionResolver`, `ShellTrustIntegration`, `IsolationEnforcer`, `PluginActivationManager`, and `PackageBoundaryValidator`.
   - Instantiate this runtime in `createShell()` after capability registry creation and before React mounts. Return it on `ShellBootstrapResult` so React shell components use the same runtime instance.
   - Register the workbook resource provider during bootstrap through `registerSpreadsheetResourceProvider()` so route and binding resolution share production document resource semantics.
   - Convert the current side-effect app registration flow into a catalog input for the platform runtime. Remove independent `APP_IDS`, `APP_MANIFESTS`, and `APP_LOADERS` lifecycle ownership; the app switcher and `AppSlot` should read from the platform `AppRegistryService`.

3. Make package registration and enablement policy-complete.
   - Store each package entry's `runtimeHost` from `manifest.runtimeHost`, not from the registration source.
   - Track registration source separately from runtime host and use it to produce or look up a trust record.
   - On registration, run canonical structural validation, duplicate package ID checks, manifest entry defaulting, package boundary validation where import paths are available, and contribution declaration shape validation.
   - On enablement, run compatibility profile validation, trust evaluation, isolation enforcement, runtime host support checks, resource kind availability checks for required eager resources, and contribution point validation.
   - Preserve `installed` for structurally valid packages that are not enabled, set `incompatible` only with durable diagnostics, and ensure `AppRegistryService` exposes only `enabled` packages.

4. Replace the old app launch path with platform launch orchestration.
   - Move `launchApp()` capability consent and gated API creation behind a platform launch dependency rather than letting `AppSlot` call it independently.
   - Delete the hardcoded first-party trust set as launch authority. The source of first-party auto-grant must be `ShellTrustIntegration.evaluateAppLaunch()`.
   - Extend `AppInstanceManager` dependencies to include trust integration, isolation enforcer, capability grant service, resource binding service, host service factory, app loader adapter, clock, ID generator, and startup timeout scheduler.
   - `createInstance()` should record app ID, route, and any requested binding descriptors. `launchInstance()` should validate enabled app state, evaluate trust/isolation, grant or request capabilities, resolve route/resource bindings, create `ShellHostServices`, create immutable `AppHostContext`, load the app entry, and transition to `running` only after the runtime is ready.
   - Adapt the current React `AppLoader` production model explicitly: platform launch should return a renderable app runtime descriptor for React apps, while keeping the platform contract generic enough for non-React entry functions. `AppSlot` then renders the descriptor and no longer owns trust, capability, or runtime-host decisions.
   - Add crash and startup timeout handling. Loader failures, entry failures, missing exports, and timeout failures transition to `crashed`, release leases, dispose partial handles, and return diagnostics.

5. Strengthen app runtime lifecycle handling.
   - Store runtime handles by instance ID. `closeInstance()` transitions `running|suspended -> closing -> closed`, disposes the handle exactly once, releases resource leases, withdraws instance-scoped contributions if any, and clears active instance state.
   - Enforce `manifest.lifecycle.suspendable`; non-suspendable apps cannot suspend. Suspendable apps call optional suspend hooks when available and update leases using descriptor setup/access policy.
   - `resumeInstance()` restores eligible leases, calls optional resume hooks when available, updates `lastActiveAt`, and returns to `running`.
   - Add idempotent close/dispose guards so user close, crash recovery, and shell dispose cannot double-dispose runtime handles.
   - On shell dispose, close all non-terminal app instances before document manager disposal.

6. Make resource binding provider-aware.
   - Inject `IResourceProviderRegistry` into `createResourceBindingService()`.
   - Validate that every binding descriptor has a registered provider, supported access mode, valid owner namespace, and a resolved resource ID either from descriptor or route resolution.
   - Preserve eager/lazy setup policy: eager bindings resolve before app launch reaches `running`; lazy bindings resolve through app host services and still fail closed.
   - Track leases by instance ID as well as lease ID. Suspend/resume/close operations should operate on all leases for that instance.
   - Include conformance coverage for unknown resource kinds, unsupported access modes, route-derived workbook bindings, independent bindings for two app instances, lease release on close, and lease retain/downgrade on suspend.

7. Wire live contribution lifecycle.
   - On package enablement, validate and submit manifest contributions to the resolver. On disable or uninstall, remove that package's contributions.
   - On app launch, expose resolved contributions only from enabled packages; do not import entry code during resolution.
   - Convert plugin registration to use `PluginManifest` instead of app-manifest placeholders, and make plugin activation submit plugin contributions only after trust and isolation pass.
   - On plugin deactivation, withdraw plugin contributions and release any plugin-owned leases or command handlers.
   - Keep deterministic ordering and duplicate handling, but add tests for live add/remove across enable, disable, activation, deactivation, and duplicate contribution IDs under each override policy.

8. Complete boundary enforcement.
   - Keep `@mog/shell/platform` as the public shell import surface.
   - Use canonical `@mog-sdk/types-app-platform/*` subpaths for pure contracts and keep them allowed.
   - Add a package discovery/import scan input for app/plugin packages so boundary validation can run during registration or publish-readiness checks instead of being only a unit-test helper.
   - Fail package enablement for forbidden imports in non-first-party packages. First-party exemptions should be explicit trust policy, not a validator default that third-party package authors can trigger.

9. Preserve UI production behavior while moving authority.
   - Update app switchers and hooks to read enabled apps from the platform runtime instead of the old host globals.
   - Update `AppSlot` to request platform launch for the selected app ID and render the returned React app runtime descriptor.
   - Keep capability consent UI behavior intact, but make consent a dependency invoked by the platform launch flow.
   - Ensure current spreadsheet app launch still works with its canonical platform manifest and legacy spreadsheet app props until the spreadsheet app fully consumes `AppHostContext`.

10. Update conformance tests as the contract harness.
   - Treat `shell/src/platform/__tests__/conformance` as the primary lifecycle conformance suite.
   - Add production-path conformance fixtures that build a `ShellPlatformRuntime`, register spreadsheet plus a small test app, enable packages, launch through the same service used by `AppSlot`, verify host context, verify capability grants, verify resource leases, suspend/resume, close, and assert disposal.
   - Add regression tests for runtime-host mismatch: a manifest declaring `worker-sandbox` must not be silently stored as `same-realm-first-party` and must not become launchable until worker hosting exists.
   - Add tests that prove contribution resolution does not import app/plugin code, even when live package enablement submits contributions.

## Tests and verification gates

No verification commands should be run by this planning worker. For the implementation workstream, use these gates before claiming done:

- Platform contract and implementation:
  - `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/platform`
  - `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm typecheck`
- Canonical app-platform type alignment:
  - `cd /Users/guangyuyang/Code/mog-all/mog/types/app-platform && pnpm typecheck`
- Production app launch wiring:
  - `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/platform src/app-launcher src/host`
  - `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm typecheck`
- Spreadsheet manifest and first-party launch impact:
  - `cd /Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet && pnpm test`
  - `cd /Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet && pnpm typecheck`
- Repository-level TypeScript contract:
  - `cd /Users/guangyuyang/Code/mog-all/mog && pnpm typecheck`
- UI production path:
  - Start the dev server from the appropriate app entry.
  - Exercise real UI app selection and launch, spreadsheet launch, capability consent/auto-grant, denied launch, close/reopen, and a forced loader failure in a browser.
  - Confirm no direct test/state mutation is used for E2E setup; drive app selection and consent through the same UI input path a user uses.

## Risks, edge cases, and non-goals

- Risk: canonical `@mog-sdk/types-app-platform` and shell-local types are close but not identical. The implementation should align contracts deliberately rather than mechanically replacing imports and accepting accidental API drift.
- Risk: current React app loading expects `AppProps` with a capability-gated kernel API, while `AppHostContext` is a product-neutral platform contract. The correct solution is a typed React app runtime adapter owned by shell, not a second launch path.
- Risk: package registration currently uses side-effect globals. Replacing that with a per-shell runtime must not reintroduce module-global state through helper hooks or app switcher caches.
- Risk: runtime host validation must distinguish structural manifest validity from current host executability. Worker/iframe/server/remote declarations can remain valid, but they must not enter `enabled`, `running`, or `active` without implemented host bridges.
- Risk: resource route matching is currently simple prefix plus `:id`; production route-derived resources need exact route-pattern semantics before supporting overlapping patterns.
- Risk: capability names in canonical app-platform manifests are strings, while the existing capability system uses kernel security capability types and composites. The platform launch flow must normalize and expand capabilities through the existing capability registry before exposing grants.
- Risk: first-party exemptions can mask boundary violations. Keep exemptions explicit to bundled package IDs configured at bootstrap.
- Edge case: startup failures after some leases or commands are registered must clean up partial state and transition to `crashed`.
- Edge case: duplicate close, shell dispose during launch, and React unmount during launch must not leak leases or double-dispose handles.
- Edge case: disabled packages must withdraw contributions and disappear from app switcher data even if an old instance is still closing.
- Edge case: lazy resource binding failures should report typed binding diagnostics through host services without crashing unrelated app instances.
- Non-goal: implementing iframe, worker, server-side, or remote-bridge app hosts in this workstream. The plan strengthens denial and diagnostics until those hosts are implemented as a separate production feature.
- Non-goal: changing native/web file-system platform behavior in `infra/platform`, except through host-service adapters required for shell app platform launch.
- Non-goal: keeping `launchApp()` as an independent compatibility launch path after platform wiring. Its useful capability logic should move under platform launch authority.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable, but integration must happen through one platform runtime contract.

- Agent A: canonical contract alignment in `types/app-platform/src` and `shell/src/platform/types.ts`, including validators and exported public types.
- Agent B: shell platform runtime factory, package registry enablement policy, trust/isolation wiring, and bootstrap integration.
- Agent C: app instance lifecycle orchestration, React app runtime adapter, old `AppSlot` launch path replacement, and runtime handle disposal.
- Agent D: provider-aware resource binding, route-derived workbook bindings, and lease lifecycle coupling.
- Agent E: contribution and plugin live lifecycle, including activation/deactivation contribution withdrawal.
- Agent F: conformance and production-path tests spanning platform, app host, app launcher replacement, and spreadsheet canonical manifest.

Dependencies:

- `shell/src/platform` owns the runtime contract and should not depend on app-specific internals.
- `shell/src/host` may depend on `shell/src/platform` to render platform-launched apps.
- `apps/spreadsheet` may import `@mog/shell/platform` types and provide a first-party manifest/loader catalog entry, but `shell/src/platform` must not import spreadsheet app code directly.
- `types/app-platform` remains contracts-only and must not depend on shell, kernel, React, or runtime packages.
- `infra/platform` remains the native/web OS platform provider and should be adapted through host services, not merged with the app-platform lifecycle layer.
