Rating: 8/10

# Review of 022-kernel-src-security


## Summary judgment

This is a strong, evidence-grounded plan. Its central thesis — that `kernel/src/security`
holds a well-designed but **unexported** next-generation subject/trust model while production
enforcement actually runs through `kernel/src/services/capabilities`, the gated API, and a
**duplicate** shell registry — is accurate and verifiable in the code. The plan correctly
diagnoses a genuine, high-value architectural problem (split/duplicated authorization with
two disagreeing engines) rather than inventing busywork. The invariants section is the
standout: it reads like a security spec, with concrete, testable properties for subject
matching, grant resolution precedence, scope monotonicity, trust gating, and export
boundaries. Sequencing, parallel tracks, risks, edge cases, and non-goals are all present and
sensible.

It loses points for big-bang scope without independently-shippable milestones, and for
under-specifying two migration concerns that the code makes unavoidable: the capability-ID
scheme change (closed union → open namespaced strings) and persisted-store data migration.

## Verification of the plan's factual claims

I confirmed the plan's load-bearing claims against source:

- **Split architecture is real.** `kernel/src/security/index.ts` re-exports almost entirely
  from `../services/capabilities/*` (cap-types, taxonomy, grants, scope, gated-api, manifest,
  types, audit-logger). The new files (`capability-subject.ts`, `capability-registry.ts`,
  `grant-service.ts`, `trust-policy.ts`, `legacy-adapter.ts`) are **not exported** from the
  barrel. The "unexported next-generation model" framing is correct.
- **`trustPolicy` is accepted but unused.** `CapabilityGrantService` stores
  `this.trustPolicy` (grant-service.ts:148,155) but never references it in `grant()` or
  `check()`. Objective 6 ("turn trust policy into an input, not a parallel service") is
  well-founded.
- **Shell duplicates enforcement.** `InMemoryShellCapabilityRegistry`
  (shell/src/services/capabilities/registry.ts) has its own `permissive` mode,
  `expandCapabilities`, `scopeMatches`, expiry filtering, and audit emission, plus a
  `createPermissive...` factory — exactly the "hidden bypass" the plan flags as a risk.
- **Hardcoded first-party set exists.** `launch-app.ts` has `TRUSTED_FIRST_PARTY_APPS` plus
  `isFirstPartyApp`, matching the plan's claim about scattered first-party sets.
- **Gated API binds to `services/capabilities` types** (`scoped-access-checker.ts`,
  `capability-gated-api.ts` import from `../../../services/capabilities/*`), supporting the
  "route through subject-aware checks" objective.

This level of accuracy is the plan's biggest credibility asset.

## Major strengths

- **Invariant-first specification.** The "contracts and invariants" section gives a precise
  resolution order (exact subject before broad, negatives before positives at equal/narrower
  specificity, then most-specific positive) and monotonic scope narrowing. This is far more
  useful than prose objectives and is directly testable.
- **Correctly preserves the public/private boundary.** It keeps the intentional negative
  surface (no stores, factories, sensitive handlers, re-auth, bypass policies) and asks for
  negative export tests — consistent with the existing SDK-conformance philosophy.
- **Realistic consolidation strategy.** "Make the old app-ID registry compose over the
  subject engine" and "thin shell composition over kernel-owned services" is the right shape;
  it explicitly forbids adding a third parallel facade (non-goals).
- **Good edge-case catalogue** (app-allow + instance-deny, expired deny vs allow, implication
  cycles, namespace contention in one batch, managed-table intersection-not-union). These map
  onto real behaviors in the current code (e.g. `getImplied` is already cycle-safe via a
  `visited` set; `findMatchingGrant` currently returns the *first* broad match, not the
  specificity-ordered one — so the plan's resolution work is genuinely needed).
- **Verification gates are concrete and runnable** (per-package `pnpm test -- <filter>` and
  typecheck, plus a repo-level typecheck after cross-package export changes).

## Major gaps or risks

1. **Capability-ID scheme migration is under-specified — and it is the hard part.** Production
   uses a *closed* discriminated union: `CapabilityType` built from `Tier0Capability` etc.
   with single-colon IDs like `'cells:read'`, giving compile-time exhaustiveness across every
   consumer. The new model uses *open* namespaced strings (`'mog:cells:read'`), and
   `extractNamespace` explicitly treats single-colon IDs as "legacy / no namespace." Unifying
   these means either widening every `CapabilityType` consumer to `string` (losing
   exhaustiveness) or maintaining a bidirectional mapping `cells:read` ↔ `mog:cells:read`.
   The plan says to "reconcile `CAPABILITY_REGISTRY`, `CAPABILITY_IMPLIES`, `CORE_CAPABILITIES`
   into one source of truth" but never confronts the type-system cost or the dual-ID mapping.
   This is the single most likely thing to blow up the estimate.

2. **No persisted-data migration story.** `services/capabilities/stores/` contains
   `sqlite-store.ts` and `cloud-store.ts` — grants are persisted by (AppId, CapabilityType).
   Re-keying to `subjectKey || capabilityId` is a storage-format change. The plan mentions
   "explicit migration/system source" for grant *creation* but says nothing about migrating
   existing persisted grants, schema versioning, or read-compat for old rows. For a security
   store, silently dropping or mis-mapping existing grants is a correctness/UX hazard.

3. **`dependsOn` semantics are introduced but undefined.** The current registration shape has
   only `implies`. The plan repeatedly references `dependsOn` (and "revocation of a dependency
   capability should revoke/invalidate dependents") but leaves the meaning open ("includes
   both `implies` and `dependsOn` semantics, or explicitly derive one from the other"). The
   difference between "implies" (transitive grant) and "dependsOn" (precondition) materially
   changes revocation behavior and is the basis of one of the listed edge cases — it should be
   pinned down, not deferred.

4. **Big-bang scope with no independently-shippable milestone.** The plan spans kernel
   security, services/capabilities, gated API, shell registry, launch flow, hooks, host slot,
   types/app-platform, and docs. The parallel tracks help, but every track ultimately depends
   on the canonical contract freeze, and step "adapt old app-ID registry over subject services"
   is a wide blast radius (the risks section admits it "can break shell, app launcher, gated
   API, fixtures, and SDK conformance tests at once"). There is no first increment that lands
   value without touching everything. A safer framing would ship the kernel engine + adapter
   behind the existing public types first, then migrate consumers one at a time.

5. **Grant-resolution algorithm specified by properties, not procedure.** The ordering rules
   are stated as invariants, which is good, but no concrete tie-break procedure is given for
   the case of two grants at equal specificity with conflicting scopes, or how scope
   specificity composes with subject specificity. The implementer is left to re-derive a total
   order; for a security primitive this should be nailed down in the plan.

## Contract and verification assessment

Contract clarity is above average. The public/private split is explicit and matches the
existing barrel's intent; the canonical `GrantDecision` union and single capability-metadata
shape are named; subject constructors and the "reject empty subject" rule are concrete (and
the current `createCapabilitySubject` does *not* reject empties today, so this is a real,
testable change). The proposed compile-time assignability tests between `@mog-sdk/kernel/security`
and `types/app-platform` are exactly the right mechanism to prevent drift — and
`types/app-platform/src/{capabilities,trust}` do exist, so the target is real.

Verification gates are good but have two soft spots: (a) the test matrix asserts *behaviors*
but there is no gate that proves the old shell registry's enforcement results are preserved
across the migration (a differential/parity test between old and new engines would de-risk
step 5 far more than the listed per-feature tests); (b) no gate covers persisted-grant
read-back after the storage re-key (tied to gap #2). The negative-export tests are well
specified.

## Concrete changes that would raise the rating

1. **Add an ID-scheme migration section.** Decide explicitly: keep `CapabilityType` as a
   branded subset of namespaced strings, or introduce a canonical `cells:read ↔ mog:cells:read`
   map with a single normalization function, and state what happens to compile-time
   exhaustiveness for existing consumers. This alone would address the biggest estimate risk.
2. **Add a persisted-store migration plan** for `sqlite-store`/`cloud-store`: schema version
   bump, subject-key encoding, read-compat for legacy (AppId, CapabilityType) rows, and a
   parity/round-trip test gate.
3. **Define `implies` vs `dependsOn` precisely**, including their distinct revocation
   semantics, and tie each to the specific edge-case tests already listed.
4. **Sequence a shippable first increment**: land the subject engine + a green adapter that
   reproduces today's enforcement results (proven by a differential test against the existing
   shell/services registries) before migrating any consumer. Call out which steps are
   reversible behind a flag.
5. **Specify the grant-resolution procedure** as a deterministic total order (subject
   specificity, then polarity, then scope specificity, with the exact tie-break), with a
   worked example for the equal-specificity conflicting-scope case.
6. **Add an explicit decision for `permissive` mode**: name the kernel policy object that
   replaces it, the audit event it must emit, and a test asserting it cannot be constructed
   from the public subpath.

These are refinements to an already well-targeted plan; none undermine its core direction.
