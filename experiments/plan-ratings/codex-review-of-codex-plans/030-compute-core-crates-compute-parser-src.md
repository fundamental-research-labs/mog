Rating: 8/10

Summary judgment

This is a strong plan for `mog/compute/core/crates/compute-parser/src`. It correctly treats the parser as a production contract boundary spanning formula parsing, reference grammar, normalization, identity conversion, display, `ParsedExpr`, reference-token collection, XLSX import/export behavior, and downstream dynamic-reference and structured-reference consumers. The plan is grounded in real source shape: `parse_formula` is the main AST entry point, `a1_entry.rs` delegates through it, `reference_tokens.rs` is a separate pre-AST scanner, normalization has distinct user/XLSX/table modes, R1C1 currently has display functions but no parser, `INDIRECT(..., FALSE)` currently returns `#REF!`, and `compute-core` structured-reference updates still use regex-shaped rewrites.

The main weakness is not ambition or relevance. The weakness is that the plan is still too prose-heavy and too broad to be a fully executable implementation contract. It names the right systematic work, but several slices need type sketches, fixture schemas, exact span conventions, and phase-level acceptance criteria before parallel agents can implement independently without drifting.

Major strengths

- The scope is accurate and production-relevant. The plan covers the actual exported parser surface in `lib.rs`, including parsing, A1 helpers, normalization helpers, identity transforms, A1/R1C1 display, structured-reference parsing, visitor/fold traits, reference-token collection, and `ParsedExpr`.
- The architectural direction is right. Consolidating reference parsing around shared leaf primitives fits the current dependency DAG (`parser -> expressions -> references -> structured_ref_parsing`) and addresses real duplication across `references.rs`, `a1_entry.rs`, `reference_tokens.rs`, normalization scanners, `compute-core` wrappers, and `xlsx-parser` A1 utilities.
- The invariant list is unusually useful. It preserves key behavior that would be easy to break: `parse_formula` accepting optional `=`, no implicit normalization in raw parsing, UTF-8-safe slicing under the crate's `clippy::string_slice` guard, Excel grid bounds, pre-commit backtracking for identifiers/names, post-commit specific errors, current-sheet sentinel behavior, 3-D reference positional inners, external workbook token preservation, and `ParsedExpr` totality.
- The plan correctly identifies real production gaps. R1C1 is display-only today, while `INDIRECT("R1C1", FALSE)` is explicitly tested as unsupported. Structured-reference mutation in `compute-core` is table-agnostic in places, with tests documenting that `Sales[Amount]+Tax[Amount]` currently rewrites both columns.
- The normalization separation is well framed. User entry, XLSX import, and implicit table-reference qualification are distinct source modes in the current code and should remain distinct contracts rather than being folded into `parse_formula`.
- The verification list includes relevant package gates and focused downstream tests instead of only parser unit tests. It also correctly distinguishes parser-only work from structured-reference mutation, R1C1/`INDIRECT`, and XLSX/import fidelity work.
- The parallelization notes are credible. Fixture matrix work, shared reference primitives, token/normalization migration, R1C1 parsing, structured-reference rewrite support, and XLSX fidelity can be split once the shared contracts are made precise.

Major gaps or risks

- The plan is too large for one implementation contract without explicit phases and stop conditions. A shared fixture matrix, grammar primitive refactor, committed-error overhaul, normalization provenance, R1C1 parser, identity/display round trips, typed structured-reference rewrites, import/export fidelity, and downstream parser de-duplication are each meaningful projects.
- The shared reference primitive API is not specified. The plan should define concrete structs/enums for cell endpoints, row/column endpoints, sheet prefixes, external workbook prefixes, broken refs, structured-reference spans, and identifier boundaries, including ownership, lifetimes, span units, and whether primitives return winnow results, plain scanners, or both.
- "One authoritative grammar" needs a sharper compatibility rule. `reference_tokens.rs` intentionally runs before AST construction and returns UTF-16 spans including the leading `=` convention; normalization scanners intentionally rewrite strings while skipping literals; XLSX parsers have some performance-sensitive byte scanners. The plan should state which scanners must share parser primitives, which may stay as byte-level fast paths, and how semantic equivalence is proven.
- R1C1 parsing is under-specified relative to its risk. The plan lists example forms, but it does not define the proposed API shape, base-cell type, zero/one-based input contract, absolute/relative conversion rules, sheet-qualified behavior, row-only/column-only semantics, error kinds, or how R1C1 parsing interacts with named-range validation and defined names that look like R1C1.
- Error tightening is directionally correct but needs an implementation pattern. The current parser often returns `backtrack()` to preserve alternative parses. The plan should define where winnow cuts are introduced, how `ParseState::last_error_kind` is set, and expected spans for representative cases after `!`, `:`, external workbook syntax, and structured-reference bracket commitment.
- Normalization provenance is a good objective but not yet a contract. "Verify the same input cannot be accidentally normalized twice into a different string" needs a concrete representation, such as a mode enum, trace/event list, idempotence table, or internal function that exposes the exact transformation sequence for tests.
- Structured-reference rewrite support needs exact span and rewrite semantics. The plan should say whether spans are byte offsets or UTF-16 offsets, whether they include the table name and outer brackets, how they relate to leading `=`, how escaped column text is preserved, and whether rewrites operate on formula strings, identity templates, or both.
- Import/export fidelity remains broad. The plan names data validations, defined names, hyperlinks, table ranges, pivot refs, conditional formatting `sqref`, and XML entities, but it does not define the fixture schema, canonical writer expectations, or the exact corpus/round-trip gates that must run when those paths are touched.

Contract and verification assessment

The plan has strong high-level contracts and matches the production path. Its parser invariants align with the live code: `parse_formula` trims and strips optional `=`, A1 wrappers call the parser and pattern-match the AST, `ParsedExpr::classify` is total and preserves raw `FormulaSource` bytes, reference tokens are pre-AST lexical spans, and identity display is the storage/display source of truth rather than debug AST display.

The contract weakness is API-level specificity. An implementer could follow the prose and still choose incompatible designs for the shared grammar module, R1C1 entry points, normalization provenance, structured-reference spans, external reference binding, or downstream scanner migration. This matters because the plan explicitly expects parallel implementation.

The verification gates are appropriate as final gates, especially `cargo test -p compute-parser`, `cargo clippy -p compute-parser`, `cargo test -p compute-parser --test public_api`, and the focused downstream gates for structured refs, dynamic refs, `INDIRECT`, `xlsx-parser`, and import paths. They should be attached to phases. For example, the shared primitive phase should have equivalence tests for A1 helpers, parser refs, reference tokens, and normalization scanners; the R1C1 phase should require parser/display/identity round trips plus `INDIRECT(..., FALSE)` behavior tests; the structured-reference phase should require targeted rename/delete tests that prove only the intended table and column spans are rewritten.

Concrete changes that would raise the rating

- Split the work into named milestones with deliverables, exit criteria, and required gates for each milestone.
- Add a concrete fixture matrix schema with fields for input, source mode, expected AST/display/identity/token/classification result, expected error kind/span, and downstream fixture category.
- Provide type-level sketches for the shared reference primitives and the R1C1 parser entry points, including span units and ownership/lifetime choices.
- Define the scanner consolidation rule: which byte scanners must be replaced, which may stay for performance, and what equivalence tests prove they share the authoritative grammar.
- Specify the winnow commitment/cut strategy and add representative expected error-kind/span examples before implementation begins.
- Make normalization provenance testable with an explicit mode enum and idempotence/trace fixtures for user entry, XLSX import, and table-cell entry.
- Define structured-reference rewrite spans and emitters precisely, including escaped text preservation and whether rewrites apply to formula strings, identity templates, or both.
- Name the exact XLSX/import/export round-trip fixtures and corpus gates required when `ParsedExpr`, `FormulaSource`, `SqrefList`, validation formulas, hyperlinks, pivots, or XML entity handling change.
