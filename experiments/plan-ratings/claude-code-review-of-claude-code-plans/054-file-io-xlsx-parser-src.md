Rating: 9/10

# Review of Plan 054 — Harden and decompose the XLSX parser/writer/roundtrip core

## Summary judgment

This is an unusually strong, evidence-grounded plan. It treats `mog/file-io/xlsx/parser/src` for what it is — the single production path between `.xlsx` bytes and Mog's in-memory model — and frames every change around two real, in-tension properties of that path: a throughput-critical hot loop and a correctness-critical roundtrip-fidelity contract. The plan is a *program of work* sequenced into phases, not a single PR, and it is honest about that. Nearly every concrete claim I spot-checked against the source is accurate to the file and line, which is rare and is the main reason for the high rating.

Verified against the tree (838 `.rs` files, ~126k LOC in `domain/` alone):
- Public entry points exist exactly as described: `parse_xlsx_to_output`, `parse_xlsx_to_output_max_sheets`, and the crate-private native re-exports in `lib.rs`.
- `pipeline/full_parse/implementation.rs` = 2065 lines; `write/from_parse_output/mod.rs` = 2139 lines; `write/package_ownership.rs` = 2002 lines — all match the plan's figures.
- The "500K cells in <50ms" target and the `#![warn(clippy::string_slice)]` guardrail comment are present at the top of `lib.rs`.
- Safety limits in `zip/mod.rs` match exactly (`MAX_WORKSHEET_CELLS = 20M`, `MAX_SHARED_STRINGS = 5M`, `MAX_UNCOMPRESSED_SIZE = 256MB`, `MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE = 1GB`).
- The four flagged line-fill TODOs are real: `LineFill::Gradient`/`LineFill::Pattern` are empty `// TODO` arms in both `domain/drawings/write/writer/styling.rs:543-548` and `domain/charts/write_canonical/shape_props.rs:244-249`.
- The writer UTF-8-lossy sites at `mod.rs:1771` (form controls) and `mod.rs:1802` (OLE) are real `String::from_utf8_lossy(...).to_string()` calls; lossy call sites across the crate number ~162 occurrences across ~48 files (plan said "100+").
- Roundtrip determinism tests `test_chart_double_round_trip` (lib.rs:348) and `chart_xml_stabilizes_after_reimport_export` (lib.rs:383) exist as named.
- The large-file list is accurate and *discriminates test files from production files* correctly (e.g. it lists `chart_space.rs` 2189, `themes/types.rs` 1322, `series.rs` 1147, `axes.rs` 1113 — all production — and does not list `charts/tests.rs` 1672 or `slicers/write/tests.rs` 1370 as decomposition targets).
- `bin/xlsx_gate.rs` really does expose `--list/--suites/--plan/--schedule` and the `local-smoke / ci-golden / autonomous-full` suite tiers.
- `write_zip_package` in `zip_assembly.rs:15` is indeed guarded by `#[allow(clippy::too_many_arguments)]`.

That density of verifiable, correct detail is the plan's defining strength.

## Major strengths

- **Production-path framing is correct and explicit.** It names the contract boundary (`domain_types::ParseOutput/ParseDiagnostics/SheetData`), correctly places it in an adjacent crate that is out of scope, and even correctly excludes the known `charts.update({series})` / `seriesConfigToWire` serde bug as living in the bridge/contracts layer, not this Rust core — matching project memory. It refuses to chase that bug here, which is the right call.
- **Risk-ordered sequencing.** Structural, behavior-preserving moves (Phases B/D) land before any byte- or diagnostic-changing work (Phases C/E), so diffs stay attributable and the XML-diff gate can prove the moves are inert. This is exactly the discipline a fidelity-critical writer needs.
- **The verification section is a real acceptance contract**, not boilerplate: it ties each phase to the specific gate that polices it (perf gate after B/E because they touch the hot path/clone pressure; XML-diff byte-equality for B/D; corpus parity allowing *new* diagnostics only for files that were silently lossy before). The "only emit a diagnostic when a U+FFFD byte was actually substituted" rule is the right way to avoid degrading signal.
- **Honest calibration.** The plan explicitly warns that exploration over-flagged `unwrap` sites that turned out to be `#[cfg(test)]`, and makes Phase A classification mandatory before any Phase C edit. Self-awareness about its own evidence quality is a maturity signal most plans lack.
- **Contracts to preserve are specific and behavioral**, not vague: package-ownership model/diagnose/drop semantics, authority/currentness replay logic in `chart_replay.rs`, the `package_graph/validation.rs` invariants (strengthen, don't relax), and the string-slice guardrail.

## Major gaps or risks

- **The "Confirmed candidates to verify first" list contains a misclassification, despite the calibration note warning about exactly this.** The plan names `pipeline/streaming/deflate.rs` ("multiple `.unwrap()` on decompression") as a confirmed production candidate. In the actual file every `.unwrap()` sits below `#[cfg(test)]` (line 286 onward); the production `fn new` and chunk path carry none. So the word "Confirmed" is too strong for at least one item on a list meant to be the trustworthy seed for Phase A. By contrast `lazy.rs:133,142` *are* production unwraps but are the provably-infallible `contains_key` → `get().unwrap()` pattern (Phase A would correctly classify them as (a), not convert them). Net: the audit's seed list needs the same Phase-A scrubbing the plan prescribes for everything else — it is not pre-validated.
- **Scope is enormous and under-bounded for a single plan.** ~200k LOC, 7 objectives spanning decomposition, observability, safety audit, two feature completions, primitive extraction, and ergonomics. The phasing makes it *workable*, but there is no effort sizing, no "minimum shippable slice," and no statement of which phase is the actual deliverable if time is constrained. A reader cannot tell whether this is one quarter or three.
- **Objectives 5 and 7 are the weakest value-per-risk.** Decomposing 900+ line files and cutting `.clone()` counts are code-health, not user- or correctness-facing, yet they carry the single highest risk the plan itself names (canonical-XML byte drift). The plan mitigates with the XML-diff gate, but it never argues *why* these are worth doing now versus deferring — they read as "large file = must split," which is a weaker justification than the rest of the plan earns.
- **Diagnostic-channel design is asserted, not specified.** Objective 2 depends on adding `ParseDiagnostics`/`export_report` variants, and the plan correctly flags that the read-side variant requires an additive change in the out-of-scope `domain_types` crate. But it does not sketch the variant shape (what fields identify "part X", how a U+FFFD substitution is detected without re-scanning in the hot path) or confirm with the `domain_types` owners that an additive enum is acceptable. That cross-crate coordination is on the critical path for Phase C yet is left as "coordinate with owners."
- **Perf-gate budget is treated as binary.** "Must not regress 500K cells/<50ms" — but adding UTF-8 validity checks and diagnostic routing on read paths (objective 2) inherently adds work. The plan says "route diagnostics outside the inner cell loop," which is the right instinct, but gives no margin/threshold (e.g. acceptable % regression) and no baseline-capture step in Phase A. If the gate is a hard equality, Phase C may be unshippable for reasons the plan hasn't reckoned with.

## Contract and verification assessment

The contract section is the best part of the plan. It distinguishes byte-level invariants (canonical chart XML stability), API invariants (re-exported signatures), and policy invariants (package ownership, authority/currentness) — and verification maps cleanly onto each. The "strengthen, don't relax" stance on `package_graph/validation.rs` is the correct direction.

Two soft spots: (1) the plan extends byte-stability assertions to "styles, pivots, and drawings canonical XML" but doesn't confirm those canonicalizers *are* deterministic today (only charts are proven by an existing test) — extending the assertion could surface pre-existing nondeterminism that the plan would then own without budget for it; (2) verification is entirely gate-driven with no statement of what the implementer does when a gate *legitimately* must change (Phase C/E), e.g. golden-file update procedure and review sign-off. "The XML-diff output is byte-identical" is stated as the bar for B/D, but C/E need an explicit "expected diff, here's how we bless it" path.

## Concrete changes that would raise the rating

1. **Re-validate the Phase-A seed list before publishing it.** Drop `deflate.rs` from "confirmed production candidates" (it's all `#[cfg(test)]`), and re-classify `lazy.rs:133,142` as provably-infallible examples rather than conversion targets. Better: present the seed list as "to classify," not "confirmed," so it doesn't contradict the calibration note.
2. **Add effort sizing and a minimum-shippable slice.** State which phase is the standalone deliverable (Phase A + B is a credible first PR: pure decomposition + the audit artifact) and roughly how large each phase is, so the plan can be scheduled rather than read as an open-ended program.
3. **Specify the diagnostic variants concretely** — field shape, the part-identifier scheme, and how U+FFFD substitution is detected cheaply — and add an explicit Phase-A task to confirm the additive `domain_types` enum change with its owners *before* Phase C starts.
4. **Capture a perf baseline in Phase A and state an allowed regression margin** for the 500K-cells gate, so objective 2's added checks have a defined budget instead of an implicit "zero regression" that may be unmeetable.
5. **Justify or defer objectives 5 and 7.** Either tie each large-file split / clone reduction to a downstream objective it unblocks (the plan already gestures at this for objective 5 → "enabling step for 2-4" but not file-by-file), or explicitly mark them as optional/last so the byte-drift risk isn't taken on for pure tidiness.
6. **Add a golden-update procedure for Phases C/E** — how an intentional byte/diagnostic change is reviewed and blessed — so the gate discipline that makes B/D safe also covers the phases that legitimately change output.
