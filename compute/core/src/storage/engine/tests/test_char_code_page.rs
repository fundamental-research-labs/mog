//! CHAR/CODE code-page selection must remain a runtime calculation option.
use super::super::ComputeEngine;
use super::helpers::{cell_value_at, simple_snapshot};
use crate::snapshot::CellData;
use value_types::CellValue;

fn char_snapshot() -> crate::snapshot::WorkbookSnapshot {
    let mut snapshot = simple_snapshot();
    snapshot.sheets[0].cells.push(CellData {
        cell_id: "550e8400-e29b-41d4-a716-446655440004".to_string(),
        row: 0,
        col: 2,
        value: CellValue::Null,
        formula: Some("=CHAR(240)".to_string()),
        identity_formula: None,
        array_ref: None,
    });
    snapshot.sheets[0].cells.push(CellData {
        cell_id: "550e8400-e29b-41d4-a716-446655440005".to_string(),
        row: 0,
        col: 3,
        value: CellValue::Null,
        formula: Some("=CODE(\"\")".to_string()),
        identity_formula: None,
        array_ref: None,
    });
    snapshot
}

fn char_value(engine: &ComputeEngine) -> CellValue {
    let sheet_id = engine.stores.storage.sheet_order()[0];
    cell_value_at(engine, &sheet_id, 0, 2)
}

fn code_value(engine: &ComputeEngine) -> CellValue {
    let sheet_id = engine.stores.storage.sheet_order()[0];
    cell_value_at(engine, &sheet_id, 0, 3)
}

#[test]
fn char_code_page_switch_recalc_rebuild_and_native_reload_preserves_runtime_selection() {
    let (mut engine, _) = ComputeEngine::from_snapshot(char_snapshot()).unwrap();
    assert_eq!(engine.char_code_page(), 1252);
    assert!(engine.set_char_code_page(65001).is_err());
    assert_eq!(engine.char_code_page(), 1252);
    assert_eq!(char_value(&engine), CellValue::from("ð"));
    assert_eq!(code_value(&engine), CellValue::number(63.0));

    engine.set_char_code_page(10000).unwrap();
    engine.recalculate().unwrap();
    assert_eq!(engine.char_code_page(), 10000);
    assert_eq!(char_value(&engine), CellValue::from(""));
    assert_eq!(code_value(&engine), CellValue::number(240.0));

    engine.set_char_code_page(1252).unwrap();
    engine.recalculate().unwrap();
    assert_eq!(char_value(&engine), CellValue::from("ð"));
    assert_eq!(code_value(&engine), CellValue::number(63.0));
    engine.set_char_code_page(10000).unwrap();
    engine.recalculate().unwrap();

    engine.rebuild_compute_core().unwrap();
    assert_eq!(engine.char_code_page(), 10000);
    assert_eq!(char_value(&engine), CellValue::from(""));
    assert_eq!(code_value(&engine), CellValue::number(240.0));

    let mut peer = super::helpers::rebuild_native_engine(&engine);
    peer.set_char_code_page(10000).unwrap();
    let sheet_id = peer.stores.storage.sheet_order()[0];
    peer.set_cell_value_parsed(&sheet_id, 0, 0, "11").unwrap();
    peer.rebuild_compute_core().unwrap();

    assert_eq!(peer.char_code_page(), 10000);
    assert_eq!(char_value(&peer), CellValue::from(""));
    assert_eq!(code_value(&peer), CellValue::number(240.0));
}
