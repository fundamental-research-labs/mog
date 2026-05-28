use domain_types::CellFormat;
use domain_types::domain::filter::SortOrder;
use value_types::{CellValue, FiniteF64};

use super::super::planner::compute_sorted_row_order;
use super::super::test_helpers::{make_cell_id, place_cell, storage_with_sheet};
use super::super::types::{CellRange, SortCriterion, SortMode, SortOptions};

#[test]
fn test_compute_sorted_row_order_single_asc() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(101);
    let c2 = make_cell_id(102);
    let c3 = make_cell_id(103);

    // Row 0: value 30
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Number(FiniteF64::must(30.0)),
    );
    // Row 1: value 10
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        1,
        0,
        &CellValue::Number(FiniteF64::must(10.0)),
    );
    // Row 2: value 20
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
            header_cell_id: c1, // column 0
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
    // Sorted: 10(row1), 20(row2), 30(row0)
    assert_eq!(result.sorted_indices, vec![1, 2, 0]);
    assert_eq!(result.rows_moved, 3); // all three rows moved
    assert!(!result.has_unresolved_criteria);
}

#[test]
fn test_compute_sorted_row_order_blanks_last_ascending() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(1201);
    let c2 = make_cell_id(1202);
    let c3 = make_cell_id(1203);
    let c4 = make_cell_id(1204);
    let c5 = make_cell_id(1205);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Number(FiniteF64::must(3.0)),
    );
    grid.register_cell(c2, 1, 0);
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        2,
        0,
        &CellValue::Number(FiniteF64::must(1.0)),
    );
    grid.register_cell(c4, 3, 0);
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c5,
        4,
        0,
        &CellValue::Number(FiniteF64::must(2.0)),
    );

    let range = CellRange::new(0, 0, 4, 0);
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

    assert_eq!(result.sorted_indices, vec![2, 4, 0, 1, 3]);
}

// ===================================================================
// Test 16: compute_sorted_row_order — descending
// ===================================================================

#[test]
fn test_compute_sorted_row_order_desc() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(201);
    let c2 = make_cell_id(202);
    let c3 = make_cell_id(203);

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
    // Sorted desc: 30(row1), 20(row2), 10(row0)
    assert_eq!(result.sorted_indices, vec![1, 2, 0]);
}

// ===================================================================
// Test 17: compute_sorted_row_order — with headers
// ===================================================================

#[test]
fn test_sort_mixed_types() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(901);
    let c2 = make_cell_id(902);
    let c3 = make_cell_id(903);
    let c4 = make_cell_id(904);

    // Row 0: "Hello"
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Text("Hello".into()),
    );
    // Row 1: 42
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        1,
        0,
        &CellValue::Number(FiniteF64::must(42.0)),
    );
    // Row 2: null
    place_cell(&storage, &mut grid, sheet_id, c3, 2, 0, &CellValue::Null);
    // Row 3: true
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c4,
        3,
        0,
        &CellValue::Boolean(true),
    );

    let range = CellRange::new(0, 0, 3, 0);

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
    // Production range sort keeps blanks last, then applies type priority:
    // bool(row3) < number(row1) < string(row0) < null(row2).
    assert_eq!(result.sorted_indices, vec![3, 1, 0, 2]);
}

// ===================================================================
// Test 28: sort_by_column — descending
// ===================================================================

#[test]
fn test_sort_strings_natural() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c1 = make_cell_id(1101);
    let c2 = make_cell_id(1102);
    let c3 = make_cell_id(1103);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        0,
        0,
        &CellValue::Text("Item 10".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        1,
        0,
        &CellValue::Text("Item 2".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        2,
        0,
        &CellValue::Text("Item 1".into()),
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

    let result = compute_sorted_row_order(
        storage.doc(),
        &storage.sheets_ref(),
        sheet_id,
        &range,
        &options,
        &grid,
        |_r, _c| CellFormat::default(),
    );
    // Natural sort: "Item 1" < "Item 2" < "Item 10"
    assert_eq!(result.sorted_indices, vec![2, 1, 0]);
}

// ===================================================================
// Test 31: compare_cell_values — desc reverses type priority
// ===================================================================
