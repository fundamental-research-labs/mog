Rating: 8/10

# Review of 027 — compute/core/src/import


## Summary judgment

This is a strong, unusually well-grounded plan. I cross-checked its specific
claims against the live source in `mog/compute/core/src/import` and the adjacent
folders it names, and essentially every concrete assertion is true:

- `parse_output_to_workbook_snapshot` uses `debug_assert_eq!` on ID-map lengths
  (`parse_output_to_snapshot/mod.rs:109-111`) followed by index-bounds `if`
  guards — exactly the "unchecked conversion relying on debug_assert + indexing"
  the plan targets.
- `table_lowering.rs:40` falls back to `SheetId::from_raw(0)` on resolver
  failure; `data_table_lowering.rs:24-26` falls back to `unwrap_or_default()`
  (empty sheet string). Both fallbacks are real and are precisely the
  silent-malformed-input behaviors the plan calls out.
- `classifier.rs:538` encodes `CellValue::Array | Control | Image` as Null
  (tag `0x00`) — the lossy "encode as Null" fallback the plan flags as a
  must-fix data-loss path. The comment at `classifier.rs:510-511` confirms it.
- `phantom.rs` still carries the `contains(':')` shape heuristic the plan
  wants removed, and `mod.rs` still describes "W4 landing pad" no-op lowerers.
- Dynamic-array filtering keys on `ImportedCellProjectionRole::DynamicArraySpillTarget`
  (`sheet_lowering.rs:55`), matching the plan's "skip only on parser-proven role".
- `HydrationIdMap` has the `Vec<Vec<...>>` per-sheet shape
  (`storage/infra/hydration/mod.rs:79-99`) the plan proposes to validate, and
  the construction paths (`xlsx.rs`, `csv.rs`, `deferred.rs`, `range_styles.rs`)
  and the `test_deferred_xlsx_import` gate all exist as cited.

Because the diagnosis is accurate, the plan reads as authored from real
investigation rather than pattern-matching, which is its main credibility win.

## Major strengths

- **Contract-boundary framing.** It correctly identifies `import` as a contract
  boundary (snapshot vs. direct-Yrs-hydration vs. identity-anchor vs.
  range-compaction), not just a converter, and the "invariants to preserve"
  section is concrete and testable rather than aspirational.
- **Real bugs, not cosmetics.** The three fallback/data-loss paths above are
  genuine correctness hazards. Fixing the Array/Control/Image→Null encoding and
  the `from_raw(0)` / empty-string sheet fallbacks would prevent silent ingest
  corruption.
- **Production-path verification discipline.** The plan repeatedly insists on
  testing through the real constructors and `init_from_snapshot` + export
  readback, and explicitly states that direct-lowerer unit tests "are not enough
  to prove ingest correctness." That is the right bar for an ingest folder.
- **Lossless-by-construction intent.** Replacing the "comment says it's safe"
  posture with a typed `RunKind`/payload eligibility model and a decoder
  roundtrip test (numbers, large-safe-int boundaries, errors, nulls,
  unsupported variants) is the correct shape for the classifier.
- **Honest dependency calls.** It flags that pivot extent may not be derivable
  from current `ParsedPivotTable` metadata and routes that to an upstream
  `xlsx-parser` contract instead of pretending the scan is fine.
- **Verification gates are real commands** scoped to real test paths, with a
  sensible "additional gates when dependencies change" matrix.

## Major gaps or risks

- **Scope is very large with no defined minimal landable increment.** Nine
  implementation sections, a feature-policy manifest, a checked builder, a
  diagnostics struct, typed-reference migration, classifier rewrite, six-agent
  fan-out, and a kitchen-sink fixture matrix. There is a dependency graph but no
  "smallest first PR that ships value and de-risks the rest." Realistically the
  data-loss fixes (Array/Control/Image, `from_raw(0)`, empty-sheet) could land
  first as small, independently verifiable changes; the plan buries them inside
  larger refactors.
- **The central architectural change is under-specified at its hardest point.**
  Converting `parse_output_to_workbook_snapshot` to
  `try_… -> Result<_, ImportLoweringError>` changes the failure semantics of the
  *entire* import pipeline, yet the plan never says what the top-level callers
  do on `Err`. Abort the whole workbook open? Skip the offending sheet/feature
  and continue? Surface to the user how? `ImportLoweringError`'s variants,
  whether it is public, and the caller contract are the crux of the work and are
  left blank. This is the biggest contract-clarity hole.
- **"Drops are diagnostics, not fallbacks" can be a behavior regression.** The
  plan acknowledges (under Risks) that stricter malformed-ref handling changes
  which broken artifacts get skipped, but does not commit to whether a malformed
  table/name/data-table is *dropped silently with a counter* or *fails the
  import*. Today's `from_raw(0)` at least keeps the table; a naive "skip on
  resolver failure" could remove tables that currently round-trip. The
  acceptance criterion (drop vs. retain-degraded vs. error) needs to be pinned
  per feature, not left to implementation.
- **Open questions left unresolved.** Table compute-lookup key (`name` vs.
  `display_name`) and the out-of-bounds-cell policy ("extend dimensions or
  reject") are flagged but not decided. These are exactly the decisions a plan
  should resolve so the six parallel agents don't each pick differently.
- **Diagnostics/observability infra (section 7) risks front-loading scope.** A
  large `ImportLoweringDiagnostics` struct + tracing spans is valuable but is
  not on the correctness critical path; if sequenced early it competes with the
  data-loss fixes for effort.
- **Kitchen-sink fixture feasibility unverified.** It assumes a `ParseOutput`
  fixture can carry every feature family (charts, slicers, timelines, x14
  validations, authored style runs). Whether those are constructible without a
  full parse is not established, and that fixture is load-bearing for the
  "promotes only safe cells" assertion.

## Contract and verification assessment

- **Contracts:** Mostly excellent. The invariants section is the plan's best
  asset — position-keyed `ParseOutput`, snapshot-narrower-than-ParseOutput,
  single identity space under `HydrationIdMap`, no compaction of cell-attached
  identity, payload length == axis cardinality, and the `mog` must-not-depend-on
  `mog-internal` direction are all correct and verifiable. The one missing
  contract is the error-propagation contract for the new checked builder (see
  gaps).
- **Verification:** Gates are concrete and exist (`cargo test -p compute-core
  import::parse_output_to_snapshot`, `…storage::engine::construction`,
  `…test_deferred_xlsx_import`, `…services::export`, full crate + clippy), and
  the dependency-triggered gates for `domain-types`, `snapshot-types`,
  `cell-types`, `compute-parser`, `xlsx-parser` are appropriate. The decoder
  roundtrip test and the dual-residency test (range-backed value + explicit
  metadata) are the right correctness anchors. Weakness: no gate ties a
  *behavior* assertion to the malformed-input policy (e.g., a golden test
  proving which artifacts are now dropped vs. previously retained), so the
  acknowledged behavior change is not actually pinned by a gate.

## Concrete changes that would raise the rating

1. **Define the `ImportLoweringError` / caller contract.** State the error
   variants, whether the type is public, and exactly what each top-level import
   caller (XLSX/CSV/deferred/direct) does on `Err` — fail-workbook vs.
   skip-feature-with-diagnostic — and add a gate asserting that contract. This
   single addition addresses the largest gap.
2. **Carve out a Phase 0 of small, independently landable data-loss fixes**
   (Array/Control/Image lossless-or-retain, `table_lowering` `from_raw(0)` →
   diagnostic drop/retain decision, `data_table` empty-sheet → resolution
   policy), each with its own test, ahead of the big refactors.
3. **Resolve the open questions in-plan:** pick the table lookup key, and pick a
   single out-of-bounds-cell policy, so the six agents share one answer.
4. **Pin malformed-input behavior with golden tests** that document, per feature
   family, whether the new behavior drops or degrades, so the acknowledged
   "which artifacts get skipped" risk is covered by a gate, not prose.
5. **Sequence diagnostics after correctness**, and gate the kitchen-sink fixture
   on first proving a `ParseOutput` can actually carry each feature family
   (otherwise scope it to the families the parser can populate today).

Net: an accurate, high-fidelity diagnosis with the right invariants and real
verification gates; held back from 9–10 by an outsized scope with no minimal
increment and by leaving the checked-builder error/caller contract — the heart
of the change — unspecified.
