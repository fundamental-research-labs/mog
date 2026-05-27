use domain_types::CellFormat;
use domain_types::domain::filter::{ColorPosition, SortOrder};
use value_types::{CellValue, FiniteF64};

use super::planner::compute_sorted_row_order;
use super::test_helpers::{make_cell_id, place_cell, storage_with_sheet};
use super::types::{CellRange, SortCriterion, SortMode, SortOptions};

fn fmt_fill(color: &str) -> CellFormat {
    CellFormat {
        background_color: Some(color.to_string()),
        ..Default::default()
    }
}

fn fmt_font(color: &str) -> CellFormat {
    CellFormat {
        font_color: Some(color.to_string()),
        ..Default::default()
    }
}

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

#[test]
fn test_sort_by_cell_color_top_preserves_order() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c0 = make_cell_id(2001);
    let c1 = make_cell_id(2002);
    let c2 = make_cell_id(2003);
    let c3 = make_cell_id(2004);
    let c4 = make_cell_id(2005);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c0,
        0,
        0,
        &CellValue::Text("alpha".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        1,
        0,
        &CellValue::Text("beta".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        2,
        0,
        &CellValue::Text("gamma".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        3,
        0,
        &CellValue::Text("delta".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c4,
        4,
        0,
        &CellValue::Text("epsilon".into()),
    );

    let range = CellRange::new(0, 0, 4, 0);
    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: c0,
            direction: Some(SortOrder::Asc),
            case_sensitive: false,
            mode: SortMode::CellColor {
                target: "#FFFF00".into(),
                position: ColorPosition::Top,
            },
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
        |row, _col| match row {
            0 | 2 | 4 => fmt_fill("#FFFF00"),
            _ => fmt_fill("#FFFFFF"),
        },
    );
    // Matched rows first in original relative order: [0, 2, 4].
    // Non-matched in original relative order: [1, 3]. The single
    // color criterion returns Equal for color ties, so the stable
    // sort preserves original order within each bucket. (Excel
    // parity: Sort by Cell Color does not implicitly value-sort.)
    assert_eq!(result.sorted_indices, vec![0, 2, 4, 1, 3]);
}

// -------------------------------------------------------------------
// Test 34: color-on-bottom inverts the bucket order — non-matched
// rows precede matched rows.
// -------------------------------------------------------------------

#[test]
fn test_sort_by_cell_color_bottom_inverts() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c0 = make_cell_id(2101);
    let c1 = make_cell_id(2102);
    let c2 = make_cell_id(2103);
    let c3 = make_cell_id(2104);
    let c4 = make_cell_id(2105);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c0,
        0,
        0,
        &CellValue::Text("alpha".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        1,
        0,
        &CellValue::Text("beta".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        2,
        0,
        &CellValue::Text("gamma".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c3,
        3,
        0,
        &CellValue::Text("delta".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c4,
        4,
        0,
        &CellValue::Text("epsilon".into()),
    );

    let range = CellRange::new(0, 0, 4, 0);
    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: c0,
            direction: Some(SortOrder::Asc),
            case_sensitive: false,
            mode: SortMode::CellColor {
                target: "#FFFF00".into(),
                position: ColorPosition::Bottom,
            },
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
        |row, _col| match row {
            0 | 2 | 4 => fmt_fill("#FFFF00"),
            _ => fmt_fill("#FFFFFF"),
        },
    );
    // Non-matched first in original order [1, 3]; matched after in
    // original order [0, 2, 4]. Stable-sort tiebreak preserves
    // within-bucket order.
    assert_eq!(result.sorted_indices, vec![1, 3, 0, 2, 4]);
}

// -------------------------------------------------------------------
// Test 35: custom-list sort with shuffled weekdays. Values present
// in the list sort by list position; values not in the list fall to
// the end (Excel parity).
// -------------------------------------------------------------------

#[test]
fn test_sort_by_custom_list_weekdays() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();

    // Shuffled order: Wed, Mon, Fri, *Holiday* (off-list), Tue, Sun, Thu, Sat
    let inputs = ["Wed", "Mon", "Fri", "Holiday", "Tue", "Sun", "Thu", "Sat"];
    let mut ids = Vec::new();
    for (i, v) in inputs.iter().enumerate() {
        let id = make_cell_id(2200 + i as u128);
        place_cell(
            &storage,
            &mut grid,
            sheet_id,
            id,
            i as u32,
            0,
            &CellValue::Text((*v).into()),
        );
        ids.push(id);
    }

    let custom_list: Vec<CellValue> = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        .iter()
        .map(|s| CellValue::Text((*s).into()))
        .collect();

    let range = CellRange::new(0, 0, 7, 0);
    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: ids[0],
            direction: Some(SortOrder::Asc),
            case_sensitive: false,
            mode: SortMode::Value {
                custom_list: Some(custom_list),
            },
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
    // Expected order by list position: Mon(1), Tue(4), Wed(0),
    // Thu(6), Fri(2), Sat(7), Sun(5), then off-list: Holiday(3).
    assert_eq!(result.sorted_indices, vec![1, 4, 0, 6, 2, 7, 5, 3]);
}

// -------------------------------------------------------------------
// Test 36: multi-criterion sort — primary by cell color (yellow on
// top), secondary by value ascending. Within each color bucket the
// value comparator drives the order; ties on both keys preserve
// original row order (stable sort).
// -------------------------------------------------------------------

#[test]
fn test_sort_multi_criterion_color_then_value() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    // Two columns: column 0 is the color column (and also primary
    // header for resolution); column 1 is the value column.
    let c00 = make_cell_id(2301);
    let c01 = make_cell_id(2311);
    let c10 = make_cell_id(2302);
    let c11 = make_cell_id(2312);
    let c20 = make_cell_id(2303);
    let c21 = make_cell_id(2313);
    let c30 = make_cell_id(2304);
    let c31 = make_cell_id(2314);

    // Row 0: yellow / 30
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c00,
        0,
        0,
        &CellValue::Text("a".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c01,
        0,
        1,
        &CellValue::Number(FiniteF64::must(30.0)),
    );
    // Row 1: white / 10
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c10,
        1,
        0,
        &CellValue::Text("b".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c11,
        1,
        1,
        &CellValue::Number(FiniteF64::must(10.0)),
    );
    // Row 2: yellow / 20
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c20,
        2,
        0,
        &CellValue::Text("c".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c21,
        2,
        1,
        &CellValue::Number(FiniteF64::must(20.0)),
    );
    // Row 3: white / 5
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c30,
        3,
        0,
        &CellValue::Text("d".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c31,
        3,
        1,
        &CellValue::Number(FiniteF64::must(5.0)),
    );

    let range = CellRange::new(0, 0, 3, 1);
    let options = SortOptions {
        criteria: vec![
            SortCriterion {
                header_cell_id: c00,
                direction: Some(SortOrder::Asc),
                case_sensitive: false,
                mode: SortMode::CellColor {
                    target: "#FFFF00".into(),
                    position: ColorPosition::Top,
                },
            },
            SortCriterion {
                header_cell_id: c01,
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
        |row, col| {
            if col == 0 {
                match row {
                    0 | 2 => fmt_fill("#FFFF00"),
                    _ => fmt_fill("#FFFFFF"),
                }
            } else {
                CellFormat::default()
            }
        },
    );
    // Yellow bucket: rows 0(30), 2(20) → ordered by value asc → [2, 0].
    // White bucket:  rows 1(10), 3(5)  → ordered by value asc → [3, 1].
    assert_eq!(result.sorted_indices, vec![2, 0, 3, 1]);
}

// -------------------------------------------------------------------
// Test 37: font-color sort top inverts under desc — non-matched
// first, then matched (the per-criterion direction reverses the
// top/bottom verdict).
// -------------------------------------------------------------------

#[test]
fn test_sort_by_font_color_top_desc_inverts() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    let c0 = make_cell_id(2401);
    let c1 = make_cell_id(2402);
    let c2 = make_cell_id(2403);

    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c0,
        0,
        0,
        &CellValue::Text("a".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c1,
        1,
        0,
        &CellValue::Text("b".into()),
    );
    place_cell(
        &storage,
        &mut grid,
        sheet_id,
        c2,
        2,
        0,
        &CellValue::Text("c".into()),
    );

    let range = CellRange::new(0, 0, 2, 0);
    let options = SortOptions {
        criteria: vec![SortCriterion {
            header_cell_id: c0,
            direction: Some(SortOrder::Desc),
            case_sensitive: false,
            mode: SortMode::FontColor {
                target: "#FF0000".into(),
                position: ColorPosition::Top,
            },
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
        |row, _col| match row {
            1 => fmt_font("#FF0000"),
            _ => fmt_font("#000000"),
        },
    );
    // Top + Desc → matched goes after non-matched. Within-bucket
    // ties preserve original row order via the stable sort.
    // Non-matched in original order: [0, 2]. Matched: [1].
    assert_eq!(result.sorted_indices, vec![0, 2, 1]);
}
