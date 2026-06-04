Rating: 8/10

Summary judgment

This is a high-quality plan with the right architectural instinct: it treats `compute-cf` as a pure rule engine, explicitly pulls in the scheduler/cache/bridge/render production path, and aims to turn broad existing unit coverage into durable public contracts. It correctly identifies the main sources of future drift: flat wire rules versus typed Rust rules, formula handling split across compute-core and `compute-cf`, visual result serialization, and handwritten TypeScript bridge types that lag Rust serde shapes.

The rating is not higher because the plan is stronger as a roadmap than as an executable specification. The hardest changes, especially diagnostics for invalid rules and source-of-truth generation for bridge types, are described directionally but do not define the exact contract shape, caller behavior, migration sequence, or acceptance tests. For a package whose bottleneck is clear contracts, those details need to be pinned down before parallel agents start editing.

Major strengths

- Correctly preserves the package boundary: `compute-cf` remains deterministic and storage/formula/clock/range materialization stay in compute-core.
- Accurately calls out production-path dependencies, including `compute/core/src/scheduler/cf_eval.rs`, stored/domain conversion through `storage/engine/cf_cache`, public contract types, bridge declarations, and render conversion.
- The rule contract matrix idea is exactly the right center of gravity. Enumerating every public/domain rule type, Rust `CFRuleKind`, accepted OOXML alias, validation requirement, default, and dispatch behavior would prevent another round of ad hoc conditional-format fixes.
- The plan focuses on full categories rather than one-off bugs: cell-value coercion, text operators, blanks/errors, date periods, top/bottom, above-average, duplicate detection, visual algorithms, and range statistics.
- It identifies a real production issue: direct bridge/delegation conversion still silently drops invalid `CFRuleWire` values via `filter_map(...ok())`.
- Verification is mostly production-path aware. It explicitly rejects relying only on `compute-cf` unit tests when scheduler, cache, bridge, render, or public API contracts change.
- Parallelization notes are useful and split along natural ownership boundaries: Rust conversion/types, rule semantics, visual/stats/evaluator, scheduler/cache, TypeScript bridge, and import/export fixtures.

Major gaps or risks

- The diagnostics objective is underspecified. The plan says to introduce valid rules plus diagnostics, typed errors, or a parallel diagnostics channel, but it does not choose a canonical response type, diagnostic schema, severity model, source identifiers, propagation path, or backward-compatibility behavior for existing callers that currently expect only `CellCFResult[]`.
- The silent-drop inventory is incomplete. In addition to the named `compute_sheets_named.rs` path, there is also `compute/core/src/storage/engine/services/delegations/compute_reachthrough.rs` using `filter_map(|w| CFRule::try_from(w).ok())`. `cf_cache` no longer uses `filter_map`, but it still logs and drops conversion failures rather than returning typed diagnostics.
- The bridge generation/source-of-truth plan is directionally right but not precise enough. Rust `CFRuleWire` already uses `CfValue`, while `kernel/src/bridges/compute/types.ts` still describes `values?: string[]`, color/icon threshold values as `string`, and omits newer data-bar/custom-icon fields. The plan should name the exact generated file(s), codegen command, and drift assertion that make this impossible to regress.
- The plan asks for a very large test expansion without defining priority order or landing checkpoints. Agents could spend a long time adding low-value edge tests before settling the core contracts for diagnostics, wire operands, and render units.
- Several acceptance criteria are qualitative. For example, "Excel-shaped semantics" and "known expected outputs" should be converted into concrete fixtures/tables with exact expected values, especially for date serial 60, percentile interpolation, top/bottom ties, icon thresholds, and formula error truthiness.
- The import/export fixture section names broad fixture classes but not the actual import/export pipeline, parser location, fixture format, or whether the assertion should run through stored domain formats, compute cache refresh, binary viewport conversion, or all of them.
- The plan does not explicitly require testing malformed custom icon indexes, `NoIcons`/`Custom` sentinel threshold behavior, or handwritten/public `gte` versus Rust `operator` conversion in the API-to-wire boundary, even though these are likely drift points.
- Large-range production tests are called out, but the plan does not set a performance guardrail or fixture size that proves the sparse path and normal path agree without creating slow CI tests.

Contract and verification assessment

The plan has strong contract intent but needs sharper contract artifacts. The proposed rule matrix should be the first deliverable and should include exact columns for public type, accepted bridge aliases, required wire fields, defaults, Rust `CFRuleKind`, validation error, style/visual category, render result fields, and representative match/non-match outcomes. Without that matrix being explicit, the later work can still become a set of broad but disconnected tests.

The verification gates are mostly appropriate: `cargo test -p compute-cf`, `cargo clippy -p compute-cf`, targeted compute-core scheduler/cache tests, `cargo test -p compute-core` or a production-path filter, TypeScript typecheck/codegen readiness, render serialization tests, and kernel/public API tests when those surfaces change. The main gap is that any implementation touching compute-core Rust should also run `cargo clippy -p compute-core`, not only compute-core tests. The TypeScript gate also needs the exact repo command for generated bridge/readiness drift rather than a descriptive placeholder.

The plan is properly production-path focused. It avoids moving formula evaluation into `compute-cf`, calls out `ComputeCore::eval_cf`, CF cache refresh, render/cache output, and real public/domain conversion. It also correctly notes that `evaluate_rules` is only safe when all rules share one stats object, while the scheduler uses per-rule stats.

Concrete changes that would raise the rating

- Add a concrete diagnostics contract before implementation: Rust structs/enums, JSON shape if exposed over a bridge, source rule id/index fields, error codes mapped from `CFRuleValidationError`, behavior for invalid formulas, and how existing `CellCFResult[]` callers receive or ignore diagnostics.
- Expand the production-path conversion inventory to include `storage/engine/services/delegations/compute_reachthrough.rs`, the existing warning-and-drop behavior in `storage/engine/cf_cache/convert.rs`, and any generated/WASM eval-CF bridge entrypoint that accepts `CFRuleWire`.
- Make the rule contract matrix schema explicit and commit to landing it first, even if some rows initially mark gaps as expected failures or TODO assertions.
- Name the exact bridge/codegen/typecheck commands and files that must stay aligned, especially `kernel/src/bridges/compute/types.ts`, generated compute-wire types, public `contracts/src/data/conditional-format.ts`, and render cache/binary viewport conversion.
- Add clippy for every Rust crate touched, specifically `cargo clippy -p compute-core` when scheduler/cache/delegation code changes.
- Define a staged sequence: contract matrix and diagnostics shape first, then Rust conversion/evaluator coverage, then scheduler/cache wiring, then TS/codegen/render alignment, then import/export parity fixtures.
- Turn the most ambiguous Excel semantics into exact fixture tables with expected outputs and cited owner decisions where Mog intentionally diverges.
