# Plan 054 — Harden and decompose the XLSX parser/writer/roundtrip core in `mog/file-io/xlsx/parser/src`

## Source folder and scope

- **Folder:** `mog/file-io/xlsx/parser/src` (Rust crate `xlsx_parser`). ~838 `.rs` files, ~200k LOC.
- **Public entry points (the production contract this plan must respect):**
  - `lib.rs:269` `parse_xlsx_to_output(&[u8]) -> Result<(domain_types::ParseOutput, domain_types::ParseDiagnostics), String>` — the canonical import path.
  - `lib.rs:279` `parse_xlsx_to_output_max_sheets(..)` — metadata-only beyond N sheets.
  - `write::from_parse_output::write_xlsx_from_parse_output(&ParseOutput) -> Result<Vec<u8>, _>` (`write/from_parse_output/mod.rs:218`) and `…_with_report` (`mod.rs:2072`) — the export side of the roundtrip.
  - `parse_xlsx_full_native` / `…_max_sheets` (`lib.rs:100-101`) — crate-private-ish native path used by binaries/tests.
- **In scope (by top-level subdir, with measured LOC):**
  - `domain/` (~126k) — feature parsers/writers: `cells`, `strings`, `styles`, `themes`, `workbook`, `worksheet`, `tables`, `pivot`, `charts`, `drawings`, `comments`, `cond_format`, `validation`, `sparklines`, `slicers`, `names`, `hyperlinks`, `print`, `protection`, `external`, `controls`, `connections`, `rich_text`, `calc`, `vba`, `web_extensions`, `auto_filter`, `feature_property_bags`.
  - `write/` (~34k) — `from_parse_output/*`, `package_graph/*`, `package_ownership.rs`, `relationships/*`, `sheet/*`, `pivot_writer/*`, `drawing_writer_helpers/*`, `xml_writer/*`, `zip_writer.rs`.
  - `output/` (~18.6k) — `to_parse_output/*` (the `FullParseResult → ParseOutput` conversion, package-fidelity capture).
  - `infra/` (~10k) — `scanner`, `xml`, `error`, `opc`, `package_integrity`, `arena`, `xml_namespaces`, `imported_parts`.
  - `pipeline/` (~8.2k) — `full_parse/*`, `fast_parse`, `lazy/*`, `streaming/*`, `parallel`, `mmap`, `external_refs`, `import_extensions`.
  - `zip/` (~3k), `testing/` (~5.6k gate/contract harness), `bin/` (~3.5k: `roundtrip`, `xlsx_gate`, `crashtest`, `profile_*`, `generate_test_corpus`), `bridge/` (~170).
- **Out of scope (adjacent, referenced not edited):** the `domain_types` crate that owns `ParseOutput`/`ParseDiagnostics`/`SheetData` (the contract boundary); the WASM/JS bridge and `@mog-sdk/contracts` rendering layer (the known `charts.update({series})` → `seriesConfigToWire` projection-diagnostics serde bug lives there and in the contracts mapping, **not** in this Rust core — see Risks); `test-corpus/` fixtures.

## Current role of this folder in Mog

This crate is Mog's **entire XLSX import/export engine**. It is the only path by which `.xlsx` bytes become Mog's in-memory model (`domain_types::ParseOutput`) and the only path back out to `.xlsx` bytes. Everything downstream — the kernel document model, rendering, formula recalc — consumes `ParseOutput`; everything a user "saves as xlsx" flows through `write_xlsx_from_parse_output`.

Two design pillars shape the folder:

1. **Performance.** The crate states a target of "parse 500K cells in <50ms" (`lib.rs:10`). It ships multiple parse strategies behind one façade: `full_parse` (default, structured), `fast_parse` (SIMD/`memchr` cell scan), `lazy` (metadata-first, on-demand sheets), `streaming` (incremental deflate + cell parse), `parallel` (rayon per-sheet, feature-gated), and `mmap` (large files). The cell hot path (`domain/cells/parsing/fast.rs`) is written to be allocation-free.
2. **Roundtrip fidelity with explicit ownership.** The writer does not blindly re-emit imported XML. `write/package_ownership.rs` (2,002 lines) is a **policy registry** declaring, per OOXML part type, whether content must be modeled, diagnosed, or dropped. `output/to_parse_output/package_fidelity.rs` captures opaque/unmodeled parts and relationship provenance so the writer can replay them when (and only when) an "authority/currentness" fingerprint still matches. `write/from_parse_output/export_report.rs` emits structured diagnostics (e.g. `ChartSpaceReplaySuppressed`, `CalcIdCanonicalized`, `ChartSourceCacheOmitted`) describing every intentional deviation. `testing/` + `bin/xlsx_gate.rs` provide gate suites (perf gate, OOXML contract gate, package-graph validation, XML diff, fidelity) that police regressions.

The folder is therefore both a throughput-critical hot loop and a correctness-critical fidelity contract. Its main structural liability today is **scale concentrated in a few mega-modules** plus **silent lossy fallbacks** that are not all wired to the diagnostic channel.

## Improvement objectives

1. **Decompose the orchestration mega-functions** so the parse and export flows are reviewable and the two duplicated worksheet paths (parallel vs sequential) cannot drift:
   - `pipeline/full_parse/implementation.rs` (~2,066 lines) carries the entire phased parse including a near-duplicated parallel path (`~612-816`) and sequential path (`~819-846`, with the per-sheet body `~1533-2004`). The post-`sheetData` error-boundary scan and VML-drawing collection are copy-pasted across both.
   - `write/from_parse_output/mod.rs` (~2,139 lines) is a single function assigning relationship IDs for ~11 part families inline (hyperlinks, tables, pivots, comments, threaded comments, printer settings, header/footer VML, form controls, OLE, drawings, custom props).
2. **Make every lossy fallback observable.** There are 100+ `String::from_utf8_lossy` call sites (charts/axes ~13, drawings text/styling ~25+, vba ~5, pivot/preservation ~4) plus UTF-8-lossy conversions of whole part XML in the writer (`mod.rs:1771` form controls, `mod.rs:1802` OLE). Today these silently replace bytes with U+FFFD. Each must either be proven impossible by an upstream UTF-8 boundary check, or routed to `ParseDiagnostics`/`export_report` so data loss is never silent.
3. **Audit and harden `unwrap()`/`expect()`/`panic!` on the parse-from-untrusted-bytes path.** Treat malformed/adversarial `.xlsx` as the threat model (the crate already ships `bin/crashtest.rs` and fuzz-style limits in `zip/mod.rs`). **Calibration note:** a spot-check during planning found that several sites initially flagged by exploration (e.g. `write/from_parse_output/external_links.rs:379,383`, `domain/sparklines/read.rs:345-355`, `domain/slicers/read/cache.rs:342+`) are inside `#[cfg(test)]`/`#[test]` blocks, **not** production code. So this objective is an *audit with classification*, not a blanket rewrite: enumerate every non-test `unwrap/expect/panic/unreachable` reachable from `parse_xlsx_to_output`, classify each as (a) provably-infallible-with-comment, or (b) convert to `?`/recovery/diagnostic. Confirmed candidates to verify first: `pipeline/streaming/deflate.rs` (multiple `.unwrap()` on decompression), `pipeline/lazy.rs:133,142`, and the UTF-8 `.expect(...)` sites in `implementation.rs:1202,1606` and `domain/cells/full_convert.rs:52`.
4. **Complete the writer fidelity gaps that are flagged TODO in production code**, because they are silent geometry/formatting loss on export, not test gaps:
   - Gradient and pattern *line* fills are unimplemented in `domain/drawings/write/writer/styling.rs:544-547` and `domain/charts/write_canonical/shape_props.rs:245,248`.
5. **Decompose the largest domain files** that concentrate risk and block parallel work: `domain/charts/read/extraction/chart_space.rs` (2,189), `domain/themes/types.rs` (1,322), `domain/charts/read/extraction/series.rs` (1,147), `domain/charts/axes.rs` (1,113), `domain/pivot/write/types.rs` (997), `domain/drawings/parse/styling.rs` (980), `domain/themes/formats.rs` (971), `domain/pivot/package.rs` (941), `domain/strings/read.rs` (935), `domain/sparklines/read.rs` (932), `domain/protection/read.rs` (919), `domain/connections.rs` (885, standalone). Decomposition is structural only — no behavior change — and is the enabling step for objectives 2–4.
6. **Extract shared low-level primitives** that are independently re-implemented read-side and write-side, raising the chance of read/write asymmetry bugs: OOXML color parsing/serialization (themes, charts, drawings, styles), XML element traversal predicates (pivot `parse/` vs `reader/`, drawings, charts), and formula-reference adjustment (`domain/cells/helpers`). Asymmetric color/transform handling between `domain/drawings/parse/styling.rs` and `domain/drawings/write/writer/styling.rs` is the highest-value target.
7. **Reduce parameter-explosion and clone pressure on the export path** without changing output bytes: `write/from_parse_output/zip_assembly.rs::write_zip_package` carries 15+ params behind `#[allow(clippy::too_many_arguments)]`; `mod.rs` has ~99 `.clone()` and `zip_assembly.rs` ~44, many cloning whole structs into the relationship graph. Introduce a borrowing context struct / builder.

## Production-path contracts and invariants to preserve or strengthen

**Must preserve (byte- and API-level):**

- The public signatures and names re-exported from `lib.rs` (the `parse_xlsx_to_output*`, `write_xlsx_from_parse_output*`, all `domain::*` and `output::results::*` re-exports, `zip::{XlsxArchive,…}`, the `CT_*` content-type constants). Downstream crates import these by name.
- **Roundtrip determinism.** `lib.rs` already encodes two regression invariants that must continue to hold and be extended, not weakened: charts survive export→reimport→export with stable count (`test_chart_double_round_trip`) and **canonical chart XML is byte-identical on the second export** (`chart_xml_stabilizes_after_reimport_export`). Any decomposition must keep canonical-XML output byte-stable.
- **The package-ownership policy semantics.** `write/package_ownership.rs` decisions (model / diagnose / drop for pivots, form controls, printer settings, external links, OLE) are behavioral contracts. Refactors may reorganize the registry but must not change which parts are dropped vs preserved, nor silence an existing `export_report` diagnostic.
- **Authority/currentness fidelity logic** in `write/from_parse_output/chart_replay.rs` (`should_reconstruct_chart_space`, schema-version / relationship-closure / invalidated-owner checks) and the calc-state diagnostics in `export_report.rs` (`CalcIdCanonicalized`, `ConsumerRecalcRequired`, `FormulaRecalcIntentPreserved`).
- **`package_graph/validation.rs` invariants:** modeled parts carry required content types; relationship owner/target kinds are validated; opaque parts cannot leave orphaned references. Strengthen (add assertions) rather than relax.
- **Safety limits** in `zip/mod.rs` (`MAX_WORKSHEET_CELLS = 20M`, `MAX_SHARED_STRINGS = 5M`, `MAX_UNCOMPRESSED_SIZE = 256MB`, `MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE = 1GB`) and their enforcement via `ensure_count_limit`. These are anti-DoS guards on untrusted input — keep enforced on every path including streaming/lazy/parallel.
- **The crate-level typed-boundary guardrail** (`lib.rs:1-4`, `#![warn(clippy::string_slice)]`): any new `&str[n..]` slice needs an `#[allow(clippy::string_slice)]` with an ASCII-boundary justification per repo `AGENTS.md`. Refactors must not introduce unjustified slices.

**To strengthen:**

- Lossy conversions become **diagnosable**: introduce/extend a `ParseDiagnostics` variant (read side) and an `export_report` variant (write side) for "non-UTF-8 bytes encountered in part X, replaced." Default behavior unchanged for valid files; loss is now reported.
- Parse-path `unwrap/expect` either gain a proof comment or become recoverable errors flowing through the existing `ErrorCollector`/`ParseMode` model (`infra/error/*`).

## Concrete implementation plan

Sequenced so structural decomposition (low risk, behavior-preserving) lands before behavior touches.

**Phase A — Establish the safety net (no production edits).**
1. Inventory the verification surface: enumerate gate suites exposed by `bin/xlsx_gate.rs` (`--list`, `--suites`, `--plan`, `--schedule`) and the perf/OOXML-contract/package-graph/XML-diff/fidelity gates in `testing/`. Record the exact commands and the `test-corpus/parity/*` fixtures (e.g. `charts/chart-bar.xlsx`) that anchor roundtrip stability. These become the regression oracle for every later phase.
2. Produce a definitive, file:line classification of all non-test `unwrap/expect/panic/unreachable/from_utf8_lossy` reachable from the two public entry points (objective 2 & 3 evidence base). Mark each test-only vs production.

**Phase B — Decompose orchestration mega-functions (behavior-preserving).**
3. `pipeline/full_parse/implementation.rs`: extract the shared per-worksheet processing (cell buffer sizing + retry-on-overflow at `~1226-1242`/`~1626-1642`, post-`sheetData` error-boundary scan at `~1266`/`~1671`, VML-drawing collection at `~702-722`/`~1849-1868`) into one helper consumed by both the parallel and sequential drivers, eliminating the duplication. Keep the parallel gating condition (`!profiling && feature="parallel"`) and per-sheet timing instrumentation intact.
4. `write/from_parse_output/mod.rs`: split the per-part-family relationship-ID assignment blocks into `assign_*_relationships` helpers (one per family already delimited by the inline comments), each taking a borrowed export context. The global counter allocation (`~268-292`) becomes one explicit `RelIdCounters` struct.

**Phase C — Make loss observable + complete flagged gaps.**
5. Wire the writer UTF-8-lossy sites (`mod.rs:1771,1802`) and the highest-traffic reader sites (charts/axes, drawings text) to diagnostics per objective 2; where an upstream archive-boundary UTF-8 check already guarantees validity, replace `from_utf8_lossy` with a checked decode + proof comment instead.
6. Implement gradient and pattern *line* fills in `domain/drawings/write/writer/styling.rs:544-547` and `domain/charts/write_canonical/shape_props.rs:245,248`, reusing the existing solid-line/fill serialization helpers and the read-side parse structures so the roundtrip is symmetric.

**Phase D — Decompose large domain files + extract shared primitives.**
7. Split the >900-line files (objective 5) along the seams already implied by their content (e.g. `chart_space.rs` by chart-type extraction vs shared frame/series wiring; `themes/types.rs` by colors/fonts/formats/effects). Pure module moves; public re-exports preserved.
8. Extract the shared color parse/serialize primitive and the XML-traversal predicates (objective 6), migrating drawings parse/write first (the asymmetry risk), then themes/charts/styles. Each migration is gated on the fidelity + XML-diff gates passing unchanged.

**Phase E — Export ergonomics.**
9. Replace `write_zip_package`'s 15+ positional params with a borrowing `ZipPackageContext<'a>`; remove the `#[allow(too_many_arguments)]`. Convert struct-cloning into the relationship graph to borrows where lifetimes permit; measure clone reduction.

## Tests and verification gates

> Per task constraints this plan does **not** run any build/test/clippy/cargo command. The following are the gates a future implementer must pass; they are the acceptance criteria.

- **Roundtrip determinism (blocking):** `lib.rs` tests `test_chart_double_round_trip` and `chart_xml_stabilizes_after_reimport_export` must stay green; extend the byte-stability assertion to styles, pivots, and drawings canonical XML before/after Phase D.
- **Gate suites (blocking):** all `bin/xlsx_gate.rs` suites — local-smoke, ci-golden, autonomous-full — must pass: perf gate (must not regress the 500K-cells/<50ms budget; run after Phase B and E since those touch the hot path / clone pressure), OOXML contract gate, `validate_package_graph_bytes`, XML-diff fidelity gate.
- **Corpus parity:** parse→write→parse over `test-corpus/parity/*` must show no new `ParseDiagnostics`/`export_report` entries for files that previously roundtripped cleanly. Phase C is allowed to *add* diagnostics only for files that were silently lossy before.
- **Malformed-input safety:** `bin/crashtest.rs` and the existing `public_parse_rejects_*` tests must continue to return `Err`, never panic. Phase A's audit results feed new negative tests for any production `unwrap` converted to a recoverable error.
- **Lint guardrails:** crate compiles with the existing `#![warn(clippy::string_slice)]` and the documented `#![allow(...)]` set unchanged; no new unjustified `allow`.
- **Diff discipline:** Phases B and D must be provably behavior-preserving — the XML-diff gate output is byte-identical before/after. Only Phases C and E may legitimately change output bytes (line fills) or diagnostics.

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- **Canonical-XML byte drift.** The single biggest risk: any reordering during decomposition that perturbs attribute/element emission order breaks `chart_xml_stabilizes_after_reimport_export` and downstream diffs. Mitigation: Phases B/D are pure moves; gate on XML-diff byte-equality.
- **Parallel/sequential divergence.** Unifying the two worksheet paths (Phase B) risks subtly changing error-boundary behavior. Mitigation: extract first as a literal common helper called by both, change nothing else.
- **Hot-path regression.** Touching `implementation.rs` buffer sizing or adding diagnostic checks in `domain/cells` could regress the perf budget. Mitigation: run the perf gate; keep the fast path allocation-free; route diagnostics outside the inner cell loop.
- **Over-eager `unwrap` removal.** Spot-checks proved several flagged sites are test code; mechanically rewriting them is churn. Mitigation: Phase A classification is mandatory before any Phase C edit.
- **Lossy→diagnostic could be noisy.** If a common valid-file pattern trips a new diagnostic, it degrades signal. Mitigation: only emit when a byte was actually replaced (U+FFFD path taken), never on the happy path.

**Non-goals (explicitly excluded, per "no reduced scope / no shims / no workarounds"):**
- Not adding new XLSX features or new OOXML part support beyond completing the two flagged line-fill TODOs.
- Not changing the `domain_types::ParseOutput` contract (owned by an adjacent crate — see below).
- Not "fixing" read-only features (`calc`, `hyperlinks`, `names`, `vba`, `web_extensions` have no `write.rs`) by adding writers; that is a separate feature decision, not a code-health fix, and these are intentionally import-only today.
- Not the WASM/JS bridge chart-series serde bug. Per project memory, `charts.update({series})` dropping the array and `seriesConfigToWire` emitting a non-`Option` `projectionDiagnostics: undefined` that breaks wasm serde **lives in the bridge/contracts layer; the Rust core here is fine.** Out of scope for this folder; flagged only so the implementer does not chase it here.

## Parallelization notes and dependencies on other folders

- **Internal parallelism (after Phase A lands):** Phase B-parse (`pipeline`), Phase B-write (`write/from_parse_output`), and Phase D domain-file splits are largely independent and can be worked by separate agents per subsystem (charts, themes, drawings, pivot) once the gate harness is the shared oracle. The shared-primitive extraction (objective 6) is the one cross-cutting workstream and should land its trait/module before the per-feature migrations fan out.
- **Ordering constraint:** Phase A (gates + audit) must complete first; Phase C/E (behavior/byte changes) must come after the Phase B/D structural moves so diffs stay attributable.
- **Cross-folder dependency:** `domain_types` (the `ParseOutput`/`ParseDiagnostics`/`SheetData` definitions) is the contract boundary. Objective 2 (new diagnostic variants) may require an additive change there — coordinate with the `domain_types` owners; keep it additive (new enum variants) so consumers are unaffected. No other folder needs to change for Phases B, D, E.
- **Consumers to notify:** kernel/document model and the WASM bridge consume `ParseOutput` and the export bytes; if any new `export_report`/`ParseDiagnostics` variant becomes user-surfaced, the bridge must learn to forward it — but that is additive and non-breaking.
