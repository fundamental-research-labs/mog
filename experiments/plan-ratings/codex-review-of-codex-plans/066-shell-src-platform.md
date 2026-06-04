Rating: 8/10

Summary judgment

This is a strong plan. It correctly identifies that `shell/src/platform` is currently a tested/exported platform scaffold rather than the authority for the production app launch path, and it ties the fix to the adjacent production files that must change for the contract to matter. The plan is architecturally aligned with Mog's OS layering: contracts in `types/app-platform`, shell-owned runtime orchestration, host/app rendering above the platform, and no dependency from platform back into spreadsheet internals.

The rating is not higher because the plan still leaves several integration contracts under-specified. The biggest missing pieces are the exact `ShellPlatformRuntime` public API, the React runtime adapter shape returned to `AppSlot`, the app catalog/bootstrap registration contract, and the mapping between canonical manifest contribution refs and shell `ContributionDeclaration`s. Without those, implementers could agree on the goal but diverge on the surface that composes the parallel workstreams.

Major strengths

- The plan is production-path relevant. It does not optimize the existing platform unit-test layer in isolation; it explicitly moves authority through `createShell()`, `AppSlot`, app registry data, launch trust, capability consent, resource binding, lifecycle state, and disposal.
- The source diagnosis matches the current code. `createShell()` does not instantiate an app-platform runtime, `AppSlot` uses `APP_MANIFESTS` and `launchApp()`, `host/app-registry.ts` is mutable module-global state, `PackageRegistryService.registerBuiltInPackage()` stores a hardcoded `same-realm-first-party` runtime host, and `AppInstanceManager` currently records transitions without creating host context or loading runtime handles.
- The canonical type drift is called out correctly. `types/app-platform` exists with exported validators and `AppEntryDescriptor.export?: string`, while `shell/src/platform/types.ts` still duplicates the contract and `manifest-validator.ts` requires `entry.export`.
- The plan has good fail-closed invariants: unsupported runtime hosts can be structurally valid without becoming launchable, only enabled packages should appear in app registry data, resource lease internals should remain private, contribution resolution should remain data-only, and terminal lifecycle states should remain terminal.
- The decomposition is credible for parallel work. Contract alignment, runtime/bootstrap, app launch adapter, resources, contributions/plugins, and conformance tests are separable if the runtime API is specified first.

Major gaps or risks

- The `ShellPlatformRuntime` contract is described as a collection of services, but not as an explicit API. The plan should define its factory inputs, returned service fields, lifecycle methods, dispose semantics, event surface, and bootstrap config/result fields before assigning parallel implementation agents.
- The React app runtime adapter is the largest unresolved contract. The plan says platform launch should return a renderable descriptor for React apps while staying generic for non-React entries, but it does not define the descriptor shape, how legacy `AppProps` map to `AppHostContext`, or how loader modules with missing/non-default exports are validated.
- App catalog registration is underspecified. The plan says to convert side-effect app registration into a runtime catalog input, but it should name the catalog type, where bundled first-party IDs/loaders are supplied, and how spreadsheet's legacy `manifest.ts` and `canonical-manifest.ts` converge.
- Canonical validator diagnostics need a precise adapter. `types/app-platform` returns `{ errors, warnings }` with machine-readable codes, while shell currently uses `{ issues }`. The plan asks to normalize diagnostics but should define whether shell preserves canonical codes, how paths are represented, and which errors become UI-facing messages.
- Resource binding requirements are more concrete than the current manifest contract. The plan talks about required eager resources and requested binding descriptors, but canonical manifests only declare `data.resourceKinds`; the instance launch API needs an explicit source for binding descriptors, route-derived resource IDs, setup policy, and suspend downgrade/retain policy.
- Contribution lifecycle wiring needs a mapping contract. `ManifestContributionRef` has `contributionPointId`, `kind`, `id`, `label`, and `icon`, while shell resolver declarations use `targetPointId`, metadata, priority/group, and override fields. The plan should specify the conversion and defaults.
- Package boundary enforcement says to add discovery/import scan input, but not which production or publish-readiness gate will feed it. Since this touches public package boundaries, it should include the package/dependency changes, especially adding `@mog-sdk/types-app-platform` as a shell dependency and preserving package export rules.

Contract and verification assessment

The contract intent is good: canonical public contracts live in `@mog-sdk/types-app-platform`, shell implementation types stay implementation-only, and `@mog/shell/platform` remains the public shell import surface. The plan also correctly separates registration-time structural validity from enable/launch-time executability.

Verification is mostly strong. The proposed shell platform tests, shell typecheck, app-platform typecheck, spreadsheet tests/typecheck, repo-wide `pnpm typecheck`, and browser exercise of real app selection/launch cover the right layers. I would strengthen the gates with explicit regression tests that `ShellBootstrapResult` exposes the one runtime instance, app switcher data comes from enabled packages only, the old host globals no longer authorize launch, and a worker-sandbox manifest remains installed/incompatible rather than silently stored as same-realm.

Concrete changes that would raise the rating

- Add a short contract section for `ShellPlatformRuntime`: factory inputs, output fields, `registerCatalog`, `enablePackage`, `create/launch/suspend/resume/closeInstance`, `resolveContributions`, and `dispose`.
- Define `PlatformReactRuntimeDescriptor` or equivalent, including loader result validation, `AppHostContext`/legacy `AppProps` bridging, error diagnostics, and cleanup hooks.
- Specify the bundled app catalog format and migration path for spreadsheet from `register.ts` side effects to bootstrap/runtime registration.
- Define the diagnostics adapter from canonical `ValidationDiagnostic` to shell/UI errors without losing machine-readable codes.
- Define resource binding descriptor sources and route matching semantics before implementing provider-aware binding.
- Define contribution-ref-to-declaration defaults for group, priority, metadata IDs, override policy, and duplicate handling.
- Add package/dependency/export updates and boundary-check gates to the implementation plan so contract alignment cannot compile only through accidental path aliases.
