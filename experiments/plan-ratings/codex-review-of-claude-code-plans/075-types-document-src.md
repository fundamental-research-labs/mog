Rating: 8/10

Summary judgment

This is a strong, source-aware plan for a high-leverage contracts package. It correctly treats `mog/types/document/src` as a Tier-1 type vocabulary spanning document creation, storage providers, filesystem, shell/platform facades, and security policy shapes, and it focuses on contract drift rather than implementation churn. The best parts are the duplicate-vocabulary inventory, the JSON-serialization concern around inbound sequence values, the recognition that `CreateDocumentOptions` currently exposes runtime-rejected paths, and the call to make Rust/TS serde claims checkable.

The rating is not higher because several implementation-critical decisions are still left as choices inside the plan, and the verification story underweights the public `@mog-sdk/contracts` facade that re-exports these types. A contracts-hardening plan should leave implementers with exact canonical shapes, exact export/runtime-value policy, and exact gates for the private shard plus the public facade.

Major strengths

- The scope is accurate. The plan identifies the real subgroups, root `export {}` rationale, package exports map, and the package's dependency purity on `@mog/types-core`.
- It finds real contract drift. `app.TableColumnType`/`TableSchemaDefinition` and `storage.ColumnType`/`TableSchema` are overlapping but not equivalent; legacy `document.ProviderConfig` is distinct from `storage.StorageProviderConfig`; and `ProviderInboundUpdateEnvelope.sequence?: bigint` conflicts with JSON/signed-payload expectations.
- It correctly preserves important invariants: subpath stability, discriminated unions, the two distinct `AccessLevel` domains, credential handles rather than secrets in provider configs, `CellId`-based search/comment identity, and the CSV formula-evaluation guard.
- The plan is production-path relevant. It names kernel lifecycle/provider registry/composition-validator consumers, host creation/validation paths, shell boundary checks, Rust `compute-security`, and `csv_parser`, rather than proposing isolated type edits.
- The cross-boundary conformance objective is especially valuable. The TS `AccessExplanation` currently claims to match Rust, while Rust has fields such as effective tags, sorted policies, ambiguity, clamp state, and enum-style reason that are not represented in the current TS interface.
- Additive-first migration is the right posture for a widely imported private type shard that also feeds public contracts.

Major gaps or risks

- Phase 1 does not choose the canonical table-schema mapping. "Either aliases of, or documented subsets" and "pick one polarity" is not enough; implementers need the exact resulting `TableColumnDefinition` semantics, whether `required` is derived from `nullable`, and how `array`/`unknown` are handled for app data requirements.
- The runtime-value policy is underspecified. Adding exported `as const` tuples for every union turns many type-only modules into runtime modules. That may be correct, but it must update the contracts runtime inventory and public facade rules intentionally, not just pass a vague "no-runtime check."
- The plan treats `types-document` exports as the main contract surface but does not sufficiently account for `@mog-sdk/contracts`, which is public and re-exports many of these types through shims. Changes here affect `contracts` declaration rollups, runtime export verification, API snapshots, and SDK/node surfaces.
- Phase 4's `CreateDocumentOptions` split is directionally right but not specified as an API contract. The plan should name the new public and internal types, their export paths, and the migration of `DocumentImportOptions extends CreateDocumentOptions`, kernel `DocumentFactory`, host-internal create options, and public `@mog-sdk/contracts/document`.
- The `appId()` decision is framed as either moving the constructor to kernel or allowing constructors here, but the plan does not spell out compatibility for current `@mog-sdk/contracts` API snapshots that expose `appId(id: string): AppId`.
- The sequence migration is high risk and needs a stronger rollout. A branded decimal string is a good recommendation, but the plan should define the canonical JSON representation, conversion boundaries, monotonic comparison rules, and whether `StorageReplayError.failedAtSequence` and high-water snapshots migrate in the same change.
- Version branding is too loose. A semver-shaped brand helps assignment safety, but the plan does not define whether compatibility is major-only, range-based, exact, per-provider-kind, or enforced by the composition validator.
- Parallelization notes overstate independence. Tuple exports, runtime inventory, root barrel changes, and public facade updates can collide because they change module runtime surfaces and export snapshots, even if the source files look separate.

Contract and verification assessment

The contract goals are mostly the right ones, and the plan correctly keeps enforcement changes out of this folder. The biggest contract weakness is precision: several phases say "decide," "either," or "preferred" where a handoff-ready plan should already define the target shape. For a contracts package, ambiguity in the plan becomes ambiguity in every downstream package.

The verification section has the right categories but needs exact, workspace-real gates. `pnpm --filter @mog-sdk/types-document typecheck` maps to the package script, but public-impacting changes also need `pnpm --filter @mog-sdk/contracts build`, `pnpm check:contracts-declaration-identity`, `pnpm check:contracts-runtime-inventory`, `pnpm check:api-snapshots`, and targeted kernel/shell gates when consumer migrations happen. The plan should also require compile-time equality assertions for old-vs-new tuple-derived unions before migration, plus fixture-based Rust/TS conformance for `AccessExplanation` and `CsvImportOptions`.

Concrete changes that would raise the rating

- Replace all "pick one" choices with exact target contracts: final table schema mapping, final `CreateDocumentOptions` split, final `appId()` policy, final sequence type, and final version compatibility semantics.
- Add a public-facade subsection covering `contracts/src` shims, `@mog-sdk/contracts` runtime exports, declaration rollups, API snapshots, and SDK/node API surfaces.
- Define the runtime tuple policy explicitly: which tuples are exported as values, which remain type-only, how `contracts-runtime-inventory.json` is updated, and how tree-shaking/runtime self-containment is verified.
- Add an exact migration matrix for downstream consumers: kernel registry/composition-validator, document factory, host-internal create/validate, shell boundary validator, runtime SDK API generation, Rust bridge types, and public contracts snapshots.
- Specify conformance fixtures in concrete terms, including sample serialized `CsvImportOptions` defaults and full `AccessExplanation` fixtures from Rust to TS.
- Tighten sequencing so high-risk wire changes land behind characterization fixtures and public API snapshot review, while purely internal documentation/import-path cleanup can land separately.
