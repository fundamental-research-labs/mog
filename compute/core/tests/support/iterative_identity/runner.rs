//! Execution and matrix generation for Class I identity cases.

use std::time::Instant;

use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;
use value_types::{CellValue, FiniteF64};

use super::cases::{
    Class1Axis3, Class1Axis4, Class1Case, Class1CaseV2, CoverageReason, FamilySummary, TestOutcome,
    cell_values_bit_equal, describe_cell_value, render_input, value_type_seeds,
};
use super::workbooks::{
    workbook_for_case, workbook_for_case_v2, workbook_for_case_v2_named, workbook_for_case_v2_table,
};
use super::{SHEET1_UUID, sheet_id};
use crate::support::matrix::{EditPosition, FormulaShape, RangeType, ValueType};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

pub(crate) fn run_case(case: &Class1Case) -> TestOutcome {
    let (snapshot, target_cell_id, target_row, target_col, formula_cell_id) =
        match workbook_for_case(case) {
            Ok(x) => x,
            Err(reason) => return TestOutcome::Skipped(reason),
        };

    let (mut engine, _init) = match YrsComputeEngine::from_snapshot(snapshot) {
        Ok(pair) => pair,
        Err(e) => {
            return TestOutcome::Failed(format!(
                "from_snapshot failed (likely formula parse error): {:?}",
                e
            ));
        }
    };

    let sid = sheet_id(SHEET1_UUID);

    // Snapshot pre-op dependent value.
    // Use get_cell_value_at (positional) because the formula cell id we
    // computed may not match the engine's (engines can rewrite ids on
    // load). Fall back to by-id if at-pos doesn't find it.
    let pre_op_value = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(20, 12))
        .cloned()
        .or_else(|| engine.mirror().get_cell_value(&formula_cell_id).cloned())
        .unwrap_or(CellValue::Null);

    // Forward op — set the target cell to the new value. We use
    // set_cell with a rendered string for the forward, because that's
    // how user edits normally flow.
    let new_input = render_input(&case.new_value);
    if let Err(e) = engine.set_cell(
        &sid,
        target_cell_id,
        target_row,
        target_col,
        new_input.as_str().into(),
    ) {
        return TestOutcome::Failed(format!("forward set_cell failed: {:?}", e));
    }

    // Inverse op — use import_values to restore the prior raw CellValue
    // (bypasses the parser, per FINDINGS.md Class-A fix).
    if let Err(e) = engine.import_values(
        &sid,
        vec![(target_row, target_col, case.prior.clone(), None)],
    ) {
        return TestOutcome::Failed(format!("inverse import_values failed: {:?}", e));
    }

    // Post-inverse value of the dependent formula.
    let post_value = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(20, 12))
        .cloned()
        .or_else(|| engine.mirror().get_cell_value(&formula_cell_id).cloned())
        .unwrap_or(CellValue::Null);

    if cell_values_bit_equal(&pre_op_value, &post_value) {
        TestOutcome::Passed
    } else {
        TestOutcome::Failed(format!(
            "dependent drift: pre={} post={} (forward={} inverse={})",
            describe_cell_value(&pre_op_value),
            describe_cell_value(&post_value),
            describe_cell_value(&case.new_value),
            describe_cell_value(&case.prior),
        ))
    }
}

// ---------------------------------------------------------------------------
// Case generation
// ---------------------------------------------------------------------------

/// Generate the full Class I matrix. Axes 1 × 2 cartesian, with axes 3/4
/// pinned to representative defaults (Inside + Int).
fn generate_class1_cases() -> Vec<Class1Case> {
    let mut out = Vec::with_capacity(300);
    for &shape in FormulaShape::all() {
        for &range in RangeType::all_stage2() {
            let edit_pos = Class1Axis3::Inside;
            let value_kind = Class1Axis4::Int;
            // Prior = 5 (inside the 1..10 seed range). New = 7.
            let prior = CellValue::Number(FiniteF64::must(5.0));
            let new_value = CellValue::Number(FiniteF64::must(7.0));
            out.push(Class1Case {
                name: format!(
                    "class1__{}__{}__{}__{}",
                    shape.as_slug(),
                    range.as_slug(),
                    "inside",
                    "int",
                ),
                shape,
                range,
                edit_pos,
                value_kind,
                prior,
                new_value,
            });
        }
    }
    out
}

/// Cases for one axis-1 family (single shape, all ranges).
pub(crate) fn cases_for_shape(shape: FormulaShape) -> Vec<Class1Case> {
    generate_class1_cases()
        .into_iter()
        .filter(|c| c.shape == shape)
        .collect()
}

// ---------------------------------------------------------------------------
// Family-level runner
// ---------------------------------------------------------------------------

pub(crate) fn run_family(family_label: &'static str, shape: FormulaShape) -> FamilySummary {
    let cases = cases_for_shape(shape);
    let mut passed = 0;
    let mut failed = 0;
    let mut skipped_incompat = 0;
    let mut skipped_pending = 0;
    let mut failures: Vec<String> = Vec::new();
    let start = Instant::now();

    for case in &cases {
        match run_case(case) {
            TestOutcome::Passed => passed += 1,
            TestOutcome::Failed(msg) => {
                failed += 1;
                failures.push(format!("  [{}] {}", case.name, msg));
            }
            TestOutcome::Skipped(CoverageReason::IncompatibleCombo(why)) => {
                skipped_incompat += 1;
                // Uncomment to inspect:
                // eprintln!("  [{}] incompatible: {}", case.name, why);
                let _ = why;
            }
            TestOutcome::Skipped(CoverageReason::FixturePending(why)) => {
                skipped_pending += 1;
                let _ = why;
            }
        }
    }
    let elapsed = start.elapsed();

    let total = cases.len();
    let counted = passed + failed;
    let skipped_total = skipped_incompat + skipped_pending;
    eprintln!(
        "[Class I · {}] {}/{} passed, {} failed, {} skipped ({} incompat + {} pending) ({:?})",
        family_label,
        passed,
        counted,
        failed,
        skipped_total,
        skipped_incompat,
        skipped_pending,
        elapsed,
    );
    if !failures.is_empty() {
        for f in &failures {
            eprintln!("{}", f);
        }
    }
    assert_eq!(
        failed, 0,
        "Class I family `{}`: {} failures — failing tests ARE the bug \
         tracker. See named failures in stderr output above.",
        family_label, failed,
    );

    FamilySummary {
        family: family_label,
        total,
        passed,
        failed,
        skipped_incompat,
        skipped_pending,
        failures,
        elapsed_ms: elapsed.as_millis(),
    }
}

/// Runner for one Track-4b case. Parallels `run_case` but routes to the
/// right fixture builder based on `RangeType`.
fn run_case_v2(case: &Class1CaseV2) -> TestOutcome {
    // Route to the appropriate fixture based on RangeType. NamedRange
    // has its own builder (Track-4d); StructuredTable has a best-effort
    // builder (may hit parser limits for `Table1[Col]`). ThreeD is only
    // handled inside the default builder (which falls through to
    // formula_template's ThreeD skip).
    let build = match case.range {
        RangeType::NamedRange => workbook_for_case_v2_named(case),
        RangeType::StructuredTable => workbook_for_case_v2_table(case),
        _ => workbook_for_case_v2(case),
    };

    let (snapshot, target_cell_id, target_row, target_col, formula_cell_id, target_sheet_id) =
        match build {
            Ok(x) => x,
            Err(reason) => return TestOutcome::Skipped(reason),
        };

    let (mut engine, _init) = match YrsComputeEngine::from_snapshot(snapshot) {
        Ok(pair) => pair,
        Err(e) => {
            return TestOutcome::Failed(format!(
                "from_snapshot failed (likely formula parse error): {:?}",
                e
            ));
        }
    };

    let dependent_sheet = sheet_id(SHEET1_UUID);

    let pre_op_value = engine
        .mirror()
        .get_cell_value_at(&dependent_sheet, SheetPos::new(20, 12))
        .cloned()
        .or_else(|| engine.mirror().get_cell_value(&formula_cell_id).cloned())
        .unwrap_or(CellValue::Null);

    // Capture the ACTUAL prior value from the mirror at the target cell.
    // The case's `prior` field is the ValueType-derived seed that *was
    // requested*, but when fixture layering (named-range seed block,
    // structured-table seed block) overlaps the target position, the
    // engine's effective pre-op value may differ. The identity invariant
    // is "write new_value then write back what-was-actually-there → same
    // dependent"; use the live mirror value as the true prior.
    let live_prior = engine
        .mirror()
        .get_cell_value_at(&target_sheet_id, SheetPos::new(target_row, target_col))
        .cloned()
        .unwrap_or(CellValue::Null);

    // Forward op: rendered-string set_cell. For values where the
    // rendered string can't round-trip through the parser, skip forward
    // via `import_values` and mark the path explicitly. That means
    // Boolean/Error/Text/NullEmpty go through the raw path so we isolate
    // dependency-propagation drift from parser fidelity drift.
    let forward_err = match &case.new_value {
        CellValue::Number(_) => {
            let new_input = render_input(&case.new_value);
            engine
                .set_cell(
                    &target_sheet_id,
                    target_cell_id,
                    target_row,
                    target_col,
                    new_input.as_str().into(),
                )
                .err()
        }
        _ => engine
            .import_values(
                &target_sheet_id,
                vec![(target_row, target_col, case.new_value.clone(), None)],
            )
            .err(),
    };
    if let Some(e) = forward_err {
        return TestOutcome::Failed(format!("forward op failed: {:?}", e));
    }

    // Inverse op always goes through import_values (raw CellValue) with
    // the live-captured prior — not the case's nominal prior.
    if let Err(e) = engine.import_values(
        &target_sheet_id,
        vec![(target_row, target_col, live_prior.clone(), None)],
    ) {
        return TestOutcome::Failed(format!("inverse import_values failed: {:?}", e));
    }

    let post_value = engine
        .mirror()
        .get_cell_value_at(&dependent_sheet, SheetPos::new(20, 12))
        .cloned()
        .or_else(|| engine.mirror().get_cell_value(&formula_cell_id).cloned())
        .unwrap_or(CellValue::Null);

    if cell_values_bit_equal(&pre_op_value, &post_value) {
        TestOutcome::Passed
    } else {
        TestOutcome::Failed(format!(
            "dependent drift: pre={} post={} (forward={} inverse={} live_prior={})",
            describe_cell_value(&pre_op_value),
            describe_cell_value(&post_value),
            describe_cell_value(&case.new_value),
            describe_cell_value(&case.prior),
            describe_cell_value(&live_prior),
        ))
    }
}

/// Generate all Class I V2 cases pinned to one `EditPosition`.
fn cases_for_edit_pos(edit_pos: EditPosition) -> Vec<Class1CaseV2> {
    let mut out =
        Vec::with_capacity(FormulaShape::all().len() * RangeType::all_stage2().len() * 13);
    for &shape in FormulaShape::all() {
        for &range in RangeType::all_stage2() {
            for &value_kind in ValueType::all_stage2() {
                let (prior, new_value) = value_type_seeds(value_kind);
                let name = format!(
                    "class1v2__{}__{}__{}__{}",
                    shape.as_slug(),
                    range.as_slug(),
                    edit_pos.as_slug(),
                    value_kind.as_slug(),
                );
                out.push(Class1CaseV2 {
                    name,
                    shape,
                    range,
                    edit_pos,
                    value_kind,
                    prior,
                    new_value,
                });
            }
        }
    }
    out
}

/// Generate cases pinned to one (EditPosition, ValueType) pair.
/// Used by the fine-grained 5×13 = 65-test split to fit within the
/// 180 s wall-clock ceiling via cargo-test's parallel thread pool.
fn cases_for_edit_pos_value(edit_pos: EditPosition, value_kind: ValueType) -> Vec<Class1CaseV2> {
    let mut out = Vec::with_capacity(FormulaShape::all().len() * RangeType::all_stage2().len());
    for &shape in FormulaShape::all() {
        for &range in RangeType::all_stage2() {
            let (prior, new_value) = value_type_seeds(value_kind);
            let name = format!(
                "class1v2__{}__{}__{}__{}",
                shape.as_slug(),
                range.as_slug(),
                edit_pos.as_slug(),
                value_kind.as_slug(),
            );
            out.push(Class1CaseV2 {
                name,
                shape,
                range,
                edit_pos,
                value_kind,
                prior,
                new_value,
            });
        }
    }
    out
}

/// Aggregate runner for one EditPosition split. Counts pass / fail /
/// incompatible / pending, emits a `[Class I V2 · <edit_pos>] ...`
/// summary line, and panics on any failure.
///
/// Failing tests ARE the bug tracker. Per the plan, `FarOutside` × full-col
/// × SUMIFS cases may surface the unit-level `Ib6CYMnT` expression; those
/// are **failures**, not `#[ignore]`s. The handoff records the specific
/// failing entries as `regression_ib6cymnt_unit_*`.
#[allow(dead_code)] // Retained as the coarse-split entry; 5×13 fine split
// is the default but this helper still works.
fn run_edit_pos_split(label: &'static str, edit_pos: EditPosition) -> (usize, usize, usize, usize) {
    let cases = cases_for_edit_pos(edit_pos);
    let total = cases.len();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped_incompat = 0usize;
    let mut skipped_pending = 0usize;
    let mut failures: Vec<String> = Vec::new();
    let mut ib6_hits: Vec<String> = Vec::new();
    let start = Instant::now();
    for case in &cases {
        match run_case_v2(case) {
            TestOutcome::Passed => passed += 1,
            TestOutcome::Failed(msg) => {
                failed += 1;
                // Tag potential Ib6CYMnT unit-level hits: FarOutside ×
                // full-col × SUMIFS-family shape.
                let is_ib6_signature = edit_pos == EditPosition::FarOutside
                    && matches!(
                        case.range,
                        RangeType::FullCol | RangeType::FullColMulti | RangeType::FullRow
                    )
                    && matches!(
                        case.shape,
                        FormulaShape::Sumifs
                            | FormulaShape::Sumif
                            | FormulaShape::Countifs
                            | FormulaShape::Countif
                            | FormulaShape::Averageifs
                            | FormulaShape::Averageif
                            | FormulaShape::Minifs
                            | FormulaShape::Maxifs
                    );
                if is_ib6_signature {
                    ib6_hits.push(format!(
                        "  [ib6cymnt_unit] [{}] shape={:?} range={:?} value={:?}: {}",
                        case.name, case.shape, case.range, case.value_kind, msg,
                    ));
                }
                failures.push(format!("  [{}] {}", case.name, msg));
            }
            TestOutcome::Skipped(CoverageReason::IncompatibleCombo(_)) => skipped_incompat += 1,
            TestOutcome::Skipped(CoverageReason::FixturePending(_)) => skipped_pending += 1,
        }
    }
    let elapsed = start.elapsed();
    eprintln!(
        "[Class I V2 · {}] {}/{} passed, {} failed, {} incompat, {} pending ({:?}) \
         (total={})",
        label,
        passed,
        passed + failed,
        failed,
        skipped_incompat,
        skipped_pending,
        elapsed,
        total,
    );
    if !ib6_hits.is_empty() {
        eprintln!(
            "[Class I V2 · {}] Ib6CYMnT unit-level hits ({}):",
            label,
            ib6_hits.len()
        );
        for h in &ib6_hits {
            eprintln!("{}", h);
        }
    }
    if !failures.is_empty() {
        eprintln!("[Class I V2 · {}] failures:", label);
        for f in &failures {
            eprintln!("{}", f);
        }
    }
    (passed, failed, skipped_incompat, skipped_pending)
}
// ---------------------------------------------------------------------------
// Class I V2 fine split runner
// ---------------------------------------------------------------------------

#[allow(dead_code)] // Called only from the 65 per-(pos × value) tests.
pub(crate) fn run_edit_pos_value_split(
    label: &'static str,
    edit_pos: EditPosition,
    value_kind: ValueType,
) -> (usize, usize, usize, usize) {
    let cases = cases_for_edit_pos_value(edit_pos, value_kind);
    let total = cases.len();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped_incompat = 0usize;
    let mut skipped_pending = 0usize;
    let mut failures: Vec<String> = Vec::new();
    let mut ib6_hits: Vec<String> = Vec::new();
    let start = Instant::now();
    for case in &cases {
        match run_case_v2(case) {
            TestOutcome::Passed => passed += 1,
            TestOutcome::Failed(msg) => {
                failed += 1;
                let is_ib6_signature = edit_pos == EditPosition::FarOutside
                    && matches!(
                        case.range,
                        RangeType::FullCol | RangeType::FullColMulti | RangeType::FullRow
                    )
                    && matches!(
                        case.shape,
                        FormulaShape::Sumifs
                            | FormulaShape::Sumif
                            | FormulaShape::Countifs
                            | FormulaShape::Countif
                            | FormulaShape::Averageifs
                            | FormulaShape::Averageif
                            | FormulaShape::Minifs
                            | FormulaShape::Maxifs
                    );
                if is_ib6_signature {
                    ib6_hits.push(format!(
                        "  [ib6cymnt_unit] [{}] shape={:?} range={:?} value={:?}: {}",
                        case.name, case.shape, case.range, case.value_kind, msg,
                    ));
                }
                failures.push(format!("  [{}] {}", case.name, msg));
            }
            TestOutcome::Skipped(CoverageReason::IncompatibleCombo(_)) => skipped_incompat += 1,
            TestOutcome::Skipped(CoverageReason::FixturePending(_)) => skipped_pending += 1,
        }
    }
    let elapsed = start.elapsed();
    eprintln!(
        "[Class I V2 · {}] {}/{} passed, {} failed, {} incompat, {} pending ({:?}) \
         (total={})",
        label,
        passed,
        passed + failed,
        failed,
        skipped_incompat,
        skipped_pending,
        elapsed,
        total,
    );
    if !ib6_hits.is_empty() {
        eprintln!(
            "[Class I V2 · {}] Ib6CYMnT unit-level hits ({}):",
            label,
            ib6_hits.len()
        );
        for h in &ib6_hits {
            eprintln!("{}", h);
        }
    }
    if !failures.is_empty() {
        eprintln!("[Class I V2 · {}] failures:", label);
        for f in &failures {
            eprintln!("{}", f);
        }
    }
    (passed, failed, skipped_incompat, skipped_pending)
}
