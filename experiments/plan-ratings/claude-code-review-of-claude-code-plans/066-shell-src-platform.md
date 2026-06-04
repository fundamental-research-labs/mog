Rating: 9/10

# Review — Plan 066: `mog/shell/src/platform`


## Summary judgment

This is an unusually strong, evidence-grounded plan. It correctly diagnoses that
the folder's defining problem is *integration and self-contradiction*, not
absence: the pieces (registries, lifecycle state machines, trust, isolation,
resolution, enablement) are individually built and tested, but are not wired into
a single enforced path, and several are dead or behaviorally wrong. I
independently verified the central claims against source and every one held:

- `launchInstance` (`app-instance-manager.ts:107`) only checks registered+enabled
  then flips to `running`; the body literally carries the "In future versions,
  this would set up … resolve resource bindings, and initialize host services"
  comment. `closeInstance` (`:160`) has a "Dispose subscriptions and handles"
  comment with no disposal code.
- `evaluateAppLaunch` and `canLaunchApp` have **no non-definition callers**;
  `resolveTrustSource` (`trust-integration.ts:68`) only ever returns
  `bundled-first-party` or `unknown`, so the `local-dev`/`marketplace-*` arms of
  `evaluateSource` and the whole `allowLocalDev` field are dead.
- `createAppInstanceId` (`types.ts:185`) uses `Date.now()+Math.random()`;
  `leaseCounter` (`resource-binding-service.ts:68`) is module-global, violating
  the advertised per-host isolation.
- The `last-wins` and `first-wins` branches (`contribution-resolver.ts:146-177`)
  are behaviorally identical (both keep first occurrence in sorted order).
- `requiredCapabilities` and `evaluateEnablementPredicate` have no resolver
  caller; `validateRuntimeHostCompatibility` (`validation.ts:33`) is never called
  while `enablePackage` (`package-registry.ts:172`) hand-rolls the same check.
- `RouteSnapshot` carries both `kind?` and `target?`; `ResolvedResourceBinding`
  carries both `resourceRef?` and `resourceId?`; brands are soft (`__brand?`
  optional). The canonical `mog/types/app-platform/src` and the item-006 plan
  both exist, as claimed.

The plan turns these findings into a coherent, well-sequenced, fail-closed
program of work with concrete file/line targets, explicit preserve-vs-strengthen
invariants, phase-aligned test specs, and honest cross-folder coordination
flags. It earns a high rating on specification quality, contract clarity, and
verification design.

## Major strengths

- **Diagnosis precision.** Claims are cited to file:line and verifiable; the
  "Evidence sufficiency" section is accurate, not boilerplate. This is the
  difference between a plan that can be executed and one that must be
  re-investigated.
- **Sequencing.** Additive in-folder phases (1 identity, 4 resolution, 5
  validation, most of 7 error model) are correctly marked independent and
  front-loaded; the breaking, externally-gated work (Phase 6 contract collapse,
  live wiring) is deferred and explicitly tied to item 006 and the bootstrap
  layer. The dependency graph is right.
- **Invariant discipline.** The "preserve vs strengthen" split is a genuine
  contract: fail-closed defaults, purity/no-`eval` of resolution, per-host
  ownership, reserved-namespace enforcement, listener-error isolation. New checks
  are specified deny-by-default, which is the correct posture for a trust/isolation
  substrate.
- **Test gates map 1:1 to phases** and target exactly the previously-dead code
  paths (asserting `evaluateSource` branches now execute, deterministic ids
  across seeded hosts, `last-wins ≠ first-wins`, double-launch returns a denial
  instead of throwing). The grep-based gate ("`evaluateAppLaunch`/`canLaunchApp`
  now have production callers; no module-global mutable id state") is a clean,
  objective acceptance criterion.

## Major gaps or risks

1. **Production-path relevance is aspirational, and the plan slightly
   over-frames it.** The folder has *zero* production consumers today (I confirmed
   no `src/platform/*` import exists anywhere in `mog/shell/src`; the "platform"
   imports in `bootstrap/services/context` all resolve to `@mog-sdk/contracts/platform`
   and `@mog/platform`, unrelated packages). So "an unenforced launch path is a
   security gap" is true only *prospectively* — nothing launches an app through
   this code in production. The plan does acknowledge this in Risks, but it
   doesn't grapple with the prioritization consequence: hardening a fully-unwired
   substrate is lower-leverage than a thin live wiring of the spreadsheet app
   would be. A short "why harden before wiring" justification (e.g. "the enforced
   path must exist and be conformance-locked before bootstrap can safely adopt it")
   would close this.
2. **Phase 2 leans on a loader/entry contract it doesn't pin down.** It invokes
   "the app's `AppEntryFunction` from the loader" and retains an
   `AppRuntimeHandle`, but doesn't establish whether those types/shapes exist and
   are honored by current registered loaders, or whether app instantiation
   semantics must be defined here first. This is the largest phase and the most
   likely to balloon; it deserves an explicit sub-step confirming/defining the
   loader→entry→handle contract before the pipeline rewrite.
3. **Override-policy fix is under-specified.** Saying `last-wins` should "keep the
   lowest-priority/last" is directionally right, but the precise tiebreak
   (priority value vs sort index, and what "wins" means when priorities tie) is
   left implicit. Since the bug is that the two branches are identical, the fix
   must state the exact ordering semantics to be testable.
4. **`maxStartupMs` timeout teardown is genuinely hard** and only sketched. The
   plan flags it in Risks (dispose partial handle/leases → `crashed`), but a
   timeout racing against an in-flight async loader is the kind of thing that
   needs a defined cancellation contract, not just a transition. Pairing it
   explicitly with the Phase-7 in-flight guard would help.
5. **Boundary-validator enforcement remains genuinely unresolved.** The plan is
   honest that runtime import-graph inspection may be infeasible and that the
   shared-config fallback "does not by itself enforce anything at runtime." That's
   the right candor, but it means Phase 5's boundary work may land as
   documentation + drift-prevention rather than enforcement. Acceptable, but the
   "or be removed" option should be a real branch, not a footnote.

## Contract and verification assessment

Contract clarity is high. The plan names the typed result shapes
(`LaunchResult`-style denials with distinct `launchDenied`/`unsupportedIsolation`
reasons), specifies the dual-field collapse targets and the hard-brand adoption,
and ties each to its consumer (the `AppResourceBindingSnapshot` projection,
route handling, conformance fixtures). The error-model unification (return typed
`Result` everywhere vs the current `Result`-for-launch / `throw`-for-everything-else
split) is correctly identified — I confirmed `transition` throws on invalid
transitions and dispatches listeners without try/catch, so the double-launch and
throwing-listener failure modes are real.

Verification gates are concrete and runnable by the implementer: scoped
typecheck, full unit+conformance suite, a post-Phase-6 cross-package build, and
the grep assertion on caller existence. The compile-time fixture for the hard
brand (rejecting raw `string` assignment) is the right way to lock a brand change.
One gap: there is no stated gate for the **behavioral-regression** risk the plan
itself raises (launches that previously succeeded now denied) — since there are
no live callers this is currently moot, but the plan should note that the
regression gate becomes mandatory at bootstrap-adoption time.

## Concrete changes that would raise the rating

- Add a one-paragraph prioritization rationale: why enforce-then-wire (conformance
  lock before adoption) beats a minimal live wiring first, given zero current
  consumers. This is the main thing separating a 9 from a 10.
- In Phase 2, add an explicit pre-step that confirms or defines the
  `AppLoader → AppEntryFunction → AppRuntimeHandle` contract and what current
  registered loaders actually return, so the pipeline rewrite isn't built on an
  assumed shape.
- Pin the override-policy semantics exactly (priority field vs sort index, tie
  behavior) so the `last-wins ≠ first-wins` test has a defined oracle.
- Promote the `maxStartupMs` timeout + in-flight cancellation into a single
  named contract in Phase 7 rather than split across Phase 2 and Risks.
- State the deferred behavioral-regression gate explicitly as a precondition for
  the bootstrap-adoption follow-up.

Overall: a precise, honestly-scoped, well-sequenced plan whose claims I could
verify line-by-line. The deductions are for the unresolved strategic question of
hardening an unwired substrate and a few under-specified spots in the largest
phase — not for correctness or evidence.
