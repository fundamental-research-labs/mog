Rating: 8/10

Summary judgment

This is a strong, well-grounded plan. It correctly treats `contracts/src/core` as a public facade with private type-shard authoring and contracts-owned runtime values, and it identifies the real production risks: duplicated `execution.ts` and `schema.ts` type bodies, private runtime import leakage, branded declaration identity, `RangeKind` parity, public subpath stability, and insufficient external fixture coverage. The plan is architecturally compatible with the current package boundary tooling and names concrete source files, production consumers, and existing gates.

The main reason it is not higher is that several important work items are specified as broad audits rather than crisp implementation contracts. The plan would be easier to execute and verify if it separated the facade cleanup from exploratory wire-shape audits, defined the new inventory/checker schema exactly, and mapped each deliverable to a pass/fail gate.

Major strengths

- Accurately describes the current source-of-truth split: type bodies in `types/core` and `types/commands`, with public runtime values emitted locally by `@mog-sdk/contracts`.
- Correctly targets production-path package boundaries rather than test-only cleanup. The existing build already runs declaration identity, runtime inventory, and runtime import checks, so the proposed extensions fit the architecture.
- Preserves public compatibility across root, `@mog-sdk/contracts/core`, and narrower subpaths instead of proposing shims or public-surface churn.
- Calls out the subtle nominal-brand risks for `SheetId`, `RangeId`, `CellId`, `FormattedText`, and formula brands, which is essential for declaration rollups.
- Includes real cross-language contract risks, especially `RangeKind`, `RangeAnchor`, `PayloadEncoding`, and `PrintSettings`.
- The parallelization split is sensible: inventory/checker, facade refactors, tests, fixtures, Rust/generated parity, wire-shape audit, downstream constants, and final integration are largely separable.

Major gaps or risks

- The plan combines a bounded facade refactor with a much larger audit of `CellValue`, `CellRange`, `RangeAnchor`, `AxisIdentityRef`, `PayloadEncoding`, and `PrintSettings`. Those audits are valuable, but they need explicit stop conditions or they can expand beyond the core facade cleanup.
- The new `check-contracts-core-facade` gate is under-specified. It should define its exact file path, inventory format, package-script integration, parser strategy, and failure messages before implementation starts.
- `schema.ts` has a subtle type/value hazard: projecting `ValidationErrorCode` from `@mog/types-commands/schema` while locally emitting `ValidationErrorCodes` must be proven in the built declaration output and external type fixtures, not only source TypeScript.
- The `RangeKind` Rust comparison needs a less brittle contract. The plan says to compare Rust source and generated bridge output, but should identify whether the authoritative gate is a serde snapshot, generated bridge type, Rust unit test, or all three.
- The downstream spreadsheet-limit replacement needs an allowlist model. Some numeric constants may be product or algorithm limits, and the plan notes this, but does not define how the scan records intentional exceptions.
- Verification is comprehensive but not sequenced. The plan lists many gates, yet it does not tie each gate to the step that requires it or distinguish mandatory facade gates from conditional consumer/Rust gates.

Contract and verification assessment

The contract model is mostly excellent. Runtime self-containment, package export stability, declared ownership for runtime values, identity factory behavior, exact spreadsheet limits, and `RangeKind` string parity are all appropriate invariants for this folder. The plan also correctly avoids moving validation behavior into contracts and avoids inverting the tier-0 type-shard dependency direction.

The verification strategy is directionally strong. `@mog-sdk/contracts` build, runtime inventory, runtime import, declaration identity, declaration rollup, API snapshot, and external fixture checks are the right gates for this surface. The added parity checks for execution constants, `ValidationErrorCodes`, formatted text helpers, identity factories, and `RangeKind` would materially reduce drift.

The weak point is precision. The plan should turn "audit high-risk wire shapes" into specific assertions, such as assignability fixtures, generated bridge snapshot comparisons, or named conversion-boundary tests. It should also specify that public fixture assertions exercise built artifacts for root, core, execution, schema, and core/core imports, because source-time aliases are not enough for this package.

Concrete changes that would raise the rating

- Add a deliverables table with exact paths, owners, and acceptance gates for the inventory file, checker script, package script entry, tests, fixtures, and downstream constant scan.
- Define the core facade inventory schema up front, including public subpath, source type shard, runtime owner, retained runtime exports, and allowed duplicate-runtime rationale.
- Split the work into two phases: facade source-of-truth cleanup with parity gates, then high-risk wire-shape audits with independent acceptance criteria.
- Add an explicit built-declaration acceptance test for `ValidationErrorCode` and `ValidationErrorCodes` proving root/core/schema imports do not create private runtime references or duplicate public owners.
- Make `RangeKind` parity use generated bridge output plus a Rust serde test or snapshot as the authoritative cross-language contract, with source parsing only as a secondary convenience.
- Define the spreadsheet-limit scan as a checker with an allowlist for intentional non-sheet limits, and require renamed constants for any retained product-specific limits.
- Map verification gates to implementation steps so workers know the minimum required checks for each slice and the integrator knows the final full gate set.
