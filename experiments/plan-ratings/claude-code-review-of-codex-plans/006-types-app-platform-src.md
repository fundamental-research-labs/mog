Rating: 8/10

# Review of 006: Improve `mog/types/app-platform/src`

## Summary judgment

This is a strong, accurately-diagnosed plan. Its central thesis — that
`@mog-sdk/types-app-platform` *looks* canonical but the shell production path
actually executes against a separately-drifted local mirror in
`shell/src/platform/types.ts` — is true and verifiable in the tree. I confirmed
the mirror file carries the literal "defined locally until
`@mog-sdk/types-app-platform` is published … Mirrors `@mog-sdk/types-app-platform`"
comment, that the shell mirror uses divergent field names (`targetPointId`,
`contributionId`, `isolation`, `toolbarItem`, `fileHandler`,
`PluginManifest`-with-`id`) while the canonical package uses
`targetContributionPointId`, `isolationMode`, and `PluginManifest.pluginId`, and
that the canonical package today has **no test files and no `test` script**
(only `typecheck`). The plan's objectives, invariants, and sequencing follow
directly from real conditions rather than speculation. The main thing keeping it
from a 9–10 is that it identifies every divergence but defers the actual
"which name wins" decisions to the implementer, and it underplays the size and
risk of the shell migration it prescribes.

## Major strengths

- **Diagnosis is correct and falsifiable.** Every drift example in the plan
  (§13, §90) maps to a real line in either the canonical package or the shell
  mirror. The plan is not inventing problems.
- **Boundary discipline is explicit and right.** Objectives 1/5 and the
  invariants section correctly insist the package stay
  workspace-internal/`private: true`, contracts-only, dependency-free, and
  serializable across the declared host modes — matching the package's own
  top-of-file contract and `package.json` (`"private": true`, empty
  `dependencies`).
- **Correctly refuses compatibility shims.** Telling the implementer to *decide*
  `id` vs `pluginId`, `targetPointId` vs `targetContributionPointId`, sync vs
  async storage once and migrate both sides — rather than carrying dual names —
  is the right call and prevents the drift from simply relocating.
- **Verification gates are concrete and layered**: package test + typecheck,
  shell `src/platform` test + typecheck, repo-wide typecheck, public-boundary
  check, and publish-readiness. The plan honestly flags that the package test
  script must be *added first* before the first gate can run — a real gap it
  did not paper over.
- **Type-strengthening targets are well-chosen.** `CapabilitySubject` is indeed
  an all-optional property bag today (every field `?`), so the "exactly one
  principal shape / no empty-subject" objective is justified. Likewise
  `ContributionDeclaration` is a loose base that concrete kinds (`command`,
  `menu`, `panel`, `file-handler`) extend, but consumers
  (`ResolvedContribution.declaration`, `PluginManifest.contributions`) reference
  the base — so the "explicit discriminated union" objective is accurate, not
  redundant.
- **Sequencing and parallelization** (Agent A→B→C→D, boundary/docs last) is
  sensible: shell migration depends on the frozen field matrix, and recording
  boundary/inventory state last avoids documenting an intermediate reality.

## Major gaps or risks

- **The plan stops at "decide each divergent field once" without deciding.**
  Step 1 prescribes producing the matrix and resolving each conflict "based on
  production semantics," but never states the resolution. For a plan whose whole
  value is collapsing two contracts into one, leaving the canonical winners
  unspecified pushes the highest-judgment work onto the implementer. At minimum
  it should assert the default rule (canonical package shape wins unless
  production semantics force otherwise) and name the handful of fields where
  production semantics genuinely differ (e.g. numeric vs ISO timestamps, sync vs
  async storage API).
- **Shell migration scope is large and under-bounded.** Step 5 touches ~15
  platform files (package/app/instance registries, host context factory, host
  services, resource binding, contribution registry/resolver, boundary
  validator, trust integration, isolation enforcer, activation manager) plus all
  their fixtures, in lockstep with the contract change. The plan's only stated
  mitigation for the "largest risk" (silent drift) is "do it in the same
  change" — which is correct in principle but offers no incremental landing
  strategy, no per-subsystem checkpoint, and no rollback story for a change set
  this wide. This is the biggest practical risk to execution.
- **Test tooling is unspecified.** The plan says "add package test tooling and
  script support" but names no runner. Given the gate is
  `pnpm --filter @mog-sdk/types-app-platform test`, the implementer needs to know
  whether to wire vitest (the repo's apparent convention) and how to keep test
  files out of `dist` — the plan gestures at the latter but does not say how
  (e.g. `tsconfig` exclude vs separate test config).
- **`development` vs `dist` export condition not addressed.** The package
  exposes a `development` condition pointing at `./src/*.ts` and a default
  pointing at `./dist`. Consumers in dev resolve to source; CI/publish resolve to
  `dist`. The plan correctly says to regenerate `dist`, but does not call out
  that shell typecheck/test results can differ depending on which condition
  resolves — a real footgun when proving "package, declarations, and shell
  agree."
- **Capability dependency/implied-capability cycle detection** is listed as a
  validator to add (good), but the plan does not note that
  `CapabilityMetadata` cycles are a *registry-graph* property, not a
  single-manifest property — so it needs registry-level fixtures, not just
  per-manifest ones. Minor, but the test design implication is unstated.

## Contract and verification assessment

The contract analysis is the plan's strongest dimension. The invariants section
reads like a genuine spec: validators-before-registration, deterministic
path-addressed diagnostics with stable codes, branded IDs validated at
construction (today `createCapabilityId`/`createPluginId` simply cast with no
format check — confirmed), no leakage of lease/grant/policy internals into
app-facing snapshots, and explicit canonical denial states for unsupported
isolation modes (`PluginInstanceState` already includes `unsupportedIsolation`,
so the contract surface for this exists). `ValidationResult` is already
`{ valid, errors, warnings }`, so "standardize across the package" is a
consolidation task, not a redesign — the plan slightly overstates this as new
work but the direction is harmless.

Verification gates are appropriate and ordered from narrow to broad. The
weakness is purely that the first gate is not yet runnable (no test script) and
the plan, while flagging this, does not specify the tooling to make it runnable.
The shell-conformance requirement ("exercise the real registry/resolver/
activation manager rather than direct state mutation") is exactly the right bar
to prevent tests that pass against a private contract.

## Concrete changes that would raise the rating

1. **Resolve the divergences in the plan, not just enumerate them.** Add a short
   decision table (field, canonical winner, why) for at least: `id`/`pluginId`,
   `targetPointId`/`targetContributionPointId`, `isolation`/`isolationMode`,
   `toolbarItem`/`fileHandler` vs discriminated `kind`, numeric vs ISO
   timestamps, and sync vs async storage API. State the default rule
   ("canonical package shape wins unless noted").
2. **Make the shell migration incremental and checkpointed.** Define a landing
   order (e.g. re-export shim first → registries → resolver/activation → host
   services), with `pnpm --filter @mog/shell typecheck` green at each step, so
   the wide change set has internal checkpoints rather than one big-bang diff.
3. **Name the test runner and dist-exclusion mechanism** so the first
   verification gate is actually executable, and add a one-line note that
   shell verification must pin the export condition (source vs `dist`) it runs
   against.
4. **Clarify graph-level validators.** Specify that implied/dependent-capability
   cycle detection and contribution conflict rules need registry-level fixtures,
   distinct from single-manifest fixtures.
5. **Add an explicit acceptance criterion** that `shell/src/platform/types.ts`
   contains zero locally-defined contract types after migration (only re-exports
   plus genuinely shell-only types like `AppLoader`), so "single source of
   truth" is mechanically checkable rather than aspirational.

---

*Evidence basis: read `mog/types/app-platform/src/{index,manifest/validation,
capabilities/types,plugin/types,contributions/types}.ts` and
`package.json`; inspected `mog/shell/src/platform/types.ts` and directory
listing; confirmed canonical-package imports in shell are limited to
`types.ts` and `package-boundary-validator.ts`; confirmed the package has no
test files and only a `typecheck` script. Read-only inspection; no plan or
production files modified.*
