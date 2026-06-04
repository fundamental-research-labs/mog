Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly identifies `compute-formats` as the canonical Rust display formatter, maps the main source files, names the important production callers, and catches the key architectural problem: storage input parsing still duplicates date, time, formatted-number, fraction, currency, and policy logic outside the crate. The plan is also well aligned with Mog's preference for systematic contracts over isolated fixes.

The rating is not higher because the plan is so broad that several workstreams remain under-specified. It calls for a "complete typed Excel format IR", new parse APIs, storage migration, bridge stability, locale completion, special formats, and production performance caching, but does not define exact public API shapes, acceptance fixtures, compatibility boundaries, or phase exit criteria tightly enough for independent workers to compose without re-litigating contracts.

Major strengths

- The source-folder description is accurate: the crate has a public facade in `api.rs`/`lib.rs`, token parsing in `parser.rs`/`types.rs`, string-based detection in `detection.rs`, renderers in `number.rs`/`datetime.rs`/`fraction.rs`, input helpers, constants, and locale data.
- The plan correctly identifies existing production paths: `YrsComputeEngine::format_value_at_cell` calls `compute_formats::format_value`, viewport batch formatting calls `format_values_batch`, and formula wrappers such as `TEXT`, `DOLLAR`, and `FIXED` delegate into this crate.
- The plan's central architectural objective is right: category parsing and user input parsing should become one production contract rather than a mixture of `compute-formats`, storage-local parsing, `value_types` parsing, and bridge helpers.
- The contract and invariant section is unusually useful. It covers section selection, color metadata, text sections, serial-date boundaries, General precision, batch equality, locale fallback, bridge DTO stability, and date1904 ownership.
- The verification gates include both crate-local checks and production-path compute-core checks, which is essential for a formatting engine that is consumed by storage, formulas, viewport rendering, and bridges.
- The parallelization notes are credible after the initial contract matrix: parser/detection, numeric rendering, date/time/input, storage migration, integration tests, and performance can be separated with clear dependency direction.

Major gaps or risks

- The typed IR is specified as a capability list rather than an API contract. The plan should define the target section/part structures, public vs private boundaries, condition representation, unsupported-token representation, and what must remain serializable across WASM/N-API/PyO3/TS.
- The proposed new input parsing APIs are not concrete enough. "Policy outputs" are mentioned, but the plan does not name the result enum/struct, parse options, preservation categories, date1904 responsibilities, or how storage's existing `AutomaticConversionPolicy` maps into the crate.
- The plan underplays `TEXT`'s current text coercion path. `compute-functions` currently attempts text-to-number/date/datetime/time coercion through `value_types` before calling `compute_formats`; that needs an explicit migration or non-goal, not just general formula coverage.
- The scope is very large for one plan. It combines parser IR replacement, all category rendering, locale audit, storage parser deletion, public bridge contract stability, special formats, and performance caching. The ordering is plausible, but it needs sharper phase boundaries and "do not proceed until" gates.
- Excel parity is asserted without naming an oracle. The contract matrix should specify whether expected outputs come from Excel fixtures, existing Mog behavior, OOXML docs, or deliberate product choices, especially for malformed custom formats, serial 0/60, locale-specific currency/accounting, and ambiguous input like `1/2/24`.
- Special formats are too vague. The plan says to implement ZIP, phone, and SSN if detection-only behavior exists, but does not define whether this crate should own those renderers, how parsing should work, or whether locale-specific special formats are in scope.
- Performance guidance is directionally correct but lacks measurable thresholds. It says to measure production display/autofit/range paths and add caching if needed, but does not define cache ownership, invalidation, maximum size, hit-rate expectations, or acceptable regression budgets.

Contract and verification assessment

The plan's contract coverage is high-level but mostly correct. It names the right canonical APIs (`format_value`, `format_values_batch`, `format_number_result`, `detect_format_type`, date input helpers), the right downstream consumers, and the right invariants. It also correctly treats date1904 as caller/workbook policy rather than raw serial rendering.

Verification is good but incomplete. `cargo test -p compute-formats`, `cargo clippy -p compute-formats`, `cargo test -p compute-core --test formula_accuracy_text_format`, storage parsing tests, and full `cargo test -p compute-core` are appropriate. However, the plan should add exact bridge-generation or bridge-contract commands once DTOs are touched, exact storage parser test names or filters, explicit compute-functions tests for `TEXT` coercion and `NUMBERVALUE`, and at least one production-path test that types values through the storage input path and reads display text through `format_value_at_cell`.

Concrete changes that would raise the rating

- Add a first deliverable that writes the contract matrix with concrete fixtures, provenance, and expected outputs before any implementation. Include built-in IDs, presets, builder outputs, malformed custom formats, locale variants, input parsing cases, and production-path assertions.
- Specify the target IR and parse API shapes in the plan, including field names, enum variants, public/private exposure, serialization expectations, and migration constraints for bridge DTOs.
- Split the plan into explicit phases with acceptance gates: parser/detection contract, renderer parity, input parse API, storage migration, formula/bridge integration, locale audit, then production performance.
- Define exactly how storage's `AutomaticConversionPolicy` and preservation categories move into or depend on `compute-formats`, including which decisions stay workbook-context-owned.
- Add dedicated handling for formula text coercion, especially `TEXT` on text that looks like a date/time/number, so it does not remain a second parser contract.
- Replace broad performance language with concrete production benchmarks, cache bounds, cache key/invalidation rules, and pass/fail thresholds.
- Clarify special format scope and acceptance tests for ZIP, phone, SSN, and any intentionally unsupported special formats.
