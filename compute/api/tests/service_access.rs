//! Exercise the FFI service's full-workbook access and persistence contract.

use cell_types::SheetId;
use compute_api::ComputeService;
use compute_api::dispatch::Dispatch;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

#[test]
fn service_reads_writes_and_creates_sheets_without_session_setup() {
    let sheet_uuid = "44444444-4444-4444-4444-444444444444";
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid.into(),
            name: "Sheet1".into(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let mut service = ComputeService::new(Dispatch::from_engine(engine).unwrap());
    let sheet_id = SheetId::from_uuid_str(sheet_uuid).unwrap();

    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "21")
        .unwrap();
    service
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*2")
        .unwrap();
    assert_eq!(
        service.get_cell_value(&sheet_id, 0, 0),
        CellValue::Number(FiniteF64::must(21.0))
    );
    assert_eq!(
        service.get_cell_value(&sheet_id, 0, 1),
        CellValue::Number(FiniteF64::must(42.0))
    );

    let (created_uuid, _) = service.create_sheet("Created").unwrap();
    let created_id = SheetId::from_uuid_str(&created_uuid).unwrap();
    service
        .set_cell_value_parsed(&created_id, 0, 0, "7")
        .unwrap();

    let state = service.sync_full_state();
    let (restored_engine, _) = YrsComputeEngine::from_yrs_state(&state).unwrap();
    let mut restored = ComputeService::new(Dispatch::from_engine(restored_engine).unwrap());
    assert_eq!(
        restored.get_cell_value(&sheet_id, 0, 0),
        CellValue::Number(FiniteF64::must(21.0))
    );
    assert_eq!(
        restored.get_cell_value(&sheet_id, 0, 1),
        CellValue::Number(FiniteF64::must(42.0))
    );
    assert_eq!(
        restored.get_cell_value(&created_id, 0, 0),
        CellValue::Number(FiniteF64::must(7.0))
    );

    // Restored formulas retain their dependencies and remain editable.
    restored
        .set_cell_value_parsed(&sheet_id, 0, 0, "30")
        .unwrap();
    assert_eq!(
        restored.get_cell_value(&sheet_id, 0, 1),
        CellValue::Number(FiniteF64::must(60.0))
    );
}
