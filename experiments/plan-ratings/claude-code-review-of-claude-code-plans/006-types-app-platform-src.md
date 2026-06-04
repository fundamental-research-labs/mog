Rating: 9/10

# Review — Plan 006: Harden `@mog-sdk/types-app-platform` canonical contracts

## Summary judgment

This is a strong, evidence-grounded plan. Every material claim it makes about the
current source was verifiable in the folder: `createAppId`/`createCapabilityId`/etc.
are unchecked `raw as X` casts; `validateAppManifest` checks only top-level
primitives plus a *prefix* semver regex (`/^\d+\.\d+\.\d+/`) and verifies arrays are
arrays without inspecting elements; there is no plugin-manifest validator at all;
`AppManifest.capabilities` and `ManifestRouteDeclaration.requiredCapabilities` are
`readonly string[]`; `ManifestContributionRef.contributionPointId`/`kind` are bare
`string` while `ContributionPointId`/`ContributionKind` exist in `contributions/types.ts`;
`CapabilitySubject` is an all-optional bag despite the existing `SubjectKind` union;
`ICapabilityGrantService.grant`/`revoke` return `void`; `ICapabilityService.requestCapability`
returns `Promise<boolean>`; the package is `private`, `0.1.0`, `dependencies: {}`; the
export map enumerates precise subpaths; tsconfig already excludes `__tests__`/`*.test.ts`
and emits `declaration`/`declarationMap`; and the shell mirror at
`mog/shell/src/platform/types.ts` does carry a soft brand (`__brand?: 'AppId'`) with a
header explicitly stating it "becomes a re-export shim" once this package exists. The
1,514-LOC figure is exact. The plan did not hallucinate its premises.

It correctly identifies the two highest-value issues — the dual-source-of-truth hazard
versus the shell mirror, and the missing plugin-manifest validator on a trust/isolation
boundary — and frames the whole effort around them rather than around cosmetic typing.
The phasing separates purely-additive work from breaking work, defers the one genuinely
cross-team decision (RuntimeHostMode vs PluginIsolationMode) instead of guessing, and
ships a concrete test surface plus verification gates. This is close to the ceiling for a
contract-hardening plan.

## Major strengths

- **Accurate, exhaustive grounding.** Inventory table, LOC, brand divergence, and the
  shell shim header are all real. The "two divergent definitions of the same contracts"
  observation is the correct production framing and is independently confirmable.
- **Security-relevant gap is the centerpiece.** Phase 4 (plugin validation before
  trust/isolation) targets a real, unprotected boundary and rightly classifies
  `isolationMode`/`activationEvents` failures as errors, not warnings.
- **Invariant preservation is explicit and correct.** Zero-dep (no `zod`/`ajv`), hard
  nominal brand, `readonly` fields, and the `export type` / `export` split for
  `verbatimModuleSyntax` consumers are all called out as hard constraints.
- **Drift defense.** The `REQUIRED_MANIFEST_FIELDS: readonly (keyof AppManifest)[]`
  exhaustiveness guard plus a drift test is a pragmatic answer to interface/validator
  skew given no schema library — a failure mode that already exists in the current code.
- **Single-source formats.** Centralizing `APP_ID_RE`/`SEMVER_RE`/`CAPABILITY_ID_RE`/
  `ROUTE_PATH_RE` so parsers and validators share one regex, and replacing the prefix
  semver with a complete pattern (rejecting `1.2.3-garbage`), is exactly right.
- **Honest sequencing of breakage.** Phases 5–6 are flagged as breaking and gated behind
  coordination with the shell platform plan (item ~066), with import-cycle and
  over-strict-validation risks pre-identified and mitigated.

## Major gaps or risks

- **Phase 2 is mis-labeled as "additive / parallelizable now."** Adding a *required*
  `manifestSchemaVersion` to `AppManifest` and `PluginManifest` is a breaking change to
  the interface: every existing manifest literal, fixture, and the validator's own
  required-field set must change in lockstep, and the new drift guard
  (`REQUIRED_MANIFEST_FIELDS`) will *enforce* that the validator demands it. Yet the
  parallelization section lists Phase 2 among the "no other folder needs to change"
  additive set. This is an internal inconsistency: Phase 2 should either be grouped with
  the coordinated breaking phases, or `manifestSchemaVersion` should land optional-first
  with a warning and be tightened to required in the same change set as the shell shim.
- **Two parallel error vocabularies.** Phase 1 introduces `ParseResult<T>` with a free-text
  `reason: string`, while validation uses `ValidationDiagnostic` with machine `code` +
  `path`. The plan doesn't say how a `parseX` rejection reason maps to a validator
  diagnostic code, so the two can drift (e.g. a parser rejects an id the validator accepts,
  or with a different message). A note that parsers reuse the same `code` constants would
  close this.
- **`CapabilitySubject.pluginId?: string` is unbranded and not explicitly flagged.** Phase 5
  targets loose-typing drift, but the most obvious instance inside `CapabilitySubject`
  itself — `pluginId` typed as bare `string` rather than `PluginId`, plus `workspaceId`/
  `tenantId`/`resourceBindingId` as bare strings — isn't named. The discriminated-union
  rework should explicitly state which of these become branded, since `PluginActivation.grantSubject`
  and the grant records depend on it.
- **Drift guard covers presence, not shape.** `REQUIRED_MANIFEST_FIELDS` forces the
  validator to acknowledge new *required keys*, but nothing forces nested element validators
  (compatibility/route/contribution element shapes) to stay in sync when those nested
  interfaces gain fields. The plan acknowledges this is a "cheap structural defense" but
  could note the residual exposure so implementers don't over-trust it.
- **Unverified tooling reference.** Gate 4 cites
  `mog-internal/tools/inventory-sdk-contract-graph.mjs`; the plan asserts it resolves all
  subpaths but doesn't confirm the tool exists or what failure looks like. Minor, but a
  one-line "confirm tool present" would harden the gate.

## Contract and verification assessment

The contract direction is sound: nominal brands gain a validated parse path without losing
the unchecked cast for trusted/perf paths; manifest cross-references move from `string[]`
to the package's own `CapabilityId`/`ContributionPointId`/`ContributionKind`; service
signatures stop discarding decision/audit information (`void` grants → returning the
`CapabilityGrant`/`GrantDecision`; `boolean` request → `{ granted, decision }`); and the
`CapabilitySubject` bag becomes a `SubjectKind`-keyed discriminated union so consumers can
narrow. The `PlatformError` data-type (not an `Error` subclass) for documenting Promise
rejection contracts is the right call for a runtime-free package. The plan correctly
recognizes the potential `manifest/types → contributions/capabilities` import cycle from
Phase 5 and pre-plans the `core/` hoist mitigation; given `manifest/types` is currently the
leaf the others import *from*, this cycle is real and the mitigation is appropriate.

Verification gates are concrete and appropriately scoped to the implementer: typecheck with
declaration emit, new unit tests, a grep-enforced zero-dependency check, downstream
`mog/shell` re-typecheck, and subpath resolution. The test surface (per-field code+path
assertions, bad-enum/bad-semver cases including the previously-passing `1.2.3-garbage`,
nested element failures, duplicate route/contribution, schema-version warning, a brand
`@ts-expect-error` strength fixture, and the drift test) is genuinely targeted at locking
the invariants rather than padding coverage. The main weakness is the missing link between
the `ParseResult` reason vocabulary and the diagnostic `code` vocabulary noted above.

## Concrete changes that would raise the rating

1. **Reclassify Phase 2.** Either move the *required* `manifestSchemaVersion` into the
   coordinated breaking set (with the shell shim), or land it optional-with-warning first
   and tighten to required alongside Phases 5–6. Remove it from the "additive / no other
   folder changes" list. (This is the one substantive consistency fix.)
2. **Unify the error vocabulary.** State that `parseX` rejection `reason`s reuse the same
   `code` constants as `ValidationDiagnostic` (e.g. `INVALID_ID_FORMAT`), and that the
   regexes are imported from the single shared formats module so a parser and the validator
   can never disagree on acceptance.
3. **Name the `CapabilitySubject` field-typing fixes explicitly** in Phase 5: which of
   `pluginId`/`workspaceId`/`tenantId`/`resourceBindingId` become branded vs stay `string`,
   and confirm `PluginActivation.grantSubject` and `CapabilityGrant.subject` still typecheck
   after the discriminated-union rework.
4. **Acknowledge the drift guard's limit** — presence-only, not nested-shape — so the
   exhaustiveness mechanism isn't over-trusted, and consider a sibling guard for the
   element-level validators.
5. **Confirm gate-4 tooling exists** (`inventory-sdk-contract-graph.mjs`) and state the
   expected pass signal, so the gate is runnable rather than aspirational.

These are refinements, not redesigns; the plan's architecture, scope discipline, and
evidence quality are already high.
