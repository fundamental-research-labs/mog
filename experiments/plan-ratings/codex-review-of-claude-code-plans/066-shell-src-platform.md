Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan for turning `shell/src/platform` from a mostly self-tested substrate into an enforcing app/plugin platform. It correctly focuses on production-path enforcement, public API contracts, lifecycle consistency, determinism, and conformance tests. The rating is held below 9 because the plan under-specifies two central integration contracts: how the current React `AppLoader` becomes an `AppEntryFunction`/runtime handle, and how the local type mirror migrates to the canonical `@mog-sdk/types-app-platform` shapes beyond the two dual-field examples it names.

Major strengths

- The plan accurately identifies the folder as a public `@mog/shell/platform` surface and treats its exported contracts as part of the change, not as private implementation details.
- The core evidence is solid: `AppInstanceManager.launchInstance` only checks enabled registration before transitioning to `running`; trust/isolation are used for plugins but not app launch; `evaluateEnablementPredicate`, `canLaunchApp`, and `PackageBoundaryValidator` have no non-test production callers in this platform path; lease IDs use module-global mutable state; and `last-wins`/`first-wins` resolution are equivalent.
- The objectives are architecturally aligned with Mog's OS-style layering: fail-closed admission, per-host services, deterministic pure contribution resolution, host-scoped identity, and contract consolidation onto the canonical SDK package.
- The sequencing is mostly reasonable: deterministic IDs and resolver fixes can land in-folder first, while canonical type collapse and live shell bootstrap adoption are called out as coordinated work.
- The verification section names behavior-specific conformance tests instead of relying only on typechecking, and it includes grep-based checks for production callers and global mutable ID state.

Major gaps or risks

- Phase 2 assumes the app loader can produce an `AppEntryFunction` and `AppRuntimeHandle`, but the current `AppLoader` imported by `platform/types.ts` from `shell/src/apps/types.ts` returns `Promise<{ default: React.ComponentType<AppProps> }>`; the conformance fixtures use that shape too. The plan needs an explicit contract decision: adapt React component loaders into platform runtime handles, change the loader type, or split "admit launch" from "mount UI" across the bootstrap/render layer.
- The contract-collapse phase is under-enumerated. The canonical package differs from `platform/types.ts` in hard brands, yes, but also in `ResourceRef`, `AccessMode`, `SetupPolicy`, `ResolvedResourceBinding`, `AppResourceBindingSnapshot`, `AppHostContext`, host service method names/async behavior, lifecycle states, and several package/trust shapes. A migration table is needed before implementers can safely collapse the mirror.
- Capability grant integration is too abstract. The plan says to inject a capability/grant accessor and auto-grant bundled apps, but it does not specify the source of grants, the subject model, how user consent/admin grants compose with existing shell capability context, or how denied capabilities flow into host services and contribution filtering.
- The plan acknowledges that `shell/src/platform` is not wired into the live shell launch path, but it still labels several Phase 2 outcomes as production-path fixes. That is acceptable only if the acceptance boundary is explicit: first make the substrate enforceable, then a separate/bootstrap phase must route real shell launch through it before the security claim is complete.
- The proposed default `IdSource` still needs a precise determinism contract. "Host-unique prefix" can reintroduce nondeterminism if it comes from time/randomness; tests and SSR need an injected, seedable source and production needs a scoped source that does not violate per-host isolation.

Contract and verification assessment

The preservation and strengthening invariants are good: per-host ownership, fail-closed admission, pure resolver logic, manifest validation at registration, public barrel stability, namespace enforcement, and listener error isolation are all the right contracts. The lifecycle/error contract needs more concrete result shapes, especially for trust denial, unsupported isolation, startup timeout, missing grants, binding diagnostics, invalid transition, and in-flight launch cancellation.

The proposed gates are relevant, but should be expanded for this public surface. In addition to `pnpm --filter @mog/shell typecheck`, platform tests, the canonical types package build, and grep checks, the plan should require a typecheck/build gate for existing consumers such as `@mog/app-spreadsheet`'s canonical manifest import from `@mog/shell/platform`. After the loader contract decision, the tests should also prove that the chosen React-component or entry-function path is actually exercised, not only that an instance state flips.

Concrete changes that would raise the rating

- Add a Phase 0 "loader/runtime contract reconciliation" that decides how `AppLoader`, `AppEntryFunction`, React mounting, and `AppRuntimeHandle.dispose()` compose, with before/after type signatures and tests.
- Add a canonical-type migration matrix covering every divergent exported type, not only brands and dual route/resource fields, plus the downstream packages that must typecheck.
- Define a `CapabilityGrantProvider` or equivalent interface with subject identity, auto-grant rules, denied-grant behavior, and contribution/host-service filtering semantics.
- Split acceptance criteria into "platform substrate now enforces admission when called" and "live shell bootstrap uses the enforcing path", with a named follow-up owner if the second remains out of folder.
- Specify the exact ID source API and default implementation constraints: no `Date.now()` or `Math.random()` for IDs, seedable tests, per-host scope, and no module-level counters.
- Add public-surface verification gates for the `@mog/shell/platform` export and known consumers, including declaration emit and at least one consumer typecheck after Phase 6.
