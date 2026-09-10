//! Conditional format priority changes.

use cell_types::SheetId;
use compute_core::storage::engine::ComputeEngine;
use serde_json::json;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}
fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}
fn number_cell(id_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn snapshot_with_numbers(values: &[f64]) -> WorkbookSnapshot {
    let cells = values
        .iter()
        .enumerate()
        .map(|(i, n)| number_cell(100 + i as u32, i as u32, 0, *n))
        .collect();
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id_str(1),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn red_above_100_rule(rule_id: &str, sheet_id: &SheetId) -> serde_json::Value {
    json!({
        "id": format!("cf-{}", rule_id),
        "sheetId": sheet_id.to_uuid_string(),
        "ranges": [{
            "startRow": 0u32, "startCol": 0u32, "endRow": 9u32, "endCol": 0u32,
        }],
        "rules": [{
            "type": "cellValue",
            "id": format!("rule-{}", rule_id),
            "priority": 1,
            "operator": "greaterThan",
            "value1": 100,
            "style": {
                "backgroundColor": "#FF0000"
            }
        }]
    })
}
#[test]
fn add_cf_rule_typed_priority_bump_renumbers_existing_formats() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_with_numbers(&[10.0, 200.0])).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("Sheet1").expect("Sheet1");

    engine
        .add_cf_rule(&sid, red_above_100_rule("a", &sid))
        .expect("add_cf_rule (a)");
    engine
        .add_cf_rule(&sid, red_above_100_rule("b", &sid))
        .expect("add_cf_rule (b)");
    engine
        .add_cf_rule(&sid, red_above_100_rule("c", &sid))
        .expect("add_cf_rule (c)");

    let formats = engine.get_all_cf_rules(&sid);
    assert_eq!(formats.len(), 3);
    let priorities: Vec<i32> = formats
        .iter()
        .map(|f| f.rules.first().expect("rule").priority())
        .collect();
    let mut sorted = priorities.clone();
    sorted.sort();
    assert_eq!(sorted, vec![1, 2, 3], "typed priority bump must renumber");
}
