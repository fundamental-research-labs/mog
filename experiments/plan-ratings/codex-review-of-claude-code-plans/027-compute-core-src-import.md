Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It correctly identifies the import folder as the ParseOutput-to-WorkbookSnapshot lowering stage and focuses on real correctness contracts in the production XLSX ingest path: range payload fidelity, identity stability, classifier side effects, anchor preservation, orphan references, and lowering performance. The plan is unusually well evidenced against the current code: the duplicated MixedCbor encoder/decoder, Array/Control/Image-to-Null loss, direct row/col-id indexing, data-table empty-sheet fallback, table SheetId::from_raw(0) fallback, pivot output scan, named-range linkage scans, and mixed ID-string formatting all exist.

The main reason this is not a 9 or 10 is that several changes necessarily cross the stated folder boundary, but the plan alternates between treating those edits as out of scope and as required implementation steps. The highest-risk API migration, returning classifier decisions to hydration, is also under-specified and under-enumerates production call sites.

Major strengths

- The plan is grounded in the production import path rather than a harness-only path. It correctly follows XLSX parse -> snapshot conversion -> CellMirror/ComputeCore init -> Yrs hydration implications.
- The MixedCbor objective is the right top priority. Today `classifier.rs` owns encoder tags and error discriminants while `mirror/range_view.rs` owns a separate decoder table; unsupported variants are encoded as Null. Centralizing this contract is structurally correct.
- The contracts C1-C10 are useful and mostly verifiable. C2, C3, C5, C6, C7, and C8 are the right invariants to protect import correctness.
- The plan notices subtle behavior that a shallow review would miss: explicit Null cells may be included in MixedCbor payloads but retained as per-cell identity entries, and the caller's ranged-position diff already has exceptions for skipped empty styled cells.
- Sequencing is mostly good. Shared codec first, classifier-decision return second, then independent lowerer fixes is a sensible integration order.
- Verification is broad and tied to behavior: codec round trips, no silent loss, caller-diff equivalence, pivot extent regressions, orphan data-table handling, named-range linkage parity, determinism, and deferred XLSX integration coverage.

Major gaps or risks

- The cross-folder ownership model is inconsistent. The source/scope section says outside folders are evidence only and "not edited", but Step 1 requires editing `mirror/range_view.rs` and possibly `cell-types`, and Step 2 requires storage construction changes. The plan should either be explicitly cross-folder or split into dependency plans with exact interfaces.
- Objective 3 misses production call sites. The same snapshot-vs-parse-output ranged-position inference exists in `storage/engine/construction/deferred.rs` for first-sheet deferred import and full deferred completion, and a similar pattern exists in `storage/engine/construction/csv.rs`. Updating only `construction/xlsx.rs` would leave the fragile implicit contract in production paths.
- The returned classifier decision needs a precise type contract. It must distinguish positions actually removed from `sheet.cells` from positions merely covered by a RangeData payload. MixedCbor null entries are currently encoded in the range but retained per-cell; returning all covered positions would make hydration skip identity-bearing null cells and change behavior.
- The codec home is left as a risk rather than a decision. `cell-types` owns `PayloadEncoding` but currently has no `value-types` dependency; a codec that encodes/decodes `CellValue` there would create a new type-crate dependency edge. A compute-core-local codec avoids that edge but does not centralize the contract beside `PayloadEncoding` for other consumers. The plan should choose one after a dependency audit and name the module/API.
- The "defensive non-lossy fallback" for Array/Control/Image is not mechanically specified. If the codec reports an unencodable value, `flush_run` needs to decline promotion before writing RangeData and before marking removals. A debug assertion inside the encoder alone would not preserve the cell.
- Pivot extent replacement is under-specified. "Bounded, correct derivation" from structural metadata plus sheet extent needs an exact formula and fixtures for adjacent or multiple pivots on the same sheet. A sheet-level extent can over-approximate if unrelated cells sit in the estimated pivot columns.
- Named-range narrowing by scope is potentially incomplete. A sheet-scoped name's scope is the name's visibility, not necessarily the referred target sheet if the raw expression has an explicit sheet prefix. The plan should parse or preserve target sheet qualification, especially for workbook-scoped names with explicit sheet refs and sheet-scoped names that refer elsewhere.
- Verification gates are directionally good but not exact enough for the touched surface. If `cell-types`, `value-types`, `mirror`, storage construction, or CSV/deferred import are changed, the plan should name the corresponding `cargo test -p ...` and `cargo clippy -p ...` gates, not just "clippy clean on touched crates".

Contract and verification assessment

The contract section is the best part of the plan. C2, C3, C6, C7, and C8 directly encode the risky production invariants. C6 should be refined from "ranged positions" to "positions removed from per-cell hydration" and should explicitly preserve the existing null-cell behavior. C8 should define malformed/truncated MixedCbor behavior as well as tag agreement, because `range_view.rs` currently returns early or Null on malformed payloads.

The verification plan has the right shape, but it should expand to all migrated call sites. The deferred XLSX path is especially important because `construction/deferred.rs` rebuilds snapshots and recomputes ranged positions independently. The CSV path should be addressed or explicitly excluded with rationale. The xlsx-roundtrip corpus gate is useful, but the plan should also include targeted tests that run through `hydrate_from_parse_output_with_ranges`, because that is where the returned decision set becomes observable.

Concrete changes that would raise the rating

1. Resolve the scope contradiction: declare the plan cross-folder, or split Step 1 and Step 2 into explicit dependency plans with exact exported contracts.
2. Define a concrete return type, for example `ImportSnapshotLowering { snapshot, ranged_removed_positions_per_sheet }`, and specify behavior for `id_map: None`, deferred first-sheet import, full deferred completion, CSV import, and test helpers.
3. Specify that returned ranged positions are only cells removed from per-cell storage/hydration, not all row_ids covered by a range payload.
4. Pick the codec module home and API, including malformed-payload behavior and whether error diagnostic messages are intentionally dropped.
5. Make unsupported CellValue handling explicit in classifier control flow: pre-scan mixed runs, decline promotion for unencodable values, and test that the original cells remain.
6. Replace the pivot step with an exact extent derivation contract or state the parser metadata that must be added before this can be correct.
7. Add all production call sites to Step 2: `construction/xlsx.rs`, `construction/deferred.rs`, and `construction/csv.rs`, plus any test helper that hydrates ranges.
8. Tighten verification gates to exact commands for every touched crate and include deferred import and hydrate-with-ranges behavior tests.
