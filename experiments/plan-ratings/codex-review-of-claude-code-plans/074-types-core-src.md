Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan for a real foundation-contract problem. It correctly treats `@mog/types-core` as a Tier-0 vocabulary package, keeps the work on the production type surface, and names the downstream contract pressure through `@mog-sdk/contracts`, kernel, app code, and Rust wire shapes. The rating is held below 9 because several important brand seams remain implicit or missed, and a few verification mechanisms are directionally right but not yet executable from the current package setup.

Major strengths

- The factual baseline is mostly accurate: `core.ts` is the 1530-line outlier, `cells/formula-string.ts` has brands but no constructors, several exported identity fields still erase brands to `string`, `CellMetadata` and `CellProperties` duplicate blocks, and Rust-mirrored range types are hand-maintained.
- The architectural direction fits the repo: fix the canonical source, preserve Tier-0 dependency purity, avoid compatibility shims, keep constructors pure, and protect the `index.ts`/exports surface.
- The plan is production-path relevant. It recognizes that type tightening must be accepted through `@mog-sdk/contracts` declaration output and downstream TypeScript consumers rather than proven only inside `types/core`.
- The verification categories are the right ones: type-negative assertions, constructor behavior tests, Rust parity, barrel export stability, no-new-dependency checks, and downstream typecheck after declaration rollup.
- The sequencing notes are useful and realistic about cross-folder migration pressure, especially the need to coordinate kernel bridges, app producers, and `@mog-sdk/contracts`.

Major gaps or risks

- The formula contract is incomplete. `IdentityFormula.template` is currently `string`, and `IFormulaConverter.toIdentity(a1Formula: string)` / `toA1(...): string` remain unmentioned as target seams. Adding constructors without branding these owner interfaces would leave the `FormulaA1` / `FormulaTemplate` brands non-load-bearing at some of their most important boundaries.
- Existing production helpers already exist in `@mog/spreadsheet-utils/cells/formula-string` (`asFormulaA1`, `toFormulaA1`, `asFormulaTemplate`, `toFormulaTemplate`, `ensureFormulaA1`). The plan should consolidate or rehome those helpers instead of creating a second API with overlapping names and possibly different normalize-vs-assert semantics.
- The brand inventory misses or underspecifies some Rust-mirrored range/axis details. `RangeAnchor` currently uses bare strings for row/column ids even though Rust uses `RowId`/`ColId`, and `AxisRunId` is a Rust `u64` while TypeScript models it as `number`; safe-integer and serialization constraints need an explicit contract.
- Phase 4 decomposition is a large pure-move refactor mixed into a contract-tightening plan. It is architecturally reasonable, but doing it in the same implementation stream can hide producer migration errors and export regressions unless the plan requires an export snapshot before and after the move.
- The type-level test gate is not yet actionable. `types/core` does not currently show a `tsd` or expect-type harness, and its tsconfig excludes `src/**/*.test.ts`, so the plan needs to define the exact fixture layout and command.
- The dist/declaration story needs precision. `@mog/types-core` is private and its package `files` list currently contains `src`, while the exports map points non-development `types` and `import` conditions at `dist`. The plan should state exactly which CI/package paths consume `dist` and which command regenerates it before downstream typecheck.
- The `extensions` work is still soft. It documents the escape hatches but does not specify a first-party namespace, current key inventory, compatibility rules, or how unknown payloads can be narrowed later without breaking stored data.

Contract and verification assessment

The contract section is the best part of the plan. It correctly names the invariants that matter: source/dist shape lockstep, Tier-0 dependency purity, single brand ownership, `ResolvedCellFormat` density, Rust serde fidelity, and barrel API stability. Those are the right acceptance criteria for a public foundation package.

The verification plan should be made more concrete before implementation. For TypeScript, specify an actual type-regression harness that works with current package config, such as a dedicated `tsconfig.type-tests.json` compiling fixtures with `@ts-expect-error`. For Rust parity, pick a first implementation path and name the source of truth, e.g. `compute/core/crates/types/cell-types/src/range_id.rs`, plus the generated file or JSON fixture that CI compares. For brand tightening, require a clear raw-wire DTO versus branded-domain boundary so implementation does not replace existing unsafe strings with scattered `as` casts.

Concrete changes that would raise the rating

- Add a complete brand-seam inventory table with current type, target type, producer owners, and migration notes for `CellAddress`, `CellRange`, `IDataProvider`, `IdentityRangeSchemaRef`, `CellIdRange`, `IdentityMergedRegion`, `IdentityFormula.template`, `IFormulaConverter`, `RangeAnchor`, `RowAxisIdentityRef`, `ColAxisIdentityRef`, and `AxisRunId`.
- Define the formula API by moving the existing spreadsheet-utils helpers into `@mog/types-core/formula-string`, or by making spreadsheet-utils re-export the new foundation helpers. Specify exact function names and whether each one validates, normalizes, strips, or throws.
- Split execution into two tracks: contract narrowing plus producer migrations first, `core.ts` decomposition second. Require an exported-name snapshot gate around the decomposition.
- Specify the type-test harness and commands without adding vague tool choices; use a dedicated fixture tsconfig if no `tsd` dependency is intended.
- Make the Rust parity guard concrete with a generator/check command, checked-in expected output or serde examples for each variant, and explicit handling for `u64` axis run ids.
- Turn `extensions` hygiene into a real contract: reserved namespace, known first-party keys, and compatibility policy for unknown extension payloads.
