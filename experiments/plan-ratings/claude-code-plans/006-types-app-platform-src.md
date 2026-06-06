# Plan 006 — Harden `@mog-sdk/types-app-platform` canonical contracts

## Source folder and scope

- **Folder:** `mog/types/app-platform/src`
- **Package:** `@mog-sdk/types-app-platform` (version `0.1.0`, `private: true`, contracts-only, zero runtime deps).
- **In scope:** the contract surface under `src/` — the eight contract modules
  (`manifest`, `package`, `lifecycle`, `routing`, `services`, `capabilities`,
  `contributions`, `plugin`, `trust`), the per-module `index.ts` barrels, the
  root `index.ts`, and the only non-type-only file, `manifest/validation.ts`.
- **Out of scope (folder boundary):** the consuming shell code in
  `mog/shell/src/platform/*`, the `package-boundary-validator`, `dist/`, and
  `package.json` `exports`. These are referenced under *Dependencies* because the
  improvement is incomplete without them, but they belong to other queue items
  (notably the shell platform folder) and are **not** edited by this plan beyond
  what is called out as a coordinated follow-up.

### Inventory (1,514 LOC, all under `src/`)

| Module | `types.ts` | other | Exports a value? |
|---|---|---|---|
| `manifest` | 159 | `validation.ts` (221) | `createAppId`, `validateAppManifest`, `isValidAppManifest` |
| `contributions` | 183 | — | `createContributionPointId` |
| `routing` | 188 | — | — (types only) |
| `services` | 158 | — | — (types only) |
| `plugin` | 128 | — | `createPluginId` |
| `capabilities` | 125 | — | `createCapabilityId` |
| `lifecycle` | 86 | — | `createAppInstanceId` |
| `package` | 65 | — | `createPackageId` |
| `trust` | 54 | — | — (types only) |

`manifest/validation.ts` is the only file containing real logic; everything else
is type declarations plus unchecked branded-id constructors.

## Current role of this folder in Mog

This package is the **canonical, product-neutral contract layer** for Mog's
app/plugin platform: the typed vocabulary that the shell, plugin host, capability
broker, trust/policy engine, and package registry are all supposed to agree on.
It defines:

- **Identity & manifests** — `AppManifest`, `PluginManifest`, branded
  `AppId`/`PluginId`/`PackageId`/`AppInstanceId`/`CapabilityId`/`ContributionPointId`.
- **Install/trust** — `PackageInstallationRecord`, `TrustPolicyDecision`,
  `ITrustPolicyService`, `ICapabilityGrantService`, `CapabilityGrant`.
- **Runtime host surface** — `ShellHostServices` (10 service interfaces),
  `AppHostContext`, `AppEntryFunction`, lifecycle snapshots.
- **Extension model** — contribution points/declarations, route targets, resource
  binding descriptors and leases.
- **Validation** — `validateAppManifest` / `isValidAppManifest`.

The package is the dependency-free root of the platform contract graph: every
other module imports from `manifest/types` (the brand + stability/compat
primitives live there). The package's stated invariant (root `index.ts` header)
is *"Contracts-only: TypeScript types, validators, and pure helpers. No React,
shell implementation, kernel internals, or runtime-specific imports."*

**Critical observation — the contracts are not yet the source of truth.**
`mog/shell/src/platform/types.ts` (581 LOC) is a hand-maintained parallel copy
whose header says it exists *"until `@mog-sdk/types-app-platform` is published …
Once that package exists, this file becomes a re-export shim."* The canonical
package now exists, so the platform currently carries **two divergent
definitions of the same contracts**. The shell brand (`AppId = string & { __brand?: 'AppId' }`,
a soft optional brand) is already structurally different from the canonical brand
(`AppId = string & { readonly [unique symbol] }`, a hard nominal brand). This
divergence is the single biggest production risk in the area and frames the plan.

## Improvement objectives

1. **Make the package safe to adopt as the single source of truth** so the shell
   mirror can collapse to a re-export shim without losing type strength
   (objective that unblocks the shell folder's own plan).
2. **Close the plugin-manifest validation gap.** Untrusted plugin manifests reach
   a trust/isolation boundary with *no structural validator* — only
   `validateAppManifest` exists. This is a correctness and security gap.
3. **Deepen `validateAppManifest`** from "are the top-level fields the right
   primitive type" to "are the nested element shapes, enums, and formats valid,"
   and make it provably consistent with the `AppManifest` interface.
4. **Eliminate cross-module type drift** where the manifest declares loosely-typed
   `string[]` for things that have a branded/enum contract elsewhere
   (capabilities, contribution point ids, contribution kinds, route capabilities).
5. **Introduce contract schema versioning** so the package can evolve without
   silently breaking consumers and stored records.
6. **Give the brand constructors a validated variant** so the nominal brand
   actually implies the documented format invariant.
7. **Tighten service / trust / capability-subject contracts** that currently lose
   information (`void`-returning grants, optional-bag subjects, untyped errors).
8. **Add the test surface** (currently zero) that locks these invariants in.

All objectives are production-path strengthening of the public contract — no
shims, no scope reduction, no test-only changes substituting for a real fix.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (hard invariants — do not regress):**

- **Zero runtime dependencies and no React/shell/kernel imports.** Every change
  must keep `dependencies: {}` and import nothing outside the package. This rules
  out pulling in `zod`/`ajv`; validation stays hand-written and pure.
- **Subpath export map stability.** `package.json` exposes precise subpaths
  (`./manifest`, `./manifest/types`, `./manifest/validation`, `./capabilities`,
  …). New files must be added to both the barrel and the export map; existing
  subpaths must keep resolving.
- **Nominal branding via `unique symbol`.** The hard brand is a deliberate
  strengthening over the shell's soft brand; keep it.
- **`readonly` on every contract field.** Contracts are immutable data shapes;
  preserve `readonly`/`Readonly<…>`.
- **Type-only re-exports.** Barrels use `export type { … }` for types and
  `export { … }` only for the value constructors/validators — keep that split so
  `isolatedModules`/`verbatimModuleSyntax` consumers are unaffected.

**Strengthen (the work):**

- `validateAppManifest` must be a *total* function over `unknown` that never
  throws and whose set of checked fields is kept in lockstep with `AppManifest`.
- The branded id format documented in the JSDoc/regex (`/^[a-z][a-z0-9._-]*$/`
  for `AppId`, semver for `version`) must be enforceable at construction, not only
  during full-manifest validation.
- A plugin manifest is structurally validated before it can be trusted/isolated.
- Manifest cross-references (`capabilities`, route `requiredCapabilities`,
  contribution `contributionPointId`/`kind`) must use the same nominal/enum types
  the rest of the package already defines.

## Concrete implementation plan

### Phase 1 — Validated brand constructors (foundation, no breaking changes)

The brands today are escape hatches: `createAppId(raw)` is an unchecked
`raw as AppId`, so the nominal type guarantees nothing about format. Add a
validated, non-throwing parse variant alongside each existing constructor and a
shared result type, keeping the unchecked cast for internal/perf paths.

- Add `manifest/brand.ts` (or extend `manifest/types.ts`) exporting a tiny
  shared `ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }`
  used package-wide.
- For each branded id, add `parseAppId`, `parseCapabilityId`,
  `parsePluginId`, `parsePackageId`, `parseContributionPointId`,
  `parseAppInstanceId` returning `ParseResult<…>`, enforcing the documented
  format (single canonical `ID_RE`/`CAPABILITY_ID_RE` shared with validation —
  see Phase 3 for the single-source regex).
- Keep `createAppId` etc. as the explicit "I already validated this / trusted
  source" cast, and document that contrast in JSDoc.

This is purely additive — existing exports keep working.

### Phase 2 — Contract schema versioning

Neither `AppManifest` nor `PluginManifest` carries a schema version, yet
`ContributionPointRegistration` and `PackageInstallationRecord` do
(`schemaVersion`, `manifestDigest`). Without a manifest schema version, the
contract cannot evolve safely and stored `manifestDigest`s are unanchored.

- Add `export const APP_PLATFORM_CONTRACT_VERSION = '1.0.0'` (and a
  `ContractVersion` type) to the package root.
- Add a required `readonly manifestSchemaVersion: string` to `AppManifest` and
  `PluginManifest`. Because the package is `0.1.0` and `private`, this is the
  right moment to make it required rather than optional.
- `validateAppManifest`/the new plugin validator emit a **warning** (not error)
  when `manifestSchemaVersion` major differs from the package's supported major,
  using the existing `warnings` channel that is currently always empty.

### Phase 3 — Single-source formats + deepened manifest validation

`manifest/validation.ts` today checks top-level primitive types and a partial
semver prefix (`/^\d+\.\d+\.\d+/`), and verifies arrays *are arrays* without
inspecting elements. Strengthen it:

- **Centralize formats.** Move `APP_ID_RE`, a full `SEMVER_RE`, a new
  `CAPABILITY_ID_RE`, and a `ROUTE_PATH_RE` into one shared module that both the
  Phase-1 parsers and the validators import. Today's `SEMVER_RE` only matches a
  prefix; replace with a complete semver pattern (with pre-release/build) so
  `1.2.3-garbage!!` is rejected.
- **Validate array element shapes**, each producing a path-scoped diagnostic:
  - `compatibility[i]`: `{ profile: string, versionRange: valid-range }`.
  - `capabilities[i]`: non-empty string matching `CAPABILITY_ID_RE`.
  - `routes[i]`: `path` matches `ROUTE_PATH_RE`; `requiredCapabilities` (if
    present) are valid capability ids; duplicate-path check is kept.
  - `contributions[i]`: required `contributionPointId`/`kind`/`id`; `kind`
    against the `ContributionKind` union; duplicate-id check is kept.
  - `data`: `stores`/`resourceKinds` are string arrays when present.
  - `lifecycle`: `suspendable`/`background` boolean, `maxStartupMs` positive
    number when present.
- **Coherence checks** (warnings): e.g. `kind: 'background-app'` with
  `runtimeHost: 'disabled'` is suspicious; `runtimeHost: 'server-side'` with a
  client-only entry export. These are advisory, not blocking.
- **Drift guard.** Add an internal exhaustiveness mechanism so a new required
  `AppManifest` field cannot be added without the validator acknowledging it —
  e.g. a `const REQUIRED_MANIFEST_FIELDS: readonly (keyof AppManifest)[]` typed
  array that the compiler forces to stay total, iterated by the validator. This
  is the cheap structural defense against the "interface and validator drift"
  failure mode given we cannot pull in a schema library.

### Phase 4 — Plugin manifest validation (the security gap)

Add `plugin/validation.ts` mirroring the manifest validator, exported via the
`./plugin` barrel and a new `./plugin/validation` subpath:

- `validatePluginManifest(input: unknown): ValidationResult` (reuse the
  `ValidationResult`/`ValidationDiagnostic` types — promote them to a shared
  `validation/` location, or re-export from `manifest/validation`, so they are not
  manifest-specific).
- `isValidPluginManifest(input): input is PluginManifest`.
- Validates `pluginId` format, `version` semver, `hostCompatibility[]`,
  `extends[]` against `PluginExtensionTarget`, `entry.module`, `contributions[]`
  against the full `ContributionDeclaration` shape (not just id), `capabilities[]`
  ids, `activationEvents[]` (`kind` against `ActivationEventKind`, `selector`
  presence rules per kind), and `isolationMode` against `PluginIsolationMode`.
- Because untrusted plugins hit `ITrustPolicyService`/isolation, the
  `isolationMode` and `activationEvents` checks are **errors**, not warnings.

### Phase 5 — Cross-module type alignment

Fix the loose-typing drift so the manifest references the package's own nominal
types (these are the breaking-but-correct changes; acceptable at `0.1.0`):

- `AppManifest.capabilities: readonly CapabilityId[]` (was `readonly string[]`).
- `ManifestRouteDeclaration.requiredCapabilities?: readonly CapabilityId[]`.
- `ManifestContributionRef.contributionPointId: ContributionPointId` and
  `kind: ContributionKind` (was bare `string`). This requires `manifest/types`
  to import from `contributions`/`capabilities`; verify no import cycle is
  introduced (manifest is currently the leaf others import *from*). If a cycle
  arises, hoist the brand+enum primitives into a small `core/` module that both
  sides import, preserving the dependency-free invariant.
- Reconcile `CapabilitySubject` into a **discriminated union** keyed by the
  already-existing `SubjectKind`, replacing the all-optional bag, so consumers
  can statically narrow which id field is present. Keep `GrantPrincipal` as an
  alias.

### Phase 6 — Service / trust contract tightening

- `ICapabilityGrantService.grant`/`revoke` currently return `void`; have them
  return the `CapabilityGrant` record (or a `GrantResult` carrying the
  `GrantDecision`) so denials and audit records are not silently dropped.
- `ICapabilityService.requestCapability` returning bare `boolean` loses the
  reason for denial; return a small `{ granted: boolean; decision: GrantDecision }`.
- Document the rejection/error contract for the `Promise`-returning service
  methods (`IRoutingService.navigate`, `IStorageService.*`,
  `IClipboardService.*`) — define a shared `PlatformError` shape (a data type, not
  an Error subclass, to stay runtime-free) that hosts reject with.
- Note (do **not** auto-merge) the `RuntimeHostMode` vs `PluginIsolationMode`
  divergence (`same-realm-first-party` vs `same-realm-trusted`,
  `remote-bridge` host-only). Document the intended relationship in JSDoc; only
  unify if the shell confirms they are the same axis — defer the merge to the
  shell folder's plan to avoid an unreviewed semantic change.

### Phase 7 — Barrels, export map, docs

- Add new files (`plugin/validation`, shared `validation`/`core` modules,
  brand parsers) to the per-module `index.ts` and to `package.json` `exports`
  with `development`/`types`/`import` entries, matching the existing pattern.
- Update the root `index.ts` header and `mog/docs/guides/plugins.md` /
  `mog/docs/internals/spreadsheet/packages.md` references to mention plugin
  validation and the contract version (docs edits are outside this folder; flag
  as a coordinated follow-up, not part of this file's single-file output).

## Tests and verification gates

The package has **zero tests** today (tsconfig already excludes `__tests__` and
`*.test.ts`, so a test runner is anticipated). Add `src/**/__tests__/`:

- `manifest/__tests__/validation.test.ts`: valid manifest passes; each required
  field missing/empty produces the exact `code` + `path`; bad enums; bad semver
  including the previously-passing `1.2.3-garbage`; nested element failures
  (compatibility/route/contribution/data/lifecycle); duplicate route + duplicate
  contribution id; `manifestSchemaVersion` major-mismatch warning.
- `plugin/__tests__/validation.test.ts`: symmetric coverage incl. isolationMode
  and activationEvents selector rules.
- `*/brand.test.ts`: `parseX` accepts canonical ids and rejects malformed ones;
  `createX` is documented as unchecked.
- A **drift test**: assert `REQUIRED_MANIFEST_FIELDS` covers all required
  `AppManifest` keys (type-level + a runtime list check) so the validator cannot
  silently miss a new field.
- A **brand-strength test** confirming `AppId` etc. are not assignable from raw
  `string` without a constructor (a `// @ts-expect-error` compile fixture).

Verification gates (run by the implementer, not this planning worker):

1. `pnpm --filter @mog-sdk/types-app-platform typecheck` (`tsc -b .`) is clean,
   including `declaration`/`declarationMap` emit.
2. New unit tests pass.
3. `dependencies` remains `{}`; no new non-type imports (grep for `import`
   targets outside the package).
4. Downstream typecheck of `mog/shell` and the contract-graph inventory
   (`mog-internal/tools/inventory-sdk-contract-graph.mjs`) still resolves all
   subpaths.
5. Consumers of changed contracts (shell mirror) compile or are updated in their
   own folder's change — see dependencies.

## Risks, edge cases, and non-goals

**Risks / edge cases**

- **Breaking the shell mirror.** Phases 5–6 change public types the shell copies.
  The shell mirror (`mog/shell/src/platform/types.ts`) currently *diverges*
  already; tightening here may surface type errors when the shell adopts the
  package. Mitigation: land Phases 1–4 (purely additive) first; gate Phases 5–6
  behind coordination with the shell platform plan (item 066) so the shim
  conversion and these changes land together.
- **Import cycle** from making `manifest/types` reference `contributions`/
  `capabilities` (Phase 5). Mitigation: hoist shared brand/enum primitives into a
  leaf `core/` module.
- **Over-strict validation rejecting in-flight manifests.** New element-level
  errors could reject manifests previously accepted. Mitigation: classify
  format/coherence tightenings as warnings where data may legitimately vary;
  reserve errors for structural/security-relevant fields (entry, isolationMode,
  enums).
- **Semver regex correctness.** A hand-rolled full semver regex is error-prone;
  cover it heavily in tests rather than approximating.

**Non-goals**

- No runtime/host implementation, no React, no kernel logic — contracts-only.
- No adoption of an external schema/validation library (would break the
  zero-dependency invariant).
- Not migrating the shell mirror or editing `package-boundary-validator` in this
  plan — that is the shell platform folder's work; this plan makes the migration
  *possible and safe*.
- Not unifying `RuntimeHostMode`/`PluginIsolationMode` semantically without shell
  confirmation (documented only).

## Parallelization notes and dependencies on other folders

- **Independent / parallelizable now:** Phases 1 (brand parsers), 2 (contract
  version), 3 (deeper manifest validation), 4 (plugin validation), and the test
  surface — all additive within this folder, no other folder needs to change.
- **Coordinated:** Phases 5–6 (cross-module type alignment, service/trust
  signature changes) are breaking for `mog/shell/src/platform/*`. Sequence them
  with the **shell platform folder plan (queue item ~066, `mog/shell/src/platform`)**
  so the shell collapses its 581-line mirror into a re-export shim in the same
  change set. This is the highest-leverage outcome (eliminates the dual-source-of-truth
  hazard) but must not be done blind to the shell.
- **Downstream consumers to re-typecheck:** `mog/shell/src/platform/types.ts`,
  `package-boundary-validator.ts`, and the SDK contract-graph inventory tooling
  (`mog-internal/tools/inventory-sdk-contract-graph.mjs`).
- **Docs** (`mog/docs/guides/plugins.md`, `mog/docs/internals/spreadsheet/packages.md`)
  reference the package and should be refreshed when plugin validation + contract
  version land; tracked as a follow-up, outside this folder.

---

### Evidence sufficiency

The folder exists and was fully read (all 20 files, 1,514 LOC) along with
`package.json`, `tsconfig.json`, and the divergent shell mirror. Evidence is
sufficient for a full production-path plan; no blocked sections. The one item
requiring cross-team confirmation (RuntimeHostMode/PluginIsolationMode unification)
is explicitly deferred rather than guessed.
