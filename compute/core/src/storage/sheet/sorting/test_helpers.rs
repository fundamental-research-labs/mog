use std::sync::Arc;

use cell_types::{CellId, SheetId};
use compute_document::identity::GridIndex;
use value_types::CellValue;

use crate::storage::WorkbookStorage;

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Create a storage with one sheet plus a fresh `GridIndex` that serves
/// as the authoritative identity store for that sheet in the test.
///
pub(super) fn storage_with_sheet() -> (WorkbookStorage, SheetId, GridIndex) {
    let mut storage = WorkbookStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(cell_types::IdAllocator::new()));

    (storage, sheet_id, grid)
}

pub(super) type PlannerValues = std::collections::HashMap<(u32, u32), CellValue>;

pub(super) fn planner_fixture() -> (PlannerValues, SheetId, GridIndex) {
    let id = make_sheet_id(1);
    (
        PlannerValues::new(),
        id,
        GridIndex::new(id, 100, 26, Arc::new(cell_types::IdAllocator::new())),
    )
}

pub(super) fn place_cell(
    values: &mut PlannerValues,
    grid: &mut GridIndex,
    _sheet_id: SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    value: &CellValue,
) {
    values.insert((row, col), value.clone());
    grid.register_cell(cell_id, row, col);
}

pub(super) fn compute_sorted_row_order<F: Fn(u32, u32) -> domain_types::CellFormat>(
    values: &PlannerValues,
    range: &super::types::CellRange,
    options: &super::types::SortOptions,
    grid: &GridIndex,
    format: F,
) -> super::types::SortResult {
    let criteria: Vec<_> = options
        .criteria
        .iter()
        .map(|criterion| super::types::SortColumnCriterion {
            column: grid
                .cell_position(&criterion.header_cell_id)
                .map(|(_, col)| col)
                .unwrap_or(u32::MAX),
            direction: criterion.direction,
            case_sensitive: criterion.case_sensitive,
            mode: criterion.mode.clone(),
        })
        .collect();
    super::planner::compute_sorted_row_order_by_columns_with_scope(
        &Default::default(),
        range,
        &criteria,
        options.has_headers,
        |row, col| values.get(&(row, col)).cloned().unwrap_or_default(),
        format,
        false,
    )
}
