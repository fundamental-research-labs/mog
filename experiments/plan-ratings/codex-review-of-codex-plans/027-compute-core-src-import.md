Rating: 8/10

Summary judgment

This is a strong, source-aware plan for `compute/core/src/import`. It correctly identifies the folder as a production contract boundary, not just a mechanical converter, and it focuses on the right failure classes: unchecked `HydrationIdMap` shape assumptions, lossy range classification, stringly A1 parsing, silent lowerer fallbacks, incomplete anchor policy, and production ingest/export verification. The plan is especially good at preserving the architecture that `ParseOutput` stays position-keyed while `WorkbookSnapshot` stays narrower than full import state.

The main weakness is that the plan is so broad that it reads more like a multi-epic import correctness program than an implementation-ready plan for this folder. It names many correct changes, but it does not always define crisp acceptance contracts, minimal migration order, public API/error shapes, or how to split "complete feature policy" from cross-repo parser/export work that may be needed before compute-core can finish.

Major strengths

- The plan matches the actual production path: `FullParseResult -> ParseOutput -> parse_output_to_workbook_snapshot -> WorkbookSnapshot -> ComputeCore::init_from_snapshot`, with XLSX/CSV/deferred constructors building `HydrationIdMap` and then using the snapshot builder.
- It accurately calls out real unchecked behavior: direct indexing in sheet lowering, `debug_assert`-only ID-map checks, fallback table sheet IDs, empty data-table sheet IDs, best-effort named-range data-range linkage, and range classifier row/column ID indexing.
- The losslessness contract for range classification is exactly the right bar. Current `MixedCbor` behavior can encode `Array`, `Control`, and `Image` as null, and the plan correctly treats that as unacceptable for import correctness.
- The feature-policy manifest is a good architectural abstraction because `SheetData` and `ParseOutput` now carry many feature families that are either snapshot-owned, hydration-owned, export-only, or intentionally ignored. Making that policy explicit would reduce future whack-a-mole anchoring.
- Verification is production-path oriented. It requires constructor, hydration, mirror, deferred, and export-visible checks rather than relying only on lowerer unit tests.
- The plan preserves important dependency direction: implementation belongs in public `mog`, while this plan remains internal and does not suggest a public dependency on `mog-internal`.

Major gaps or risks

- The plan needs a sharper first deliverable. "Enumerate every top-level `ParseOutput` field and every `SheetData` field" is correct, but that surface is very large: package fidelity, workbook XML fidelity, styles, pivot caches, external links, persons, volatile dependencies, worksheet semantic containers, slicers, timelines, views, protection, print settings, and more. The plan should define what fields are in scope for compute-core import anchoring versus export-only package fidelity, otherwise the manifest can become a blocking mega-task.
- The checked builder proposal is under-specified. It names `try_parse_output_to_workbook_snapshot` and `ImportLoweringError`, but does not define whether production call sites return `ComputeError`, embed diagnostics in existing parse/import diagnostics, or allow non-fatal drops. That distinction matters because malformed names/tables may be warnings while invalid ID-map shapes should be hard errors.
- Sequencing is directionally right but still too coarse. Migrating the entrypoint, adding diagnostics, replacing parser helpers, changing classifier retention, and extending production fixtures are all high-blast-radius changes. The plan should define staged compatibility points so each agent can land a coherent slice without breaking current constructors.
- The feature policy is assigned to `anchor_collection`, but several policies are not really anchor policies. Workbook-level package fidelity, style palette, workbook views, external links, print/protection, and semantic raw XML may need manifest coverage, but not anchor collection consumption.
- The plan does not specify enough about diagnostics as a contract. Counters and reason lists are named, but severity, stable reason codes, aggregation location, and test assertions are missing.
- Pivot extent is correctly flagged as weak, but the plan depends on possible upstream parser metadata without stating the fallback contract if that metadata is unavailable.
- Some verification gates are broad enough to be expensive but still may miss cross-crate parser/export contracts unless the implementation explicitly changes those crates. The plan should tie each gate to the exact files/contracts touched and add targeted fixture names.

Contract and verification assessment

The contract framing is the plan's strongest part. It preserves the core invariant that `ParseOutput` is position-keyed and parser-owned, while compute import either lowers into `WorkbookSnapshot`, hydrates directly into storage, creates identity-only anchors, creates phantom cells, or leaves export-only provenance alone. It also correctly insists that range compaction must be lossless for values and metadata, and that dynamic-array spill filtering must use `ImportedCellProjectionRole` rather than inferring from OOXML metadata.

The verification strategy is also mostly correct: lowerer unit tests are treated as necessary but insufficient, and the plan asks for production-path tests through XLSX/CSV/deferred construction, ranged hydration, `ComputeCore::init_from_snapshot`, mirror readback, and export reconstruction. The missing piece is an explicit fixture matrix with named expected outcomes, especially for "direct hydration but no snapshot" feature families and dual-resident range-backed cells.

Concrete changes that would raise the rating

- Add a phase 0 deliverable that produces only the manifest and a generated/checked coverage test over current `ParseOutput` and `SheetData` fields, with clear categories for compute import, hydration, export-only, and no-effect fields.
- Define `ImportLoweringError` and `ImportLoweringDiagnostics` precisely: hard-error cases, warning/drop cases, stable reason codes, and how they flow into existing import diagnostics.
- Split the checked builder migration into an API-compatible stage, then a production-call-site stage, then removal of unchecked accessors.
- Make the feature policy consume points explicit: which categories feed anchor collection, which feed ID allocation, which feed direct hydration, and which are manifest-only.
- Add acceptance criteria for classifier losslessness: unsupported `CellValue` variants must remain explicit unless a typed payload codec can roundtrip them, and metadata-bearing cells must have a tested dual-residency path.
- Add a dependency table for upstream parser/export requirements, especially pivot rendered extent, validation sqref typing, hyperlink anchor use in hydration, and named-range sheet qualifier preservation.
- Replace broad fixture descriptions with named tests or evals and expected assertions for direct import, ranged import, deferred completion, mirror readback, and export-visible reconstruction.
