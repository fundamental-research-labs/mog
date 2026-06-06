Rating: 8/10

# Review of Plan 030 — Compute Parser Grammar Contract Upgrade


## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every specific claim it makes
about the `compute-parser` crate checks out against the actual source, and the
"contracts and invariants" section reflects genuine domain understanding rather than
generic boilerplate. The plan correctly diagnoses the crate's real weaknesses
(scattered per-file test examples, duplicated reference scanning, R1C1 being
display-only, regex-shaped downstream structured-ref rewrites) and proposes a
coherent direction toward a single authoritative grammar contract.

Its main limitation is scope: it reads more like a multi-quarter epic than a single
executable plan. Six objectives, ten implementation steps, and six parallel agents
spanning four-plus crates, with several steps (committed-error tightening, R1C1
parsing, typed structured-ref rewrite) each being substantial features in their own
right. The plan lacks an MVP-first phasing and a crisp definition of done beyond
"tests green," and the contract for the downstream (`compute-core`/`compute-table`)
changes is thinner than the parser-local contract.

### Evidence I verified
- `lib.rs` exports match the plan exactly: `parse_formula`/`ParseError`/`ParseErrorKind`,
  `collect_reference_tokens`/`ReferenceToken`, `to_a1_string*`/`to_r1c1_string*`,
  `parse_a1_cell`/`parse_a1_range`/`parse_sqref_list`/`split_sheet_prefix`,
  `normalize_*`/`qualify_implicit_structured_refs`, `ParsedExpr`/`FormulaSource`/`SheetName`/`SqrefList`,
  and the `#[cfg(any(test, feature = "test-utils"))]`-gated structured-ref helpers
  (`find_outer_matching_bracket`, `unescape_column_name`, etc.). The plan's claim about
  test-utils gating and "do not expose test-only helpers" is accurate (lib.rs:124–127).
- The `SheetId(0)` current-sheet sentinel and the no-resolver→positional contract are
  documented exactly as the plan states (lib.rs:140, 161–172).
- The crate-level `#![warn(clippy::string_slice)]` "typed-boundary guardrail" exists with
  the W10 justification comment the plan references (lib.rs:16–19).
- `MAX_DEPTH` and the `MAX_ARGS = 4096` function-argument limit are real and already have
  tests at the exact limit (`state.rs`, `expressions/args.rs:15`, `edge_case_tests.rs:595–615`).
- R1C1 is genuinely display-only: `to_r1c1_string` renders via `n::R1C1 { base_row, base_col }`
  but there is no `parse_r1c1`/`from_r1c1` entry point anywhere in the crate. The display
  style already takes a base cell, consistent with the plan's "R1C1 needs a base cell" framing.
- `INDIRECT(..., FALSE)` really does treat R1C1 as unsupported:
  `mog/compute/core/src/eval/lookup/indirect.rs:47` literally comments "R1C1 style not
  supported," and that function carries its own A1 parsing logic
  (delegating to `compute_parser::parse_a1_cell` but with local range/cell handling),
  validating both objective 4 and the "duplicated downstream A1 parsing" premise.
- `compute-core` and `xlsx-parser` are real crates (`mog/compute/core/Cargo.toml`,
  `mog/file-io/xlsx/parser/Cargo.toml`); the gate test filters (`structured_ref_updater`,
  `dynamic_refs`, `indirect`, `import`) all match files under `mog/compute/core/src`.
  The crate references in the plan are correct.
- The premise of "scattered per-file examples" is accurate: tests live across
  `parser_tests_*.rs`, `coverage_*_tests.rs`, `edge_case_tests.rs`, `precedence_tests.rs`,
  etc., with no central fixture matrix. `tests/public_api.rs` exists (727 lines), so the
  "expand the public API test" objective builds on a real artifact.

## Major strengths

1. **Contract/invariant section is excellent.** It captures the genuinely subtle,
   bug-prone properties of this crate: backtracking-before-commitment, the SheetId(0)
   sentinel, 3-D inners staying positional, ghost CellId creation as a parse side-effect,
   external-token preservation, `ParsedExpr::classify` totality over arbitrary UTF-8, raw
   `FormulaSource` byte preservation, and UTF-16 span conventions in `collect_reference_tokens`.
   These are exactly the things a careless refactor would silently break, and stating them
   as preserved invariants is the most valuable part of the plan.

2. **Production-path relevance is high and concrete.** R1C1 parsing wired to
   `INDIRECT(ref, FALSE)`, structured-ref rename/delete rewrites, and XLSX import/export
   fidelity are all real user-facing paths, not benchmark theater. The non-goal of
   "optimize only scheduler/init/import production parse paths" shows the author knows
   where the value is.

3. **Verification gates are scoped to blast radius.** Gates are tiered: parser-only,
   downstream structured-ref, R1C1/INDIRECT, and XLSX/import. This is the right shape and
   avoids demanding the full corpus for a parser-local change.

4. **Honest, specific risk section.** The escaping hazards for structured refs (`]]`,
   `[[`, doubled quotes, Unicode column names), the R1C1-needs-a-base-cell under-spec
   risk, and the backtracking/commitment-boundary risk are all real and correctly called out.

5. **DAG discipline.** Step 3 insists the shared reference-grammar module stay a leaf
   depending only on lexer/types, preserving the documented acyclic DAG (lib.rs:36–39).

## Major gaps or risks

1. **Oversized scope, no phasing.** Six objectives × ten steps × six agents across
   `compute-parser` + `compute-core` + `compute-table` + `xlsx-parser` + possible
   `formula-types` type changes. There is no MVP-first ordering or shippable-increment
   breakdown. As written, it is hard to tell when the work is "done enough to merge."
   Steps 4 (tighten committed errors), 6 (R1C1 parsing), and 8 (typed structured-ref
   rewrite) are each independent features that could ship separately and should probably
   be sequenced as such, with the fixture matrix (step 1) and shared primitives (step 3)
   as the only true prerequisites.

2. **Fuzzy success criteria on the refactor objectives.** "Keep one authoritative
   grammar" and "eliminate duplicated reference scanning" are worthy, but the plan never
   quantifies the duplication or defines a measurable exit condition. "Contracts green"
   is the only stated bar, and green tests do not prove de-duplication happened.

3. **Thin downstream-change contract (steps 8 and 10).** These steps reach into
   `compute-core` structured-ref mutation and downstream A1 parsing, but the contract for
   *what* changes and *how behavior preservation is proven* is just "only after tests
   prove the downstream behavior is preserved or intentionally corrected." That is the
   riskiest part of the work (the escaping-corruption risk lives here) and deserves a
   concrete before/after behavior table or characterization-test step, not a deferral.

4. **Cross-crate type dependency is acknowledged but not de-risked.** The plan notes new
   reference metadata "may require coordinated type changes" in `formula-types`
   (`IdentityFormula`, the ref-style enum rendered as `n`, `StructuredRef`). That is a
   blocking cross-crate change with its own review surface; the plan offers no fallback or
   sequencing if those type changes are contentious.

5. **No prioritization by value among objectives.** "Make committed-reference errors more
   specific" (step 4) is plausibly high-churn / low user-visible value relative to R1C1
   parsing (step 6), which directly unblocks a currently-unsupported product behavior.
   The plan treats all six objectives as peers.

6. **Some gates are aspirational, not existing.** The `cargo test -p compute-parser r1c1`
   gate has no matching tests today (R1C1 parsing does not exist yet). That is fine for
   net-new work, but the plan presents it alongside existing gates without flagging that
   it is creating the tests it then runs.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. The invariants are specific, testable,
and grounded in the actual crate. The proposed table-driven fixture matrix (step 1) reused
across parser/normalization/identity/display/token/classification tests is the correct
architectural move and directly attacks the scattered-examples problem I confirmed exists.
The round-trip contract in step 7 (A1 parse → IdentityFormula → `to_a1_string` →
`to_r1c1_string` given a base → R1C1 reparse) is exactly the kind of closed-loop property
that catches regressions, and it is feasible because the display side already takes a base
cell.

Verification gates are correctly tiered to blast radius and reference real crates and test
filters. The main weakness is the absence of explicit acceptance criteria beyond command
exit status — particularly for the de-duplication and downstream-rewrite objectives, where
"tests pass" does not demonstrate the structural goal was met. The idempotence/round-trip
gates in step 9 (`classify → to_a1_string → classify` and `FormulaSource::parse(x).original == x`)
are good, falsifiable contracts and partially compensate.

## Concrete changes that would raise the rating

1. **Phase the work into shippable increments.** Designate step 1 (fixture matrix) and
   step 3 (shared primitives) as the foundation, then split the rest into independently
   mergeable slices: (a) public-API test expansion + committed-error tightening,
   (b) R1C1 parsing + INDIRECT wiring, (c) typed structured-ref rewrite + downstream
   migration. State which slices are MVP and which are follow-on.

2. **Add a definition of done per objective.** For the de-duplication objectives, name the
   specific call sites that must be migrated to the shared primitives (e.g. the local A1
   parsing in `indirect.rs`, the scanners in `references.rs`/`a1_entry.rs`/`reference_tokens.rs`/
   `normalize/scan.rs`) and assert "no remaining hand-rolled A1 grammar outside these
   wrappers" as a checkable exit condition.

3. **Spell out the downstream-rewrite contract.** For steps 8 and 10, add a
   characterization-test step: capture current `compute-core` structured-ref rename/delete
   behavior (including the escaping edge cases the risk section lists) as golden tests
   *before* refactoring, so "behavior preserved or intentionally corrected" becomes a diff
   against a baseline rather than a judgment call.

4. **Sequence the `formula-types` type change explicitly.** State whether new reference
   metadata is a hard prerequisite for step 8, and provide a fallback (e.g. carry the
   metadata in `reference_tokens` spans first) if the type change is deferred.

5. **Prioritize R1C1 parsing earlier.** It is the one objective that unblocks a documented
   unsupported product behavior (`indirect.rs:47`); flag it as higher value than the
   error-specificity refactor.

6. **Flag net-new gates as net-new.** Note that the `r1c1` parser gate and any new
   downstream filters are created by this work, distinguishing them from pre-existing gates.
