Rating: 8/10

Summary judgment

This is a strong, production-relevant plan for `types/core/src`. It correctly treats the folder as a Tier 0 contract source rather than a passive type bag, and the main claims are grounded in the current code: `CellValue` is narrower than Rust's serde model, several identity-bearing fields are still plain `string`, public `contracts/src/**` duplicates runtime values, and documented helpers in formula/result/disposable/rich-text are split or missing. The plan also understands the public projection problem: `@mog/types-core` may author the contracts, but shipped public declarations and runtime modules must not leak private workspace package imports.

The rating is not higher because the plan is still more of a comprehensive direction than an implementation-ready contract. It names the right workstreams and verification gates, but it leaves several critical details open: exact generated projection mechanics, public compatibility policy, cross-language fixture ownership, accepted JSON schemas for the expanded value union, and incremental acceptance criteria for a multi-agent migration touching public contracts, kernel consumers, generated API artifacts, and Rust serde crates.

Major strengths

- The source-folder role is accurately described. The plan recognizes that `types/core/src` exports runtime values as well as types, and that `contracts/src/**`, SDK declarations, kernel bridges, and spreadsheet utilities are part of the production path.
- The `CellValue` objective is substantively correct. Rust `value-types::CellValue` covers primitives, error objects, arrays, controls, and images, while the current TS contract exposes only primitives plus `CellError` and leaves `CellControl` separate.
- The identity branding work is systematic rather than local. The plan calls out concrete plain-string gaps in `CellAddress`, `CellRange`, `IdentityRangeSchemaRef`, `CellIdRange`, and `IdentityMergedRegion`, and it distinguishes semantic branded fields from deliberate wire DTOs.
- The runtime ownership problem is real. Current public contract modules type-export from `@mog/types-core` while hand-maintaining values such as `DEFAULT_CELL_STYLE`, constructors, and enums; the plan correctly asks for a single authoring source plus public-safe projection.
- The stale/misleading helper documentation is well spotted. `formula-string.ts`, `result.ts`, `disposable.ts`, and `rich-text.ts` currently describe runtime helpers or utilities that live elsewhere or do not exist in this package.
- The verification list is production-oriented. It includes package typechecks, newly required package tests, public artifact generation, declaration rollup checks, API snapshots, external fixtures, and Rust crate serde tests.
- The parallelization notes are credible. The suggested slices have mostly clean ownership boundaries: export inventory, Rust/TS serde alignment, branding migration, public projections, runtime helper ownership, and final verification.

Major gaps or risks

- The public projection mechanism is underspecified. "Generate or project public runtime modules" is the central architectural move, but the plan does not name the generator, source inventory format, output locations, update/check modes, or how type-only imports are rewritten so public declarations stay private-package-free.
- The expanded `CellValue` contract needs an exact schema table. The plan lists arrays, controls, and images, but does not precisely specify optional versus nullable fields, image dimension semantics, `altText` absence/null behavior, unknown object handling, or whether TS boundary validators mirror Rust's lossy fallbacks.
- Public compatibility is not addressed enough. Branding `CellRange.sheetId`, `CellAddress.sheetId`, and identity fields will intentionally narrow exported public types. The plan should state whether this is an allowed breaking contract change, whether any deprecated aliases remain, and which public fixtures prove the resulting SDK shape.
- Cross-language fixture ownership is vague. The plan asks for shared JSON fixtures, but not where they live, which side generates canonical outputs, how update mode works, or what gate prevents TS validators and Rust serde from accepting different supersets.
- The module split could turn into churn unless acceptance criteria are sharper. Splitting `core.ts` is reasonable, but the plan should define which historical barrels and subpaths must remain stable, which imports are allowed to move, and which behavior must be snapshot-equivalent after each slice.
- The spill/projection transition is directionally right but still has an open decision. It says to decide whether projection is canonical after auditing consumers; that is prudent, but it means this workstream cannot be implemented safely without a concrete audit artifact and removal/rename criteria.
- Verification gates are extensive but not staged. Running the full list at the end is useful, but a multi-agent migration needs per-phase gates so type ownership, Rust serde fixtures, public projections, and kernel normalization do not diverge before integration.

Contract and verification assessment

The plan's contract model is strong. It preserves the right invariants: Excel row/column limits, zero-indexed coordinates, flat `CellRange` as the UI/API range shape, durable identity refs as separate CRDT-safe contracts, formula string prefix semantics, opaque `FormattedText`, and public declaration rollups with no `@mog/types-*` leakage. It also correctly insists that API paths intentionally returning scalar values should use named projection types rather than weakening the canonical `CellValue`.

The verification posture is above average, but it should be made more executable. The listed commands mostly correspond to real package or root scripts, and adding `@mog/types-core` tests is the right direction. The missing piece is measurable fixture and declaration contracts: exact JSON examples for every `CellValue` variant, type assertion tests that fail on plain strings at semantic branded fields, runtime equality checks between internal and public projected values, and declaration snapshots that prove the public packages expose only public specifiers.

Concrete changes that would raise the rating

- Add an explicit projection design: source inventory schema, generator/checker script names, generated file locations, public declaration rewrite rules, and sample failure output for private import leakage.
- Define the full `CellValue` JSON contract in a table, including optional/null field behavior, unknown variants, non-finite numbers, jagged arrays, control defaults, and image sizing/dimension semantics.
- State the public compatibility policy for branded field narrowing and removed helper imports, including whether deprecated aliases or migration shims are intentionally excluded.
- Pin the cross-language fixture location and ownership model, with canonical Rust output fixtures, TS validation fixtures, and update/check commands.
- Add per-phase acceptance gates: inventory complete, value model aligned, identity branding migrated, runtime projections drift-checked, helper ownership unified, spill decision recorded, declarations clean, and downstream consumers verified.
- Specify the stable export/subpath contract for `@mog/types-core` and `@mog-sdk/contracts` before module splitting begins, including whether `sheet-id` becomes a public subpath or stays internal to `core`.
- Turn the spill/projection audit into a required artifact listing every consumer of old spill types and the exact delete, rename, or keep decision for each exported symbol.
