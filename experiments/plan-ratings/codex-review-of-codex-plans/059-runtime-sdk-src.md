Rating: 8/10

Summary judgment

This is a strong plan for `runtime/sdk/src`. It correctly treats the folder as a high-leverage public package boundary rather than a small implementation module, and it is grounded in the actual current state: the package root exports internal headless/collaboration helpers, the API report contains release-tag/private-identity warnings, `api-describe.ts` erases rich generated metadata from `api-spec.json`, generated-spec freshness is not enforced, and `createWorkbook`/host/chart paths are production-critical.

The plan is not quite implementation-ready as a manager-level spec because several architectural choices remain phrased as decisions to make during implementation. The biggest missing piece is an explicit before/after contract for the public root and any unstable/internal subpath, including every downstream consumer that must move with it. Without that, parallel agents can make incompatible choices about package exports, API snapshots, publish fixtures, docs, and kernel collaboration tests.

Major strengths

- Correctly prioritizes public contract hygiene over local cleanup. The current `index.ts` exports `HeadlessEngine`, raw headless factories, `NapiAddonModule`, `CollaborativeEngine`, and `createCollaborativeGroup` despite `@internal`/`@experimental` comments; the plan identifies this as a package-contract problem and ties it to API Extractor failures.
- Strong production-path focus. It explicitly keeps `createWorkbook` on the host-backed document path, preserves import durability waiting, keeps chart exporter registration on blank and imported workbooks, and rejects fallback to raw construction when host validation fails.
- Good use of existing generated assets. The checked-in `api-spec.json` already contains `schemaVersion`, `stableId`, `canonicalPath`, source, ownership, async model, parameters, returns, alias, and deprecation metadata, while `api-describe.ts` exposes only a reduced legacy shape. The plan correctly calls for preserving the generated contract instead of inventing a parallel discovery API.
- Verification coverage is unusually concrete: package tests, typecheck, build, API report, verify-build, smoke-test, verify-publish, repo typecheck, generated freshness, docs smoke, source-handle rejection cases, lifecycle idempotency, native capability checks, and external consumer matrix.
- The parallelization split is plausible. Export surface, caller migration, API introspection, generator/docs gates, `createWorkbook`, host adapter, native/chart, and collaboration can be worked independently if the missing contracts are nailed down first.

Major gaps or risks

- The plan does not state the exact stable root export set in a machine-checkable form. It says to add a manifest and gives examples, but a plan of this size should include the proposed manifest contents or a table of keep/remove/move symbols. "Contract type re-exports" is too broad for an SDK public surface.
- The unstable/internal entrypoint is unresolved. The plan says "internal or unstable" and "if production monorepo tests need those helpers", but implementation needs a chosen package export such as `./unstable/headless` or a non-package workspace-only import path, plus whether it is published in `package.json`, `publishConfig.exports`, and API reports.
- Downstream consumer inventory is incomplete. Besides kernel/compute tests, current repo evidence includes `tools/verify-sdk-publish.mjs` requiring `HeadlessEngine` and `createHeadlessEngine`, `tools/api-snapshots/@mog-sdk__node.api.txt` snapshotting them, public/internal docs listing `createHeadlessEngine`, and external package fixtures. These are contract owners and must be listed as migration targets.
- Sequencing should be stricter. The export manifest and downstream migration must precede API Extractor fail-hard changes; otherwise agents may break publish gates before the replacement subpath and fixture expectations exist.
- Generated-spec freshness is specified at a goal level but not as a concrete mechanism. `generate-api-spec.ts` currently writes artifacts unconditionally when changed and has no check mode, so the plan should define `--check`, deterministic output requirements, and whether schema validation uses a dependency, a local validator, or structural assertions.
- The plan combines several large workstreams under one review item. That is acceptable for this repo's development model, but the acceptance criteria need phase boundaries so a partially completed implementation cannot claim victory after only root-export cleanup or only API metadata work.
- The host adapter hardening section calls for factoring many helpers, but it does not define public/private ownership of those helpers or which tests remain production-path versus unit-only. Factoring should not accidentally make trusted-host internals importable from the public package.
- Collaboration remains ambiguous: the plan permits either an unstable subsystem or a move to another package. That is the right architectural question, but it needs an explicit decision record before Agent H starts so tests, exports, and docs converge.

Contract and verification assessment

The plan has the right contract categories: stable package exports, internal/unstable headless and collaboration helpers, generated API schema/runtime shape, host authorization/source-handle invariants, workbook lifecycle ownership, native addon capabilities, chart mark serialization, and declaration self-containment.

The verification gates are broad and mostly production-relevant. `pnpm --filter @mog-sdk/node test/typecheck/build/api-report/verify-build/smoke-test/verify-publish` plus `pnpm typecheck` is appropriate for TypeScript public-surface work. The plan also correctly asks for ESM and CJS built-package checks and packed-tarball smoke tests from outside the monorepo symlink layout.

What is missing is a small number of hard, reviewable acceptance artifacts:

- A checked-in export manifest with exact stable root symbols and exact unstable/internal symbols.
- An exact API Extractor policy for which warning IDs fail and which are intentionally suppressed.
- A generated-spec `--check` contract that proves `api-spec.json` and `api-spec.schema.json` are byte-for-byte fresh.
- A downstream migration list covering API snapshots, publish verifier, external fixtures, docs, and kernel/collab tests.
- A compatibility decision for current public accidental exports, even if the answer is intentionally "break them now".

Concrete changes that would raise the rating

1. Add a table to the plan with every current root export classified as `stable`, `unstable-subpath`, `workspace-internal-only`, or `remove`, and include the exact target import path for moved symbols.
2. Choose the subpath/package-boundary design before implementation begins, including `package.json` and `publishConfig.exports` shape and whether API Extractor reports cover the unstable surface separately.
3. Expand the consumer migration list to include `tools/verify-sdk-publish.mjs`, `tools/api-snapshots/@mog-sdk__node.api.txt`, external fixtures under `fixtures/external`, public/internal docs that advertise `createHeadlessEngine`, and the kernel collaboration tests already identified.
4. Define `generate-api-spec --check` precisely: no writes in check mode, stable JSON ordering, schema validation command/library, and failure messages for stale artifact, schema mismatch, and runtime unsupported `schemaVersion`.
5. Split the implementation into ordered phases with acceptance gates after each phase: surface split, generated API contract, workbook lifecycle/host hardening, chart/native coverage, collaboration decision, docs/publish readiness.
6. Make the `WorkbookConfig { ctx, eventBus }` decision explicit in the stable manifest and README update. If removed from public docs, add a root export/type test proving the bypass is unavailable through `@mog-sdk/node`.
7. Add a "no public deep imports" check for any new internal host/headless files so the refactor does not create a different accidental public surface while fixing the root.
