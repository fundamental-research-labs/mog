# 076 — Improve `mog/types/host/src` (trusted/untrusted host boundary contracts)

## Source folder and scope

- **Folder:** `mog/types/host/src`
- **Package:** `@mog-sdk/types-host` (private workspace type shard; `"files": ["src"]`, `type: module`; single runtime dependency `@mog-sdk/types-document`).
- **Files in scope (17 src + 4 test):**
  - Contracts (type-only): `index.ts` (barrel), `trusted.ts`, `untrusted.ts`, `trust.ts`, `identity.ts`, `capabilities.ts`, `diagnostics.ts`, `operations.ts`, `source.ts`, `storage.ts`, `runtime.ts`, `view.ts`, `shell.ts`, `bindings.ts`, `kernel.ts`.
  - Runtime code: `fingerprints.ts` (hand-rolled canonical JSON + SHA-256 + fingerprint constructor) — the **only** module with executable behavior, exported via the `./fingerprints` subpath.
  - Tests / fixtures: `__tests__/brand-construction.test.ts`, `__tests__/canonical-fingerprints.test.ts`, `__tests__/fingerprint-helpers.ts`, `__tests__/deterministic-test-host.ts`.
- **In scope:** the exported type/interface surface, the barrel and the per-module subpath export map in `package.json`, the runtime canonicalization/fingerprint contract in `fingerprints.ts`, the doc comments that record the boundary invariants, and the internal consistency (DRY, branding, discriminant correctness) of these contracts.
- **Out of scope (do not edit as part of this folder's plan):** the **trusted adapter factories / validation gate** that are supposed to construct `TrustedDocumentHostContext` and produce `KernelDocumentLifecycleInput` from `KernelHostContext` (they live outside this folder — `mog/kernel/**`, host SDK packages — and at present appear absent); the Rust policy engine that issues `WorkbookAccessDecisionRef` / `WorkbookRawMaterializationDecisionRef`; the upstream `@mog-sdk/types-document` storage/security modules re-exported by `storage.ts` and `identity.ts`. These are named to describe coupling and downstream ripple, not as edit targets here. Any change requiring them is flagged as a cross-folder dependency.

## Current role of this folder in Mog

`@mog-sdk/types-host` is the **contract source of truth for the host ↔ kernel trust boundary**. It encodes:

- A **trusted/untrusted split**: `TrustedDocumentHostContext` (carries a `unique symbol` brand, the `KernelHostContext`, runtime/view/shell slices) vs. `UntrustedHostClient` (a thin `{clientKind, protocolVersion}` shape). The two are structurally disjoint by design.
- The **kernel host context** (`kernel.ts`): session, verified principal, the `HostDocumentAuthorizationService`, the authorized storage handoff, runtime config, capability lookup, diagnostics sink, clock, timezone policy, optional workbook-link resolver.
- The **authorization handoff model**: `HostDocumentAuthorizationRequest` → `HostAuthorizationDecision` → one of `AuthorizedDocumentStorageHandoff` / `AuthorizedExportMaterializationHandoff` / `AuthorizedDocumentManagementHandoff`, plus the kernel-issued proofs (`KernelDocumentHighWaterMarkProof`, `WorkbookAccessDecisionRef`, `WorkbookRawMaterializationDecisionRef`, `HostRedactedExportCoverageProof`).
- The **trusted composition bindings** (`bindings.ts`): provider materializers, source-handle resolvers, handoff replay registry, transport bindings — explicitly documented as capabilities that must never appear inside serialized handoffs, diagnostics, or `DocumentStorageConfig`.
- The **canonical fingerprint primitive** (`fingerprints.ts`): `HostCanonicalFingerprint` (a template-literal-typed string `mog-host-fp:v1:<algo>:<hex>`), a canonical JSON stringifier, a SHA-256 implementation, and `createHostCanonicalFingerprint`. Fingerprints are the binding glue across the whole surface — they pin principals, resource contexts, storage intents, document refs, content policies, and replay keys to their proofs.

Because the folder has essentially no runtime behavior except `fingerprints.ts`, "improving" it means making the contracts **complete, internally consistent, hard to misuse, and faithful to the security invariants they assert** — and making the one piece of runtime security code (canonicalization/hashing) actually correct.

## Evidence (observed in the current tree)

1. **Zero external consumers.** A repo-wide search for `@mog-sdk/types-host` / `types-host` finds only this package's own `package.json` and its own `src`/`__tests__`. No kernel, SDK, or contracts package imports it. The `Validated*` / `KernelDocumentLifecycleInput` / `BoundHostDocumentOperationAuthorization` types in `kernel.ts` describe a validation gate and a `DocumentLifecycleSystem` that consume this contract, but no such consumer exists in-tree yet. **This is a forward/aspirational contract shard not yet wired into a production path.** That raises the bar for correctness now (it is cheap to fix a contract with no callers) and means "improve the production path" = "make the contract correct and ready to be adopted," not "patch a live integration."

2. **The production canonicalizer is not RFC 8785 and can collide on security-relevant inputs.** `fingerprints.ts::canonicalJsonStringify` is the runtime that backs every fingerprint, yet the proof types advertise `canonicalization: 'jcs-rfc8785'`. The implementation diverges from JCS/RFC 8785 in ways that matter for a security proof:
   - **`undefined` / `null` collision.** An object property whose value is `undefined` is serialized as `"key":null` (the `value === null || value === undefined` branch returns `'null'`), so `{a: null}` and `{a: undefined}` produce the **same** digest. The surface is saturated with optional fields (`documentId?`, `decisionId?`, `authorityRef?`, `redactedConfigFingerprint?`, …); "field absent-as-undefined" vs. "field explicitly null" must not be indistinguishable in a binding proof.
   - **`NaN` / `Infinity` / `-0` are silently mishandled.** Numbers go straight through `JSON.stringify`, which renders `NaN`/`Infinity` as `null` and erases the sign of `-0`. RFC 8785 mandates a specific Number serialization; this is neither that nor a rejection.
   - **Non-JSON values are swallowed.** `bigint`, `symbol`, and function-valued properties fall through to the final `return 'null'`, again collapsing distinct inputs to the same digest instead of throwing.
   - **No canonical Unicode / number normalization** as RFC 8785 requires, so the `'jcs-rfc8785'` label in `HostCanonicalFingerprintProof` is currently false.

3. **`blake3` is typed but never produced.** `HostCanonicalFingerprint` and `HOST_CANONICAL_FINGERPRINT_REGEX` admit `sha256 | blake3`, and `HostCanonicalFingerprintProof.algorithm` is `'sha256' | 'blake3'`, but `createHostCanonicalFingerprint` hardcodes `mog-host-fp:v1:sha256:`. There is no blake3 implementation, so the `blake3` arm is unreachable surface that a verifier could be tricked into accepting.

4. **Hand-rolled crypto at a trust boundary.** `sha256Hex` reimplements SHA-256 (with a bespoke UTF-8 encoder) in TypeScript. For a value that anchors authorization proofs, rolling crypto by hand — untested against any reference vector beyond a single `'abc'` case, and unable to delegate to `crypto.subtle`/Rust core — is a durability and correctness risk.

5. **The proof-builders that enforce the `coveredFields` ↔ payload binding exist only in tests.** `createPrincipalFingerprintProof`, `createResourceContextFingerprintProof`, `createStorageIntentFingerprintProof`, `createDocumentRefFingerprintProof`, `createContentPolicyFingerprintProof` and the `*_COVERED_FIELDS` literals live in `__tests__/fingerprint-helpers.ts`, **not** in production `src`. So production code declares proof types with `coveredFields` and `canonicalization` but ships **no canonicalizer that guarantees the canonical payload actually contains exactly `coveredFields`**. The issuer↔verifier agreement on "which fields are bound, in what shape" is purely nominal; divergence would silently weaken a security check. (The covered-field lists are also hand-maintained string arrays that can drift from the interfaces they describe.)

6. **The brand is unenforced.** `TrustedHostBase` carries `[trustedHostBrand]: true` (a `unique symbol`) to gate construction to "trusted adapter factories and test fixtures," but the only constructor in-tree is `deterministic-test-host.ts`, which produces the value via `... as unknown as TrustedDocumentHostContext`. There is no production branded constructor / validation gate, so the brand provides no real guarantee today — any code can cast.

7. **Security-critical identifiers are unbranded `string`s.** `decisionId`, `correlationId`, `nonce`, `sessionId`, `documentId`, `hostId`, `sourceHostId`, `exportPathId`, `mutationWatermark`, `authorityRef`, `signatureOrMacRef`, `registryId`, `protocolVersion`, and the various `*Id`s are all plain `string`. Nothing prevents passing a `sessionId` where a `decisionId` is expected, or a requesting `sessionId` where a `sourceSessionId` belongs — exactly the cross-wiring a boundary contract should make impossible at compile time.

8. **`unknown` escapes at the boundary.** `ValidatedKernelRuntimeConfig.transportConfig: unknown` and `transportBinding.createTransportConfig(): unknown`; `HostTransportBinding.createTransportConfig(): unknown`; `ProviderMaterializerHandle.attach(rustDocument: unknown, …)`; `ShellContributionService.register*(…, contribution: unknown)`. Each is an un-narrowed hole in an otherwise tightly specified contract.

9. **Heavy structural duplication invites drift.** The **provider-ref shape** (`providerRefId, providerId?, kind, role, required, rawByteExposure, authorityRef?, storageScope?, redactedConfigFingerprint?`) is written out verbatim in both `HostStorageAuthorizationIntent.providers[]` and `AuthorizedDocumentStorageHandoffBase.authorizedProviders[]`. The **storage-scope shape** (`{tenantId | single-tenant; workspaceId | no-workspace; documentId?}`) is repeated ~6 times across `kernel.ts` and `bindings.ts`. `HostDocumentResourceContext` (kernel) and `CapabilityResourceContext` (capabilities) are near-identical twins. For a contract whose whole job is to make two sides agree, each duplicated literal is a place the two sides can silently diverge.

10. **Principal shape is inconsistent.** Everywhere else the actor is a `VerifiedPrincipal`, but `HostWorkbookLinkResolveRequest.principal` is the weaker ad-hoc `{ readonly tags: readonly string[] }`. A link-resolution authorization decision should not run on a structurally degraded principal.

11. **Vendor-name leak in a public source folder.** `HostPersistedLinkTarget` includes `{ kind: 'excel-external-path'; target: string }`. Per the standing "no Excel in source" guidance, public contract names should be vendor-neutral (e.g. `external-workbook-path`). This is a public Mog source folder, so the literal is externally visible.

12. **No curated public surface and no host-contract version.** `index.ts` re-exports only `TrustedDocumentHostContext`, `TrustedHostBase`, `TrustedHostKind`. Everything else (kernel, capabilities, diagnostics, bindings, fingerprints, …) is reachable only via deep subpath imports, with no documentation of which types are the stable external contract vs. internal wiring. The fingerprint payload carries a `v1` tag, but there is no top-level host-contract/protocol version negotiation type; `UntrustedHostClient.protocolVersion` is a free-form `string` with no declared format or compatibility rule.

13. **Tests cover only the happy path.** `canonical-fingerprints.test.ts` checks one SHA-256 vector and determinism; `brand-construction.test.ts` checks the test fixture and structural disjointness. There are **no** tests asserting RFC 8785 conformance, no negative tests for `HOST_CANONICAL_FINGERPRINT_REGEX`, no test that a proof's `coveredFields` actually equals the keys of its canonical payload, and no `undefined`/`null`/`NaN` collision tests — i.e. exactly the properties an attacker would probe are untested.

### Invariants the contract already gets right (preserve these)

- `HostTimezonePolicy.processTimezoneMayBeUsed: false` (literal-`false` guard against leaking the process TZ).
- `HostRawDocumentBytesPolicy.*.rawProviderBytesMayReachUntrustedClient: false` (literal-`false` raw-byte containment).
- Source handles are `singleUse: true` with an `expiresAt`; `HostHandoffReplayRegistry.consumeOnce` enforces one-shot consumption.
- `HostTrustEnforcementProfile.workbookAccess: 'rust-policy-engine'` is pinned to a single literal — workbook access is always Rust-gated.
- The `bindings.ts` module doc that forbids bindings from appearing in serialized handoffs / diagnostics / `DocumentStorageConfig`.
- Trusted vs. untrusted structural disjointness.

## Improvement objectives

1. **Make the canonicalization/fingerprint runtime actually correct and honest.** Either implement true RFC 8785 (no `undefined`/`null` collision, defined number handling, rejection of non-JSON values) or change the `canonicalization` label to name what is really computed — and make the hash provider pluggable/verifiable rather than hand-rolled.
2. **Promote the proof-construction contract into production** so that `coveredFields` and the canonical payload are derived from one source and provably agree, and the `blake3` arm is either implemented or removed.
3. **Make the trusted brand real** by defining (in this folder) the branded-construction contract that only a trusted factory can satisfy, removing the `as unknown` escape hatch as the sole path.
4. **Harden the type surface against misuse:** brand security-critical identifiers, eliminate `unknown` holes, de-duplicate the repeated shapes into named types, and unify the principal/resource-context twins.
5. **Curate the public surface and version the contract:** make `index.ts` an authoritative barrel, document stable-vs-internal, and add a host-contract version type with a real compatibility rule.
6. **Remove the vendor-name leak.**

All of these are production-path contract improvements — they tighten the types and the one security primitive that real adapters will compile and hash against, not test scaffolding.

## Production-path contracts and invariants to preserve or strengthen

- **Type-only except `fingerprints.ts`.** Keep the package side-effect free apart from the fingerprint runtime; any new value exports must be mirrored into the per-module subpath export map in `package.json`.
- **Boundary direction.** May depend only on `@mog-sdk/types-document` (downward); must not import from `kernel`/`engine`/SDK packages. Preserve.
- **Subpath export stability.** `package.json` exports each module (`./trusted`, `./kernel`, `./fingerprints`, …). Renaming/removing an exported symbol or module is a breaking change — but since there are **no consumers today**, breaking renames (e.g. branding ids, renaming `excel-external-path`) are currently cheap and should be done now rather than after adoption.
- **Strengthen, do not weaken, the literal-`false` and single-literal guards** listed above; branding ids and tightening `unknown` only adds constraints.
- **Fingerprint format compatibility.** The `mog-host-fp:v1:` prefix is a wire-visible format; if number/Unicode handling changes such that digests change, that is a `v1`→`v2` event and must be modeled explicitly (see Step 1), because issued proofs must remain verifiable.

## Concrete implementation plan

Sequenced low-risk/additive first, then the breaking contract changes (cheap now, before adoption), with cross-folder ripple called out.

### Step 1 — Fix and honestly label the canonicalization/hash runtime (`fingerprints.ts`)

- Rewrite `canonicalJsonStringify` to a single, specified canonicalization:
  - **Reject** `undefined`, `bigint`, `symbol`, function values, `NaN`, and `±Infinity` by throwing a typed error rather than emitting `'null'`. Distinguish object-property `undefined` (drop the key, JCS-style) from explicit `null` (emit `null`) so they can never collide.
  - Define number serialization explicitly (target true RFC 8785 ECMAScript-number rules) and document it.
  - Add canonical handling of `-0` (→ `0`) and confirm UTF-8/key-sort behavior matches the chosen spec.
- Either (a) implement the spec fully and keep the `'jcs-rfc8785'` label, or (b) introduce a precise label (e.g. `'mog-host-canonical-v1'`) and update `HostCanonicalFingerprintProof.canonicalization` to match. Do not leave the label asserting a spec the code does not meet.
- Make the hash provider injectable: keep the pure-TS SHA-256 as a default/fallback but allow a host-supplied `crypto.subtle`/Rust-core hasher, so production need not depend on hand-rolled crypto. Expand the test vectors (Step "Tests").
- Resolve the `blake3` arm: implement it behind the same provider seam **or** narrow the type/regex to `sha256` only until a blake3 provider exists. Do not ship an unreachable algorithm in a security type.
- Add an explicit fingerprint-format version constant and document that a canonicalization change that alters digests is a `v2` bump.

### Step 2 — Promote proof construction into production (new `src` module)

- Move the `create*FingerprintProof` builders and the `*_COVERED_FIELDS` definitions out of `__tests__/fingerprint-helpers.ts` into a production module (e.g. `src/proofs.ts`), exported via a new `./proofs` subpath.
- Derive each proof's canonical payload and its `coveredFields` from **one** declaration so they cannot drift (e.g. build the payload object and set `coveredFields = Object.keys(payload)` in canonical order, or generate both from a single field map). Tests then assert the invariant `coveredFields ≡ keys(canonicalPayload)`.
- Have the test helpers import from the production module instead of redefining, so tests verify the shipped builders.
- Set `issuedBy` appropriately for the production path (`'trusted-adapter' | 'trusted-control-plane' | 'kernel-write-gate'`) rather than the test-only `'test-fixture'`.

### Step 3 — Make the trusted brand enforceable (type-level, in this folder)

- Define the branded-construction contract here: a non-exported brand plus a single exported factory **signature** (the implementation lives in the trusted adapter folder — cross-folder) that returns `TrustedDocumentHostContext`. Document that the brand is the only legal way to obtain the type and that `as`-casts are prohibited outside test fixtures.
- Keep the test fixture as the sanctioned test-only constructor, but route it through the same brand application function rather than `as unknown`, so the fixture exercises the real construction shape.

### Step 4 — Brand security-critical identifiers (breaking; cheap now)

- Introduce nominal id types (e.g. `DecisionId`, `CorrelationId`, `Nonce`, `SessionId`, `DocumentId`, `HostId`, `SourceHostId`, `ExportPathId`, `RegistryId`, `MutationWatermark`, `AuthorityRef`, `SignatureOrMacRef`) as branded `string`s in a small `src/ids.ts`, exported via `./ids`.
- Replace the relevant `string` fields across `kernel.ts`, `bindings.ts`, `capabilities.ts`, `source.ts`, `diagnostics.ts`. This makes cross-wiring (e.g. requesting vs. source session id) a compile error.

### Step 5 — Close `unknown` holes and unify duplicated shapes

- Replace `transportConfig: unknown` / `createTransportConfig(): unknown` / `attach(rustDocument: unknown, …)` / `register*(…, contribution: unknown)` with named opaque-but-typed handles (branded or generic parameters) so callers can't pass arbitrary values.
- Extract the repeated **provider-ref** shape into one `HostAuthorizedProviderRef` interface used by both `HostStorageAuthorizationIntent` and `AuthorizedDocumentStorageHandoffBase`; extract the repeated **storage-scope** shape into one `HostStorageScope`; unify `HostDocumentResourceContext` and `CapabilityResourceContext` (one base, document context extends with `documentId?`).
- Replace `HostWorkbookLinkResolveRequest.principal: { tags }` with `VerifiedPrincipal` (or a documented, named projection of it) so link-resolution authorization runs on the same principal type as everything else.

### Step 6 — Curate the public surface, version the contract, remove the vendor leak

- Make `index.ts` an authoritative barrel that re-exports the intended stable surface, with doc comments delineating stable contract vs. internal wiring; keep deep subpaths for internal composition.
- Add a `HostContractVersion` type and a declared compatibility rule; replace `UntrustedHostClient.protocolVersion: string` with that type (or a constrained format) so untrusted clients negotiate a real version.
- Rename `HostPersistedLinkTarget` arm `'excel-external-path'` to a vendor-neutral literal (e.g. `'external-workbook-path'`). Since there are no consumers, this is a free rename now.

## Tests and verification gates

- **Canonicalization conformance:** vectors for nested objects, key ordering, Unicode/surrogate pairs, large/edge numbers, and the chosen spec; assert digests are stable across runs.
- **Collision/negative tests (the security core):** `{a: null}` vs `{a: undefined}` must now differ or throw; `NaN`/`Infinity`/`bigint`/`symbol`/function values must throw; `-0` normalizes.
- **Hash correctness:** multiple published SHA-256 test vectors (not just `'abc'`); if a pluggable hasher lands, parity test between pure-TS and injected provider.
- **Proof invariant:** for every `create*FingerprintProof`, assert `coveredFields ≡ Object.keys(canonicalPayload)` and that the digest matches `createHostCanonicalFingerprint(payload)`; assert digests change when any covered field changes and are isolated across kinds (extend the existing cross-kind test).
- **Regex tests:** positive and negative cases for `HOST_CANONICAL_FINGERPRINT_REGEX`, including the `blake3` arm resolution from Step 1.
- **Brand/disjointness:** keep and extend `brand-construction.test.ts`; add a type-level test (e.g. `tsd`/`expect-error`) that an id of the wrong brand and an `as unknown` trusted-context construction are rejected.
- **Gates (per `package.json`):** `pnpm --filter @mog-sdk/types-host typecheck` (`tsc -b`) and `pnpm --filter @mog-sdk/types-host test` (jest) must pass. Because `storage.ts`/`identity.ts` consume `@mog-sdk/types-document` subpaths, typecheck transitively validates those imports still resolve. *(Per task constraints, this plan does not itself run build/test commands; these are the gates a future implementing change must pass.)*

## Risks, edge cases, and non-goals

- **Fingerprint-format compatibility:** any change that alters produced digests is a wire-format change. Mitigation: version the format (Step 1); since no proofs are issued in production yet, the practical blast radius is currently zero — do it now.
- **Breaking renames before adoption:** branding ids, renaming the link-target arm, and curating exports are technically breaking, but with zero consumers they are low-cost now and high-cost later. The risk is the *opposite* of usual: deferring them past first adoption.
- **Hand-rolled crypto:** keep the pure-TS SHA-256 as a deterministic fallback (it is what tests and offline contexts rely on); the provider seam must default to it, not require an injected hasher.
- **Cross-folder coupling (out-of-scope to edit here):** the trusted-adapter factory and the kernel-side validation gate / `DocumentLifecycleSystem` that consume `KernelDocumentLifecycleInput` and apply the brand do not exist in-tree yet; Steps 3 and the *implementation* behind Step 4's id discipline land in those folders. This plan defines the contract they must satisfy.
- **Non-goals:** no reduction of the security model (no removal of the literal-`false` guards, single-use handles, replay registry, or Rust-gated workbook access); no compatibility shims or test-only patches in place of fixing the production canonicalizer; no change to upstream `@mog-sdk/types-document`.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:** Step 1 (fingerprint runtime), Step 5's shape de-duplication, and Step 6's barrel/rename touch largely disjoint files and can proceed concurrently.
- **Ordering:** Step 2 (production proofs) depends on Step 1 (canonicalization label/behavior fixed). Step 4 (id branding) should land before or with Step 5 since both edit the same `kernel.ts`/`bindings.ts` fields; sequence to avoid churn.
- **Downstream dependency (other folders, do not edit here):** the trusted adapter factory and the kernel validation gate / `DocumentLifecycleSystem` are the first real consumers; once this contract is hardened they must be updated to (a) construct via the real brand (Step 3), (b) carry branded ids (Step 4), and (c) emit production proofs (Step 2). Coordinate those edits as a follow-on plan in their respective folders.
- **Upstream dependency:** `@mog-sdk/types-document` storage/security modules must keep exporting the subpaths `storage.ts`/`identity.ts` consume; no change requested there, but any future digest-format change should be reconciled with `types-document`'s own `high-water-mark.ts` proof types to avoid two divergent proof vocabularies.
