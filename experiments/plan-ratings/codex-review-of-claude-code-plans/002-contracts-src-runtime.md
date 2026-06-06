Rating: 7/10

Summary judgment

This is a strong, evidence-backed plan for a real contracts problem. It correctly identifies that `contracts/src/runtime` is present in source but not reachable through `@mog-sdk/contracts` exports, that error/audit/deployment types are duplicated with `contracts/runtime-services`, and that the current config and asset contracts leave important invariants implicit.

The rating is held back by one central issue: the plan does not settle the public/private ownership model before prescribing implementation. Current public docs say self-hosting is reserved/not shipped and `@mog-sdk/runtime-service-contracts` is workspace-internal and private. A plan that might either delete `contracts/src/runtime`, move self-host config into the private package, or make public contracts re-export private package types needs a sharper architecture decision and emitted-declaration contract before implementation starts.

Major strengths

- The source diagnosis is mostly accurate: `@mog-sdk/contracts` has no `./runtime` export, `contracts/src/index.ts` does not re-export runtime, and the runtime folder has its own type-only barrel that is not a supported package subpath.
- The drift diagnosis is good. `RuntimeErrorEnvelope`, `RuntimeAuditEvent`/audit types, and `DeploymentProfile` are duplicated across `contracts/src/runtime` and `contracts/runtime-services/src`, with richer security TSDoc in `runtime-services`.
- The plan preserves the right non-goals: no service/server implementation, no non-additive error/audit wire-shape changes, and no collapsing discriminated unions into optional bags.
- The proposed config tightening is directionally correct: auth adapter blocks, TLS, horizontal collaboration broker requirements, and service account/API-key enabled states should not remain loose flag-plus-optional-field shapes.
- The asset-integrity section identifies a meaningful supply-chain contract gap and proposes making unverified loading explicit instead of silently represented by an omitted field.
- The verification section is materially better than a compile-only gate: it calls for negative type fixtures, validator unit tests, export-surface tests, package builds, and runtime-services typecheck.

Major gaps or risks

- The canonical-home decision is left as an implementation-time branch. Option A and Option B lead to very different public API outcomes, package dependencies, emitted declarations, and migration strategy. The plan should recommend one default ownership model and make the alternative a rejected path or an explicit architecture-decision prerequisite.
- Option B is risky as written. Public `@mog-sdk/contracts` cannot safely emit declarations that re-export from private `@mog-sdk/runtime-service-contracts` unless that package is intentionally made resolvable for external consumers, or the declaration rollup inlines/projects those types. The plan does not specify the dependency, tsconfig reference, declaration-rollup, or "no private specifier in dist d.ts" rules needed to keep public consumers working.
- Option A may be more consistent with the private-service-contract docs, but moving `service-config.ts` and `asset-manifest.ts` into `runtime-services` blurs two different concepts: public host/embed asset contracts versus reserved self-hosted service/deployment contracts. Runtime asset selection may belong in a public host contract even if self-hosted service config remains reserved.
- The plan underuses current product-status evidence. `docs/guides/self-hosting.md` says self-hosting is reserved/not shipped and `runtime-services` is not a published configuration schema or deployment API. Adding a versioned self-host config validator and migration API could imply a supported deployment schema unless the plan explicitly classifies it as private/reserved.
- The "type-identity tests" wording is imprecise. TypeScript assignment and most `Equal<A, B>` helpers prove structural equivalence, not nominal referential identity. If the goal is to prevent future re-declaration, the gate must inspect declarations/import paths or otherwise prove the non-canonical module is a re-export.
- The validator API is under-specified for a real config boundary. `validateMogSelfHostConfig(config): RuntimeErrorEnvelope[]` assumes an already-typed config; an operator-facing boundary needs unknown-input validation, error code taxonomy, path reporting, defaulting/migration rules, and exact handling of legacy `version: '0.1'`.
- Versioning needs a harder rule. The proposed discriminated-union changes are not merely additive for existing typed configs, so they should not mutate the `0.1` shape in place. Keep a legacy `MogSelfHostConfigV01`, add `V02`, and make migration explicit.
- Asset integrity needs a concrete schema: SRI/digest algorithm, hash encoding, local-file versus remote URL behavior, whether fonts are included, base URL resolution, and how config-level integrity keys map to manifest entries.

Contract and verification assessment

The contract intent is good: one source of truth for shared service boundary shapes, preserved serialized error/audit fields, stronger security TSDoc, explicit config invariants, and deliberate asset verification semantics. The weak point is package-boundary clarity. The plan must separate "public runtime host contract" from "workspace-internal service boundary contract" before deciding exports.

The verification gates are relevant but incomplete. `@mog-sdk/contracts build` is the right baseline because public consumers depend on emitted declarations, and `@mog-sdk/runtime-service-contracts typecheck` is needed if that package remains involved. However, the plan should add an explicit gate that scans emitted `dist/*.d.ts` and `dist/*.js` for private `@mog-sdk/runtime-service-contracts` specifiers when `@mog-sdk/contracts` remains public. Existing runtime-import checks focus on runtime JS/private shard leakage and would not by themselves prove that public declaration files are externally consumable.

The export-surface test should also be framed carefully. Since `contracts/src/runtime` is not currently a supported package subpath, the test should assert the selected new supported import path and the intentionally retained names, not accidentally freeze every private/reserved self-host type as public API. Negative fixtures should prove both sides: public host types are importable from the chosen public module, and service-only private types are not exported publicly unless the architecture decision explicitly promotes them.

Concrete changes that would raise the rating

- Add a first-phase architecture decision table classifying every runtime type as public host/embed, public error/audit envelope, workspace-internal service boundary, or reserved self-host config.
- Replace the Option A/Option B fork with a concrete default. If `runtime-services` stays private, public `@mog-sdk/contracts` should not emit private-package re-export specifiers; use a public projection, source generation, or intentional package promotion instead.
- Specify exact package-manifest and tsconfig changes, including whether `contracts` may depend on `runtime-services`, whether imports must be type-only, and whether emitted declarations may reference it.
- Add a declaration self-containment gate for `@mog-sdk/contracts/dist/**/*.d.ts`, plus an external-consumer fixture that imports the selected runtime subpath from built package artifacts.
- Define versioned config types (`V01`, `V02`), migration signatures, validation input shape (`unknown` versus typed), error codes, path reporting, and defaults.
- Define the asset integrity contract precisely, including digest/SRI format, opt-out shape, local path handling, config-to-manifest resolution, and which asset classes require verification.
- Add a concrete type-test harness instead of generic `.test-d.ts` language, since the repo does not currently appear to have a tsd-style setup under `contracts`.
