Rating: 8/10

Summary judgment

This is a strong plan. It is grounded in the actual production path, identifies real correctness defects in `compute-fill`, and avoids unnecessary architecture churn. The core diagnosis matches the source: `LinearTrend` and `GrowthTrend` are forced to fixed constants in `engine_policy.rs`, backward numeric/date series ignore the direction-aware anchor helper, `step_value` uses `1.0` as both value and sentinel, `detected_pattern` reports only the first lane, and non-finite generated numbers degrade to `#VALUE!` without a warning. The sequencing is mostly right: fix the in-crate value correctness first, then handle wire/reporting changes with explicit gates.

The rating is held below 9 because the plan under-specifies the cross-stack contract work needed for `stepValue`, new warning kinds, and a possible `Mixed` pattern. It also leaves the trend representation choice open instead of making it a crisp implementation contract, and its verification list is too Rust-heavy for changes that would touch public TypeScript contracts, generated bridge types, app handlers, and the Fill Series dialog.

Major strengths

- The source map is accurate and useful. It names the core modules, the pure `compute_fill` entry point, lane planning, target enumeration, emitter behavior, pattern detection, series generation, and formula adjustment boundaries.
- The plan correctly treats this as production-path behavior. `compute_fill` is called by the storage mutation handler, which turns `FillResult` into storage edits and exposes `FillResultSummary.pattern_type` and `warnings`.
- The objectives are systematic rather than whack-a-mole. They cover the whole trend category, both backward directions, the explicit-step contract class, heterogeneous lane reporting, and non-finite value reporting.
- The tests proposed for trend magnitudes, backward anchoring, explicit step `1.0`, heterogeneous lanes, overflow warnings, and corrected existing assertions are behavior-focused and would catch the bugs the plan describes.
- The plan respects the existing architecture: pure inference core, caller-owned mutation/storage, stable update ordering, detector priority, hidden/merge exclusions, and formula adjustment semantics.

Major gaps or risks

- The `step_value` contract change is broader than the plan spells out. Rust bridge types, generated compute TypeScript types, public contracts, kernel worksheet operations, worksheet autofill tests, app fill handlers, the Fill Series dialog, and API snapshots currently model `stepValue` as a required number or always send `1`. The plan mentions the TS bridge side, but it should enumerate these call sites and decide whether `stepValue` becomes optional, nullable, or is replaced by a separate `stepOverride`.
- The trend representation is not fully specified. The plan says to pick between reusing `step`/`multiplier` and adding trend-specific patterns, then says "prefer (b)". For implementation, this should be settled up front, including the exact `FillPattern` fields or enum variants, serde names, summary behavior, and generated TS contract shape.
- Degenerate trend behavior needs sharper contracts. Single-value `LinearTrend`, single-value `GrowthTrend`, non-positive growth inputs, all-equal sources, zero multipliers, and backwards growth should each have a defined value/warning/fallback behavior. The current plan gestures at these cases but leaves some outcomes open.
- New `FillPatternType::Mixed` and `FillWarningKind::SeriesValueOverflow` are not just additive Rust changes. Public TS unions and app warning mapping must be updated. The current app warning mapper has hardcoded handling for merged cells, formula refs, and source-empty warnings; a new warning would otherwise be displayed incorrectly.
- The non-finite warning path needs a concrete data-flow shape. Since current series generation returns only `CellValue`, the emitter cannot distinguish a generated overflow `#VALUE!` from an intentional/source error unless the series layer returns typed metadata or a richer generated-value struct.
- Flash Fill is correctly marked evidence-gated, but it still dilutes the plan. If it remains in scope, it needs concrete pass/fail contracts; otherwise it should be explicitly split into a separate audit plan.

Contract and verification assessment

The Rust-side contracts are mostly clear: keep `compute_fill` pure, preserve sorted updates, preserve hidden/source/merge exclusions, keep formula adjustment semantics stable, and do not disturb detector priority. The plan also correctly calls out that `types.rs` and `engine_types/fill.rs` are IPC/wire contracts.

The weak spot is public contract clarity. For `stepValue`, the plan should define the exact JSON compatibility story: absent field, `null`, numeric `1`, numeric `0`, and older payloads. For `Mixed` and overflow warnings, it should define serialized discriminants and public TS mappings before implementation. For trend behavior, it should define source ordering, x-indexing, floating-point tolerance, and result rounding expectations with examples.

The verification gates are good for the Rust crate but incomplete for the proposed cross-boundary changes. `cargo test -p compute-fill`, `cargo clippy -p compute-fill`, `cargo test -p compute-core auto_fill`, and the bridge generation test are appropriate. If `stepValue`, warning kinds, generated bridge types, contracts, or app handlers change, the plan should also require the relevant TypeScript package tests plus `pnpm typecheck`; if the Fill Series dialog changes, it should include a browser/UI exercise or focused app test through the real UI path.

Concrete changes that would raise the rating

- Make a firm trend contract: exact pattern representation, fields, serde names, x-index rules for forward/backward fills, and defined outcomes for single-value and invalid growth cases.
- Expand Phase 0 into a reference behavior matrix with exact expected outputs for linear trend, growth trend, explicit step `1.0`, backward numeric/date/time/growth, non-collinear regression, and overflow.
- Enumerate every cross-folder `stepValue` consumer and generated artifact that must change, including public contracts, generated compute bridge types, kernel worksheet operations/tests, spreadsheet handlers/dialog, and API snapshots.
- Specify the new warning and mixed-pattern public contract, including serialized names and TypeScript/app warning display behavior.
- Replace the vague non-finite warning proposal with a concrete return type or metadata path from series generation through lane plans into `emit_target`.
- Add TypeScript verification gates and UI-path validation for any public contract or dialog changes.
- Split Flash Fill into a separate evidence-gated plan unless concrete failures are found during Phase 0.
