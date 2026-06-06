Rating: 8/10

# Review of Plan 032: Compute Table Source Improvements

## Summary judgment

This is a strong, unusually well-researched plan. Nearly every concrete claim it
makes about the code is verifiable in the actual source, and it correctly
identifies the real production seams (`bridge_pure.rs::TableBridge`, the
compute-core filter delegation, structured-ref dependency extraction, and the
parallel TypeScript engine in `table-engine/src`). Its central thesis — turn
`compute-table` into an auditable, typed, pure-engine contract with Rust as the
single source of truth and TypeScript reduced to thin bridge calls — is the
right architectural direction and respects the crate's stated pure/stateless
charter.

The plan's principal weakness is the inverse of its strength: scope. It is
effectively a multi-quarter program (8 objectives, 20 implementation items, 8
parallel agent tracks, ~30 distinct verification gates) presented as one plan,
with only a coarse "build the inventory first" sequencing gate and no crisp
first deliverable or user-impact prioritization. It also reinvents a value-
semantics contract that already exists in the tree as an authoritative document.
Those two issues are what keep it from a 9.

## Evidence check (claims verified against source)

- ~100 source files: confirmed — 101 `.rs` files in `compute-table/src`.
- `resolve_dynamic_filter` panics when `now` missing for date rules: confirmed —
  `filter_resolve.rs:73` is literally `now.expect("Date-based dynamic filter
  requires a 'now' date parameter")`.
- Structured-ref sentinel ambiguity: confirmed — `resolve_structured_ref`
  (`structured_refs/resolution.rs:17`) returns `Vec<TableRange>` and emits
  `Vec::new()` for both unknown table and empty specifiers;
  `resolve_ranges_from_table_def:274` returns `Option<Vec<ResolvedRange>>` with
  `None` for empty. Two different sentinel shapes for adjacent failures, exactly
  as the plan describes.
- Silent range-identity fallback: confirmed — `resolve_table_range`
  (`range_resolution.rs:35`) returns `Option<TableRange>` and falls back rather
  than reporting lost CellId endpoints.
- Bridge surface: confirmed — `TableBridge` exists and delegates filter, sort,
  slicer-cache, dropdown, dynamic filter, structured-ref, visibility, and style
  resolution to `compute_table::*`.
- TypeScript drift risk: confirmed — `table-engine/src` carries parallel
  `compare.ts`, `convert.ts`, `filter.ts`, `sort.ts`, `slicer.ts`,
  `filter-dropdown.ts`, `filter-resolve.ts`, `slicer-cache.ts`.
- compute-core delegation: confirmed — `storage/sheet/filters/evaluation.rs:109`
  calls `compute_table::filter::evaluate_column_filter`.

This level of grounding is well above typical for these plans and materially
raises confidence that the proposed work targets real defects, not invented ones.

## Major strengths

- **Accurate production-path tracing.** The plan names the exact downstream
  consumers (`bridge_pure.rs`, `storage/sheet/filters/*`, `scheduler/dep_extract`,
  `storage/engine/services/tables`, `compute-parser`, `table-engine/src`) and
  ties each contract change to who must absorb it. This is the part most plans
  get wrong, and it is right here.
- **Correct typed-contract framing.** Replacing `Option`/empty-vector/unchanged-
  clone/`String`-error sentinels with domain results (`StructuredRefResolution`
  with `UnknownTable`/`UnknownColumn`/`MissingCurrentRow`/`ResolvedEmpty`,
  `RangeIdentityResolution`, `FilterEvaluationContext`/`FilterEvaluationError`)
  directly addresses the verified ambiguity and would let dependency extraction
  distinguish "no dependency" from "unresolved dependency."
- **Respects the architectural boundary.** It explicitly keeps the crate pure
  and stateless, places color/icon context-gathering in compute-core while the
  pure crate owns the final predicate, and keeps sort permutation application in
  compute-core. That division is the correct one.
- **Honest about the panic and the pass-all fallbacks** as correctness bugs, not
  cosmetic cleanup, and insists production evaluation must never silently convert
  an unsupported predicate to pass-all.
- **Sequencing has a real gate.** Item 1 (contract inventory) genuinely unblocks
  the parallel tracks and doubles as the work queue.

## Major gaps or risks

- **Scope is not landable as a single unit.** Eight objectives × twenty items ×
  eight agents is a program, not a plan. There is no MVP slice, no "first PR"
  definition, and no prioritization by user-visible impact. The two changes with
  clear user payoff and bounded blast radius — removing the date-filter panic
  (`filter_resolve.rs:73`) and replacing structured-ref sentinels — are buried at
  items 6 and 11 with no signal that they should land first. Recommend an
  explicit Phase 0 of "highest-value, lowest-risk correctness fixes" ahead of the
  broad contract refactor.
- **Overlooks an existing authoritative contract.** `compute-table/src/`
  already contains `EDGE_VALUE_SEMANTICS.md`, headed "AUTHORITATIVE REFERENCE —
  all table engine modules MUST conform," covering cross-type ranking, NaN/Inf,
  errors, blanks, arrays, and per-feature (sort/filter/topbottom/average/equality/
  slicer) behavior. Objective 4 / item 8 proposes building a "TableValueSemantics
  module or fixture" as if from scratch and never references this file. The plan
  should instead audit conformance to the existing doc and promote it to an
  executable fixture, not reinvent it. This is a real miss given the rest of the
  plan's diligence.
- **The TypeScript "generate wrappers from bridge metadata" objective is hand-
  wavy.** Item 16 offers "generate or audit" with no mechanism, no decision on
  whether the generator exists, and no fallback acceptance criteria beyond
  "parity tests until TS can be reduced to thin calls." This is one of the
  largest pieces of work in the plan and is the least specified.
- **Color/icon filter rework folds in a cross-crate effort.** Making icon filters
  evaluate against conditional-format rule output (item 7) depends on compute-core
  surfacing resolved per-row icon/color context — itself a substantial, separately-
  riskable change. The plan acknowledges the dependency but does not scope or
  sequence it as the gating prerequisite it is.
- **No per-item definition of done.** Verification gates are listed globally at
  the end; individual items lack acceptance criteria, so "done" for, e.g., item 3
  (normalize returns) is unmeasurable without back-referencing the gate list.
- **No baseline of existing coverage.** The crate already ships extensive
  `*_tests.rs` (compare, sort, slicer, filter_dropdown, visibility, types,
  structured_refs/tests, styles_tests, table/*_tests). The plan proposes large
  new test corpora without stating what is already covered, risking duplicate
  effort and obscuring which contracts are genuinely untested.

## Contract and verification assessment

Contract direction is sound and specific: the proposed result/error/context types
map cleanly onto the verified ambiguities, and the invariants section (inclusive
position-based `TableRange`, one-byte-per-row 0/1 bitmaps with identical row-count
contracts, stable-ID identity vs case-insensitive name lookup, DNF shape for
advanced filters, injected-clock parity with NOW()/TODAY()) is precise and
testable.

Verification gates are comprehensive and largely appropriate: `cargo test/clippy`
per crate, compute-core integration filters, serde roundtrip for every wire type,
descriptor parity for WASM/N-API, and contract-matrix freshness. Two cautions:
(1) the "browser/UI exercise through real input paths" gate is broad and
unprioritized — it should be reduced to the handful of workflows tied to the
contracts actually changed in a given slice; (2) the descriptor-parity and
Rust-vs-TypeScript fixture-parity gates are themselves engineering projects, so
listing them as gates without scoping them understates cost. Note also that the
plan's own constraint context here forbids running these commands — that is fine
for the plan as a specification, but it means the gates are unexercised
assertions until implementation.

## Concrete changes that would raise the rating

1. **Add a Phase 0.** Land the date-filter panic removal
   (`filter_resolve.rs:73` → typed `FilterEvaluationError`/required `now`) and the
   structured-ref typed-resolution split first, as small isolated PRs with their
   own gates, before the broad inventory-driven refactor.
2. **Reconcile with `EDGE_VALUE_SEMANTICS.md`.** Reframe objective 4 / item 8 as
   "audit all listed modules for conformance to the existing authoritative doc and
   convert it into an executable fixture," not as authoring a new semantics source.
3. **Decide the TS-generation mechanism in the plan, not during it.** State
   whether a bridge-metadata generator exists; if not, default explicitly to
   parity-test-first with a named fixture format, and move full generation to a
   non-goal for the first effort.
4. **Hoist the compute-core context-gathering dependency** for color/icon filters
   into an explicit prerequisite item with its own scope, so item 7 is not blocked
   silently.
5. **Add per-item acceptance criteria** and a one-line "done when" to each of the
   20 items, cross-referencing the specific gate(s) that prove it.
6. **State the existing-coverage baseline.** Enumerate which `*_tests.rs` already
   cover each contract area so new test corpora target genuine gaps.
7. **Cut the agent count or gate it.** Eight parallel tracks against one crate
   will collide on shared types (`types.rs`, `compare.rs`, the semantics doc).
   Either reduce tracks or make track B/C/D explicitly serialize on the shared
   type/contract edits.
