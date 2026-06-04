# Plan 002 — Strengthen `mog/contracts/src/runtime` (runtime lifecycle & host-integration contracts)

## Source folder and scope

- **Folder:** `mog/contracts/src/runtime`
- **Package:** `@mog-sdk/contracts` (`mog/contracts`, version `0.8.0`)
- **Files in scope:**
  - `index.ts` — barrel re-exporting all runtime contract types.
  - `error-envelope.ts` — `RuntimeErrorCategory`, `RuntimeErrorEnvelope`.
  - `audit-event.ts` — `AuditActor`, `AuditOutcome`, `RuntimeAuditEvent`.
  - `service-config.ts` — `MogSelfHostConfig` and its full self-host configuration tree (~50 interfaces/unions: services, auth, storage, collaboration, assets, limits, observability, security).
  - `asset-manifest.ts` — `RuntimeAssetManifest`, `WasmAssetEntry`, `WorkerAssetEntry`, `NativeAddonEntry`, `FontAssetEntry`.
- **Adjacent surface that this plan must reconcile with (not edited blindly, but coordinated):** `mog/contracts/runtime-services` (package `@mog-sdk/runtime-service-contracts`, version `0.1.0`, `private: true`), which contains `error-envelope.ts`, `audit-event.ts`, `service-contracts.ts`, `protocol-version.ts`, `deployment.ts`.

These are **type-only** contracts. Per `mog/docs/security/DATA-FLOW-AND-EGRESS.md`, "Runtime service contracts are private/type-only contracts, not a shipped server." This plan preserves that posture: no server, route, or runtime implementation is added.

## Current role of this folder in Mog

`contracts/src/runtime` is meant to be the shared vocabulary for runtime-facing lifecycle and host integration: how a self-hosted deployment is configured (`MogSelfHostConfig`), how runtime assets (wasm/worker/native addon/fonts) are located and integrity-checked (`RuntimeAssetManifest` / `RuntimeAssetConfig`), the uniform error shape every service boundary returns (`RuntimeErrorEnvelope`), and the canonical audit record every service emits (`RuntimeAuditEvent`). These are the type-level "host contract" between the open-source Mog kernel/app and whatever deployment or admin surface embeds it.

### Evidence-backed problems found

1. **The folder is unreachable through its own package.** `@mog-sdk/contracts`'s `package.json` `exports` map has **no `./runtime` entry**, and the top-level `mog/contracts/src/index.ts` does **not** re-export `./runtime` (verified: `rg "runtime|service-config|asset-manifest" contracts/src/index.ts` returns nothing). No file under `contracts/src` imports these types by relative path either. So the only documented public way to reach `MogSelfHostConfig`, `RuntimeAssetManifest`, etc. is a fragile deep path into source (`@mog-sdk/contracts/src/runtime/...`) that bypasses the `dist`/`development` export contract. In effect these contracts are **orphaned**: shipped in the tree but not part of the package's supported surface.

2. **Duplication and silent-drift hazard with `runtime-services`.** `RuntimeErrorCategory`, `RuntimeErrorEnvelope`, `AuditActor`, `AuditOutcome`, and `RuntimeAuditEvent` are declared **twice** — once here and once in `contracts/runtime-services/src`. They are currently structurally identical, but they are two independent nominal declarations maintained by hand. `DeploymentProfile` is likewise declared in **both** `service-config.ts` and `runtime-services/src/deployment.ts`. Any future edit to one copy silently diverges from the other; consumers picking different import sources get types that "look the same" until they don't.

3. **The `src/runtime` copies dropped the security-bearing documentation.** The `runtime-services` versions of `error-envelope.ts` and `audit-event.ts` carry explicit invariants — e.g. `RuntimeErrorEnvelope.details` and `RuntimeAuditEvent.redactedMetadata` **"must never contain secrets, tokens, credentials, PII, or raw byte content."** The `src/runtime` copies are stripped of all comments, so a consumer importing from `contracts/src/runtime` loses the contract's safety obligations entirely.

4. **`MogSelfHostConfig` is a large, wholly-unvalidated config contract.** It pins `version: '0.1'` but ships no companion validator, no defaults, and no narrowing/migration helpers. Cross-field invariants are expressed only in prose-free optional fields (e.g. `AuthConfig.adapter: 'oidc'` does not require `oidc` to be present; `TlsConfig.enabled: true` does not require `certPath`/`keyPath`; `CollabScalingMode: 'horizontal'` does not require a `broker`). Because it's the entry contract for self-host operators, mis-typed config currently fails late, deep in a host, instead of at the contract boundary.

5. **`RuntimeAssetConfig` (input) and `RuntimeAssetManifest` (resolved) overlap with no typed relationship.** Both express wasm variants and integrity, but integrity is `Record<string,string>` on the config and per-entry `integrity?: string` on the manifest, and there is no documented "resolve config → manifest" contract. Integrity is optional everywhere, which silently permits unverified asset loading — a supply-chain-relevant gap for a host that fetches wasm/worker/native-addon bytes.

## Improvement objectives

1. **Make the contracts reachable and intentional.** Decide and encode whether `contracts/src/runtime` is part of `@mog-sdk/contracts`'s public surface or belongs in `runtime-services`. Eliminate the "shipped but unexported" ambiguity.
2. **Establish a single source of truth** for the shared runtime types (`RuntimeErrorEnvelope`, audit types, `DeploymentProfile`), with the non-canonical location re-exporting rather than re-declaring.
3. **Restore and strengthen the security-bearing documentation** that the `src/runtime` copies lost.
4. **Tighten `MogSelfHostConfig`** so structurally-invalid deployments are unrepresentable where practical, and provide a typed validation entry point where they cannot be encoded purely at the type level.
5. **Make asset integrity a first-class, type-enforced contract** and define the config→manifest relationship.

## Production-path contracts and invariants to preserve or strengthen

Preserve:
- The exact serialized JSON shape of `RuntimeErrorEnvelope` and `RuntimeAuditEvent` (these cross service/process boundaries; renaming or retyping fields is a wire-breaking change). Field-name and optionality changes are out of scope except additive.
- `MogSelfHostConfig.version: '0.1'` as the discriminant for the current schema generation; any schema change must bump this and define migration, not mutate `'0.1'` in place.
- The type-only, no-implementation posture documented in `DATA-FLOW-AND-EGRESS.md`.
- All discriminated unions stay discriminated (`SecretRef.source`, `ObjectStoreConfig.provider`, `MetadataDbConfig.provider`, `CollabBrokerConfig.provider`, sink unions). Do not collapse them into wide optional bags.

Strengthen:
- Shared types must have exactly one declaration; duplicates become `export type { ... } from` re-exports.
- Security invariants on `details` / `redactedMetadata` must be present wherever the type is importable.
- Asset integrity should be required (or its absence should be an explicit, named opt-out type), not silently optional.
- Cross-field config invariants should be encoded as discriminated unions where the type system allows, and validated by a published guard where it does not.

## Concrete implementation plan

> All steps stay within type/contract files and their package manifests. No runtime code, no servers.

### Phase 1 — Decide canonical home and resolve reachability (foundational)

This phase has one decision with two acceptable productions; pick based on how `runtime-services` is intended to be consumed (a 1-day investigation reading `runtime-services` consumers settles it).

- **Step 1.1 — Investigate intent.** Enumerate importers of `@mog-sdk/runtime-service-contracts` and of any deep `@mog-sdk/contracts/.../runtime` path across the workspace. Confirm whether `runtime-services` is the deployment/host package and `contracts/src/runtime` is a stale fork, or whether `contracts` is meant to surface these to SDK consumers.
- **Step 1.2 — Canonical-home decision (production path, not a shim):**
  - **Option A (recommended if `runtime-services` is the host/deployment contract):** Treat `contracts/runtime-services` as canonical for the *shared service types* (`error-envelope`, `audit-event`, `protocol-version`, `deployment`, `service-contracts`). Move `service-config.ts` and `asset-manifest.ts` — the parts that have **no** counterpart in `runtime-services` — into `runtime-services` as new modules (`service-config.ts`, `asset-manifest.ts`) with matching `exports` entries, and **delete** `contracts/src/runtime` entirely. This removes the orphan and the duplication in one move.
  - **Option B (if `@mog-sdk/contracts` must surface these to SDK users):** Keep `contracts/src/runtime`, add a `./runtime` entry to `contracts/package.json` `exports` (and the `service-config`/`asset-manifest` subpaths if granular import is desired), and re-export the barrel from `contracts/src/index.ts`. Then make the shared types **re-export** from `@mog-sdk/runtime-service-contracts` instead of re-declaring, so there is still a single source of truth.
- The remaining phases are written to be valid under either option; "the canonical module" below means whichever location Phase 1 selects.

### Phase 2 — De-duplicate shared types to a single source of truth

- **Step 2.1** Choose the canonical declaration of `RuntimeErrorCategory` + `RuntimeErrorEnvelope` (the `runtime-services` copy, since it carries the documentation). The non-canonical file becomes:
  `export type { RuntimeErrorCategory, RuntimeErrorEnvelope } from '<canonical>';`
- **Step 2.2** Same for `AuditActor`, `AuditOutcome`, `RuntimeAuditEvent`.
- **Step 2.3** Collapse the duplicate `DeploymentProfile`: declare it once (canonical: `deployment.ts`) and have `service-config.ts` re-export it, so `MogSelfHostConfig.profile` and `ServiceDiagnostics.deploymentProfile` provably share one type.
- **Step 2.4** Update both packages' barrels (`index.ts`) so the public set of exported names is unchanged from a consumer's perspective (no removed names; only the declaration site moves). If Option A deleted `contracts/src/runtime`, update any consumers found in Step 1.1 to import from the new location — this is the only place consumer edits are permitted, and only because their current deep import was unsupported.

### Phase 3 — Restore security-bearing documentation on the surviving copies

- **Step 3.1** Ensure the canonical `error-envelope.ts` and `audit-event.ts` retain the existing TSDoc, including the explicit SECURITY invariants on `details` and `redactedMetadata` ("must never contain secrets, tokens, credentials, PII, or raw byte content"). After Phase 2 the stripped copies no longer exist as declarations, so this is automatically satisfied for `error-envelope`/`audit-event`; verify nothing was lost in the move.
- **Step 3.2** Add equivalent TSDoc to the previously-undocumented `service-config.ts` and `asset-manifest.ts` declarations, focusing on: which fields hold `SecretRef`s (and therefore must never be inlined into logs), the meaning of each discriminant, and the integrity/verification expectations for assets.

### Phase 4 — Strengthen `MogSelfHostConfig` validity

- **Step 4.1 — Encode cross-field invariants as discriminated unions where the type system allows.** Replace loose "flag + optional sibling" pairs with discriminants:
  - `AuthConfig`: make `adapter` discriminate the required provider block (`{ adapter: 'oidc'; oidc: OidcProviderConfig } | { adapter: 'saml'; saml: SamlProviderConfig } | { adapter: 'single-user'; singleUser: SingleUserConfig } | { adapter: 'local-dev' }`), so an `oidc` adapter without `oidc` config is unrepresentable.
  - `TlsConfig`: model as `{ enabled: false } | { enabled: true; certPath: string; keyPath: string; ... }`.
  - `CollaborationConfig`: when `scalingMode: 'horizontal'`, require `broker` (discriminate on `scalingMode`).
  - `ServiceAccountConfig.mtls`/`ApiKeyConfig`: similar `enabled`-discriminated shapes.
  These are additive in spirit but type-narrowing; treat as a `version` bump candidate (see Step 4.3).
- **Step 4.2 — Provide a published validation entry point (type-only-compatible).** Cross-field rules that can't be expressed structurally (e.g. "`security.tenantIsolation: 'multi-tenant'` requires `auth.adapter !== 'single-user'`", "`storage.encryption.previousKeys` only meaningful when `algorithm` set") get a documented `validateMogSelfHostConfig(config): RuntimeErrorEnvelope[]` **signature contract** plus a small pure validator. This is contract-layer logic (pure, no I/O, returns the existing error envelope), consistent with the package already shipping pure helpers (`toCellId`, etc., per the runtime inventory fixture). It does not introduce a server.
- **Step 4.3 — Version/migration discipline.** If Step 4.1 changes representable shapes, bump `MogSelfHostConfig.version` to `'0.2'`, keep `'0.1'` as a documented legacy literal in the union, and add a typed `migrateConfig` signature so hosts upgrade explicitly. If 4.1 lands as purely additive, keep `'0.1'`.

### Phase 5 — Make asset integrity a first-class contract

- **Step 5.1** Define the explicit relationship between `RuntimeAssetConfig` (operator input) and `RuntimeAssetManifest` (resolved, verifiable manifest): document that a manifest is the resolution of a config, and align the integrity representation (the config's `integrity?: Record<string,string>` vs. the manifest's per-entry `integrity?`).
- **Step 5.2** Make integrity non-silent: either make `integrity` required on `WasmAssetEntry`/`WorkerAssetEntry`/`NativeAddonEntry`, or model the opt-out explicitly as a named union member (`{ integrity: string } | { integrity: null; unverifiedReason: string }`) so that loading unverified bytes is a deliberate, auditable choice rather than an omitted field. Document the supply-chain rationale referencing `DATA-FLOW-AND-EGRESS.md`.
- **Step 5.3** Add TSDoc tying `NativeAddonEntry.platform/arch/libc/abiVersion` to the selection contract a host uses, and `WasmVariant` (simd/threading/memory pages) to capability negotiation.

## Tests and verification gates

(Authored as part of the change; this plan does not itself run them — see non-goals.)

- **Type-identity tests.** Add `.test-d.ts` (or equivalent `expectType`/`@ts-expect-error`) assertions proving the re-exported shared types are referentially the *same* type across both packages (e.g. assigning a `runtime-services` `RuntimeErrorEnvelope` to a `contracts` one and back with no widening), guarding against future re-divergence.
- **Negative type tests** for the new discriminated unions: `@ts-expect-error` on `{ adapter: 'oidc' }` without `oidc`, `{ enabled: true }` TLS without cert paths, `scalingMode: 'horizontal'` without `broker`, and an asset entry without integrity (when 5.2 makes it required).
- **Validator unit tests** for `validateMogSelfHostConfig`: each cross-field rule has a passing and a failing fixture; failing fixtures assert the returned `RuntimeErrorEnvelope.category`/`code`.
- **Export-surface test.** Assert every name previously exported by `contracts/src/runtime/index.ts` is still importable from its new supported path (catches accidental surface removal). Extend the existing `contracts-runtime-inventory` fixture machinery (`mog/fixtures/external/shared/contracts-runtime-inventory.mjs`) rather than inventing a parallel one.
- **Gates:** `pnpm --filter @mog-sdk/contracts build` and `pnpm --filter @mog-sdk/runtime-service-contracts typecheck` (declaration rollup must pass — note `@mog-sdk/contracts` consumers depend on emitted `dist/*.d.ts`, so a contracts build is required before downstream typecheck), full `tsc -b`, and the contracts test suite. No wire-shape snapshot may change for `RuntimeErrorEnvelope`/`RuntimeAuditEvent` except additive fields.

## Risks, edge cases, and non-goals

**Risks / edge cases**
- *Wire compatibility.* `RuntimeErrorEnvelope`/`RuntimeAuditEvent` cross process boundaries; any non-additive change breaks deserialization on the other side. Keep changes additive and version-gated.
- *Hidden deep-path consumers.* Some host outside this workspace may already import `@mog-sdk/contracts/src/runtime/...`. Option A's deletion would break them; mitigate by, if Option B is unviable, leaving a thin re-export module at the old path for one deprecation cycle (a documented forwarding export, **not** a behavioral shim).
- *Discriminated-union migration churn.* Step 4.1 narrows representable configs; existing valid-but-loosely-typed configs may need `version` bump + migration. Gate behind the `'0.1'→'0.2'` decision.
- *Two-package coordination.* Changes touch both `contracts` and `runtime-services`; their builds are independent, so land the canonical declaration first, then the re-export, to avoid a transient dangling import.

**Non-goals**
- No HTTP server, route handler, or runtime host implementation (preserves the documented "type-only, not a shipped server" posture).
- No reduction of the contract surface, no test-only patch, no compatibility shim as the *primary* fix (forwarding re-export is a bounded deprecation aid only).
- No changes to unrelated `@mog-sdk/contracts` subtrees beyond the shared-type re-export wiring.
- No new third-party validation/schema dependency; the validator is pure hand-written contract logic returning the existing envelope.

## Parallelization notes and dependencies on other folders

- **Hard dependency / coordination:** `mog/contracts/runtime-services` (queue item "contracts-runtime-services-src", number 004). Phase 1–2 must be sequenced with that folder's plan to agree on the canonical home; do **not** run the de-duplication edits for both folders concurrently without a shared decision, or they will race on which copy is canonical. Recommend this plan (002) own the canonicalization decision and 004 consume it.
- **Downstream typecheck consumers:** any package depending on `@mog-sdk/contracts` `dist` declarations (`mog/contracts` is consumed widely). The declaration rollup gate must pass before those consumers typecheck.
- **Shared fixture:** `mog/fixtures/external/shared/contracts-runtime-inventory.mjs` already tracks retained runtime values; the export-surface test extends it — coordinate with the fixtures folder owner (queue item "fixtures-external", number 100) so the inventory baseline is updated together.
- **Independent of:** all UI/grid/rendering folders; this work touches no rendering, editor, or app-eval surface.

---

### Evidence appendix (read-only findings used for this plan)

- `contracts/package.json` `exports` map: **no** `./runtime` key (jq over `.exports | keys`).
- `contracts/src/index.ts`: no `runtime` / `service-config` / `asset-manifest` re-export.
- No relative importer of `runtime/{service-config,asset-manifest,audit-event,error-envelope}` inside `contracts/src`.
- `contracts/runtime-services/src/{error-envelope,audit-event}.ts` declare the same types as `src/runtime`, with full TSDoc + SECURITY notes that `src/runtime` lacks.
- `DeploymentProfile` declared in both `src/runtime/service-config.ts` and `runtime-services/src/deployment.ts`.
- `mog/docs/security/DATA-FLOW-AND-EGRESS.md`: runtime service contracts are "private/type-only contracts, not a shipped server."
- `git log` for both folders: single "Initial public source import" commit (squashed history; no incremental nuance).
