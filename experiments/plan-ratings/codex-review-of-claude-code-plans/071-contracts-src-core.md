Rating: 8/10

Summary judgment

This is a strong plan for a high-leverage contracts folder. It correctly treats `mog/contracts/src/core` as a foundational public contract surface, identifies real production-path drift risks, and keeps the no-private-runtime-import rule front and center. The plan is especially good on preserving existing public names and values while adding parity gates instead of collapsing runtime ownership into private type packages.

It falls short of a 9 or 10 because a few contract/source-of-truth details are imprecise enough to cause implementation mistakes. The folder has 10 files, not 11; `schema.ts` and `execution.ts` are public sub-entrypoints and exact mirrors of `types/commands/src/schema.ts` and `types/commands/src/execution.ts`; and the `@mog-sdk/contracts/core` barrel gets most of those types through `export type * from @mog/types-commands`, not by re-exporting the local subpath files. The plan also proposes a fallback `RangeKind` unit test that cannot work as written because the generated `compute-types.gen.ts` `RangeKind` is a type-only union with no runtime value to import.

Major strengths

- The plan is grounded in the real architecture: local public runtime values in `contracts/src`, canonical type authoring in `types/*`, and a hard prohibition on runtime imports from private type packages.
- The objectives are production-relevant and not cosmetic. `RangeKind` drift, the conflicting `MAX_ROWS = 1_000_000`, stringly execution results, and loose schema validation contracts are all foundational contract problems.
- The public compatibility section is unusually clear. It explicitly preserves `MAX_ROWS`, `MAX_COLS`, `RangeKind` string values, branded constructors, `FormattedText` helpers, timeout constants, `ValidationErrorCodes`, and package export subpaths.
- The sequencing is mostly sensible: close low-blast-radius parity and constant drift first, then tackle schema and execution identity typing, with the execution result model last because it is the broadest consumer change.
- The plan recognizes cross-folder ownership instead of pretending this can be solved only inside `contracts/src/core`. It calls out `types/core`, `types/commands`, compute bridge generation, kernel consumers, app consumers, and contracts build tooling.
- The verification list includes the contracts build chain and downstream consumer gates, which is the right level for public contract changes.

Major gaps or risks

- The plan needs a precise mirror strategy for `schema.ts` and `execution.ts`. Today `mog/contracts/src/core/schema.ts` is byte-identical to `mog/types/commands/src/schema.ts`, and `mog/contracts/src/core/execution.ts` is byte-identical to `mog/types/commands/src/execution.ts`. If the private package is canonical, the plan should either replace local duplicated type declarations with type-only projections plus local runtime constants, or require an explicit sync/generation check. "Edit canonical private packages first" is not enough to keep `@mog-sdk/contracts/schema`, `@mog-sdk/contracts/execution`, and `@mog-sdk/contracts/core` aligned.
- The public export description is slightly misleading. `@mog-sdk/contracts/core` exports `API_CALL_TIMEOUT`, `DEFAULT_EXECUTION_TIMEOUT`, and `ValidationErrorCodes` as local runtime values, but most execution/schema types arrive via `export type * from @mog/types-commands`. The separate `./execution` and `./schema` package exports point directly at the local files. Implementation needs to verify all three surfaces, not just the `core` barrel.
- The `RangeKind` parity fallback is underspecified. A runtime test cannot import the generated `RangeKind` union from `compute-types.gen.ts` as a value. The plan should specify either a source-level parser, a generator-produced JSON/TS fixture, or a compile-time type equality assertion plus a separate Rust/codegen freshness test.
- The `rangeId`/`sheetId` "constructor parity" objective is a little vague. These constructors are runtime casts, so the important contracts are declaration identity, public runtime export presence, brand ownership, and assignability across subpaths. The plan should frame the guard around those invariants rather than a loose runtime parity assertion.
- The constants migration inventory is incomplete. The plan names representative magic literals, but read-only search shows additional production candidates in chart dimensions, drawing anchor resolution, coordinate conversion, page setup/table ribbon validation, grid-canvas defaults, viewport position indexes, and tests. The plan should include a complete initial inventory with explicit exemptions for non-sheet-bound `16384`/`1_000_000` uses.
- The execution identity model needs a sharper compatibility contract. It should name the additive fields, define whether values use `CellValue`, `CellRawValue`, or a bridge-safe serialized cell value, define how `editRanges` evolves, and identify the producer of `CodeExecutionResult`, not only consumers.
- The schema tightening is directionally right but under-specified for public compatibility. Branding `ColumnSchema.id` and `RangeSchema.id` needs a single brand owner, constructors or adapters, persisted-data compatibility, and a migration story. Typing `SchemaValidationError.code` as `ValidationErrorCode` may break custom validator extensions unless the plan deliberately supports an extension code shape.
- One factual claim is wrong: the listed `sheetId: string` methods are on `ISchemaRegistry`, not `ISchemaValidator`.

Contract and verification assessment

The contract preservation requirements are strong. The plan correctly protects runtime values, string enum values, package exports, brand ownership, and the no-private-runtime-import constraint. It also correctly treats `MAX_ROWS` and `MAX_COLS` as behavioral limits rather than documentation constants.

The verification gates are good but not complete. In addition to `pnpm --filter @mog-sdk/contracts build`, implementation should run `pnpm --filter @mog/types-core typecheck` and `pnpm --filter @mog/types-commands typecheck` before rebuilding contracts, because those are the canonical type shards implicated by the plan. For the public package, the gates should explicitly cover `@mog-sdk/contracts/core`, `@mog-sdk/contracts/schema`, `@mog-sdk/contracts/execution`, and the package root where applicable.

The new parity checks need to be made concrete before implementation. The `RangeKind` gate should compare the contracts runtime enum, private TS enum, generated bridge type output, and Rust source through a generator-owned artifact or parser-based check. The constants gate should be more than value assertions; it should include an allowlisted literal scan so fresh sheet-bound `1048576`, `1_048_576`, `16384`, and `16_384` do not reappear outside the contract.

Downstream verification should include targeted behavior tests where the contract changes affect runtime semantics. For constants, that means at least the fill and viewport/layout paths that currently use hardcoded limits. For execution, typecheck alone is not enough; the engine-to-platform `CodeExecutionResult` producer/consumer round trip needs a targeted test. For schema, existing validation/cache tests are a good start, but direct `@mog-sdk/contracts/schema` consumers in app clipboard/editor paths should be included if their public types change.

Concrete changes that would raise the rating

- Correct the scope inventory to 10 files and explicitly distinguish the `core` barrel from the `./schema` and `./execution` sub-entrypoints.
- Add a source-of-truth/mirror policy for local `schema.ts` and `execution.ts`: generated from `types/commands`, type-only projection plus local runtime constants, or a checked byte/AST parity gate.
- Replace the invalid `compute-types.gen.ts` runtime-import test idea with a concrete generator fixture, source parser, or compile-time type equality check plus Rust generator freshness check.
- Expand Phase 2 into a complete sheet-limit literal inventory with package-boundary validation and documented exemptions.
- Specify exact additive execution fields and value types, and identify the actual `CodeExecutionResult` producer plus the round-trip behavior test.
- Define `SchemaId` ownership, constructors/adapters, persisted-data compatibility, and whether validation error codes allow extension values.
- Add `pnpm --filter @mog/types-core typecheck`, `pnpm --filter @mog/types-commands typecheck`, public subpath fixture checks, and targeted behavior tests to the verification section.
