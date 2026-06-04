Rating: 7/10

Summary judgment

This is a strong architectural plan that correctly recognizes `kernel/src/services/protection` is currently only a small duplicate helper surface while real enforcement is scattered through worksheet APIs, workbook APIs, table guards, compute atomics, and XLSX import/export paths. The plan has the right north star: compute remains the state and cell-editability authority, TypeScript gets typed policy adapters and stable errors, and UI paths must not become the enforcement layer.

The main reason it is not higher is that it reads more like an epic than an implementation contract. It names many correct systems and risks, but several key interfaces are still undecided or underspecified: helper ownership, operation-to-option matrices, allow-edit range bridge/state shape, modern password hash verification, decision/error payload schemas, and phase boundaries. That makes it useful for direction-setting, but risky as a parallel-agent work order because different tracks could make incompatible choices.

Major strengths

- Correctly identifies the current folder contents and the duplication with `@mog/spreadsheet-utils/protection`.
- Correctly anchors enforcement in production paths: `ctx.computeBridge.canEditCell`, `canDoStructureOp`, workbook structure guards, bridge mutation results, undo/collab/event coherence, and real UI input E2E tests.
- Calls out real current gaps: `allowEditRanges` is only an in-memory TypeScript map, `canPauseProtection` is overly optimistic, `getConfig()` omits `hasPasswordSet`, and operation aliases/options drift across API, guards, and Rust.
- The proposed module split is architecturally reasonable for this folder: password helpers, mutation results, sheet option normalization, operation mappings, pure decisions, and thin guard adapters.
- Verification coverage is broad and mostly production-relevant, spanning kernel API tests, compute tests, XLSX roundtrip tests, workbook tests, and browser E2E tests through real input paths.
- Parallelization notes identify sensible tracks and dependency direction across kernel, contracts/types, compute, file-io, and app behavior.

Major gaps or risks

- Helper ownership is left as a decision branch. The plan says the preferred path is `@mog/spreadsheet-utils/protection`, but `@mog-sdk/kernel` currently imports it from production code while it appears only in `devDependencies`. The plan should pick the canonical owner and define the package dependency change explicitly, or specify the lower-level extraction target.
- The operation matrix is described but not specified. A parallel implementation needs an explicit table for every public and internal operation, its aliases, the protection option it consults, whether it additionally requires range editability, and the standard blocked reason.
- The plan mentions adding `insertHyperlinks`, `pivotTables`, and `editScenarios`, but current Rust `can_do_structure_op` handles `pivotTables` and aliases for filter/object while not handling `insertHyperlinks` or `editScenarios`. The plan should state exact Rust and TypeScript deltas for each missing operation.
- `allowEditRanges` is the largest behavioral expansion, but its contract is too abstract. It needs concrete snapshot fields, Yrs storage location, bridge method names/signatures, title uniqueness rules, sqref normalization rules, password/unsupported-hash behavior, session unlock scoping, collaboration semantics, and import/export acceptance criteria.
- Modern OOXML password support is ambitious but underspecified. The plan should decide whether verification lives in Rust/file-io, compute, or TypeScript, how browser/runtime crypto is handled, and how preserved-but-unverifiable metadata is represented in public APIs.
- Error contracts are not concrete enough. `ProtectionDecision` and protected workbook/sheet payloads should have exact discriminants and context fields, not just a general requirement for stable machine-readable context.
- Sequencing is too coarse. The plan should split into phases with mergeable contracts, for example: helper ownership and service module extraction, operation matrix unification, workbook decisions, allow-edit persistence, password hash model, then app/E2E adoption.

Contract and verification assessment

The plan is strong on invariants: unprotected sheets allow operations, protected empty cells default locked, selection flags default allowed, OOXML polarity must stay correct, formula hiding depends on protection plus hidden format, workbook structure protection blocks sheet structure changes, and mutation paths must go through compute. These are the right contracts to preserve.

The weaker part is that the new contracts are not yet precise enough to implement independently. The service adapter interfaces, decision result type, operation unions, alias tables, protected error context, allow-edit range model, and password hash model need exact TypeScript/Rust shapes before multiple agents can safely work in parallel.

The verification gates are directionally good and production-path relevant. They would be stronger if each phase had its own required gates and if compile-time exhaustiveness tests were named more specifically. For example, operation mapping tests should fail when a `SheetProtectionOptions` permission field or public operation is added without a mapping decision.

Concrete changes that would raise the rating

- Replace the helper ownership branch with one chosen package boundary and exact dependency/export changes.
- Add explicit worksheet and workbook operation mapping tables to the plan, including aliases, option fields, range-editability requirements, and blocked reason codes.
- Define the `ProtectionDecision` and error context schemas in the plan before implementation.
- Specify the persisted `AllowEditRange` domain/bridge contract, including session unlock behavior and XLSX protected range roundtrip expectations.
- Break the implementation into ordered phases with acceptance criteria and verification gates per phase.
- Add a call-site audit checklist for worksheet editing, formatting, hyperlinks, objects, tables, filters, slicers, pivots, formula bar, and workbook sheet structure operations so "replace scattered guards" is measurable.
