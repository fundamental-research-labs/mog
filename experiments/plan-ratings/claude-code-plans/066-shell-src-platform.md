# Plan 066 — Make `mog/shell/src/platform` an enforcing app/plugin platform, not a state-flag stub

## Source folder and scope

- **Folder:** `mog/shell/src/platform`
- **Package:** `@mog/shell`, exposed publicly as the subpath export
  `@mog/shell/platform` (see `mog/shell/package.json` `exports["./platform"]` →
  `src/platform/index.ts`). This is a published API surface, not a private
  implementation detail.
- **In scope (21 source files, ~120 KB):** the platform barrel (`index.ts`),
  the contract mirror (`types.ts`), validation (`validation.ts`,
  `manifest-validator.ts`), registries (`package-registry.ts`,
  `app-registry.ts`, `plugin-registry.ts`, `resource-provider-registry.ts`,
  `contribution-point-registry.ts`), lifecycle managers
  (`app-instance-manager.ts`, `plugin-activation-manager.ts`), the resolution /
  enablement engine (`contribution-resolver.ts`, `contribution-enablement.ts`),
  the security primitives (`isolation-enforcer.ts`, `trust-integration.ts`,
  `package-boundary-validator.ts`), the host surface (`host-services.ts`,
  `app-host-context-factory.ts`), the resource layer
  (`resource-binding-service.ts`, `spreadsheet-resource-adapter.ts`), and the
  `__tests__/` conformance suite.
- **Out of scope (folder boundary, referenced as dependencies):**
  - `mog/types/app-platform/src` — the canonical `@mog-sdk/types-app-platform`
    contracts (queue item 006). `types.ts` here is an explicitly-temporary
    parallel copy of those contracts; collapsing it is coordinated with 006, not
    owned solely here.
  - The shell bootstrap/wiring layer (`mog/shell/src/bootstrap/create-shell.ts`,
    `services/`, `context/`) that would *construct and consume* the platform.
    The `platform` subdirectory is currently **not imported anywhere outside
    itself** (verified: no production import of any `platform/*` module exists in
    `mog/shell/src`). Wiring it into the live shell launch path touches files
    outside this folder and is called out as a coordinated follow-up.
  - `mog/app-spreadsheet/src/canonical-manifest.ts` (consumed by the conformance
    suite as a real fixture).

## Current role of this folder in Mog

This folder is Mog's **app/plugin platform substrate**: the product-neutral
machinery that is meant to register packages, validate manifests, enforce trust
and isolation, run app/plugin lifecycles, broker host services, resolve
contributions into the UI, and bind resources. It is the layer that lets the
spreadsheet ship as one "app" among future apps/plugins rather than as a
hardcoded shell.

The pieces are individually well-shaped and each has unit + conformance tests:

- **Registries** are instance-owned (`PackageRegistryService`, etc.) with the
  stated invariant "each shell host creates its own; no shared global state."
- **Lifecycle** is modeled as explicit state machines
  (`AppInstanceManager.VALID_TRANSITIONS`, `PluginActivation` states).
- **Security primitives** exist as isolated, testable functions
  (`createIsolationEnforcer`, `createShellTrustIntegration`,
  `createPackageBoundaryValidator`).
- **Resolution** is pure and deterministic
  (`ContributionResolver`, `evaluateEnablementPredicate` with a hand-written
  parser — no `eval`).

**The defining problem of this folder is integration, not absence.** The parts
exist but are not connected into a single enforced path, and several are dead or
self-contradictory:

1. **The app launch path enforces nothing.**
   `AppInstanceManager.launchInstance` (`app-instance-manager.ts:107`) checks
   only that the app is registered+enabled, then flips the state to `running`.
   It never calls `ShellTrustIntegration.evaluateAppLaunch` or
   `IsolationEnforcer.canLaunchApp` (verified: both are defined but have **zero
   non-test callers**), never resolves resource bindings, never builds an
   `AppHostContext`, never constructs `ShellHostServices`, and never invokes the
   app's `AppLoader`/`AppEntryFunction`. The body's own comment admits "In future
   versions, this would set up … resolve resource bindings, and initialize host
   services." So trust and isolation are enforced for *plugins*
   (`plugin-activation-manager.ts:156-188`) but silently bypassed for *apps*.
2. **Identity generation breaks the no-global-state invariant and is
   non-deterministic.** `createAppInstanceId` (`types.ts:184`) uses
   `Date.now() + Math.random()`; `generateLeaseId` (`resource-binding-service.ts:68`)
   uses a **module-level** `leaseCounter` shared across every binding-service
   instance in the process — a global mutable identifier source inside a package
   that advertises per-host isolation.
3. **Trust resolution is disconnected from package provenance.**
   `resolveTrustSource` (`trust-integration.ts:68`) maps "not in
   `bundledFirstPartyIds`" → `'unknown'`, so the `local-dev`/`marketplace-*`
   branches of `evaluateSource` and the entire `allowLocalDev` config field are
   **dead code**. A package registered via `registerLocalDevPackage`
   (`package-registry.ts:90`, source `'local-dev'`) is denied regardless of
   config because trust never consults the registry's `PackageSource`.
4. **Contribution capability-gating and `when`-clauses are inert.**
   `ContributionResolver.resolve` (`contribution-resolver.ts:70`) never evaluates
   `declaration.requiredCapabilities` and never calls
   `evaluateEnablementPredicate`. The enablement evaluator is fully built and
   tested but has no production caller in resolution, and `ContributionMetadata.when`
   is carried but never consulted.
5. **Override-policy bug.** In `resolve`, the `last-wins` and `first-wins`
   branches (`contribution-resolver.ts:146-177`) are byte-for-byte equivalent —
   both keep the first occurrence in sorted order. `last-wins` does not win last.
   Also only `duplicate-id` conflicts are detected; the declared
   `shortcut-conflict` and `schema-mismatch` `ConflictKind`s
   (`types.ts:471`) are never produced.
6. **Contract dual-source-of-truth.** `types.ts` (582 lines) is a hand-merged
   copy "from D + E + F + G" that the canonical `@mog-sdk/types-app-platform`
   package (item 006) now supersedes. It carries legacy/forward dual fields
   (`RouteSnapshot.kind` *and* `.target`; `ResolvedResourceBinding.resourceRef`
   *and* `.resourceId`) and a *soft* brand (`AppId = string & { __brand?: 'AppId' }`)
   that is structurally weaker than the canonical hard brand.

These are production-path defects: an unenforced launch path is a security gap,
not a missing feature, and dead trust branches mean the documented policy does
not run.

## Improvement objectives

1. **Unify app and plugin lifecycles behind one enforced admission path** so
   that launching an app runs the same trust → isolation → capability checks
   that plugin activation already runs, and actually instantiates the app
   (loader + host context + bindings) instead of flipping a flag.
2. **Make trust policy real**: connect `ShellTrustIntegration` to the
   registry's `PackageSource`/`PackageInstallationRecord` so `local-dev` and
   marketplace provenance produce the documented decisions and `allowLocalDev`
   takes effect; eliminate the dead branches.
3. **Make identity deterministic and host-scoped**: remove `Date.now()`/
   `Math.random()` and the module-global lease counter; inject a per-host
   monotonic/seedable id source so registries are reproducible and truly
   isolated.
4. **Wire contribution capability-gating and enablement** into resolution so
   `requiredCapabilities` and `when` actually filter what apps/plugins surface,
   and fix the override-policy semantics + add shortcut-conflict detection.
5. **Collapse the contract mirror** (`types.ts`) onto the canonical
   `@mog-sdk/types-app-platform` (coordinated with item 006), removing dual
   fields and adopting the hard brand.
6. **Make declared-but-unenforced contracts enforced**: lifecycle hints
   (`suspendable`, `maxStartupMs`), the package-boundary validator, and runtime
   host compatibility (`validateRuntimeHostCompatibility`, currently never
   called) must participate in the real path or be removed.
7. **Standardize the error/result model** across lifecycle operations (today
   `launchInstance` returns a `Result` while `suspend/resume/close` throw, and
   `launchInstance` can itself throw on re-entry).
8. **Add an instance-lifetime/GC contract** so closed instances and released
   leases do not accumulate unbounded.

All objectives strengthen the production path. No test-only fixes, no shims
beyond the deliberate (and 006-coordinated) contract re-export.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (do not regress):**

- **Per-host instance ownership / no shared global state.** Every service is
  constructed per shell host. Strengthen this by removing the one violation (the
  module-global `leaseCounter`).
- **Determinism and purity of resolution.** `ContributionResolver` and
  `evaluateEnablementPredicate` must stay synchronous, pure, and free of plugin
  code evaluation (no `eval`/`new Function`). Capability/`when` gating must be
  pure data filtering, not code execution.
- **Fail-closed semantics.** `ResourceProviderRegistry` returns `undefined`
  rather than falling back; isolation/trust deny on unknown. Keep deny-by-default
  for every new check (a missing capability denies; an unverified manifest
  denies).
- **Manifest structural validation gates registration.**
  `registerPackage` (`package-registry.ts:94`) throws on invalid manifests —
  keep that gate; deepen the validator, do not loosen it.
- **The `@mog/shell/platform` subpath export must stay resolvable** with the
  same top-level value/type exports unless a change is intentional and reflected
  in `index.ts` (the public barrel).
- **Reserved-namespace enforcement** for resource kinds
  (`resource-provider-registry.ts:56`) — keep core-only kinds locked to
  `mog.core` and namespace-prefix ownership.
- **Listener error isolation** as already done in
  `plugin-activation-manager.ts:83` (swallow + continue). Bring
  `AppInstanceManager` up to the same policy rather than down.

**Strengthen (the work):**

- App launch becomes a *total, fail-closed* admission decision returning a typed
  result; it never throws for expected denials and never reaches `running`
  without passing trust + isolation + capability grant.
- `ResolvedResourceBinding` and `RouteSnapshot` converge to a single canonical
  shape (no dual fields) once 006's contract is adopted.
- The boundary validator participates in a real check (build-time lint and/or
  registration-time module-graph inspection) instead of being an unreferenced
  utility with a drift-prone hardcoded list.

## Concrete implementation plan

Sequenced so the additive, in-folder phases (1–5) land first and the
cross-folder contract collapse + live wiring (6–7) follow with coordination.

### Phase 1 — Deterministic, host-scoped identity (foundation)

- Introduce an injected `IdSource` (e.g. `{ nextInstanceId(): AppInstanceId;
  nextLeaseId(): string }`) constructed once per host. Default implementation is
  a per-instance monotonic counter plus a host-unique prefix; expose a seedable
  variant for tests/SSR.
- Replace `createAppInstanceId` (`types.ts:184`) usage in `AppInstanceManager`
  and the module-global `leaseCounter` in `resource-binding-service.ts:68` with
  the injected source. `Date.now()` may remain for *timestamps*
  (`createdAt`/`lastActiveAt`/`installedAt`) but never for *identity*.
- This removes the only global-mutable-state violation and makes registry
  contents reproducible — a prerequisite for deterministic conformance tests of
  the unified launch path.

### Phase 2 — Unified, enforcing admission path for app launch

- Give `AppInstanceManager` the same dependencies the plugin manager already
  takes: `IIsolationEnforcer`, `ShellTrustIntegration`, and a capability/grant
  accessor, plus a `ResourceBindingService`, host-services factory, and the
  `AppRegistry` (already injected).
- Rewrite `launchInstance` (`app-instance-manager.ts:107`) as an ordered,
  fail-closed pipeline, each step a typed denial on failure:
  1. instance exists and is in `created` (re-entrancy guard — see Phase 7);
  2. app registered + enabled (existing check);
  3. `trustIntegration.evaluateAppLaunch(appId, manifest)` → deny → `launchDenied`;
  4. `isolationEnforcer.canLaunchApp(manifest, trustRecord)` → deny →
     `launchDenied` (distinguishing `unsupportedIsolation`-style "not yet
     implemented" from hard denial, mirroring
     `plugin-activation-manager.ts:180`);
  5. resolve declared resource bindings via `ResourceBindingService` (honoring
     `eager`/`lazy` `SetupPolicy`); on failure → `launchDenied` with
     `BindingDiagnostics`;
  6. build `ShellHostServices` (`createShellHostServices`) and `AppHostContext`
     (`createAppHostContext`) with the granted capabilities and binding
     snapshots;
  7. invoke the app's `AppEntryFunction` from the loader, retain the returned
     `AppRuntimeHandle`, then transition to `running`.
- Enforce `lifecycle.maxStartupMs`: if the entry function's async setup exceeds
  the declared budget, transition to `crashed` with a timeout diagnostic
  (today the field is parsed and ignored).
- `closeInstance` must call `handle.dispose()` and release all leases the
  instance holds (today `closeInstance` (`app-instance-manager.ts:160`) only
  flips state with the comment "Dispose subscriptions and handles" doing
  nothing). `suspendInstance` must reject when `manifest.lifecycle.suspendable`
  is false rather than always allowing it.

### Phase 3 — Make trust provenance real

- Change `ShellTrustIntegration` so trust derives from the package's recorded
  provenance, not only a bundled-id allowlist. Either pass the
  `PackageInstallationRecord`/`PackageSource` into `evaluateAppLaunch`/
  `evaluatePluginActivation`, or have the integration hold a reference to the
  `IPackageRegistryService` to look up `source`.
- Map provenance → `TrustSource` correctly: `built-in` → `bundled-first-party`;
  `local-dev` → `local-dev` (then gated by `allowLocalDev`); `marketplace` →
  `marketplace-verified`/`-unverified` based on a verification signal (digest /
  signature presence on the installation record). This activates the currently
  dead `evaluateSource` branches (`trust-integration.ts:85`) and makes
  `allowLocalDev` functional.
- Populate `PackageInstallationRecord.manifestDigest`/`artifactDigest`
  (`types.ts:155`, currently never set) at registration time and have trust
  verification consult them, so `verifiedAt` reflects an actual check rather than
  an unconditional `new Date().toISOString()`.
- Remove the now-unreachable `if (!trustRecord)` dead branch in
  `plugin-activation-manager.ts:167` (or make `getTrustRecord` genuinely return
  `undefined` for unknown packages, which is the more correct fail-closed
  behavior) — pick one and make it consistent.

### Phase 4 — Contribution resolution: capability + enablement gating, correct policy

- In `ContributionResolver.resolve` (`contribution-resolver.ts:70`), after
  ordering, filter contributions by:
  - `requiredCapabilities` ⊆ the active capability set (injected accessor), and
  - `metadata.when` evaluated through `evaluateEnablementPredicate` against an
    injected `EnablementContext` (the evaluator already exists in
    `contribution-enablement.ts` and is unused). Gating is pure data filtering —
    preserves the no-code-eval invariant.
- Fix the override-policy bug: make `last-wins` keep the *lowest-priority/last*
  candidate and `first-wins` keep the *highest-priority/first*, so the two
  branches are genuinely different (`contribution-resolver.ts:146-177`).
- Add `shortcut-conflict` detection for command/menu contributions that declare
  the same `shortcut`, and `schema-mismatch` surfacing (today
  `ContributionPointRegistry.validateContribution` (`contribution-point-registry.ts:174`)
  detects schema-version mismatch but the resolver never re-checks it at
  resolution time across all submitted declarations).
- Decide and document whether resolution should drop declarations that fail
  `validateContribution` (currently a source can `addContribution` an invalid
  declaration and it still flows into `resolve`). Gate at `addContribution`
  (fail-closed) is preferred.

### Phase 5 — Validation depth and de-duplication

- Collapse the two validation entry points: `validateRuntimeHostCompatibility`
  (`validation.ts:33`) is never called — `enablePackage`
  (`package-registry.ts:172`) hand-rolls the same `runtimeHost !==
  'same-realm-first-party'` check. Route `enablePackage` through the shared
  function so there is one source of truth for host-mode admission.
- Deepen `manifest-validator.ts:28`: validate `id` format and `version` semver,
  validate `route.path` shape, validate `contributions[i]` refs (kind ∈
  `ContributionKind`, point id present), validate `compatibility[i].versionRange`,
  and validate `capabilities[i]` are well-formed ids. This mirrors item 006's
  deepened validator; share the format regexes once the canonical package is
  adopted (Phase 6) rather than duplicating them.
- Connect `PackageBoundaryValidator` to a real enforcement point. Options, in
  preference order: (a) a build-time lint rule fed by the same
  forbidden/allowed lists; (b) registration-time validation of a manifest-declared
  import/dependency list. The current state — a fully-built validator
  (`package-boundary-validator.ts`) with a hardcoded list and **no caller** — is
  the failure mode to remove. If the runtime cannot see import graphs, keep the
  utility but move the source-of-truth list to a shared config consumed by both
  lint and runtime so it cannot drift.

### Phase 6 — Collapse the contract mirror onto the canonical package (coordinated with 006)

- Once `@mog-sdk/types-app-platform` lands the alignment from item 006, convert
  `types.ts` from a 582-line parallel copy into the re-export shim its own header
  promises ("Once that package exists, this file becomes a re-export shim").
- Adopt the canonical **hard** brand (drop the soft `__brand?` optional brand)
  and **remove dual fields**: collapse `RouteSnapshot.kind`/`.target` to the
  canonical single representation and `ResolvedResourceBinding.resourceRef`/
  `.resourceId` likewise. Update every consumer in this folder (the
  `AppResourceBindingSnapshot` projection in `resource-binding-service.ts:166`,
  the route handling in `resource-provider-registry.ts`, the conformance fixtures)
  in the same change set.
- Keep `index.ts` (the public barrel) re-exporting the same names so
  `@mog/shell/platform` consumers are unaffected; where a name moves to the SDK
  package, re-export it transitively.

### Phase 7 — Error model, re-entrancy, and instance/lease GC

- Standardize the lifecycle API to one error model. Recommended: all lifecycle
  mutations return a typed `Result` (matching `LaunchResult`) rather than mixing
  `Result` (launch) with `throw` (`suspend`/`resume`/`close`,
  `app-instance-manager.ts:149-168` via `transition`). Invalid transitions become
  data, not exceptions, so `launchInstance` can no longer throw an uncaught error
  when called twice (today a second `launchInstance` on a `running` instance
  throws from `transition` despite the function's `Promise<LaunchResult>` type).
- Guard `transition` listener dispatch with try/catch like the plugin manager,
  so a throwing observer cannot abort a state change or skip later listeners.
- Add an explicit `crashInstance(id, diagnostics)` entry so the `crashed` state
  is reachable by design (today it is only reachable via a `catch` around a
  synchronous body that cannot throw).
- Define a GC/retention contract: `closeInstance` should make the instance
  eligible for eviction (or expose `destroyInstance`) so `listInstances`
  (`app-instance-manager.ts:183`) does not grow unbounded with `closed` records;
  released leases should be removed from the binding service maps (today
  `releaseLease` deletes the binding but `leaseStates` retains a `released`
  tombstone forever — `resource-binding-service.ts:129`).

## Tests and verification gates

The folder already has strong unit + `__tests__/conformance/` coverage
(`app-lifecycle-e2e`, `capability-enforcement`, `plugin-denial`,
`registry-isolation`, etc.). Extend rather than replace:

- **Unified launch enforcement** (new conformance): an app whose trust resolves
  to `unknown`/unverified is denied at launch with `launchDenied` and never
  reaches `running`; a `bundled-first-party` app passes; an app with an
  `iframe-sandbox` runtime host is denied as `unsupportedIsolation`. This locks
  the Phase-2 fix that today's `app-lifecycle-e2e.test.ts` does not cover (it
  only exercises enabled/disabled).
- **Trust provenance** (Phase 3): `local-dev` package allowed iff
  `allowLocalDev`; marketplace verified vs unverified decisions; digest-mismatch
  denies. Asserts the previously-dead `evaluateSource` branches now execute.
- **Deterministic identity** (Phase 1): two hosts with the same seed produce the
  same instance/lease ids; no cross-host id bleed (regression test for the global
  `leaseCounter`).
- **Contribution gating** (Phase 4): a contribution with an unmet
  `requiredCapability` or a false `when` clause is excluded from `resolve`;
  `last-wins` vs `first-wins` now produce different winners; duplicate `shortcut`
  yields a `shortcut-conflict`.
- **Lifecycle hardening** (Phase 7): double `launchInstance` returns a denial
  `Result` instead of throwing; non-`suspendable` app rejects suspend; a throwing
  state listener does not break the transition; `closeInstance` disposes the
  handle and releases leases.
- **Contract collapse** (Phase 6): a compile-time fixture proving the hard brand
  rejects raw `string` assignment; the conformance suite still passes against the
  single canonical `RouteSnapshot`/`ResolvedResourceBinding` shape.

Verification gates (run by the implementer, not this planning worker):

1. `pnpm --filter @mog/shell typecheck` clean, including the
   `@mog/shell/platform` `.d.ts` emit referenced by the export map.
2. Full `platform/__tests__` unit + conformance suites pass.
3. After Phase 6: `pnpm --filter @mog-sdk/types-app-platform build` then a shell
   typecheck, confirming the shim resolves and no consumer relied on a removed
   dual field.
4. Grep confirms `evaluateAppLaunch`/`canLaunchApp` now have production callers
   and that no module-global mutable identifier state remains.

## Risks, edge cases, and non-goals

**Risks / edge cases**

- **Behavioral change at launch.** Wiring trust+isolation into `launchInstance`
  will *deny launches that previously succeeded* (e.g. a non-bundled app). This
  is the intended correctness fix, but it can break any in-tree caller once the
  platform is wired live — mitigated by the fact that the folder has no
  production consumers today (the live wiring is Phase 6/7 follow-up coordinated
  with bootstrap).
- **Contract collapse is breaking and cross-folder.** Phase 6 depends on item
  006 landing its alignment first; sequence them in one coordinated change set so
  the shim and the dual-field removal land together. Do not attempt the collapse
  blind to 006.
- **Async lifecycle introduces races.** Once `launchInstance` does real async
  work (loader import, eager binding setup), close/suspend during in-flight
  launch must be defined. Add an in-flight guard (instance in `launching` rejects
  competing mutations) as part of Phase 7.
- **maxStartupMs timeout semantics.** A timeout must dispose any partially
  constructed handle/leases to avoid leaks; treat the timeout path as a `crashed`
  transition with full teardown.
- **Boundary-list drift.** If runtime import-graph inspection is infeasible, the
  validator's value is limited; the shared-config approach prevents the
  lint/runtime lists from diverging but does not by itself enforce anything at
  runtime — document the chosen enforcement point explicitly.

**Non-goals**

- Implementing the unimplemented isolation modes (`iframe-sandbox`,
  `worker-sandbox`, `server-side`, `remote-bridge`). They stay declared-valid and
  refused; this plan only ensures the *refusal* is correct and uniform.
- Building a marketplace install/verification pipeline. Phase 3 only consumes a
  verification signal if present; producing real signatures is separate work.
- Editing the canonical contracts in `mog/types/app-platform/src` (item 006) or
  the bootstrap/services wiring beyond flagging them as coordinated follow-ups.
- Replacing the hand-written enablement parser with a library (would add a
  dependency and risk `eval`-class behavior — keep the pure parser).

## Parallelization notes and dependencies on other folders

- **Independent / parallelizable now (in-folder, additive):** Phase 1 (id
  source), Phase 4 (contribution gating + policy fix), Phase 5 (validation depth,
  boundary-list consolidation), and most of Phase 7 (error model, listener
  guarding, GC) need no other folder and can proceed immediately, each with its
  own tests.
- **Coordinated with item 006 (`mog/types/app-platform/src`):** Phase 6 (contract
  collapse) is the highest-leverage outcome — it removes the dual-source-of-truth
  hazard — but is breaking and must land in lockstep with 006's cross-module
  alignment and hard-brand. 006's plan already names this folder (queue item 066)
  as the coordinated counterpart.
- **Coordinated with shell bootstrap (`mog/shell/src/bootstrap`, `services/`,
  `context/`):** making the enforced launch path *live* (constructing the managers
  with trust/isolation deps and routing real document open/new/switch through
  `AppInstanceManager`) edits files outside this folder. This plan delivers the
  enforcing platform; the bootstrap folder's work adopts it. The
  `spreadsheet-resource-adapter.ts` bridge is the intended first integration
  point.
- **Downstream consumers to re-typecheck after Phase 6:** any future importer of
  `@mog/shell/platform`, plus the conformance fixtures that construct
  `RouteSnapshot`/`ResolvedResourceBinding` literally.

---

### Evidence sufficiency

The folder exists and was read in full (all 21 source files plus the
`app-lifecycle-e2e` conformance test and `mog/shell/package.json` export map).
Key claims were verified directly: no production import of any `platform/*`
module exists outside the folder; `evaluateAppLaunch`/`canLaunchApp` have no
non-test callers; `leaseCounter` is module-global; `last-wins`/`first-wins`
branches are identical; the enablement evaluator and `requiredCapabilities` have
no resolution caller. Evidence is sufficient for a full production-path plan; no
blocked sections. The one explicitly deferred item (contract collapse) is gated
on item 006 by design, not by missing evidence.
