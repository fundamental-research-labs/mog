Rating: 8/10

Summary judgment

This is a strong, source-grounded plan. It correctly treats `domain-types/src/domain/drawings` as the persistent drawing contract layer between XLSX import, Yrs storage, generated bridge data, UI projections, and XLSX export. The plan identifies a concrete production-path loss: `DrawingData.ooxml` is populated by import and consumed by export, and generated TS exposes it, but the current Yrs drawing codec does not write or read it.

The rating is below 9 because the plan is very broad and does not draw crisp enough acceptance boundaries around the hardest cross-package pieces. The urgent Yrs sidecar fix, serde/default cleanup, bridge typing, `ooxml-types` widening, parser fixtures, and UI projection cleanup are all valid, but the current sequencing risks becoming a mega-project instead of a set of independently shippable contracts.

Major strengths

- Evidence-based scope: the plan cites the relevant drawings modules plus adjacent floating-object, Yrs, parser/writer, and bridge paths.
- Production-path relevance is high: it focuses on import -> domain -> Yrs -> bridge -> export, not isolated unit behavior.
- The architectural direction is sound: `domain-types` stays the shared source of truth, `ooxml-types` owns canonical OOXML vocabulary, `xlsx-parser` owns XML/package relationships, and UI-facing projections remain explicit lossy views.
- The plan follows the "solve once" expectation by proposing an inventory and converter matrix instead of one-off fixes.
- It names important fidelity cases: content parts, non-chart graphic frames, chart-frame exclusion, group children, VML form controls, OLE `objectPr`, rich text, fills, effects, and relationship-bearing raw XML.
- The parallelization notes have sensible package boundaries and would allow independent agents to work without introducing dependency direction problems.

Major gaps or risks

- The first deliverable should be a vertical slice for the known production bug: write/read `DrawingData.ooxml` in Yrs, update `known_fields("drawing")`, preserve legacy `data`, and prove content-part and non-chart graphic-frame round trips. The plan currently places that inside a much larger preservation program.
- The contract inventory is underspecified. It should define the exact file, row schema, ownership, and fail mode, including whether tests fail when a new public drawing export lacks an inventory row.
- The serde migration story is not concrete enough. Adding camelCase/default-skip behavior to sidecars such as group shapes can change persisted wire names, so the plan needs explicit compatibility reads for existing snake_case fields and old Yrs/JSON payloads.
- The bridge typing goal may be overambitious as written. Generated TS still exposes several canonical OOXML payloads as `unknown` (`shape`, `groupShape`, `objectPr`, `vmlShape`, `relationships`, `contentPart`). The plan should say which fields must become typed and which may remain opaque leaves because they wrap `ooxml-types`.
- Step 4 touches `file-io/ooxml/types`, but the verification gates do not include `cargo test -p ooxml-types` or `cargo clippy -p ooxml-types`.
- Raw XML safety is identified but not fully contracted. The plan should specify relationship-id extraction, remapping, external relationship policy, missing-target diagnostics, and replay normalization expectations.
- Sequencing is slightly inverted: broad inventory work is valuable, but the data-loss fix should land first or in parallel with narrow acceptance tests.

Contract and verification assessment

The contract language is one of the plan's strongest parts. It clearly states that lossless OOXML sidecars are not UI-only hints, that UI projections must not become the persisted source for export-only details, that lossy converters must be named as projections, and that serde names/defaults are bridge-visible contracts.

The proposed verification gates are directionally right: Rust package tests/clippy, parser/writer round trips, generated bridge drift checks, kernel mapper tests, TypeScript typecheck, and UI verification when projections change. The best gate is the production round trip that imports real drawing objects, persists through Yrs, exports, and reparses while asserting typed fields and package relationships. That should be a mandatory acceptance criterion for the first phase, not just part of a broad final fixture suite.

The converter parity and serde/default matrix would materially improve confidence, but only if the inventory is mechanically auditable. A static list of expected types can drift; the plan should require a test that detects new public drawing exports or new converter implementations without coverage.

Concrete changes that would raise the rating

- Split the plan into explicit phases: Yrs `DrawingData.ooxml` persistence; serde/default compatibility; bridge typing/drift; `ooxml-types` preservation gaps; production XLSX fixture expansion.
- Define the inventory test format and require a fail-fast check for newly exported drawing types missing classification.
- Add a wire-compatibility section for serde changes, including legacy snake_case reads and migration behavior for persisted Yrs objects.
- Name the exact bridge generation and drift-check commands, and add `cargo test -p ooxml-types` plus `cargo clippy -p ooxml-types` when OOXML type widening is in scope.
- Turn the raw XML/relationship policy into concrete assertions for `r:id` extraction, relationship remapping, external links, missing targets, duplicate IDs, and diagnostics.
- Clarify which generated TypeScript fields are expected to become strongly typed and which are intentionally opaque because they represent canonical OOXML payloads.
- Add a "done means" checklist for the first production bug so it can ship independently before effect DAG and custom geometry work.
