# 030 - Compute Parser Grammar Contract Upgrade Plan

## Source folder and scope

Public source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-parser/src`

This plan covers the public `compute-parser` crate's production parser surface:

- Formula parsing from strings to `ASTNode`.
- A1 reference parsing helpers, sheet-prefix handling, structured-reference parsing, external workbook references, 3-D references, broken-reference handling, range/intersection/union grammar, and reference-token collection.
- User-entry and XLSX normalization entry points.
- `ParsedExpr` classification and serialization for XLSX/import fields that are "refers_to-shaped".
- A1/R1C1 display of `IdentityFormula` values and conversion from parsed formulas to identity formulas.
- Visitor/fold traversal contracts used by downstream compute code.

This plan does not propose changing production code during the planning run. Future implementation belongs primarily in `mog/compute/core/crates/compute-parser/src` and its test directories, with limited downstream integration in `compute-core`, `compute-table`, and `xlsx-parser` only where parser contracts must be exercised through the production path.

## Current role of this folder in Mog

`compute-parser` is the formula grammar and normalization boundary for the Rust compute engine. It is a standalone crate depending on `cell-types`, `formula-types`, `value-types`, and `winnow`.

The folder currently provides:

- `parse_formula`, `ParseError`, and `ParseErrorKind` as the main formula-string to AST entry point.
- A Pratt expression parser split across `expressions/*`, with operator precedence, function calls, omitted args, arrays, lambda/call expressions, postfix percent, implicit intersection, range operators, and union expressions.
- `references.rs` as the A1/reference leaf grammar for cells, ranges, full rows/columns, absolutes, sheet-qualified references, unresolved sheets, external workbook tokens, 3-D references, and deleted `#REF!` constructs.
- `structured_ref_parsing.rs` for table structured references, including special items, column ranges, `@` this-row shorthand, Unicode column names, and escaped bracket/quote syntax.
- `normalize/*` for user-entry corrections, XLSX import normalization, XML entity decoding, and implicit structured-reference qualification.
- `identity_transform/*` for converting parsed formulas into `IdentityFormula` templates and identity refs.
- `display.rs`, `a1_display.rs`, and `r1c1_display.rs` for rendering identity formulas through the unified `formula_types::ReferenceTarget` model.
- `parsed_expr/*` for total classification of XLSX/import formula-ish fields while preserving original bytes where writer fidelity matters.
- `reference_tokens.rs` for pre-AST reference-like token collection with UTF-16 spans, so authored broken references remain visible even when AST construction collapses them to `ASTNode::Error`.

Production consumers include scheduler formula registration and bulk init, dependency extraction, eval, range management, named ranges, formula text display, XLSX import/export and validation lowering, hyperlink/table/pivot lowering, compute bridge APIs, and `compute-table` structured-reference resolution tests.

## Improvement objectives

1. Make the parser contract explicit and complete.
   Define the accepted grammar, normalization modes, reference forms, error behavior, and round-trip expectations as table-driven fixtures instead of scattered per-file examples.

2. Keep one authoritative reference grammar.
   Eliminate duplicated reference scanning between `references.rs`, `a1_entry.rs`, `reference_tokens.rs`, normalization scanners, and downstream ad hoc utilities by introducing shared parser/token primitives for sheet prefixes, cell endpoints, range endpoints, broken refs, structured-ref spans, and external workbook prefixes.

3. Strengthen production-path normalization contracts.
   Preserve the separation between user-entry normalization, XLSX import normalization, implicit table-reference qualification, and raw parser behavior. Make each mode verifiable from input provenance to stored/displayed formula text.

4. Add first-class R1C1 parsing support instead of leaving R1C1 display-only.
   `to_r1c1_string` exists, but runtime consumers such as `INDIRECT(..., FALSE)` still treat R1C1 references as unsupported. The right contract is ref-style-aware parsing: A1 remains the default, and R1C1 parsing is available when the caller provides a base cell.

5. Improve structured-reference mutation support.
   Downstream structured-reference rewrites currently use regex-shaped logic and are table-agnostic in places. The parser should provide enough typed span/AST information to let production mutation code rewrite only the intended table and column references.

6. Expand public API and downstream contract tests.
   The crate has many public exports beyond the current public API compile test. The improved test matrix should cover exported A1 helpers, parsed-expression types, identity transforms, reference tokens, R1C1 display/parsing, and structured-ref helpers exposed under `test-utils`.

## Production-path contracts and invariants to preserve or strengthen

- `parse_formula` accepts formulas with or without a leading `=`. It must not silently perform XLSX or user-entry normalization internally.
- All direct string slicing must stay UTF-8 safe. Slices should come from ASCII delimiter positions or character-aware parser offsets, with explicit local justification where required by the crate-level `clippy::string_slice` guard.
- A1 grid bounds remain Excel-compatible: rows `1..=1048576`, columns through `XFD`/`MAX_COLS`.
- Invalid reference candidates may intentionally backtrack before commitment so identifiers, function names, and names can still parse correctly.
- After committed syntax markers such as `!`, `:`, or a matched structured-ref bracket, errors should become as specific as possible without breaking backtracking semantics.
- A parse without a `CellRefResolver` produces positional refs on `SheetId(0)`, the current-sheet sentinel. Identity conversion must continue to interpret that sentinel as the caller's current sheet.
- A parse with a `CellRefResolver` may resolve cells/sheets, but 3-D reference inners must remain positional so expansion does not pin every sheet to the start sheet's cell identity.
- `IdentityResolver` may create ghost cell IDs for empty referenced cells. `ast_to_identity` must remain usable when the caller already parsed the AST.
- External workbook tokens must be preserved exactly enough for display, identity binding, import/export round-trip, and link binding. Identity conversion must reject or require a binder where an external reference cannot be represented locally.
- `ParsedExpr::classify` is total over arbitrary UTF-8 and must never panic. `FormulaSource` must preserve original bytes even when parsing fails.
- `ParsedExpr` serialization distinguishes canonical ref-shaped output from raw formula preservation. Do not canonicalize formulas that are intentionally stored as raw `FormulaSource`.
- `parse_a1_cell`, `parse_a1_range`, `parse_sqref_list`, and `split_sheet_prefix` remain wrappers over the main grammar or shared grammar primitives, not a second hand-written A1 grammar.
- `parse_a1_range("A1")` continues to promote a single cell to a 1x1 range for convenience, while downstream callers that need colon-only ranges keep enforcing that narrower contract themselves.
- `collect_reference_tokens` remains pre-AST and returns UTF-16 spans including the leading `=` position convention.
- Function argument and recursion limits remain bounded: `MAX_DEPTH` and the 4096-argument function limit must be tested as contracts.
- Production display uses `IdentityFormula` plus `WorkbookLookup`; debug AST display remains secondary and must not become the storage/display source of truth.

## Concrete implementation plan

1. Establish a parser contract matrix.
   Add a crate-local, table-driven fixture module that defines expected behavior by category: literals, operators, arrays, lambdas, calls, omitted args, errors, A1 cells, A1 ranges, row/column ranges, absolutes, sheet names, 3-D references, external workbook references, structured references, broken refs, names/identifiers, `ParsedExpr` inputs, normalization inputs, and R1C1 references. Use the same cases across parser, normalization, identity, display, token, and classification tests.

2. Expand public API compile and behavior tests.
   Update the public API integration test to import and exercise every intentional public export from `lib.rs`: A1 helpers, identity-transform entry points, A1/R1C1 display functions, `ParsedExpr`, `FormulaSource`, `SheetName`, `SqrefList`, reference-token collection, visitor/fold traits, normalization helpers, and structured-ref helpers gated by `test-utils`.

3. Introduce shared reference grammar primitives.
   Create a private module that owns typed parsing/scanning of:
   - cell endpoints with abs flags and bounds;
   - row-only and column-only endpoints;
   - range continuations;
   - quoted and unquoted sheet prefixes;
   - external workbook tokens;
   - `#REF!` reference constructs;
   - structured-reference span discovery;
   - identifier/name boundaries.

   Refactor `references.rs`, `a1_entry.rs`, `reference_tokens.rs`, and normalization scanners to consume these primitives. Keep the parser DAG acyclic by making the new module a leaf that depends only on lexer/types, not on expression parsing.

4. Tighten committed-reference errors.
   Audit every place where the current parser returns a generic backtrack after committing to a reference shape. Preserve backtracking before commitment, but after `:`, `!`, matched external workbook syntax, or structured-ref bracket matching, set `ParseErrorKind` to precise row, column, sheet, structured-ref, or closing-delimiter errors. Add fixture cases that assert error kind and span.

5. Make normalization provenance explicit.
   Keep existing public wrappers returning `String`, but introduce an internal normalization contract that records mode and expected transformation sequence:
   - user entry: quote sheet names, close trailing parens, strip unnecessary sheet quotes, uppercase A1 refs, preserve strings;
   - XLSX import: decode XML entities, strip `_xlfn._xlws.`, `_xlfn.`, `_xlpm.` outside strings, ensure `=`;
   - table-cell entry: qualify implicit structured refs before user normalization.

   The implementation should verify the same input cannot be accidentally normalized twice into a different string.

6. Add ref-style-aware R1C1 parsing.
   Add parser entry points that can parse R1C1 reference text and full formulas when the caller supplies a base row/col:
   - `R1C1`, `R[1]C[-2]`, `RC`, `R[0]C`, `R1C`, `RC5`;
   - row-only and column-only forms where Excel permits them;
   - sheet-qualified R1C1 refs with the same sheet-prefix and quoting rules as A1;
   - R1C1 ranges and mixed absolute/relative endpoints.

   Keep `parse_formula` as the A1 default. Add an explicit ref-style-aware entry point so callers such as `INDIRECT(ref_text, FALSE)` can opt in without changing existing formula parsing behavior.

7. Make display/parse/identity round trips contractual.
   For every fixture where identity resolution is possible, assert:
   - A1 input parses to the expected AST shape;
   - AST converts to `IdentityFormula`;
   - `to_a1_string` renders the expected formula;
   - `to_r1c1_string` renders the expected R1C1 formula given a base cell;
   - R1C1 parse of that display reconstructs equivalent references when parsed with the same base cell.

8. Provide typed structured-reference rewrite support.
   Extend reference-token or AST/fold support so downstream code can locate structured references with parsed table name, specifiers, original span, and escaped text. Then replace table/column rename/delete rewrites in production compute code with parser-backed operations that only affect the target table and preserve escaped Unicode column names.

9. Preserve import/export writer fidelity.
   Add fixture coverage for `ParsedExpr::classify -> to_a1_string -> classify` idempotence for ref-shaped values and `FormulaSource::parse(input).original == input` for arbitrary formula-shaped values. Include data validation formulas, defined names, hyperlink anchors, table ranges, pivot refs, conditional formatting `sqref`, and formulas with XML entities.

10. Remove or demote duplicated downstream A1 parsing only after contracts are green.
   Where downstream crates have wrappers that delegate to `compute_parser`, keep the local narrowed contract when it is intentional. Where a downstream utility still hand-parses A1 or structured refs, replace it with `compute_parser` primitives only after tests prove the downstream behavior is preserved or intentionally corrected.

## Tests and verification gates

Required gates for parser-only implementation:

- `cargo test -p compute-parser`
- `cargo clippy -p compute-parser`
- `cargo test -p compute-parser --test public_api`

Additional gates when touching downstream structured-reference mutation:

- `cargo test -p compute-core structured_ref_updater`
- `cargo test -p compute-table`

Additional gates when adding R1C1 parsing or wiring `INDIRECT(..., FALSE)`:

- `cargo test -p compute-parser r1c1`
- `cargo test -p compute-core dynamic_refs`
- `cargo test -p compute-core indirect`

Additional gates when changing XLSX/import classification or writer fidelity:

- `cargo test -p compute-core import`
- `cargo test -p xlsx-parser`
- Run any existing focused XLSX round-trip/corpus gate only when the implementation touches corpus-sensitive import/export paths.

For any future TypeScript bridge changes caused by exported API changes, run the relevant package test and `pnpm typecheck`. This plan does not require TypeScript edits unless bridge surfaces change.

## Risks, edge cases, and non-goals

- Risk: Making reference errors more specific can break combinator backtracking if commitment boundaries are misplaced. The implementation must first define commitment points, then assert both success and fallback cases.
- Risk: R1C1 relative references require a base cell. Any API that parses R1C1 without a base will be under-specified and should be rejected.
- Risk: Structured references have escaping rules where naive span replacement can corrupt `]]`, `[[`, doubled single quotes, Unicode column names, or nested bracket syntax.
- Risk: `ParsedExpr` intentionally preserves raw formula bytes for writer fidelity. Do not force canonical output through formula cases that should stay raw.
- Risk: Identity conversion may create ghost cell IDs. Tests must distinguish pure parsing from identity-building side effects.
- Risk: External workbook references need exact token preservation and binder behavior. Do not collapse them to local sheet names or generic identifiers.
- Risk: Public API expansion can accidentally expose test-only helpers. Keep helpers behind `test-utils` unless they are truly production contracts.
- Non-goal: Replacing the winnow parser with a different parsing framework.
- Non-goal: Optimizing benchmark-only paths. Any performance work should target scheduler/init/import production parse paths.
- Non-goal: Adding compatibility shims or alternate duplicate parsers. The desired result is one grammar contract with narrow wrappers.
- Non-goal: Changing public/private repo dependency direction. `mog` must not depend on `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work parallelizes cleanly once the shared fixture matrix is defined.

- Agent A: Build the fixture matrix and public API coverage in `compute-parser`.
- Agent B: Refactor shared A1/sheet/external/broken-reference primitives and migrate `references.rs` plus A1 helper wrappers.
- Agent C: Refactor `reference_tokens.rs` and normalization scanners to consume shared primitives while preserving UTF-16 spans and normalization output.
- Agent D: Add R1C1 parser support and display/parse/identity round-trip cases.
- Agent E: Add typed structured-reference span/rewrite support and update downstream `compute-core` structured-reference mutation.
- Agent F: Verify XLSX/import contracts through `ParsedExpr`, `SqrefList`, and `xlsx-parser` focused tests.

Dependencies:

- `formula-types` owns `IdentityFormula`, `IdentityFormulaRef`, `RefStyle`, `ReferenceTarget`, `StructuredRef`, and workbook lookup traits. Parser changes that need new reference metadata may require coordinated type changes there.
- `cell-types` owns row/column bounds and A1 column conversion. Keep bounds and conversions centralized there.
- `compute-core` scheduler/init/eval code is the production path for formula registration, identity generation, dependency extraction, and `INDIRECT`.
- `compute-core` structured-reference updater should consume parser-backed structured-ref spans instead of regex rewrites.
- `compute-table` owns structured-reference resolution/formatting behavior and should remain aligned with parser structured-ref parsing.
- `xlsx-parser` depends on `ParsedExpr`, `SqrefList`, and A1 helpers for import/export fidelity.
