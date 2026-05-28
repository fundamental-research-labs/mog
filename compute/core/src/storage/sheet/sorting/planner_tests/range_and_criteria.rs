use domain_types::CellFormat;
use domain_types::domain::filter::SortOrder;
use value_types::{CellValue, FiniteF64};

use super::super::planner::compute_sorted_row_order;
use super::super::test_helpers::{make_cell_id, place_cell, storage_with_sheet};
use super::super::types::{CellRange, SortCriterion, SortMode, SortOptions};

#[test]
fn test_compute_sorted_row_order_with_headers() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c_header = make_cell_id(300);
    let c1 = make_cell_id(301);
    let c2 = make_cell_id(302);
    let c3 = make_cell_id(303);

    // Row 0: header "Name"
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c_header,
        0,
        0,
        &CellValue::Text("Name".into()),
    );
    // Row 1: value 30
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        1,
        0,
        &CellValue::Number(FiniteF64::must(30.0)),
    );
    // Row 2: value 10
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        2,
        0,
        &CellValue::Number(FiniteF64::must(10.0)),
    );
    // Row 3: value 20
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        3,
        0,
        &CellValue::Number(FiniteF64::must(20.0)),
    );

    let range = CellRange::new(0, 0, 3, 0);

    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: c_header,
            direction: Some(SortOrder::Asc),
            case_sensitive: false,
            mode: SortMode::Value { custom_list: None },
        }],
        has_headers: true,
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
    // Data rows: 1(30), 2(10), 3(20) -> sorted: 2(10), 3(20), 1(30)
    assert_eq!(result.sorted_indices, vec![2, 3, 1]);
    assert_eq!(result.rows_moved, 3); // all three data rows moved
}

// ===================================================================
// Test 18: compute_sorted_row_order — multi-criteria
// ===================================================================

#[test]
fn test_compute_sorted_row_order_multi_criteria() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    // Two columns: col 0 (category), col 1 (value)
    let c_a0 = make_cell_id(401);
    let c_a1 = make_cell_id(402);
    let c_a2 = make_cell_id(403);
    let c_b0 = make_cell_id(411);
    let c_b1 = make_cell_id(412);
    let c_b2 = make_cell_id(413);

    // Row 0: "B", 20
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c_a0,
        0,
        0,
        &CellValue::Text("B".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c_b0,
        0,
        1,
        &CellValue::Number(FiniteF64::must(20.0)),
    );
    // Row 1: "A", 30
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c_a1,
        1,
        0,
        &CellValue::Text("A".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c_b1,
        1,
        1,
        &CellValue::Number(FiniteF64::must(30.0)),
    );
    // Row 2: "A", 10
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c_a2,
        2,
        0,
        &CellValue::Text("A".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c_b2,
        2,
        1,
        &CellValue::Number(FiniteF64::must(10.0)),
    );

    let range = CellRange::new(0, 0, 2, 1);

    let options = SortOptions {
        criteria: vec![
            SortCriterion {
                header_cell_id: c_a0, // sort by col 0 asc first
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            },
            SortCriterion {
                header_cell_id: c_b0, // then by col 1 asc
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::Value { custom_list: None },
            },
        ],
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
    // Sorted: A,10 (row2) -> A,30 (row1) -> B,20 (row0)
    assert_eq!(result.sorted_indices, vec![2, 1, 0]);
}

// ===================================================================
// Test 19: compute_sorted_row_order — unresolved criteria
// ===================================================================

#[test]
fn test_compute_sorted_row_order_unresolved() {
    let (storage, sheet_id, grid) = storage_with_sheet();

    let range = CellRange::new(0, 0, 2, 0);

    // Use a CellId that doesn't exist in the grid
    let nonexistent = make_cell_id(999999);
    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: nonexistent,
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
    assert!(result.has_unresolved_criteria);
    assert_eq!(result.sorted_indices.len(), 0);
    assert_eq!(result.rows_moved, 0);
}

// ===================================================================
// Test 20: sort_range — end-to-end
// ===================================================================
