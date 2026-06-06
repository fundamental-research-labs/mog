Rating: 7/10

Summary judgment

This is a strong, production-aware plan with unusually good source-folder orientation. It correctly identifies the public import/export entry points, the roundtrip fidelity contract, the hot-path parser constraints, the large orchestration modules, and several real TODOs and lossy conversion sites. The plan is directionally right for this folder: it treats XLSX as untrusted input, preserves canonical output stability, and recognizes that package ownership and diagnostic surfacing are core contracts rather than implementation details.

The rating is held back because the plan is more of a high-level work program than an implementation-ready contract. Several phases say what category of work should happen but not the exact acceptance shape, fixture set, public diagnostic schema, or migration boundary. It also overstates parts of the verification surface and includes at least one candidate risk that current source suggests is test-only rather than production-reachable.

Major strengths

- The scope is accurate and grounded: the crate has 838 Rust files, `pipeline/full_parse/implementation.rs` is 2,065 lines, `write/from_parse_output/mod.rs` is 2,139 lines, and the listed large files match current line counts.
- The plan anchors on the correct production APIs: `parse_xlsx_to_output`, `parse_xlsx_to_output_max_sheets`, `parse_xlsx_full_native*`, and `write_xlsx_from_parse_output*`.
- The architectural diagnosis is good. The duplicated worksheet processing between the parallel pre-decompress path and sequential path is real, as are the inline relationship-ID assignment blocks in the export path.
- It correctly treats package graph ownership, chart replay/currentness, calc-state diagnostics, safety limits, and canonical chart XML stability as contracts to preserve.
- The sequencing mostly makes sense: inventory/audit first, behavior-preserving decomposition before diagnostic or byte-output changes, and performance checks after touching hot paths.
- The plan avoids a blanket "remove all unwraps" rewrite and explicitly calls for production/test classification, which is the right posture for this codebase.

Major gaps or risks

- Verification is over-specified in a way that may be impossible to execute as written. `xlsx_gate.rs` implements OOXML contract, package graph, and perf gates, but corpus gates are currently contract entries that return blocked/not implemented from the binary path. The plan says "all `bin/xlsx_gate.rs` suites" must pass without distinguishing implemented, blocked, heavy, and suite-readiness gates.
- The diagnostic contract for lossy UTF-8 is not specified deeply enough. It says to add/extend `ParseDiagnostics` and `export_report`, but does not define the enum variants, stable IDs, severity/recoverability, part/relationship reference fields, deduping behavior, or how diagnostics should remain additive across the `domain_types` boundary.
- "Make every lossy fallback observable" is correct but broad. The plan identifies many `from_utf8_lossy` sites, but does not categorize which are validated XML-name conversions, opaque XML preservation, generated writer bytes, tracing/logging, tests, or genuinely lossy semantic data. Without that classification, Phase C could become noisy churn.
- One named audit candidate appears miscalibrated: the `pipeline/streaming/deflate.rs` unwraps found in the current file are inside `#[cfg(test)]`; the production decompressor path returns typed `ZipError`s. The plan does say to verify candidates first, but listing this as a confirmed first target weakens confidence.
- Phase D is too open-ended. "Split the >900-line files along seams" is not a verifiable contract and some domains are already decomposed into parse/read/convert/write submodules. The plan should name exact module moves and public re-export preservation checks for each file.
- Phase E's clone-reduction goal lacks a performance contract. It says to measure clone reduction, but not which hot-path benchmark, budget, allocation metric, or output-byte equality assertion determines success.
- The plan may require changes in `mog/domain-types`, but the review item is scoped to `mog/file-io/xlsx/parser/src`. It notes the cross-folder dependency, but does not sequence who owns the additive contract change or what happens if the diagnostic enum cannot be extended in the same workstream.

Contract and verification assessment

The contract awareness is the plan's strongest feature. It names byte determinism, package ownership, chart replay authority/currentness, package graph validation, ZIP safety limits, and `clippy::string_slice` guardrails. These are the right invariants for this folder.

The verification section needs tightening. It should separate mandatory local gates from aspirational or currently blocked gates. Based on the current command surface, an implementation-ready plan should call out at minimum `cargo test -p xlsx-parser` or targeted `xlsx-parser` tests, `cargo clippy -p xlsx-parser`, `cargo test -p xlsx-parser ooxml_contract`, implemented `xlsx-gate` commands for package graph/perf where inputs exist, and explicit XML byte-diff/canonical XML assertions for any structural move. It should also specify fixture paths and expected before/after diagnostics for lossy UTF-8 and line-fill roundtrips.

Concrete changes that would raise the rating

- Replace "all gate suites pass" with a runnable gate matrix: implemented gates, blocked gates, heavy gates requiring opt-in, required inputs, and exact commands.
- Add a Phase A output artifact contract: a table of every `from_utf8_lossy` and `unwrap/expect/panic/unreachable` site with file:line, test/production classification, public-entry reachability, chosen action, and required test.
- Define the new diagnostic schema before implementation: import/export diagnostic codes, severity, semantic impact, reference fields, deterministic ID strategy, and compatibility expectations for `domain_types` consumers.
- Add concrete fixture coverage for the two line-fill TODOs: gradient line fill and pattern line fill import -> export -> reimport tests for drawings and canonical charts, with expected XML facts.
- Make Phase D mechanical and bounded by naming each file split, new module names, preserved re-exports, and the exact byte-equality checks proving no behavior drift.
- Correct the streaming-deflate audit note to say the current unwrap hits are test-only unless a new production-reachable unwrap is found.
- Add measurable acceptance criteria for clone/parameter cleanup: unchanged bytes on a representative corpus plus a named perf/allocation benchmark that must not regress.
