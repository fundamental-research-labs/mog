//! Undo behavior for per-cell sort position changes.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot};
use value_types::{CellValue, FiniteF64};

#[test]
fn test_undo_reverts_per_cell_sort_positions() {
    let sid = sheet_id();
    let cells = [
        ("550e8400-e29b-41d4-a716-446655440011", 3.0),
        ("550e8400-e29b-41d4-a716-446655440012", 1.0),
        ("550e8400-e29b-41d4-a716-446655440013", 5.0),
        ("550e8400-e29b-41d4-a716-446655440014", 2.0),
        ("550e8400-e29b-41d4-a716-446655440015", 4.0),
    ];
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: cells
                .iter()
                .enumerate()
                .map(|(row, (cell_id, value))| CellData {
                    cell_id: (*cell_id).to_string(),
                    row: row as u32,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(*value)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                })
                .collect(),
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let options = crate::storage::engine::mutation::BridgeSortOptions {
        criteria: vec![crate::storage::engine::mutation::BridgeSortCriterion {
            column: 0,
            direction: domain_types::domain::filter::SortOrder::Asc,
            case_sensitive: false,
            mode: crate::storage::engine::mutation::BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: false,
        visible_rows_only: false,
    };

    engine.sort_range(&sid, 0, 0, 4, 0, options).unwrap();
    let sorted: Vec<CellValue> = (0..5)
        .map(|row| {
            engine
                .mirror()
                .get_cell_value_at(&sid, SheetPos::new(row, 0))
                .cloned()
                .unwrap()
        })
        .collect();
    assert_eq!(
        sorted,
        [1.0, 2.0, 3.0, 4.0, 5.0]
            .into_iter()
            .map(|n| CellValue::Number(FiniteF64::must(n)))
            .collect::<Vec<_>>()
    );

    assert!(engine.can_undo());
    let undo_result = engine.undo().unwrap().1;

    let restored: Vec<CellValue> = (0..5)
        .map(|row| {
            engine
                .mirror()
                .get_cell_value_at(&sid, SheetPos::new(row, 0))
                .cloned()
                .unwrap()
        })
        .collect();
    assert_eq!(
        restored,
        [3.0, 1.0, 5.0, 2.0, 4.0]
            .into_iter()
            .map(|n| CellValue::Number(FiniteF64::must(n)))
            .collect::<Vec<_>>(),
        "undo must restore the pre-sort position order in one step",
    );
    let changed_rows: std::collections::HashSet<u32> = undo_result
        .recalc
        .changed_cells
        .iter()
        .filter_map(|change| {
            let pos = change.position.as_ref()?;
            (pos.col == 0).then_some(pos.row)
        })
        .collect();
    assert_eq!(
        changed_rows,
        (0..5).collect(),
        "undo must emit value patches for every restored sort row",
    );
}
