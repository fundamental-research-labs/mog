Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for `mog/types/document/src`. It correctly identifies the folder as a Tier 1 contract shard rather than a passive type dump, and it ties the work to real production consumers: contracts re-export shims, kernel storage composition, host storage preflight, Rust data-policy enforcement, generated SDK declarations, external fixtures, and API Extractor output. The plan is especially good at naming current drift that is visible in the code: the intentionally empty root barrel, missing direct export decisions such as `storage/provider-kinds`, the special `PlatformFileHandle` re-export from `contracts/src/platform/index.ts`, hardcoded kernel storage kind traits, raw string host storage preflight configs, TS/Rust `AccessExplanation` mismatch, `AccessPolicyMetadata.description` drift, mixed timestamp representations in high-water proofs, and `bigint` in inbound update envelopes.

The rating is not higher because the plan is almost an umbrella program across document lifecycle, storage, host handoff, security, filesystem, platform, shell, and table drivers. It has good sequencing notes, but many implementation items still need phase-level acceptance criteria, migration boundaries, and exact source-of-truth decisions before parallel workers can safely compose their changes.

Major strengths

- The plan is production-path relevant. It explicitly avoids test-only validation and routes verification through `DocumentFactory`, `MogDocumentFactory`, kernel provider registry, host storage preflight, `HighWaterMarkProofRegistry`, bridge-facing `wb.security.*`, shell/platform services, public fixtures, and generated declarations.
- The architectural direction fits the repo boundaries. It keeps `types/document` as a leaf depending only on `@mog/types-core`, keeps `@mog-sdk/contracts` as the public facade, avoids `mog-internal` dependency leakage, and preserves the empty root barrel unless a deliberate API redesign resolves collisions.
- The storage registry objective is well justified. Moving `KIND_TRAITS` and durability/profile rules out of `kernel/src/document/providers/composition-validator.ts` into a typed source-of-truth module would make provider kind/role/capability changes compile-time visible instead of relying on copied matrices.
- The host storage handoff section is precise about fail-closed behavior. It distinguishes untrusted raw host wire shape from validated `StorageProviderConfig`, and it names the important join fields: provider ref, kind, role, authority, scope, fingerprint, required providers, protocol/schema/contract versions, and raw byte policy.
- The security parity workstream is anchored to the Rust serde shapes. The plan correctly calls out that current TS `AccessExplanation` claims Rust parity while omitting fields Rust emits, and it handles the metadata mismatch by requiring either Rust persistence support or a split UI-only type.
- Verification coverage is much stronger than average. It covers TypeScript package gates, public publish-readiness, kernel behavior, Rust security gates, serde fixtures, export-surface checks, identity checks, external positive and negative fixtures, and provider conformance tests.

Major gaps or risks

- The scope is too large for a single implementation contract. The plan spans several independent domains with different owners and risk profiles. It does list parallel workstreams, but it should turn those into explicit milestones with independent merge criteria, otherwise workers may collide on export manifests, contracts shims, SDK API reports, kernel storage lifecycle, and security fixtures.
- The proposed `types/document` executable registry and validation functions need a sharper runtime boundary. This package is described as a type shard and currently mostly exports type declarations plus small constants. If it becomes the home for production-compiled validators and const matrices, the plan should specify side-effect constraints, build/declaration expectations, import style from kernel, and what logic is allowed in the leaf package versus kernel.
- The public/internal document option split is directionally right but underspecified for compatibility. The plan should define exact old-to-new type aliases, deprecation behavior, runtime rejection behavior, and fixture/API Extractor expectations for SDK consumers currently seeing `CreateDocumentOptions` and `DocumentImportOptions`.
- Several contract-normalization tasks are named but not fully specified. Examples: exact `StorageErrorCode` naming scheme, `CompositionViolationCode` taxonomy, `ProviderSequence` wire representation, timestamp policy by family, proof payload canonicalization, path-brand constructors, and table-driver capability-method mapping.
- Security parity needs a concrete fixture flow. The plan says Rust-to-TS and TS-to-Rust fixtures are required, but it should name the fixture locations, generation ownership, serde normalization rules, and whether Rust or TS is authoritative for each shape.
- Export-surface work needs an exact manifest schema. Without that, different workers can implement incompatible notions of "public through contracts", "workspace-internal subpath", "source-owned file", and "intentional non-export".

Contract and verification assessment

The contract assessment is the best part of the plan. It treats storage composition, high-water proofs, inbound updates, security explanations, filesystem grants, platform file handles, and table-driver capabilities as enforceable contracts rather than comments. The plan also recognizes that public declaration output and type identity are part of the contract, not cleanup artifacts.

The verification gates are broad and mostly appropriate. The important improvement is to attach gates to milestones. For example, the export-surface milestone should require the manifest/package/export/API report fixture gates; the storage registry milestone should require kernel composition and provider conformance tests; the security milestone should require Rust serde parity and focused bridge/API tests. Repo-wide `pnpm typecheck` and publish-readiness are good final gates, but they should not be the only proof that each contract moved safely.

Concrete changes that would raise the rating

- Split the plan into 4-6 staged deliverables with explicit "done when" criteria and allowed file boundaries for each stage.
- Define the `export-surface.ts` schema and the checker behavior before implementation begins.
- Add a short ADR-style decision for executable code in `types/document`: allowed runtime constructs, dependency limits, build outputs, and consumer import rules.
- Specify exact public/internal option type names, aliases, and compatibility behavior for `CreateDocumentOptions`, `DocumentImportOptions`, and SDK-facing import/open options.
- Define the canonical code unions and wire brands up front: storage errors, composition violations, proof validation errors, provider sequences, timestamps, hashes, session/proof/update ids, and proof field mismatch keys.
- Pin the security parity fixture mechanism, including fixture paths, Rust serializer entry points, TS validator/assertion strategy, and camelCase/snake_case normalization rules.
- Convert the parallelization notes into a dependency graph with merge order and required gates per worker so the plan can be executed safely by multiple agents.
