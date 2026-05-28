use compute_core::mirror::CellMirror;
use compute_core::mirror::dense::{DenseBoolMask, DenseColumn};
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{RecalcResult, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

use crate::fixtures::cell_uuid;

pub(crate) fn init_engine(snapshot: WorkbookSnapshot) -> (ComputeCore, CellMirror, RecalcResult) {
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");
    (core, mirror, result)
}

pub(crate) fn find_changed_value(result: &RecalcResult, row: u32, col: u32) -> Option<CellValue> {
    let target = cell_uuid(row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target)
        .map(|cc| cc.value.clone())
}

pub(crate) fn assert_num(result: &RecalcResult, row: u32, col: u32, expected: f64) {
    let val = find_changed_value(result, row, col);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Cell (row={},col={}) expected {}, got {}",
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Cell (row={},col={}) expected Number({}), got {:?}",
            row, col, expected, other
        ),
        None => panic!(
            "Cell (row={},col={}) not in changed_cells (expected Number({})). \
             The cell was not recalculated or its value matched the initial seed.",
            row, col, expected
        ),
    }
}

pub(crate) fn col_data_value(mirror: &CellMirror, col: u32, row: u32) -> CellValue {
    let sid = mirror.sheet_by_name("sheet1").expect("sheet not found");
    let sheet = mirror.get_sheet(&sid).expect("sheet mirror not found");
    sheet
        .get_column_slice(col)
        .and_then(|s| s.get(row as usize))
        .cloned()
        .unwrap_or(CellValue::Null)
}

pub(crate) fn col_version(mirror: &CellMirror, col: u32) -> u64 {
    let sid = mirror.sheet_by_name("sheet1").expect("sheet not found");
    mirror.col_version(&sid, col)
}

pub(crate) fn dense_cache_has(mirror: &CellMirror, col: u32) -> bool {
    let sid = mirror.sheet_by_name("sheet1").expect("sheet not found");
    mirror.dense_cache().get(&sid, col).is_some()
}

pub(crate) fn warm_dense_cache(mirror: &mut CellMirror, col: u32) {
    let sid = mirror.sheet_by_name("sheet1").expect("sheet not found");
    let sheet = mirror.get_sheet(&sid).expect("sheet not found");
    let num_rows = sheet.rows as usize;

    let mut values = vec![f64::NAN; num_rows];
    let mut numeric_count = 0usize;
    if let Some(col_slice) = sheet.get_column_slice(col) {
        let len = num_rows.min(col_slice.len());
        for row in 0..len {
            if let CellValue::Number(n) = &col_slice[row] {
                values[row] = n.get();
                numeric_count += 1;
            }
        }
    }
    let dense = DenseColumn::new(values, numeric_count, 0, vec![]);
    let num_words = num_rows.div_ceil(64);
    let mask = DenseBoolMask::new(vec![0u64; num_words], 0, num_rows as u32);
    mirror.dense_cache_mut().store_dense(sid, col, dense, mask);
}

pub(crate) fn assert_col_version_bumped(scenario: &str, col: u32, before: u64, after: u64) {
    assert!(
        after > before,
        "{scenario}: col_version for col {col} should bump: before={before}, after={after}"
    );
}

pub(crate) fn assert_col_version_unchanged(scenario: &str, col: u32, before: u64, after: u64) {
    assert_eq!(
        after, before,
        "{scenario}: col_version for col {col} should be unchanged: before={before}, after={after}"
    );
}

pub(crate) fn assert_col_value(
    scenario: &str,
    mirror: &CellMirror,
    row: u32,
    col: u32,
    expected: CellValue,
) {
    let observed = col_data_value(mirror, col, row);
    assert_eq!(
        observed, expected,
        "{scenario}: col_data at (row={row}, col={col}) mismatch; observed={observed:?}"
    );
}

pub(crate) fn assert_dense_invalidated(scenario: &str, mirror: &CellMirror, col: u32) {
    assert!(
        !dense_cache_has(mirror, col),
        "{scenario}: DenseColumnCache for col {col} should be invalidated"
    );
}

pub(crate) fn assert_dense_retained(scenario: &str, mirror: &CellMirror, col: u32) {
    assert!(
        dense_cache_has(mirror, col),
        "{scenario}: DenseColumnCache for col {col} should be retained"
    );
}

pub(crate) fn assert_changed_number(
    scenario: &str,
    result: &RecalcResult,
    row: u32,
    col: u32,
    expected: f64,
) {
    let val = find_changed_value(result, row, col);
    match val {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - expected).abs() < 1e-6,
            "{scenario}: changed cell (row={row}, col={col}) expected {expected}, got {}",
            n.get()
        ),
        Some(other) => panic!(
            "{scenario}: changed cell (row={row}, col={col}) expected Number({expected}), got {other:?}"
        ),
        None => panic!(
            "{scenario}: changed cell (row={row}, col={col}) missing; expected Number({expected})"
        ),
    }
}

pub(crate) fn assert_changed_error_or_absent_not_old_number(
    scenario: &str,
    result: &RecalcResult,
    row: u32,
    col: u32,
    stale_number: f64,
) {
    match find_changed_value(result, row, col) {
        Some(CellValue::Error(_, _)) | None => {}
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - stale_number).abs() >= 1e-6,
                "{scenario}: changed cell (row={row}, col={col}) returned stale number {stale_number}"
            );
        }
        Some(_) => {}
    }
}

pub(crate) fn assert_dense_value(
    scenario: &str,
    mirror: &CellMirror,
    col: u32,
    row: usize,
    expected: f64,
) {
    let sid = mirror.sheet_by_name("sheet1").expect("sheet not found");
    let dense = mirror
        .dense_cache()
        .get(&sid, col)
        .unwrap_or_else(|| panic!("{scenario}: DenseColumnCache for col {col} should be present"));
    let observed = dense.values()[row];
    assert!(
        (observed - expected).abs() < 1e-6,
        "{scenario}: dense value at (row={row}, col={col}) expected {expected}, got {observed}"
    );
}

pub(crate) fn number(value: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(value))
}
