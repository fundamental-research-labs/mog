use crate::fullcol::fullcol_workbook;
use crate::helpers::*;
use crate::matrix::{AggregatorShape, EditPosition as V2EditPos, Extent, ValueType as V2ValueType};
use compute_core::storage::engine::YrsComputeEngine;
use value_types::{CellValue, FiniteF64};

/// Map a `ValueType` to an f64 new-value for the forward op.
///
/// Class II only varies the forward op's value; the inverse restores
/// the live prior (which may itself be Null when the target is outside
/// the initial extent). The returned CellValue is used as `new_value`.
pub(crate) fn v2_new_value(v: V2ValueType) -> CellValue {
    use std::sync::Arc;
    match v {
        V2ValueType::Int => CellValue::Number(FiniteF64::must(85.0)),
        V2ValueType::LargeInt => CellValue::Number(FiniteF64::must(1_000_000_007.0)),
        V2ValueType::FloatClean => CellValue::Number(FiniteF64::must(0.25)),
        V2ValueType::FloatCascade => CellValue::Number(FiniteF64::must(0.2)),
        V2ValueType::Bool => CellValue::Boolean(true),
        V2ValueType::Text => CellValue::Text(Arc::from("beta")),
        V2ValueType::TextShort => CellValue::Text(Arc::from("xyz")),
        V2ValueType::TextLong => CellValue::Text(Arc::from("y".repeat(256))),
        V2ValueType::LeadingApostrophe => CellValue::Text(Arc::from("'flipped")),
        V2ValueType::WhitespaceOnly => CellValue::Text(Arc::from("     ")),
        V2ValueType::NullEmpty => CellValue::Null,
        V2ValueType::Error => CellValue::Error(value_types::CellError::Na, None),
        V2ValueType::DateSerial => CellValue::Number(FiniteF64::must(45_001.0)),
        V2ValueType::TimeSerial => CellValue::Number(FiniteF64::must(0.25)),
    }
}

/// Compute the target cell (row, col) for a given `EditPosition`.
/// Class II's fullcol target is column H (col=7). The edit positions map:
/// - Inside: row 0 (inside A1Only / the initial seed).
/// - OutsideNearby: row 100 (past seed but not extreme).
/// - FarOutside: row 39_187 (Ib6CYMnT hypothesis).
/// - Boundary: row 49_999 (the A50k seed's last populated row).
/// - OtherSheet: handled by switching the target sheet to Dest (not SourceData).
pub(crate) fn v2_target_for(pos: V2EditPos) -> (u32, u32) {
    match pos {
        V2EditPos::Inside => (0, 7),
        V2EditPos::OutsideNearby => (100, 7),
        V2EditPos::FarOutside => (39_187, 7),
        V2EditPos::Boundary => (49_999, 7),
        V2EditPos::OtherSheet => (0, 7),
    }
}

/// Run a single Class II V2 fullcol case.
pub(crate) fn run_fullcol_case_v2(
    shape: AggregatorShape,
    extent: Extent,
    edit_pos: V2EditPos,
    value_kind: V2ValueType,
) -> Result<(), String> {
    let snapshot = fullcol_workbook(shape, extent);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot)
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;

    let source = sheet_id(0);
    let dest = sheet_id(1);
    let dependent = cell_id(1, 0, 0);
    let (target_row, target_col) = v2_target_for(edit_pos);

    // For OtherSheet, target Dest!B1 (which is NOT in the SourceData!H:H
    // range the dependent reads; the edit should not affect the dependent).
    let (target_sheet, target_sheet_idx, target_col) = match edit_pos {
        V2EditPos::OtherSheet => (&dest, 1, 1u32),
        _ => (&source, 0, target_col),
    };
    let target = cell_id(target_sheet_idx, target_row, target_col);

    // Pre-op dependent value.
    let before = read_value(&engine, &dependent);

    // Seed the criterion key for SUMIFS/COUNTIFS/VLOOKUP so the edit
    // would have an effect (when in-range). The seed lives in col A on
    // SourceData. Only seed for same-sheet-as-source edits; the
    // OtherSheet edit targets Dest and doesn't need this.
    //
    // Skip seeding when the target_row's A cell is already part of the
    // snapshot seed (A1Only / A50k / GrewThenShrank / ExpandedMidPath
    // extents have A1 / A49_999 populated). Seeding-then-unseeding would
    // clobber pre-existing state and cause a false dependent drift (the
    // inverse writes Null to A where the extent expected a value).
    let extent_has_key_at_row = match (extent, target_row) {
        (Extent::A1Only, 0) => true,
        (Extent::GrewThenShrank, 0) => true,
        (Extent::ExpandedMidPath, 0) => true,
        (Extent::A50k, 49_999) => true,
        _ => false,
    };
    let mut seeded_key = false;
    if edit_pos != V2EditPos::OtherSheet
        && !extent_has_key_at_row
        && matches!(
            shape,
            AggregatorShape::Sumifs | AggregatorShape::Countifs | AggregatorShape::Vlookup
        )
    {
        engine
            .import_values(
                &source,
                vec![(target_row, 0, CellValue::Number(FiniteF64::must(1.0)), None)],
            )
            .map_err(|e| format!("seed key err: {:?}", e))?;
        seeded_key = true;
    }

    let before_with_key = read_value(&engine, &dependent);

    // Capture the live prior value at the target before the forward op.
    let live_prior = engine
        .mirror()
        .get_cell_value(&target)
        .cloned()
        .unwrap_or(CellValue::Null);

    // Forward op. For numeric types go through set_cell (input-parser
    // path); for non-numeric go through import_values to isolate
    // dependency-tracking drift from parser fidelity drift.
    let new_value = v2_new_value(value_kind);
    let forward_err = match &new_value {
        CellValue::Number(_) => {
            let n = match &new_value {
                CellValue::Number(f) => f.get(),
                _ => unreachable!(),
            };
            let s = if n.fract() == 0.0 && n.abs() < 1e16 {
                format!("{}", n as i64)
            } else {
                format!("{}", n)
            };
            engine
                .set_cell(
                    target_sheet,
                    target,
                    target_row,
                    target_col,
                    s.as_str().into(),
                )
                .err()
        }
        _ => engine
            .import_values(
                target_sheet,
                vec![(target_row, target_col, new_value.clone(), None)],
            )
            .err(),
    };
    if let Some(e) = forward_err {
        return Err(format!("forward op err: {:?}", e));
    }

    // Inverse uses import_values with the live_prior.
    engine
        .import_values(
            target_sheet,
            vec![(target_row, target_col, live_prior.clone(), None)],
        )
        .map_err(|e| format!("inverse err: {:?}", e))?;

    // Clean up the seed key.
    if seeded_key {
        engine
            .import_values(&source, vec![(target_row, 0, CellValue::Null, None)])
            .map_err(|e| format!("unseed key err: {:?}", e))?;
    }

    let after = read_value(&engine, &dependent);
    let ctx = format!(
        "shape={:?} extent={:?} pos={:?} value={:?} before={:?} before_with_key={:?}",
        shape, extent, edit_pos, value_kind, before, before_with_key
    );
    assert_dependent_identity(&before, &after, &ctx)
}

/// Run all Class II V2 cases pinned to one (EditPosition, ValueType) pair.
/// Iterates `AggregatorShape::all() × Extent::all()` = 4 × 5 = 20 cases.
pub(crate) fn run_class_ii_v2_split(
    label: &'static str,
    edit_pos: V2EditPos,
    value_kind: V2ValueType,
) -> (usize, usize, Vec<String>) {
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut failures: Vec<String> = Vec::new();
    for &shape in AggregatorShape::all() {
        for &extent in Extent::all() {
            let name = format!(
                "class2v2__{}__{}__{}__{}",
                shape.as_slug(),
                extent.as_slug(),
                edit_pos.as_slug(),
                value_kind.as_slug(),
            );
            match run_fullcol_case_v2(shape, extent, edit_pos, value_kind) {
                Ok(()) => passed += 1,
                Err(e) => {
                    failed += 1;
                    failures.push(format!("  [{}] {}", name, e));
                }
            }
        }
    }
    eprintln!(
        "[Class II V2 · {}] {}/{} passed, {} failed",
        label,
        passed,
        passed + failed,
        failed,
    );
    if !failures.is_empty() {
        eprintln!("[Class II V2 · {}] failures:", label);
        for f in &failures {
            eprintln!("{}", f);
        }
    }
    (passed, failed, failures)
}
