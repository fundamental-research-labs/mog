// ===========================================================================
// Adversarial scenario audit — three-group disposition.
// ===========================================================================
//
// The adversarial scenarios resolve to three dispositions under the current
// security model:
//
// -------------------------------------------------------------------
// Group A — Intentionally non-applicable (architecture decision is
//           the test; no code assertion required).
// -------------------------------------------------------------------
//
//   - `bypass-via-error-inference` — dependent-cell error propagation
//     is an intended computed result. ARCHITECTURE.md §4.1 (Structure
//     preserves formula metadata). Same class as scenario 2 below.
//
//   - `bypass-via-sort-ordering` — sort is a write-scope mutation
//     (`sort_range` is `#[bridge::write(scope = "range")]`).
//     Attenuation blocks the write on denied cells; no read surface to
//     bypass. See write tests at `adversarial_*`.
//
//   - `bypass-via-named-range` / `bypass-via-structured-ref` — both
//     compile to cell refs at formula-eval time; share the cell-read
//     redact path tested by `sg2_structure_redacts_cell_values` +
//     `adversarial_formula_result_redacts_under_structure`.
//
//   - `bypass-via-clipboard` — payload derives from already-filtered cell
//     reads. If the cell read path is correct, the clipboard is too.
//
//   - `bypass-via-getUsedRange-bounds` — bounds are shape metadata,
//     not cell value data. `coverage_audit::CELL_DATA_RETURN_FRAGMENTS`
//     does not flag `(u32, u32)`; the architecture classification IS
//     the record.
//
//   - `bypass-via-selection-aggregates` — UI-layer concept; aggregates
//     are computed in the UI over already-redacted cells read through
//     the gated `get_cell_value` path. No engine-side aggregation
//     surface exists.
//
// -------------------------------------------------------------------
// Group B — Covered by an explicit R10 test or by `coverage_audit`.
// -------------------------------------------------------------------
//
//   - `bypass-via-formula-result` ->
//     `adversarial_formula_result_redacts_under_structure` (R10.2).
//
//   - `bypass-via-dependent-cell` ->
//     `adversarial_formula_inherits_cell_access`.
//
//   - `bypass-via-conditional-format` ->
//     `adversarial_conditional_format_read_under_none_redacts`
//     (R10.3).
//
//   - `bypass-via-chart-data` ->
//     `adversarial_chart_read_under_none_redacts` (R10.3) +
//     `coverage_audit::every_bridge_api_method_returning_cell_data_is_gated`.
//
//   - `bypass-via-pivot-aggregate` ->
//     `adversarial_pivot_read_under_none_redacts` (R10.3). Stored
//     config locked down; aggregate compute-path leak is a documented
//     known limitation (same class as `bypass-via-dependent-cell`).
//
//   - `bypass-via-autofilter-unique` ->
//     `adversarial_autofilter_unique_values_redact_under_structure`
//     (R10.3). Current test locks the passthrough behavior; a macro
//     tightening for sheet-scope Vec reads would flip the assertion.
//     See BYPASS-AUDIT.md "gaps discovered".
//
//   - `bypass-via-undo-reveal` ->
//     `adversarial_undo_does_not_reveal_redacted_cell` (R10.5). The
//     previous rationale (covered by `composition_policy_change_*`)
//     is withdrawn — that test exercises policy-version swap, not
//     undo.
//
//   - `bypass-via-hyperlink-read` ->
//     `adversarial_hyperlink_redacts_under_none` (R10.4).
//
//   - `bypass-via-comment-read` (dual surface) ->
//     `adversarial_comment_redacts_under_none_position_form` +
//     `adversarial_comment_redacts_under_none_id_form` (R10.4).
//     Both tests are required: a mis-scope regression on only ONE of
//     the two surfaces would ship silently without the pair.
//
//   - `bypass-via-batch-mixed` -> `enforcement_*` range-filter wiring
//     tests earlier in this file exercise mixed-column `filter_range_values`.
//
// -------------------------------------------------------------------
// Group C — No exposure surface yet.
// -------------------------------------------------------------------
//
//   - `bypass-via-validation-list` — no `data_validation`-family
//     bridged read exists today. Candidate method names when a
//     surface is added: `get_data_validations` /
//     `get_data_validation_for_cell`. Revisit then.
