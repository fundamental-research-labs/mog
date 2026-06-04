# Plan 030 — Tighten the formula parser's error precision, span fidelity, and reference-coordinate invariants (`mog/compute/core/crates/compute-parser/src`)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-parser/src`
- **Crate:** `compute-parser` (`publish = false`) — winnow-based formula parser for the compute engine. ~35k LOC across `src/` (a large fraction is inline `#[cfg(test)]` modules attached via `#[path = "..."]`).
- **Production modules in scope (non-test):**
  - `lib.rs` — crate root, public re-exports, `CellRefResolver` and `IdentityResolver` traits.
  - `parser.rs` — entry point `parse_formula`, `ParseError`, the `#[non_exhaustive] ParseErrorKind` taxonomy, and the error-classification block that turns winnow failures into a `ParseError`.
  - `state.rs` — `ParseState` (depth tracking, `MAX_DEPTH = 128`, `last_error_kind` error channel, byte-offset helper).
  - `lexer.rs` — token primitives (numbers with the integer fast path, quoted-content escaping, error literals, identifiers, sheet names).
  - `expressions/` — Pratt grammar: `pratt.rs` (precedence loop + `stash_if_empty`), `binding.rs`, `atom.rs`, `alpha.rs`, `args.rs`, `arrays.rs`, `postfix.rs`, `range_ops.rs`, `external.rs`.
  - `references.rs` — cell/range/sheet/3-D/external reference parsing, bounds checks, `make_cell_ref`.
  - `reference_tokens.rs` — UTF-16-offset reference-token scanner (`collect_reference_tokens`), used for editor highlighting.
  - `structured_ref_parsing.rs` — a **separate hand-rolled** structured-reference parser (not winnow), reached from the main grammar via `references.rs::try_parse_structured_ref`.
  - `normalize/` — XLSX import normalization (XML entity decode, prefix strip), user/agent input normalization, implicit structured-ref qualification.
  - `ast/` — `ASTNode` and reference node types, spans, display.
  - `identity_transform/` — A1 formula → `IdentityFormula` (stable-id) conversion; holds the `CURRENT_SHEET = SheetId(0)` sentinel.
  - `a1_display.rs`, `r1c1_display.rs`, `display.rs`, `a1_entry.rs`, `fold.rs`, `visitor.rs`, `intern.rs`, `parsed_expr/` — display renderers, owned-tree fold, read-only visitor, function-name interning, and the typed `ParsedExpr`/`FormulaSource`/`SqrefList` boundary.
- **Consumers (contract surface — not edited by this plan, only verified against):** `compute-cf`, `compute-table`, and the top-level `compute/core` crate. The TS kernel reaches this crate's behavior through the wasm bridge (`IdentityFormula`, A1 display, reference tokens).

This is a **production-path** plan. It is not test-only, not a shim, and proposes no reduced scope. Inline test modules are touched only to add regression coverage for the production changes below.

## Current role of this folder in Mog

`compute-parser` is the single front door from formula text to the compute engine's native AST. Everything downstream — dependency graph construction, evaluation, table/structured-ref rewriting, A1/R1C1 display, editor reference highlighting, and `IdentityFormula` (stable `CellId`/`RowId`/`ColId`) construction for CRDT-safe storage — consumes what this crate produces. It is also the boundary normalizer for XLSX import (entity decoding, prefix stripping) and for user/agent formula entry.

Architecturally it is one layer above the foundation type crates (`formula-types`, `value-types`, `cell-types`) and below the rest of `compute/core`. The grammar is a Pratt (precedence-climbing) parser built on winnow 0.6, chosen for a low stack-frame count (~3 frames/level) so 128 nesting levels fit inside the wasm 1 MB stack. Parsing is on the hot path for import, recalculation seeding, and every formula edit, so the lexer carries deliberate fast paths (integer accumulation, escape-free quoted-content copy).

## Improvement objectives

1. **Make the public error taxonomy honest.** `ParseErrorKind` is `#[non_exhaustive]` and advertises a rich, position-bearing set of failure modes, but a large fraction of its variants are **never produced** on the main path. A grep across non-test, non-`parser.rs` source shows zero producers for `InvalidRowNumber`, `InvalidColumnNumber`, `InvalidCellReference`, `UnknownSheetName`, `MalformedNumber`, `MalformedArrayLiteral`, `InvalidReference`, `ExpectedClosingBracket`, and `ExpectedClosingParen`. Concretely: a row past 1,048,576 or a column past XFD is rejected in `references.rs::parse_cell_ref_parts` with a bare `backtrack()` (comments at lines 64-69 and 80-82 explicitly note the precise kind "exists but `backtrack()` is correct here"), so the user sees the generic `UnexpectedToken` instead of `InvalidRowNumber { row }` / `InvalidColumnNumber { col }`. An unresolved sheet name resolves to `UnresolvedSheetRef` (no error) rather than `UnknownSheetName`, which is defensible — but the variant then has no producer at all. Either wire these variants to real producers (preferred for the bounds and structured-ref cases, which carry actionable data) or remove the dead variants so the taxonomy stops promising precision the parser does not deliver.

2. **Give errors a precise, single-coordinate-system span.** Two defects compound:
   - **Hardcoded span end.** Every error path in `parser.rs` returns `Span::new(pos, input.len())` — the end is always the end of the whole input, never the end of the offending token. Downstream surfaces (editor squiggles, agent-facing diagnostics) cannot bracket the real error region.
   - **Mixed coordinate systems.** Success spans use `state.offset(remaining)`, which is **body-relative** (0 at the first byte after `=`). Error spans compute `pos = input.len() - remaining.len()`, which is **input-relative** and silently absorbs both the stripped `=` and any leading whitespace that `input.trim()` removed (e.g. `parse_formula("  =1+", …)` mis-locates the error by the leading-space count). Ok and Err spans therefore disagree on their origin. Pick one coordinate system (body-relative, matching the success path and the documented "byte offsets relative to the formula body after `=`" contract) and make the error path honor it, accounting for trimmed leading whitespace explicitly.

3. **Make the `last_error_kind` error channel deterministic and documented.** Error classification depends on a `Cell<Option<ParseErrorKind>>` in `ParseState` that is written from two competing disciplines: `pratt::stash_if_empty` is first-write-wins, while `alpha.rs`, `args.rs`, `atom.rs`, `arrays.rs`, `postfix.rs`, and `range_ops.rs` call `last_error_kind.set(Some(...))` directly (last-write-wins) immediately before `Err(cut())`. The resulting reported kind depends on traversal/unwind order rather than on which error is most specific. Establish one rule (specific-beats-generic, set-once-at-cut) so the same malformed input always yields the same `ParseErrorKind`, and document the channel's contract in `state.rs`.

4. **Stop discarding the structured-reference parser's own diagnostics.** `references.rs::try_parse_structured_ref` (line ~561) calls `structured_ref_parsing::parse_structured_ref` and, on failure, does `let Ok(structured_ref) = … else { return backtrack }` — throwing away the `MalformedStructuredRef { detail }` that the hand-rolled parser produced. For input that has unambiguously committed to structured-ref syntax (a recognized table name followed by `[`), surface that detail through `last_error_kind` + `cut()` instead of backtracking to a generic token error.

5. **Converge the two parsers' invariants (structured refs).** `structured_ref_parsing.rs` is a standalone recursive parser with its own bracket-matching, escaping, and error model, entirely separate from the winnow grammar and producing no `Span`. It does not share `lexer.rs` quoting/escaping rules and cannot emit positions into the surrounding formula. The objective is not a rewrite for its own sake but to (a) make its error type span-bearing relative to the enclosing formula, (b) share the column-name unescape rules with the rest of the crate so escaping cannot drift, and (c) add a shared property test asserting the two paths agree on which inputs are valid structured refs.

6. **Retire the `CURRENT_SHEET = SheetId(0)` sentinel landmine.** `identity_transform/refs.rs` carries a standing `// TODO: refactor CellRef::Positional.sheet to Option<SheetId>` and relies on `SheetId::from_raw(0)` meaning "current sheet" because UUID-sourced ids are never all-zero. This is a latent correctness trap: any future code path that legitimately constructs `SheetId(0)`, or any test fixture that does, will be silently reinterpreted as "current sheet." Replace the sentinel with an explicit representation (`Option<SheetId>` on the positional ref, or a dedicated `CellRef::Positional { sheet: Option<SheetId>, … }`) so "no explicit sheet" is type-encoded, not value-encoded. (This change reaches into `formula-types`; see Dependencies.)

7. **Harden the UTF-16 reference-token scanner against its own `expect`s.** `reference_tokens.rs::utf16_offset` and `slice_range` `.expect(...)` on the assumption that the scanner only ever emits UTF-8 boundary offsets. These feed editor highlighting from arbitrary user formula text. Prove the invariant with a targeted property test over multibyte input (emoji, combining marks, CJK, RTL marks), and if any emit path can produce a non-boundary offset, fix the offset arithmetic rather than relying on the panic. Keep the offsets UTF-16 (the editor contract) but make boundary handling total.

8. **Document the `non_exhaustive` enum's actually-produced set.** Whichever variants survive objective 1, add a module-level table in `parser.rs` mapping each surviving `ParseErrorKind` to the producing site(s), so the next change cannot reintroduce dead variants unnoticed.

## Production-path contracts and invariants to preserve or strengthen

- **`parse_formula` total over UTF-8 input.** Every input string either returns `Ok(Spanned<ASTNode>)` or `Err(ParseError)` — never panics. (Preserve; strengthen via objective 7 by removing the reachable-from-user-input `expect`s.)
- **`ParsedExpr::classify` totality.** `parsed_expr` guarantees every well-formed UTF-8 string maps to exactly one variant with no `Unparseable` escape; malformed formulas land in `Formula` carrying the error-recovery node and verbatim original bytes for writer fidelity. (Preserve — error-precision changes must not introduce a hard-fail path that breaks this.)
- **Span coordinate contract.** Spans are byte offsets relative to the formula body after `=`. (Strengthen — objective 2 makes the error path obey the contract the success path already follows.)
- **Reference bounds.** Columns `< MAX_COLS` (16,384 / XFD), rows `1..=MAX_ROWS` (1,048,576), 1-based input converted to 0-based row. (Preserve the limits; objective 1 only changes the *error reported* when they are exceeded, never which inputs are accepted.)
- **Depth bound.** `MAX_DEPTH = 128` keeps the Pratt parser within the wasm 1 MB stack. (Preserve — do not add recursion depth in the structured-ref convergence.)
- **`#[non_exhaustive]` on `ParseErrorKind`.** Removing dead variants is a breaking change for exhaustive matchers, but the `non_exhaustive` attribute means external matchers already carry a wildcard arm; verify all in-tree matchers (`compute-cf`, `compute-table`, `compute/core`) before removing any variant. (Preserve the attribute; audit consumers.)
- **`CellRef` resolution semantics.** With no resolver, references are `Positional` on the current sheet; with a resolver, `Resolved` when the cell exists. (Preserve — objective 6 changes only how "current sheet" is represented, not the resolve/positional split.)
- **Lexer fast paths.** Integer accumulation (`fast_parse_int`) and escape-free quoted-content copy are correctness-preserving optimizations on the hot path. (Preserve — no regression to a slower or allocation-heavier path.)
- **No new dependencies, no `unsafe`.** `lib.rs` sets `#![deny(unsafe_code)]` and a strict clippy profile (`pedantic`, `nursery`, `string_slice` warn-with-justification). (Preserve — all `&str[n..]` additions need the documented ASCII-boundary justification.)

## Concrete implementation plan

Sequenced so each step is independently reviewable and the risky cross-crate change (objective 6) is isolated last.

**Step 1 — Error-channel discipline (`state.rs`, `expressions/pratt.rs`).**
- Document the `last_error_kind` contract on `ParseState`: it records the *most specific* error at the point of `cut()`, set once and not overwritten by shallower/generic kinds during unwind.
- Replace ad-hoc `last_error_kind.set(Some(...))` calls in `alpha.rs`, `args.rs`, `atom.rs`, `arrays.rs`, `postfix.rs`, `range_ops.rs` with a single helper (`set_specific(kind)`) that implements the agreed precedence (specific kinds win; never downgrade a structural kind to `ExpectedOperand`). Keep `stash_if_empty` only for the generic operand fallback in `pratt.rs`.
- No behavioral change to *which inputs* error — only to *which kind* is reported and to its determinism.

**Step 2 — Span fidelity (`parser.rs`, `state.rs`).**
- Track the formula-body origin explicitly: record the byte offset of the body within the trimmed/`=`-stripped input once, and compute error positions as body-relative (`formula_input.len() - remaining.len()`), mirroring `state.offset`.
- Carry the offending-token end through the error channel where it is known (the modules that `set_specific` a structural kind already know the token bounds — extend the channel to optionally carry an end offset), and fall back to a one-past-the-cursor end when unknown, instead of `input.len()`.
- Add tests asserting Ok and Err spans share an origin (e.g. `=1+` reports the error at the body offset of the trailing `+`, not at `input.len()`), including a leading-whitespace case.

**Step 3 — Wire the data-bearing error kinds (`references.rs`, `expressions/atom.rs`, `arrays.rs`).**
- In `parse_cell_ref_parts`, when a column/row that is otherwise well-formed exceeds bounds, set `InvalidColumnNumber { col }` / `InvalidRowNumber { row }` in the channel and `cut()` *only after the parse has committed to a reference* (i.e. column letters followed by digits with no other valid interpretation), preserving today's backtrack-to-try-alternatives behavior when the token could still be an identifier. This requires distinguishing "looks like a ref but out of bounds" from "not a ref."
- Verify `MalformedString`, `UnmatchedBrace`, `UnmatchedParen`, `ExpectedArgument`, `TooManyArguments`, `ExpectedExpression`, `ExpectedOperand` remain the produced set and are reachable by tests.

**Step 4 — Surface structured-ref diagnostics (`references.rs`, `structured_ref_parsing.rs`).**
- Have `try_parse_structured_ref` distinguish "not a structured ref, backtrack" (e.g. `find_outer_matching_bracket` returns `None`) from "committed structured-ref syntax that is malformed." For the latter, propagate `MalformedStructuredRef { detail }` from the inner parser into the channel and `cut()`.
- Make `parse_structured_ref`'s error carry a position relative to its input so the detail can be re-based into the enclosing formula's coordinate system.

**Step 5 — Converge structured-ref escaping/validation (`structured_ref_parsing.rs`, `lexer.rs`).**
- Factor the column-name unescape and bracket-content rules so the standalone parser and any grammar-side handling share one implementation; add a property test (`proptest`) asserting that for a generated corpus of `Table[...]` strings, `references::try_parse_structured_ref` and `parse_structured_ref` agree on validity and on the resulting `StructuredRef`.

**Step 6 — Retire the `SheetId(0)` sentinel (`identity_transform/refs.rs`, plus `formula-types`).**
- Change `CellRef::Positional.sheet` (in `formula-types`) to encode "no explicit sheet" without a magic value — `Option<SheetId>` is the documented intent. Update `references.rs::make_cell_ref` / `resolve_current_sheet`, `identity_transform/refs.rs::{resolve_cell_id, extract_position}`, and any display path that reads the sentinel.
- Remove the `CURRENT_SHEET` constant and the TODO. Add tests that a real `SheetId` with raw value `0` (constructed in a fixture) is treated as a normal cross-sheet reference, not "current sheet."

**Step 7 — UTF-16 scanner hardening (`reference_tokens.rs`).**
- Add property tests over multibyte formulas exercising every emit path in the scanner; if all offsets are provably boundaries, downgrade the `expect` messages to `debug_assert` + a total fallback (`get(..byte).map_or_else(...)`) so a future scanner change cannot panic on user input. Keep emitted offsets in UTF-16 units.

**Step 8 — Taxonomy cleanup + documentation (`parser.rs`).**
- After Steps 1-4 settle the produced set, either delete still-dead variants (auditing the three consumer crates' matchers first) or leave them with a producer. Add the variant→producer table as module docs.

## Tests and verification gates

The constraints for this task forbid running `cargo`/build/test commands, so this plan specifies the gates to be run by the implementer; it does not execute them.

- **Unit/regression (inline `#[cfg(test)]` modules):**
  - `parser_tests_errors.rs`: add cases asserting `InvalidRowNumber { row }` for `=A1048577`, `InvalidColumnNumber { col }` for `=XFE1`, and that a bare identifier-like token still parses as `Identifier` (no false bounds error).
  - New span tests: error position is body-relative and brackets the offending token, including a leading-whitespace input; Ok/Err span-origin agreement.
  - Structured-ref: malformed committed syntax (`=Table1[[#Data]` unterminated) yields `MalformedStructuredRef`, not `UnexpectedToken`.
  - Error-kind determinism: a fixed malformed input yields the same `ParseErrorKind` across runs (guards the channel-discipline change).
- **Property tests (`proptest`):** structured-ref agreement (Step 5); UTF-16 scanner totality over multibyte corpora (Step 7); existing `proptest_tests.rs` / `parsed_expr/tests/proptests.rs` must continue to assert `parse_formula` never panics and `classify` stays total.
- **Round-trip:** `ast/tests/roundtrip.rs`, `a1_display`/`r1c1_display` tests, and identity-transform tests must pass unchanged after objective 6 (display output must not depend on the old sentinel).
- **Benchmarks:** run `benches/parse_benchmark.rs` (criterion) before/after; the hot-path numbers (`number`, `cell_ref`, `add`, `sum_range`, `vlookup`) must not regress — the error-channel and span changes touch only failure paths, so the success path should be flat.
- **Lint gate:** `cargo clippy` under the crate's `pedantic`/`nursery`/`string_slice` profile with zero new warnings; any new slice carries the ASCII-boundary justification comment required by the repo `AGENTS.md`.
- **Consumer compile gate:** `compute-cf`, `compute-table`, and `compute/core` must compile after any `ParseErrorKind` variant removal and after the `formula-types` `Option<SheetId>` change; audit their match arms first.
- **Docs:** `#![deny(rustdoc::broken_intra_doc_links)]` means the new variant→producer table and any doc examples must build clean.

## Risks, edge cases, and non-goals

- **Risk — error-kind changes are observable contract changes.** Some consumer may branch on the *generic* `UnexpectedToken` for an out-of-bounds reference today. Wiring the specific kind (objective 1/3) could change that branch. Audit consumers before merging; treat the produced-kind set as part of the contract.
- **Risk — `formula-types` change has blast radius (objective 6).** Changing `CellRef::Positional` ripples across every crate that constructs or matches it. This is the highest-risk step and is intentionally sequenced last and isolated; it can ship as its own PR. If the blast radius proves too large for one change, the fallback is to keep the sentinel but add a `debug_assert!(sheet != SheetId::from_raw(0) || is_current)` tripwire and a newtype wrapper — but the *production-path* goal remains eliminating the magic value, not papering over it.
- **Edge case — committed vs. backtrackable refs.** The bounds-error wiring must not turn a token that is legitimately an identifier or function name (after backtracking) into a hard reference error. The "looks like a ref but out of bounds" discriminator must be precise; over-cutting would reject currently-valid formulas.
- **Edge case — leading/trailing whitespace and the `=` strip.** The span-origin fix must account for `input.trim()` having removed leading whitespace and for the optional `=`; off-by-`n` here would relocate every error.
- **Edge case — multibyte input in the UTF-16 scanner.** The whole point of objective 7; the property corpus must include grapheme clusters and surrogate-pair characters.
- **Non-goal — rewriting the structured-ref parser into winnow.** Objective 5 converges *invariants and diagnostics*, not implementation. A full rewrite is out of scope and unjustified by current evidence.
- **Non-goal — changing the grammar's accepted language.** No new operators, functions, or syntax. Every change here is about *diagnostics, span fidelity, and reference-coordinate representation* — not about which formulas parse.
- **Non-goal — touching `intern.rs`'s function table** beyond what compiles; the known-function list is a separate maintenance concern.
- **Non-goal — splitting the inline test files out of `src/`.** The `#[path = "..."]` test layout is a house convention; reorganizing it is not a production-path improvement.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now (no cross-crate dep):** Steps 1, 2, 3, 4, 7, 8 are confined to `compute-parser/src`. They can proceed in parallel with other folder reviews and do not block on `formula-types`.
- **Cross-crate dependency:** Step 6 (`Option<SheetId>`) requires a coordinated change in `mog/compute/core/crates/types/formula-types` (`CellRef`/`CellRefNode` definitions) and re-verification of `compute-cf`, `compute-table`, and `compute/core`. Sequence it after Steps 1-5 land and treat it as a standalone PR. This overlaps with any plan covering `formula-types` and with the kernel formulas plan (014), which already notes the `IdentityFormulaRef` variant surface — coordinate so the wire/contract converters there stay in sync if the positional-sheet representation changes.
- **Downstream consumers to re-verify (read-only contract check, not edited here):** `compute-cf` and `compute-table` import `ParseErrorKind` and `parse_structured_ref`; the wasm bridge surfaces `reference_tokens`, A1 display, and `IdentityFormula` to the TS kernel. Any error-taxonomy or sentinel change must be validated against these before release.
- **No dependency on the dirty/in-flight app-eval or fixture paths** noted at launch; this plan touches none of them.
