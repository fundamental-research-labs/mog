//! Splitting text reports both source overwrites and destination writes.

use compute_core::storage::engine::ComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}
fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}

fn text_cell(id_suffix: u32, row: u32, col: u32, text: &str) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Text(text.to_string().into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn snapshot_with_delimited_strings() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 26,
            cells: vec![
                text_cell(100, 0, 0, "Seattle, WA, 098101"),
                text_cell(101, 1, 0, "Portland, OR, 097201"),
                text_cell(102, 2, 0, "Boise, ID, 083702"),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn delimited_options() -> serde_json::Value {
    serde_json::json!({
        "splitType": "Delimited",
        "delimiters": {
            "tab": false,
            "semicolon": false,
            "comma": true,
            "space": false,
        },
        "treatConsecutiveAsOne": false,
        "textQualifier": "doubleQuote",
    })
}

fn find_change<'a>(
    changes: &'a [snapshot_types::CellChange],
    row: u32,
    col: u32,
) -> Option<&'a snapshot_types::CellChange> {
    changes.iter().find(|c| {
        c.position
            .as_ref()
            .map_or(false, |p| p.row == row && p.col == col)
    })
}

#[test]
fn text_to_columns_emits_change_for_source_column_overwrite() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_with_delimited_strings()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");
    let result = engine
        .text_to_columns(&sid, 0, 2, 0, 0, 0, delimited_options())
        .expect("text_to_columns");

    let changes = &result.recalc.changed_cells;
    let src = find_change(changes, 0, 0).expect(
        "source-column overwrite (0,0) must be present in recalc.changed_cells — \
         the in-place split's first token replaces the source cell value, \
         and the viewport buffer needs a patch for that position",
    );
    assert!(
        matches!(&src.value, CellValue::Text(s) if s.as_ref() == "Seattle"),
        "(0,0) should carry the new first-token value 'Seattle', got {:?}",
        src.value
    );
    let mid = find_change(changes, 0, 1).expect("(0,1) WA");
    assert!(
        matches!(&mid.value, CellValue::Text(s) if s.as_ref() == "WA"),
        "(0,1) should be 'WA', got {:?}",
        mid.value
    );
    let tail = find_change(changes, 0, 2).expect("(0,2) 098101");
    assert!(
        matches!(&tail.value, CellValue::Text(s) if s.as_ref() == "098101"),
        "(0,2) should be '098101', got {:?}",
        tail.value
    );
    for row in 1..=2 {
        let row_src = find_change(changes, row, 0)
            .unwrap_or_else(|| panic!("source overwrite ({row},0) missing from changed_cells"));
        let expected = match row {
            1 => "Portland",
            2 => "Boise",
            _ => unreachable!(),
        };
        assert!(
            matches!(&row_src.value, CellValue::Text(s) if s.as_ref() == expected),
            "({row},0) should be '{expected}', got {:?}",
            row_src.value
        );
    }
}

#[test]
fn text_to_columns_fixed_width_emits_change_for_source_column_overwrite() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_with_delimited_strings()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");
    let opts = serde_json::json!({
        "splitType": "FixedWidth",
        "fixedWidthBreaks": [7],
        "delimiters": { "tab": false, "semicolon": false, "comma": false, "space": false },
        "treatConsecutiveAsOne": false,
        "textQualifier": "doubleQuote",
    });

    let result = engine
        .text_to_columns(&sid, 0, 2, 0, 0, 0, opts)
        .expect("text_to_columns");

    let src = find_change(&result.recalc.changed_cells, 0, 0).expect(
        "fixed-width split: source-column overwrite (0,0) must be present in changed_cells",
    );
    assert!(
        matches!(&src.value, CellValue::Text(s) if s.as_ref() == "Seattle"),
        "(0,0) fixed-width first segment should be 'Seattle', got {:?}",
        src.value
    );
}
