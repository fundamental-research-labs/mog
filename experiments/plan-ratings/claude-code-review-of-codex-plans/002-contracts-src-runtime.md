Rating: 7/10

# Review of `002-contracts-src-runtime.md`

## Summary judgment

This is a well-researched, evidence-grounded plan that accurately diagnoses the current
state of `mog/contracts/src/runtime` and proposes a coherent set of improvements:
canonical public subpath, deduplication against the private runtime-service-contracts
package, executable boundary validators, explicit versioning, and stronger discriminated
shapes. Its strongest asset is a precise, source-faithful catalogue of the invariants that
matter (SecretRef confidentiality, AssetLocation path/url disjointness, profile-specific
topology requirements, category/status coherence, redaction safety). Its weakest aspect is
that it repeatedly frames the work as a "production path" exercise when these contracts are,
in fact, currently unconsumed forward-looking type islands — and that it bundles a
multi-PR, cross-queue-item program under a single folder task without measurable
done-criteria. Accurate and thoughtful, but it oversells production relevance and
under-specifies the type-to-value architectural shift it is proposing.

## Major strengths

- **Accurate diagnosis of the current state.** Every structural claim verifies:
  - `contracts/package.json` has no `./runtime` export (confirmed — the exports map jumps
    from `./api` subpaths past runtime with no entry).
  - `contracts/src/index.ts` does not re-export the runtime folder (confirmed — no `runtime`
    reference in the root barrel).
  - Real duplication exists: `RuntimeErrorEnvelope`, `RuntimeAuditEvent`, and
    `DeploymentProfile` are defined in BOTH `contracts/src/runtime` and
    `contracts/runtime-services/src` (`@mog-sdk/runtime-service-contracts`). The
    source-of-truth risk the plan names is genuine, not hypothetical.
  - The private package additionally owns `ProtocolVersion`/`CompatibilityResult`/
    `ProtocolHandshake`, `ServiceHealth`/`ServiceReadiness`/`ServiceDiagnostics`, and
    service-boundary contracts — exactly the "richer documented concepts" the plan proposes
    to migrate. The plan has clearly read both folders.
- **Invariant capture is the best part of the plan.** The "contracts and invariants to
  preserve" section maps one-to-one onto actual fields: `SecretRef` (env/file/vault),
  `AssetLocation { path?; url? }` (the path/url/both/neither matrix is a real ambiguity in
  the current type), `TlsConfig.clientAuth: 'required'` needing `clientCaPath`,
  `SessionConfig.cookieSameSite: 'none'` + `cookieSecure`, `DeploymentProfile` topology
  rules, `StorageEncryptionConfig.keyRef`, and the loose `WasmVariant`/`WasmAssetEntry`
  booleans. These are concrete, testable, and correctly prioritized.
- **Verification gates are real and appropriate.** `check:contracts-runtime-inventory`,
  `check:contract-runtime-imports`, `verify-runtime-exports.mjs`, `check:publish-readiness:fast`,
  and the contracts `test`/`typecheck`/`build` scripts all exist (the build itself chains
  `check-contracts-declaration-identity`, `verify-runtime-exports`, runtime-inventory, and
  runtime-imports). The self-containment invariant — dist must not import private workspace
  packages — is the right production constraint and aligns with the existing
  `check-contract-runtime-imports` gate.
- **Good engineering discipline in non-goals and risks:** zero-dependency validators (no
  schema library), single source of truth over compatibility aliases, version/declaration
  fixtures before broad wiring. The negative-test matrix (path-only/url-only/both/neither,
  horizontal-without-broker, air-gapped-with-remote-assets, TLS-without-CA) is specific and
  directly exercises the named invariants.

## Major gaps or risks

1. **Production-path relevance is overstated — there are no consumers.** A repo-wide search
   finds `@mog-sdk/runtime-service-contracts` referenced only in docs
   (`self-hosting.md`, `http-service.md`, security/architecture docs) and
   `tools/package-inventory.jsonc` — never imported by source. `MogSelfHostConfig` and
   `RuntimeAssetManifest` appear ONLY inside `contracts/src/runtime` itself. There is no
   `self-host`/`server` package in the repo. Consequently the plan's steps 8 ("wire
   production consumers"), the "migrate internal references" instruction, and the
   "production-path smoke verification in the relevant runtime host... actual runtime
   bootstrap/config path" are largely vacuous: there is nothing to migrate and no host to
   smoke-test. The plan should state plainly that these are greenfield/unconsumed contracts,
   that the "production path" is aspirational, and either (a) defer consumer wiring until a
   consumer exists, or (b) first establish/point to the consuming host. This is the central
   credibility gap.
2. **Scope is multi-PR and gated on a cross-item dependency, but presented as one folder
   task.** The plan folds in runtime-services consolidation (explicitly queue item 4),
   validators + normalizers, versioning, discriminated-union refactors of `service-config.ts`,
   consumer wiring across five packages, and new publish gates. It even partitions the work
   across Agents A–E. The dependency on item 4 is a hard blocker for the dedup decision, yet
   the plan proceeds as if the source-of-truth choice is unilaterally resolvable here. Either
   land this as a sequenced series with explicit per-stage merge points, or scope this item
   to "establish the public subpath + validators for the existing types" and split the
   consolidation into its own plan.
3. **The type-only → runtime-value shift is under-specified mechanically.** This folder (and
   the whole `@mog-sdk/contracts` runtime surface) is historically type-only; adding
   validators introduces emitted JS into a public subpath. The plan asserts self-containment
   must hold but does not address: where validators live so type-only importers don't pull
   runtime code, dual ESM/CJS output, tree-shaking, and how `check-contracts-runtime-inventory`
   will now treat these new runtime exports. Note also that `verify-runtime-exports.mjs`
   currently checks number-format constants (`DEFAULT_FORMAT_BY_TYPE`, `FORMAT_PRESETS`), not
   host contracts — "extend it" conflates folder-`runtime` with value-`runtime`; acceptable
   only because the plan offers the "or add a runtime-specific gate" alternative.
4. **Versioning is described in prose, not as a contract.** `MogSelfHostConfig.version` is
   already the literal `'0.1'`. The plan proposes several new `MOG_RUNTIME_*_VERSION`
   constants without reconciling them with the existing field, and describes protocol
   compatibility rules without giving a function/result shape — even though the private
   package already defines `ProtocolVersion` and `CompatibilityResult`. The plan should
   reference reusing those and specify the comparison signature.
5. **Two overlapping asset representations are not reconciled.** `asset-manifest.ts` defines
   an array-based `RuntimeAssetManifest` (wasm[]/workers[]/nativeAddons[]/fonts[]), while
   `service-config.ts` defines a single-asset `RuntimeAssetConfig` (`wasm: AssetLocation`,
   `wasmVariant`, `integrity: Record`). These are two competing asset models inside the same
   folder. The plan strengthens the manifest but never calls out or resolves this internal
   inconsistency — a real source-of-truth problem distinct from the runtime-services one.
6. **No measurable definition of done.** Gates are listed but success thresholds are not:
   e.g., "zero local duplicate type definitions remain," "N consumers migrated,"
   "validator coverage for every named invariant." "Remove the private duplicate package if
   no longer needed" hand-waves the decision without first inventorying which of its six
   modules are genuinely private (service-contracts.ts is a 4 KB service-boundary surface)
   versus public — and ignores that the package has its own exports map that unseen tooling
   may reference.

## Contract and verification assessment

Contract clarity is high where it counts: the invariant list is specific, source-faithful,
and testable, and the negative-test matrix would catch the most important malformed-config
cases. The main clarity gap is the validator result type — "path-addressed failures, not
boolean-only" is the right intent but is described rather than specified (no result shape,
no error-code convention, no path-encoding rule). The verification section references real,
existing gates and correctly insists on self-containment and declaration-identity coverage;
this part is production-credible. The weak link is that the most consequential gate —
"production-path smoke verification in the relevant runtime host" — names no host, no
bootstrap entry point, and no observable outcome, and currently has no real target in the
repo.

## Concrete changes that would raise the rating

1. **Acknowledge consumer reality.** Add a short "current consumers" subsection stating that
   these contracts are presently unconsumed (docs/inventory only), and either defer steps 8
   and the host smoke-test until a consumer exists or cite the specific consuming package.
   This single correction would resolve the central overstatement (worth +1 alone).
2. **Re-scope to a sequenced series.** Make this item "public subpath + validators +
   versioning for the existing `contracts/src/runtime` types," and split (a) runtime-services
   consolidation and (b) consumer wiring into dependent follow-on plans with explicit
   ordering and merge points. Mark the item-4 dependency as a hard prerequisite for any dedup.
3. **Specify the type/value architecture.** State where validators live, how type-only
   importers avoid pulling runtime code, dual-format output expectations, and how
   `check-contracts-runtime-inventory` should classify the new runtime exports. Decide
   whether to extend `verify-runtime-exports.mjs` or add a dedicated runtime-host-contracts
   gate, and say which.
4. **Reconcile the two asset models.** Add an explicit step to unify `RuntimeAssetManifest`
   (array) and `RuntimeAssetConfig` (single) into one canonical asset contract, or document
   why both must coexist.
5. **Give versioning a shape.** Reconcile the new version constants with the existing
   `version: '0.1'` field, reuse `ProtocolVersion`/`CompatibilityResult` from the private
   package, and specify the compatibility-check signature and the validator result type
   (fields, path encoding, error-code convention).
6. **Add measurable acceptance criteria** per step (duplicate-type count → 0, invariant →
   test mapping, migrated-consumer count) and a concrete inventory of which
   runtime-service-contracts modules are private vs public before proposing package removal.
