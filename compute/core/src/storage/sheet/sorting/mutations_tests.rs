use domain_types::CellFormat;
use domain_types::domain::filter::SortOrder;
use value_types::{CellValue, FiniteF64};

use super::mutations::{sort_by_column, sort_range};
use super::planner::compute_sorted_row_order;
use super::test_helpers::{make_cell_id, place_cell, read_cell_position, storage_with_sheet};
use super::types::{CellRange, SortCriterion, SortMode, SortOptions};

#[test]
fn test_sort_range_end_to_end() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(501);
    let c2 = make_cell_id(502);
    let c3 = make_cell_id(503);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Number(FiniteF64::must(30.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        1,
        0,
        &CellValue::Number(FiniteF64::must(10.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        2,
        0,
        &CellValue::Number(FiniteF64::must(20.0)),
    );

    let range = CellRange::new(0, 0, 2, 0);

    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: c1,
            direction: Some(SortOrder::Asc),
            case_sensitive: false,
            mode: SortMode::Value { custom_list: None },
        }],
        has_headers: false,
    };

    // Compute + apply permutation via GridIndex (production caller is
    // responsible for calling grid.sort_rows with the equivalent mapping).
    let result = compute_sorted_row_order(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        &options,
        &grid,
        |_r, _c| CellFormat::default(),
    );
    assert!(result.rows_moved > 0);

    let data_start = range.start_row();
    let permutation: Vec<(u32, u32)> = result
        .sorted_indices
        .iter()
        .enumerate()
        .filter_map(|(new_offset, &original_row)| {
            let new_row = data_start + new_offset as u32;
            if original_row != new_row {
                Some((original_row, new_row))
            } else {
                None
            }
        })
        .collect();
    grid.sort_rows(&permutation);

    // Also call sort_range to cover the whole code path (no yrs
    // mutations, but verifies the function signature + return value).
    let moved = sort_range(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        &options,
        &grid,
        |_r, _c| CellFormat::default(),
    );
    // After grid.sort_rows above the values are already in order, so
    // sort_range observes no further movement.
    assert_eq!(moved, 0);

    // After the identity-level sort: c2 (10) at row 0, c3 (20) at row 1,
    // c1 (30) at row 2.
    let pos_c1 = read_cell_position(&grid, c1);
    let pos_c2 = read_cell_position(&grid, c2);
    let pos_c3 = read_cell_position(&grid, c3);

    assert_eq!(pos_c2, Some((0, 0)), "c2 (10) should be at row 0");
    assert_eq!(pos_c3, Some((1, 0)), "c3 (20) should be at row 1");
    assert_eq!(pos_c1, Some((2, 0)), "c1 (30) should be at row 2");
}

// ===================================================================
// Test 21: sort preserves CellIds (identity preservation)
// ===================================================================

#[test]
fn test_sort_preserves_cell_ids() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(601);
    let c2 = make_cell_id(602);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Number(FiniteF64::must(20.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        1,
        0,
        &CellValue::Number(FiniteF64::must(10.0)),
    );

    let range = CellRange::new(0, 0, 1, 0);

    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: c1,
            direction: Some(SortOrder::Asc),
            case_sensitive: false,
            mode: SortMode::Value { custom_list: None },
        }],
        has_headers: false,
    };

    let result = compute_sorted_row_order(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        &options,
        &grid,
        |_r, _c| CellFormat::default(),
    );

    let data_start = range.start_row();
    let permutation: Vec<(u32, u32)> = result
        .sorted_indices
        .iter()
        .enumerate()
        .filter_map(|(new_offset, &original_row)| {
            let new_row = data_start + new_offset as u32;
            if original_row != new_row {
                Some((original_row, new_row))
            } else {
                None
            }
        })
        .collect();
    grid.sort_rows(&permutation);

    // c2 (value 10) should now be at row 0, c1 (value 20) at row 1,
    // but each keeps its CellId.
    let pos_c1 = read_cell_position(&grid, c1).unwrap();
    let pos_c2 = read_cell_position(&grid, c2).unwrap();

    assert_eq!(pos_c1, (1, 0), "c1 moved to row 1 but keeps its CellId");
    assert_eq!(pos_c2, (0, 0), "c2 moved to row 0 but keeps its CellId");

    // Identity authority: GridIndex should agree on the reverse lookup.
    assert_eq!(grid.cell_id_at(0, 0), Some(c2));
    assert_eq!(grid.cell_id_at(1, 0), Some(c1));
}

// ===================================================================
// Test 22: sort_range — no movement returns 0
// ===================================================================

#[test]
fn test_sort_range_already_sorted() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(701);
    let c2 = make_cell_id(702);
    let c3 = make_cell_id(703);

    // Already sorted ascending
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Number(FiniteF64::must(10.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        1,
        0,
        &CellValue::Number(FiniteF64::must(20.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        2,
        0,
        &CellValue::Number(FiniteF64::must(30.0)),
    );

    let range = CellRange::new(0, 0, 2, 0);

    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: c1,
            direction: Some(SortOrder::Asc),
            case_sensitive: false,
            mode: SortMode::Value { custom_list: None },
        }],
        has_headers: false,
    };

    let moved = sort_range(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        &options,
        &grid,
        |_r, _c| CellFormat::default(),
    );
    assert_eq!(moved, 0);
}

// ===================================================================
// Test 23: sort_by_column — convenience API
// ===================================================================

#[test]
fn test_sort_by_column() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(801);
    let c2 = make_cell_id(802);
    let c3 = make_cell_id(803);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Number(FiniteF64::must(30.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        1,
        0,
        &CellValue::Number(FiniteF64::must(10.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        2,
        0,
        &CellValue::Number(FiniteF64::must(20.0)),
    );

    let range = CellRange::new(0, 0, 2, 0);

    let moved = sort_by_column(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        0,
        Some(SortOrder::Asc),
        false,
        &grid,
    );
    assert!(moved > 0);

    // Apply permutation to the grid to verify end-to-end identity update.
    let result = compute_sorted_row_order(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        &SortOptions {
            criteria: vec![SortCriterion {
                header_cell_id: c1,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            }],
            has_headers: false,
        },
        &grid,
        |_r, _c| CellFormat::default(),
    );
    let data_start = range.start_row();
    let permutation: Vec<(u32, u32)> = result
        .sorted_indices
        .iter()
        .enumerate()
        .filter_map(|(new_offset, &original_row)| {
            let new_row = data_start + new_offset as u32;
            if original_row != new_row {
                Some((original_row, new_row))
            } else {
                None
            }
        })
        .collect();
    grid.sort_rows(&permutation);

    // Verify sorted order
    let pos_c2 = read_cell_position(&grid, c2).unwrap();
    assert_eq!(pos_c2, (0, 0), "c2 (10) should be at row 0 after sort");
}

// ===================================================================
// Test 24: sort_by_column — empty column returns 0
// ===================================================================

#[test]
fn test_sort_by_column_empty_column() {
    let (storage, sheet_id, grid) = storage_with_sheet();

    let range = CellRange::new(0, 0, 2, 0);

    let moved = sort_by_column(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        5,
        Some(SortOrder::Asc),
        false,
        &grid,
    );
    assert_eq!(moved, 0);
}

// ===================================================================
// Test 25: check_sort_range_merges — no merges
// ===================================================================

#[test]
fn test_sort_by_column_descending() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(1001);
    let c2 = make_cell_id(1002);
    let c3 = make_cell_id(1003);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Number(FiniteF64::must(10.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        1,
        0,
        &CellValue::Number(FiniteF64::must(30.0)),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        2,
        0,
        &CellValue::Number(FiniteF64::must(20.0)),
    );

    let range = CellRange::new(0, 0, 2, 0);

    let moved = sort_by_column(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        0,
        Some(SortOrder::Desc),
        false,
        &grid,
    );
    assert!(moved > 0);

    // Apply the permutation produced by compute to the grid.
    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: c1,
            direction: Some(SortOrder::Desc),
            case_sensitive: false,
            mode: SortMode::Value { custom_list: None },
        }],
        has_headers: false,
    };
    let result = compute_sorted_row_order(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        &options,
        &grid,
        |_r, _c| CellFormat::default(),
    );
    let data_start = range.start_row();
    let permutation: Vec<(u32, u32)> = result
        .sorted_indices
        .iter()
        .enumerate()
        .filter_map(|(new_offset, &original_row)| {
            let new_row = data_start + new_offset as u32;
            if original_row != new_row {
                Some((original_row, new_row))
            } else {
                None
            }
        })
        .collect();
    grid.sort_rows(&permutation);

    // After desc sort: 30 (c2) at row 0, 20 (c3) at row 1, 10 (c1) at row 2
    let pos_c2 = read_cell_position(&grid, c2).unwrap();
    let pos_c3 = read_cell_position(&grid, c3).unwrap();
    let pos_c1 = read_cell_position(&grid, c1).unwrap();

    assert_eq!(pos_c2, (0, 0));
    assert_eq!(pos_c3, (1, 0));
    assert_eq!(pos_c1, (2, 0));
}

// ===================================================================
// Test 29: natural_compare — strings with no numbers
// ===================================================================
