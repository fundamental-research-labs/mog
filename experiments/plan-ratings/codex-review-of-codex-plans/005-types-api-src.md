Rating: 8/10

Summary judgment

This is a strong plan for a high-risk public type surface. It correctly treats `types/api/src` as the private source of truth that becomes public through `@mog-sdk/contracts`, generated API metadata, declaration snapshots, runtime import checks, and external fixtures. The plan is grounded in the current repo shape: `@mog/types-api` is private, has a large export map, `contracts/src/api` is mostly a shim layer, `tools/generate-api-reference.ts` still uses hand-maintained Workbook/Worksheet maps, and `runtime/sdk/scripts/generate-api-spec.ts` already uses AST discovery.

The rating is not higher because several execution contracts are still underspecified. The plan says what classes of problems to solve, but not exactly what inventory schema, checker command names, CI insertion points, allowlist policy, or per-agent acceptance contracts will prove the work is complete.

Major strengths

- Production-path relevance is high. The plan centers `@mog-sdk/contracts/api`, public declaration artifacts, generated docs/specs, snapshots, runtime import inventory, and external fixture imports instead of local-only type cleanup.
- The architectural boundary is right. It preserves `@mog/types-api` as a private build input and calls out that public consumers should not import private type shards directly.
- The loose-type hardening objective is systematic rather than whack-a-mole. The cited hotspots in filters, pivots, services, capabilities, workflows, object updates, and conditional formats are real areas where `any`, `unknown`, or `Record<string, unknown>` can weaken downstream contracts.
- The generator alignment work is valuable. Having one metadata generator read `types/api/src/api` with hand-maintained sub-API maps while another scans `contracts/src/api` is exactly the kind of drift this folder needs to eliminate.
- Verification breadth is good. The plan names the relevant contracts build, declaration identity, runtime import, API snapshot, generated metadata, external fixture, and repo-wide type gates.
- Parallelization is plausible. The proposed split across inventory, API DTOs, non-API DTOs, generator alignment, fixtures, and integration has mostly clean ownership boundaries.

Major gaps or risks

- The new contract inventory is not specified enough. It should name the checked-in file path, schema fields, allowed classifications, owner package, public projection path, contracts shim path, generated metadata consumers, runtime-value status, and allowlist reason format.
- Checker integration is vague. The repo already has `package-export-dispositions.mjs`, package validation, declaration rollup, runtime import, and API snapshot tooling. The plan should say whether the parity checker extends these or creates a new command. Current root `package.json` also references an `inventory:contracts` script for `tools/contracts-shim-inventory.mjs`, but that file was not present in this checkout, so the plan needs an explicit tool home rather than assuming one exists.
- The loose-type policy needs measurable exit criteria. Some schemaless workflow, app config, producer metadata, and error-detail fields are legitimate. The plan should define which raw `any`/`unknown`/`Record<string, unknown>` forms are forbidden in public declarations, which named DTOs are allowed, and how the checker distinguishes intentional JSON boundaries from accidental placeholders.
- The implementation sequencing is broad enough to create integration risk. Updating `types/api`, `contracts`, `kernel`, `apps/spreadsheet`, `runtime/sdk`, generators, docs, snapshots, and fixtures in one stream needs tighter merge contracts per agent, especially around dependency direction and avoiding new casts.
- The verification list is strong but incomplete for touched consumers. If `kernel`, `apps/spreadsheet`, or contract runtime values change, the plan should require their relevant package tests in addition to typecheck/build gates. If it intentionally relies on type-only fixtures instead, it should state why no behavior test is needed.
- The generated metadata agreement checker needs a normalization spec. It should define how to compare overloads, excluded internal members, deprecated tags, async model, aliases, source locations, and owner packages so the gate does not become noisy or silently weaker than either generator.
- The existing `types/api/src/api/README.md` already contains the core DTO philosophy but still references the old `@mog/spreadsheet-contracts/api` import path. The plan should explicitly update that doc rather than add a parallel governance document.

Contract and verification assessment

The contract model is mostly clear: public API types are authored in `types/api/src`, projected through `contracts/src`, rolled into `@mog-sdk/contracts` declarations, and consumed by SDK metadata plus external fixtures. The plan appropriately protects against private runtime imports and duplicate branded declaration ownership.

The weakest contract area is the definition of "public" for this private package. `@mog/types-api` package exports are not themselves public consumer paths, so the inventory should classify source files by their public projection through `@mog-sdk/contracts`, not merely by private package export presence. The plan gestures at this but should make it a hard invariant.

The verification gates are relevant and mostly use real repo commands. To be execution-ready, the plan should add named commands for the new parity checker and metadata agreement checker, state where they are wired into publish readiness or public-boundary checks, and include consumer package tests when implementation packages are modified.

Concrete changes that would raise the rating

- Add an exact inventory schema and target path, with examples for a direct public API source, a barrel-only file, an internal helper, and a runtime-value shim.
- Define a loose-type allowlist policy with a final measurable gate such as "no raw `any` in public `@mog-sdk/contracts/api` declarations; no raw `Record<string, unknown>` except named `JsonObject`, `ExtensionMetadata`, or approved workflow/app-config DTOs."
- Name the new commands, for example `pnpm check:types-api-contracts` and `pnpm check:api-metadata-agreement`, and specify their CI/publish-readiness insertion points.
- Specify generator agreement normalization rules before implementation starts, including exclusions and overload/deprecation handling.
- Add per-agent acceptance contracts: files owned, allowed dependencies, expected fixtures/snapshots, and no-new-cast/no-private-runtime-import rules.
- Expand final verification to include relevant package tests for any changed implementation consumers, or explicitly justify a type-only gate when no runtime behavior changes.
