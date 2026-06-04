# 054 - File IO XLSX Parser Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/file-io/xlsx/parser/src`

Queue item: 54

Scope: the Rust `xlsx-parser` source tree that reads XLSX ZIP/OOXML packages, builds parser-owned full parse results, converts them into shared `domain_types::ParseOutput`, writes XLSX packages from `ParseOutput`, and exposes native/CLI/testing helpers for roundtrip fidelity and performance gates.

Files and integration points inspected:

- `file-io/xlsx/parser/src/lib.rs`
- `file-io/xlsx/parser/src/pipeline/*`
- `file-io/xlsx/parser/src/pipeline/full_parse/*`
- `file-io/xlsx/parser/src/domain/*`
- `file-io/xlsx/parser/src/output/results/*`
- `file-io/xlsx/parser/src/output/to_parse_output/*`
- `file-io/xlsx/parser/src/write/*`
- `file-io/xlsx/parser/src/write/from_parse_output/*`
- `file-io/xlsx/parser/src/write/package_graph/*`
- `file-io/xlsx/parser/src/infra/*`
- `file-io/xlsx/parser/src/zip/*`
- `file-io/xlsx/parser/src/testing/*`
- `file-io/xlsx/parser/src/bin/xlsx_gate.rs`
- `file-io/xlsx/parser/Cargo.toml`
- `file-io/xlsx/parser/package.json`
- `file-io/xlsx/parser/tests/*`
- `file-io/xlsx/parser/tests/roundtrip_parse_output/parse_result_sidecar_storage_audit.md`
- `file-io/xlsx-api/src/{parse,export,options}.rs`
- `file-io/xlsx/test-contracts/src/commands.rs`
- `compute/core/src/storage/engine/construction/{xlsx,deferred,sheet_import}.rs`
- `compute/core/src/import/mod.rs`
- `compute/core/src/storage/engine/export.rs`
- `kernel/src/document/document-lifecycle-system.ts`
- `kernel/src/api/workbook/workbook-impl.ts`
- `runtime/sdk/src/boot.ts`
- `compute/{napi,wasm,pyo3}/src/lib.rs`
- `domain-types/src/parse_output.rs`

Adjacent folders are in scope only as production consumers or contract owners:

- `file-io/xlsx-api/src` wraps parser import/export and owns public parse options.
- `domain-types/src` owns `ParseOutput`, package fidelity metadata, and sheet/cell domain contracts.
- `compute/core/src/import` consumes parser output for compute hydration.
- `compute/core/src/storage/engine/export.rs` exports current workbook state through `xlsx-api -> xlsx-parser`.
- `file-io/xlsx/test-contracts` defines gate names, report schemas, and rollout policy.

This plan does not cover implementation work in `mog-internal`, TypeScript bridge UI behavior, or public examples. This plan is internal; implementation belongs in `mog`.

## Current role of this folder in Mog

`file-io/xlsx/parser/src` is the production Rust engine for XLSX import, export, and roundtrip fidelity.

The current production data flow is:

```text
XLSX bytes
  -> XlsxArchive / ZIP + OPC inventory
  -> parse_xlsx_full_native()
  -> FullParseResult
  -> full_parse_result_to_parse_output()
  -> domain_types::ParseOutput + ParseDiagnostics
  -> compute import / Yrs hydration

Current workbook state
  -> ParseOutput
  -> write_xlsx_from_parse_output()
  -> XLSX bytes
```

Observed responsibilities:

- `lib.rs` exposes `parse_xlsx_to_output`, `parse_xlsx_to_output_max_sheets`, native full parse entrypoints used by tests/binaries, ZIP/archive helpers, parser result types, domain parser helpers, and writer types.
- `pipeline/full_parse/implementation.rs` is the central import orchestrator. It reads ZIP entries, content types, workbook relationships, shared strings, styles, themes, workbook metadata, sheet inventory, each worksheet, feature sidecars, package inventory, and opaque/typed package fidelity data.
- `domain/*` contains OOXML feature readers and some writers for cells, workbook metadata, worksheets, styles, shared strings, rich text, comments, conditional formats, validations, tables, charts, drawings, controls, print settings, protection, pivots, slicers, timelines, external links, metadata, rich data, web extensions, VBA detection, and package content types.
- `output/results/*` defines parser-owned `FullParseResult`, `FullParsedSheet`, `FullCellData`, timing, style, workbook, comments, table, control, print, metadata, and status DTOs.
- `output/to_parse_output/*` is the critical contract bridge into `domain-types`. It resolves styles, shared strings, charts, floating objects, comments, metadata, package fidelity, pivots, diagnostics, workbook metadata, and sheet extents into position-keyed `ParseOutput`.
- `write/from_parse_output/*` is the current unified exporter from `ParseOutput` to XLSX bytes. It runs preflight, style remapping, shared string construction, sheet part construction, relationship planning, chart replay, pivot package generation, media/OLE emission, doc props, external links, metadata, and final ZIP assembly.
- `write/package_graph/*`, `write/package_ownership.rs`, `infra/opc_inventory.rs`, and `infra/package_integrity.rs` collectively define package ownership, imported package inventory, writer package graph construction, relationship/content type validation, and safety policies.
- `zip/*` implements XLSX archive reading, central directory parsing, decompression, path validation, recovery, and safety checks.
- `pipeline/lazy`, `pipeline/streaming`, optional `pipeline/mmap`, and optional `pipeline/parallel` provide alternate parsing modes, but the strongest production contract is still the full parse to `ParseOutput`.
- `src/testing/*` contains important production-path test adapters: OOXML contract fixtures, package graph validation, XML diffing, fidelity comparison, context removal audit, and performance gates.
- `src/bin/xlsx_gate.rs` exposes gate commands. `ooxml-contract`, `package-graph`, and performance gates are implemented; corpus correctness gates are declared in `xlsx-test-contracts` and package scripts but currently return a not-implemented report in the gate runner.

The folder is therefore not just a parser. It is the boundary where external OOXML packages become Mog-owned domain state, where imported package provenance is classified, and where current Mog state becomes a valid XLSX package again.

## Improvement objectives

1. Make the production XLSX contract explicit: `XLSX bytes -> ParseOutput + diagnostics -> current Mog state -> ParseOutput -> XLSX bytes`.

2. Turn `FullParseResult` and `FullParsedSheet` sidecars into a checked owner policy. Every parser-only field must either convert into a typed domain owner, feed a diagnostic, or be impossible to replay.

3. Refactor the full parse pipeline into named stages with typed contexts, so workbook discovery, package inventory, sheet planning, feature parsing, diagnostics, and conversion are independently verifiable while preserving the public entrypoints.

4. Enforce public parse options in the production parser path instead of rejecting most options in `xlsx-api`.

5. Make read/write symmetry systematic across all OOXML feature families: every domain reader must have a typed writer path, an owner-scoped inert preservation policy, or an explicit unsupported diagnostic.

6. Collapse ad hoc package part and relationship assembly into one authoritative package graph that both import inventory and export assembly validate against.

7. Implement real corpus correctness and anti-cheat gates so the existing gate command surface proves import/export behavior over production paths, not just generated fixtures or performance harnesses.

8. Preserve and improve production performance on the actual `parse_xlsx_full_native -> ParseOutput -> write_xlsx_from_parse_output` path, with budgets and metrics that include conversion and writer work.

9. Keep active content, malformed packages, Strict/Transitional dialect differences, unsafe MCE, and stale imported sidecars fail-closed and diagnosable.

10. Bring docs and package scripts in line with the current source layout and target-dir conventions.

## Production-path contracts and invariants to preserve or strengthen

- `ParseOutput` remains position-keyed. XLSX import must not allocate cell IDs, sheet IDs, UUIDs, or identity formulas inside the parser.
- `parse_xlsx_to_output()` remains the primary Rust parser entrypoint for domain-typed import. External consumers should not depend on `FullParseResult`.
- `write_xlsx_from_parse_output()` remains the single XLSX writer for both clean export and imported-file roundtrip.
- `xlsx-api::parse()` and compute import/export must use the same production parser and writer path as tests and gates.
- The crate facade must match the contract it documents. If `FullParseResult` and `parse_xlsx_full_native` remain public for tests or tooling, their status must be deliberate, documented, and protected from becoming an editable app API.
- `FullParseResult` and `FullParsedSheet` fields are parser-private conversion inputs. They are not durable package storage.
- Raw XML or binary bytes may survive only through a typed current owner, an owner-scoped inert package policy, or a diagnostic. No package-wide replay of source bytes.
- Package fidelity metadata is provenance, not authority. Export must revalidate current owner, relationship closure, content type, stale state, active-content policy, and package profile before using imported hints.
- Workbook sheet identity must be relationship/content-type driven, not derived from `sheetN.xml` naming or workbook order assumptions.
- Relationship target resolution must be OPC-correct for absolute paths, relative paths, external targets, Strict vs Transitional relationship types, and owner-scoped `.rels` files.
- Exported packages must pass package integrity validation: no missing owners, duplicate relationship IDs, invalid targets, missing content types, stale content types, or missing XML relationship references.
- Mog must never export `xl/calcChain.xml`; calc chain remains an Excel engine cache. Formula cache currentness must be carried by typed calculation and formula-cache provenance.
- Shared string export must be derived from current cell text and rich-string state. Imported SST indices and entries are provenance only.
- Styles, themes, comments, threaded comments, charts, drawings, controls, OLE, media, pivots, slicers, timelines, tables, validations, conditional formats, metadata, rich data, print settings, external links, connections, and workbook properties must each have one declared owner and invalidation rule.
- `ParseMode` must be meaningful: strict fails on contract violations, lenient collects recoverable errors without hiding data loss, permissive recovers only where the recovery policy is explicit and diagnosed.
- Parser safety limits for ZIP structure, decompression, shared strings, styles, worksheet cells, merges, tables, pivots, charts, validations, and active content must be enforced before expensive parse or export work.
- Performance work must target production import/export. Optimizing only `pipeline/streaming`, lazy helpers, generated fixtures, or benchmark harnesses is not sufficient.
- Existing root crate lint guard for UTF-8 string slicing must stay intact; new byte slicing must be ASCII-boundary justified or replaced with typed parsing.
- Public dependency direction remains: `mog` must not depend on `mog-internal`.

## Concrete implementation plan

### 1. Clarify the crate facade and public API boundary

`lib.rs` comments say the native full-parse entrypoint is now crate-private and that external consumers should use `parse_xlsx_to_output()`, but the crate still publicly reexports `parse_xlsx_full_native`, `parse_xlsx_full_native_max_sheets`, `FullParseResult`, `FullParsedSheet`, and `FullCellData`. Make this boundary intentional.

Implementation:

- Define the supported public API tiers: production domain API, test/tooling API, and internal crate API.
- Keep `parse_xlsx_to_output()` and `write_xlsx_from_parse_output()` as the production import/export API.
- Move lower-level full-parse types behind a named `testing`/`tooling` feature or clearly documented module if downstream tests and bins still need them.
- Audit `xlsx-api`, compute tests, tooling scripts, and bridge code for direct dependencies on full-parse DTOs.
- Update stale bridge surfaces that still request full-parse commands when generated command metadata only exposes lazy/version XLSX commands.
- Add compile-time or doctest coverage that the documented facade matches the actual exports.

This should land before deeper pipeline changes so agents do not build new production behavior on an accidental public surface.

### 2. Add an authoritative XLSX pipeline contract

Introduce a parser-local contract module, for example `pipeline/contract.rs`, that defines the production parse stages and their inputs/outputs:

- `ArchiveOpenStage`: ZIP open, central directory, safety diagnostics, encrypted package detection.
- `PackageDiscoveryStage`: content types, root relationships, workbook relationship discovery, package profile, OPC inventory.
- `WorkbookDiscoveryStage`: workbook XML, sheet inventory, defined names, workbook views/properties, calculation settings, workbook XML fidelity.
- `GlobalTablesStage`: shared strings, styles, themes, metadata, rich data, external links, pivot caches, slicer/timeline caches, connections.
- `WorksheetPlanStage`: one `WorksheetParsePlan` per workbook sheet, keyed by workbook sheet record, owner part path, relationship owner, content type, visibility, sheet kind, and editable/non-editable disposition.
- `WorksheetParseStage`: cells, dimensions, views, merges, row/column metadata, formulas, comments, hyperlinks, validations, CF, tables, charts, drawings, controls, print, protection, pivots, slicers, timelines, semantic containers, raw feature inputs, and per-sheet diagnostics.
- `ParseOutputStage`: conversion from parser-owned DTOs into `ParseOutput` plus diagnostics and package fidelity.

Keep `parse_xlsx_full_native()` and `parse_xlsx_to_output()` stable, but route them through this staged contract. This makes timing, diagnostics, feature skips, and option enforcement explicit without changing the main public path.

### 3. Replace the monolithic full-parse implementation with typed stage contexts

Refactor `pipeline/full_parse/implementation.rs` into smaller stage modules that operate on typed contexts rather than shared local variables:

- `archive_stage.rs`
- `package_stage.rs`
- `workbook_stage.rs`
- `global_stage.rs`
- `worksheet_plan.rs`
- `worksheet_stage.rs`
- `sidecar_stage.rs`
- `finalize_stage.rs`

The first implementation can move code without changing behavior, but each stage should expose a checked output type. For example:

- `PackageContext`: archive, content type defaults/overrides, root/workbook relationships, package inventory, package profile, package diagnostics.
- `WorkbookContext`: workbook XML, workbook namespaces, sheet inventory, sheet package contexts, defined names, workbook fidelity, workbook-level typed properties.
- `GlobalContext`: shared strings, styles, theme, metadata, pivot caches, slicer/timeline caches, external links, feature properties, rich data.
- `WorksheetContext`: parsed worksheet result plus relationship facts and namespace facts.

The sequential and optional parallel paths should share a common `parse_one_worksheet(plan, globals, archive_access)` contract so they cannot diverge on feature coverage. Parallel mode can still pre-read archive bytes sequentially, but the feature parse plan should be identical.

Domain feature parsers that currently take `XlsxArchive` directly should move behind a `PartResolver` or `SheetPackageContext` interface. Tables, comments, charts, controls, pivots, slicers, timelines, print settings, and VML readers should receive resolved owner context plus part bytes/relationships rather than independently walking the archive. This makes nonstandard OPC paths, parallel pre-read, and fixture tests use the same relationship resolution contract.

### 4. Enforce parse options in the parser, not just `xlsx-api`

Add an `XlsxParseOptions` type in `xlsx-parser` and make `xlsx-api::ParseOptions` lower into it. It should include:

- `mode`
- `profiled`
- `max_sheets`
- `max_cells`
- `sheet_filter`
- feature skip flags for styles, charts, drawings, comments, validations, conditional formats
- `values_only`

Implement each option in the production stage pipeline:

- `max_sheets` should already map to metadata-only sheets; preserve that behavior and make it part of `WorksheetParsePlan`.
- `max_cells` should fail or stop according to `ParseMode` before worksheet parse work exceeds the limit.
- `sheet_filter` should use workbook sheet names and sheet identity, not physical file names.
- `skip_*` options should skip the owning feature stage and add diagnostics that the resulting `ParseOutput` is intentionally partial.
- `values_only` should preserve cached value semantics while omitting formula text only when the caller explicitly chooses that partial import contract.
- `profiled` should return timings from the same stages that the production path uses.

Once these are implemented, remove the `xlsx-api` unsupported-option rejection for supported options and add tests proving the public option contract.

### 5. Turn sidecar storage policy into executable coverage

Promote the audit in `tests/roundtrip_parse_output/parse_result_sidecar_storage_audit.md` into an executable manifest, for example `output/to_parse_output/sidecar_policy.rs` or `testing/context_removal_audit.rs`.

For every parser-owned field on `FullParseResult` and `FullParsedSheet`, record:

- source field name
- classification: typed owner, conversion input, diagnostic only, active quarantined, unsupported drop, internal transient
- target `ParseOutput` or `SheetData` field when applicable
- currentness or invalidation rule
- writer owner that may emit the state
- required test or gate

Add tests that fail when new parser-only fields are added without a policy. The policy must prove that raw comments, VML, table XML passthroughs, worksheet `extLst`, doc props, metadata, custom XML, web extensions, media, OLE, non-editable sheets, package relationships, and content types do not silently become stale package replay.

### 6. Make feature read/write symmetry systematic

Create a domain feature matrix for every `domain/*` feature and wire it into parser tests. Each row should declare:

- reader module
- writer module or export owner
- canonical type source (`ooxml-types`, `domain-types`, parser-local type, or binary owner)
- `FullParseResult` field
- `ParseOutput` field
- Yrs/compute storage owner, when any
- package parts and relationship types owned
- currentness invalidators
- unsupported diagnostic policy

Use the matrix to drive implementation lanes:

- Workbook, worksheets, styles, shared strings, themes, metadata, doc props, calculation settings, and views: typed regenerated owners with lexical provenance only where current.
- Cells and formulas: preserve formula metadata, cache provenance, empty cached values, date lexical values, rich strings, phonetic flags, VM metadata, dynamic array roles, and original values through typed cells.
- Tables, auto filters, sort state, validations, x14 validations, conditional formats, sparklines, and worksheet semantic containers: eliminate raw XML sidecars where typed state is sufficient; otherwise require owner-scoped typed container fields.
- Charts, ChartEx, drawings, images, SmartArt, connectors, and chart auxiliary files: preserve through typed chart/floating-object owners and current auxiliary relationship closure.
- Comments, threaded comments, persons, legacy VML comment shapes, and comment namespaces: preserve through typed comments/persons and comment package metadata.
- Controls, ActiveX, OLE, form controls, control properties, VML, embeddings, preview media: preserve only through typed control/OLE/floating-object owners with binary ownership.
- Pivots, pivot caches, slicers, and timelines: separate typed current state from imported cache/package fidelity, and block stale replay when source tables/cells change.
- External links, connections, query tables, volatile dependencies, rich data, web extensions, VBA, custom XML, labels, and active package content: classify as typed current state, inert provenance, active quarantined, active forbidden, or unsupported-needs-model.

Do not add broad raw passthrough as a fallback. If a feature requires package preservation, model its owner and invalidation rule.

### 7. Unify OPC inventory and writer package graph

Today `infra/opc_inventory.rs`, `write/package_graph/*`, `write/package_ownership.rs`, `write/from_parse_output/*`, and `infra/package_integrity.rs` all participate in package ownership. Consolidate them around one authoritative graph contract:

- Import builds `ImportedPackageGraph` from archive entries, content types, relationships, owner paths, package profile, and diagnostics.
- `ParseOutput.package_fidelity` stores only safe provenance derived from that graph.
- Export builds `CurrentPackageGraph` from current typed owners and validated provenance hints.
- ZIP assembly consumes only `CurrentPackageGraph`.
- Package integrity validates the emitted graph before bytes are returned in test/gate modes and optionally in debug assertions.

All part path allocation, relationship ID hinting, content type emission, Strict/Transitional selection, external target handling, and opaque part inclusion should go through this graph. Remove ad hoc relationship construction where it conflicts with graph ownership.

### 8. Strengthen writer preflight and currentness

Make `write/from_parse_output/preflight_phase.rs` return a checked `WorkbookPreflightResult` rather than an always-successful struct. It should include:

- remapped output
- current owner graph
- style/shared-string plans
- sheet part plans
- chart/drawing/pivot/OLE/control/media/doc-prop plans
- export diagnostics
- explicit blocked reasons for unsupported package profiles or stale active content

`write_xlsx_from_parse_output()` should still return `Result<Vec<u8>, WriteError>`, but unsupported or stale owners should be represented as structured `WriteError` or `ExportReport` diagnostics. `write_xlsx_from_parse_output_with_report()` should become the default tool for gates so loss, drops, and quarantines are measured.

Currentness rules to enforce:

- Imported relationship IDs may be reused only when the same current owner emits the same relationship target.
- Imported content type rows may be reused only when the current graph owns the same part/default.
- Imported binary/media/OLE parts may be emitted only when a current domain object owns them.
- Imported pivot cache package bytes may be reused only when pivot source binding and cache schema are unchanged.
- Workbook XML raw children may be preserved only when owner policy allows inert preservation and relationship references are safe.
- Active content must never be replayed without an explicit typed owner and security policy.

### 9. Implement corpus correctness and anti-cheat gates

The package scripts and `xlsx-test-contracts` declare corpus gates, but `src/bin/xlsx_gate.rs` currently reports them as not implemented. Implement:

- `corpus-smoke`: quick curated real-file import, `ParseOutput` conversion, export, re-import, package graph validation, and fact comparison.
- `corpus-anti-cheat`: import -> export with context, import -> export with context-stripped current state, compare modeled workbook facts, and ensure no feature depends on unsafe source-byte replay.
- `corpus-golden`: curated broader fixtures with expected fact budgets and diagnostic budgets.
- `corpus-full`: manifest-driven broad dialect discovery with stable fingerprints and no release-blocking unknowns unless policy says so.

All corpus gates should call production entrypoints:

- `parse_xlsx_to_output`
- `write_xlsx_from_parse_output_with_report`
- `validate_package_graph_bytes`
- re-import of exported bytes
- optional compute import/export only when testing full app state currentness

Do not validate by direct mutation of parser internals.

### 10. Expand generated OOXML contract fixtures

`testing/ooxml_contract.rs` already generates rows for core relationships and package facts. Extend it into a contract matrix that covers every feature row from the domain feature matrix:

- one-attribute fixtures
- explicit default fixtures
- relationship-edge fixtures
- missing optional fixtures
- negative near-miss fixtures
- unknown extension fixtures
- active-content/quarantine fixtures
- empty and large-dimension worksheets
- Strict and Transitional package profile variants

For each fixture, assert:

- import facts
- `ParseOutput` owner fields
- export facts
- package graph validity
- re-import facts
- expected diagnostics and dropped/blocked decisions

This makes "solve once" practical: adding a feature means adding its full contract row, not a single local regression.

### 11. Optimize the production import/export path

Use the existing perf harness only for production phases and add metrics where gaps exist:

- ZIP open/index time
- shared string read/parse/materialize time and memory
- style/theme parse time
- workbook/package discovery time
- per-sheet XML read/decompress time
- cell parse time
- auxiliary feature parse time by feature
- `FullParseResult -> ParseOutput` conversion time
- writer preflight time
- package graph build time
- XML write time
- ZIP assembly time
- output size ratio and peak RSS

Then optimize real bottlenecks:

- Avoid duplicated archive reads for worksheet rels, comments, drawings, tables, pivots, and feature sidecars by caching owner-scoped part bytes in the worksheet plan.
- Share one XML scanning/namespace capture primitive across worksheet, styles, workbook, comments, and chart parsing.
- Reduce clones between `FullParseResult` and `ParseOutput` where ownership can move safely in the native path.
- Make lazy/streaming helpers feed the same cell parser and feature plan as full parse, rather than diverging into separate behavior.
- Keep optional parallel parsing deterministic by sorting outputs and sharing the same feature parser contract.

Performance success must be measured on `parse_xlsx_to_output` and `write_xlsx_from_parse_output`, not on test-only generated byte paths alone.

Add adjacent end-to-end performance coverage for the real user path once parser-level production perf is stable:

- XLSX import through `xlsx-api::parse` into compute construction.
- Deferred first-sheet import plus full deferred reparse.
- Yrs hydration and export through `xlsx_api::export_from_parse_output`.
- Kernel/SDK import and workbook export bridge calls where feasible.

These end-to-end gates should supplement, not replace, parser-level gates. Parser optimization still targets this folder's production path first.

### 12. Harden errors, diagnostics, and security policy

Replace string-only fatal errors with structured parser diagnostics internally, then map to strings at public boundaries where needed.

Specific hardening:

- ZIP bomb and archive safety diagnostics should stop all later package reads after a fatal safety error.
- Malformed UTF-8, malformed XML, invalid A1 refs, invalid dimensions, invalid relationship targets, duplicate relationship IDs, missing content types, unknown active parts, and MCE `MustUnderstand` should have stable codes.
- `ParseMode` should control fail/collect/recover behavior through policy, not ad hoc returns.
- Encrypted Office packages should be detected before deeper parsing where possible.
- Active package content policy should align import diagnostics, package fidelity, writer preflight, and export report.
- Diagnostic output should distinguish semantic loss, visual loss, inert provenance drop, active security drop, and unsupported-needs-model.

### 13. Clean up stale docs and scripts after contracts land

The parser README still describes an older module layout and WASM surface that does not match the current source tree. After implementation, update:

- `file-io/xlsx/parser/README.md`
- `file-io/xlsx/parser/package.json` scripts that reference stale target paths or unimplemented gates
- any docs that imply `FullParseResult` is public
- any docs that describe raw package replay as acceptable

Use `target-native` and `target-wasm` paths in docs/scripts, never bare `target/`.

## Tests and verification gates

Focused tests to add or update:

- Stage contract tests for archive open, package discovery, workbook discovery, global tables, worksheet planning, worksheet parsing, sidecar capture, and final conversion.
- Public parser option tests covering `mode`, `profiled`, `max_sheets`, `max_cells`, `sheet_filter`, `skip_*`, and `values_only`.
- Sidecar policy coverage tests for every `FullParseResult` and `FullParsedSheet` field.
- Domain feature matrix tests proving every feature has a reader, writer/current owner, package ownership row, invalidation rule, and diagnostic policy.
- Roundtrip tests for cells, formulas, rich strings, date lexical values, metadata indices, dynamic arrays, styles, themes, tables, filters, sort state, validations, CF, sparklines, comments, threaded comments, charts, ChartEx, drawings, controls, OLE, pivots, slicers, timelines, print settings, workbook metadata, external links, connections, rich data, and non-editable sheets.
- Package graph tests for relationship closure, content types, path allocation, duplicate IDs, external targets, Strict/Transitional variants, and missing owner failures.
- Writer preflight tests for stale package fidelity, deleted owners, changed pivot sources, changed media/OLE owners, active content, calcChain omission, and workbook XML MCE.
- Corpus gate tests proving `corpus-smoke`, `corpus-anti-cheat`, `corpus-golden`, and `corpus-full` run production entrypoints and produce stable gate reports.
- Performance gate tests that measure import, conversion, export, package graph validation, peak RSS, and output size ratio.
- Integration tests with `xlsx-api` parse/export and compute import/export for the public production path.

Required final gates for an implementation touching this folder:

- `cargo test -p xlsx-parser`
- `cargo clippy -p xlsx-parser`
- `cargo test -p xlsx-parser --features cli`
- `cargo test -p xlsx-parser --features native`
- `cargo test -p xlsx-parser --features parallel`
- `cargo test -p xlsx-api`
- `cargo clippy -p xlsx-api`
- `cargo test -p compute-core storage::engine::construction::xlsx`
- `cargo test -p compute-core storage::engine::construction::deferred`
- `cargo test -p domain-types`
- `cargo test -p compute-core import::parse_output_to_snapshot`
- `cargo test -p compute-core storage::engine::services::export`
- `pnpm --filter @mog/xlsx-parser-wasm run gate:check:smoke`
- `pnpm --filter @mog/xlsx-parser-wasm run gate:ooxml-contract`
- `pnpm --filter @mog/xlsx-parser-wasm run gate:package-graph <representative-input.xlsx>`
- `pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-smoke`
- `pnpm --filter @mog/xlsx-parser-wasm run gate:corpus-anti-cheat`
- `pnpm --filter @mog/xlsx-parser-wasm run gate:perf-smoke`

Additional gates when relevant:

- `cargo test -p xlsx-parser --features slow-tests corpus_tests` when corpus fixture behavior changes.
- `pnpm --filter @mog/xlsx-parser-wasm run gate:check:golden` before landing broad feature or package graph changes.
- `pnpm --filter @mog/xlsx-parser-wasm run gate:check:full` for autonomous corpus/perf rollout or large OOXML ownership changes.
- `cargo test -p compute-core` when parser output fields, import contracts, or export-visible domain types change.
- `cargo clippy -p compute-core` when compute import/export code changes.
- `pnpm typecheck` if TypeScript bridge, tooling, package scripts, or public TS types change.

Verification must exercise XLSX bytes through parser import, `ParseOutput` conversion, writer export, package graph validation, and re-import. Unit tests around a domain parser or writer are useful but not sufficient on their own.

## Risks, edge cases, and non-goals

Risks:

- `pipeline/full_parse/implementation.rs` is large and feature-dense. Refactor by staged contracts first, then feature behavior changes, so agents do not create incompatible partial pipelines.
- Making parse options real can expose callers that assumed unsupported options were rejected. Migrate `xlsx-api` and tests together.
- Sidecar policy enforcement can reveal stale raw XML dependencies. Fix by modeling owners or adding explicit diagnostics, not by preserving raw passthrough globally.
- Package graph consolidation can change relationship IDs, content type ordering, or part numbering. Preserve stable current-owner hints where valid, but prioritize package correctness over byte-for-byte source replay.
- Parallel parsing can drift from sequential parsing if pre-read and feature parsing are not shared. Keep one `WorksheetParsePlan` contract.
- Strict vs Transitional support can become inconsistent between import and export. Package profile must be a first-class graph fact.
- Performance changes can accidentally optimize generated fixtures while slowing real imports. Gate on production import/export phases and real corpus fixtures.

Edge cases to cover:

- Empty workbooks, empty sheets, hidden sheets, very hidden sheets, non-editable chartsheets/dialogsheets, missing optional workbook parts, and invalid sheet relationship targets.
- Large dimensions, malformed dimensions, sparse sheets, max cell references, authored blank style-only cells, explicit blank cells, and cells outside declared dimensions.
- Shared strings with rich text, phonetics, empty entries, entity-heavy text, Unicode text, original SST indices, and unused SST entries.
- Formulas with empty caches, stale caches, force-recalc flags, shared formulas, array formulas, dynamic arrays, data table formulas, external refs, broken refs, and calcPr variants.
- Styles with explicit defaults, dxfs, table styles, theme colors, tints, indexed colors, style-only cells, row/column styles, and extension lists.
- Hyperlinks with external targets, internal locations, tooltip/display text, range refs, relationship IDs, invalid target modes, and extension UIDs.
- Data validations and conditional formats with x14 extensions, sqref lists, formulas, unsupported operators, disabled prompts, and container count attributes.
- Tables with query-table bindings, XML maps, totals rows, filters, sorts, single-cell tables, and tableSingleCells parts.
- Charts, ChartEx, SmartArt, connectors, images, grouped shapes, chart auxiliary style/color/user-shape parts, external chart relationships, and unsupported chart families.
- Comments, threaded comments, persons, legacy VML shapes, comment extLst, and orphaned or unused authors.
- Controls, ActiveX, OLE, embedded packages, VML preview images, control property parts, and stale binary owners.
- Pivots with local table sources, external sources, missing cache records, stale cache package bytes, slicers, timelines, and changed source ranges.
- Rich data, metadata, volatile dependencies, external links, connections, web extensions, custom XML, VBA, digital signatures, sensitivity labels, and active content policy.
- ZIP entries with duplicate names, path traversal attempts, bad compression, bad CRCs, missing central directory data, huge decompression ratios, invalid UTF-8 XML, and malformed MCE.

Non-goals:

- Do not create a second XLSX parser or writer model.
- Do not expose `FullParseResult` as a public editable API to avoid completing `ParseOutput`.
- Do not preserve raw package bytes as a compatibility shim for modeled current state.
- Do not optimize lazy, streaming, CLI, or benchmark-only paths instead of the production import/export path.
- Do not implement test-only gates that bypass `parse_xlsx_to_output` or `write_xlsx_from_parse_output`.
- Do not weaken active-content or malformed-package policy to improve byte roundtrip scores.
- Do not add dependencies from public `mog` code to `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the stage contract and feature matrix are drafted.

- Agent A: extract the staged parse contract and split `pipeline/full_parse/implementation.rs` into typed stage modules without behavior changes.
- Agent B: implement `XlsxParseOptions` in `xlsx-parser`, lower `xlsx-api::ParseOptions` into it, and add public option tests.
- Agent C: convert the sidecar storage audit into an executable field policy and add coverage tests for all parser-only fields.
- Agent D: build the domain feature matrix and fill read/write/current-owner gaps for worksheet/table/validation/CF/sparkline/comment features.
- Agent E: unify imported OPC inventory, writer package graph, package ownership, and package integrity validation around one graph contract.
- Agent F: harden writer preflight, export report diagnostics, stale package fidelity rejection, and active-content policy.
- Agent G: implement corpus smoke, anti-cheat, golden, and full gates in `xlsx_gate`.
- Agent H: extend generated OOXML contract fixtures across feature families and Strict/Transitional package variants.
- Agent I: optimize measured production import/export bottlenecks after stages expose reliable timing and memory metrics.

Dependencies:

- The staged parse contract should land before parse options, performance changes, or parallel path work.
- The sidecar field policy and domain feature matrix should land before broad writer currentness changes.
- Package graph unification should land before large feature writers start allocating new package parts.
- Writer preflight depends on package graph ownership and sidecar currentness policy.
- Corpus gates depend on package graph validation and export reports so they can distinguish semantic loss, safe diagnostic drops, and hard failures.
- Compute import/export tests depend on `domain-types::ParseOutput` field changes; coordinate with `compute/core/src/import` and `compute/core/src/storage/engine/export.rs`.
