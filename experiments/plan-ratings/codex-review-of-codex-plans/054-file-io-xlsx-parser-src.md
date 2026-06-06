Rating: 8/10

Summary judgment

This is a strong architectural plan for `file-io/xlsx/parser/src`. It correctly treats the folder as Mog's production XLSX import/export/roundtrip boundary rather than a narrow parser, and many of its core claims are supported by the source: `lib.rs` still publicly reexports `parse_xlsx_full_native` and `FullParseResult` despite comments about crate-private status, `xlsx-api` rejects most parse options because the parser does not enforce them, `xlsx_gate` still returns not-implemented reports for corpus gates, `FullParseResult` carries many skipped/raw/package sidecars, and package ownership is split across OPC inventory, package graph, ownership, and integrity modules.

The plan earns a high rating because it names the right contracts: typed current owners over raw replay, explicit sidecar policy, a single package graph, production-path corpus and anti-cheat gates, and import/export performance measured on `parse_xlsx_to_output` and `write_xlsx_from_parse_output`. It stops short of a 9 or 10 because it is still more of a broad architecture program than a fully executable specification. Several lanes need machine-readable schemas, sharper acceptance criteria, and smaller phase boundaries before parallel agents could implement them without diverging.

Major strengths

- The production path is explicit and correct: XLSX bytes to `FullParseResult`, conversion to `domain_types::ParseOutput`, compute hydration, current-state export, package validation, and re-import.
- The plan identifies real source contradictions and gaps, especially the accidental public full-parse facade, unsupported public parse options, corpus gate stubs, parser-only sidecars, and fragmented OPC/package graph ownership.
- The architectural direction is sound: every imported package fact must become typed current state, safe inert provenance, or a diagnostic; package fidelity is provenance rather than export authority; active and malformed content fail closed.
- The verification emphasis is appropriate for this area. It requires parser tests, API tests, package graph validation, corpus gates, re-import checks, and performance gates on production import/export rather than generated-only or benchmark-only paths.
- The sequencing and parallelization notes are directionally useful. They recognize that stage contracts, sidecar policy, feature matrix, and package graph ownership need to land before broad writer/currentness changes.
- Security and edge-case coverage is unusually complete for XLSX: Strict vs Transitional, MCE, external targets, active content, VBA, digital signatures, ZIP safety, calcChain, pivots, threaded comments, rich data, and non-editable sheets are all called out.

Major gaps or risks

- The scope is extremely large. Thirteen implementation sections cover what should likely be several independently ratable plans. The dependency list helps, but each lane still needs a phase definition, exit criteria, and a small production-path proof before the next lane starts.
- The staged pipeline contract names good stages, but it does not define exact Rust structs, ownership/borrowing rules, diagnostic shapes, or behavior-preservation tests for splitting the current 2k-line `pipeline/full_parse/implementation.rs`. That leaves too much room for incompatible stage abstractions.
- The domain feature matrix is specified as a concept, not as an initial generated inventory. To be executable, it needs a schema and a complete first row set derived from `domain/*`, `output/results/*`, `output/to_parse_output/*`, `write/from_parse_output/*`, relationship types, content types, and `ParseOutput` fields.
- The sidecar policy proposal is correct but underspecified mechanically. The current markdown audit and context-removal test exist; the plan should say whether coverage is enforced by a declarative Rust table, macro, compile-time field inventory, snapshot, or explicit test helper that fails when `FullParseResult` or `FullParsedSheet` fields change.
- Parse option enforcement needs a sharper public contract. The plan lists options, but not the exact `xlsx-parser` API shape, how `profiled` timings are returned, how `ParseMode` maps to recoverable diagnostics, or how partial imports are marked in `ParseOutput` and `ImportReport`.
- Package graph unification is architecturally right but risky without a migration seam. Existing relationship managers, content-type managers, package graph builder, OPC inventory, and package integrity validation can coexist accidentally unless the plan defines which modules become authoritative and which become adapters or disappear.
- Verification gates are comprehensive but not sliced by implementation phase. Requiring corpus gates that the plan itself implements is fine for final rollout, but early refactor lanes need narrower required gates and explicit temporary checks.
- Performance goals list useful metrics but no concrete budgets, corpus manifests, fixture classes, or regression thresholds. That makes "preserve and improve production performance" hard to verify objectively.

Contract and verification assessment

The contract language is the strongest part of the plan. The invariants around position-keyed `ParseOutput`, no parser-owned durable identity, no calcChain export, shared strings derived from current cells, relationship/content-type validation, owner-scoped package fidelity, and active-content policy are exactly the kind of rules this folder needs.

The main missing piece is turning those rules into normative artifacts. The plan should require checked schemas for `pipeline/contract.rs`, sidecar policy rows, domain feature matrix rows, package graph ownership rows, export-report diagnostics, and corpus fact comparison. Without those artifacts, the plan depends too much on prose interpretation by many agents.

The verification section uses the right production path and includes the right adjacent crates. It would be stronger if it separated per-slice gates from final rollout gates, named the corpus manifests and fact budgets, included clippy coverage for feature combinations that matter, and specified exact anti-cheat assertions for context-stripped export versus normal import/export.

Concrete changes that would raise the rating

- Split the plan into milestone contracts: facade/API boundary, behavior-preserving stage split, parser option enforcement, sidecar policy coverage, feature matrix inventory, package graph authority, writer preflight/currentness, corpus gates, and performance rollout.
- Add concrete Rust schema sketches for the stage contexts, sidecar policy table, feature matrix table, package graph ownership model, and export diagnostics/report types.
- Define an executable sidecar coverage mechanism that fails when a new `FullParseResult` or `FullParsedSheet` field lacks a policy row.
- Seed the feature matrix with a generated inventory from the current source tree instead of leaving "every feature" as prose.
- Specify the exact `XlsxParseOptions` API and how it lowers from `xlsx-api::ParseOptions`, including mode semantics, partial-output diagnostics, and profiling output.
- Add per-phase verification gates and reserve the full corpus/perf gate suite for final integration.
- Name initial corpus manifests, anti-cheat fact comparisons, diagnostic budgets, and performance thresholds so success is measurable.
- Add a compatibility plan for public full-parse reexports: deprecation, feature gating, test/tooling migration, and any downstream breakage policy.
