use super::*;
use std::sync::Arc;
use value_types::CellValue;

fn native_range_workbook() -> Vec<u8> {
    let output = domain_types::ParseOutput {
        sheets: vec![
            domain_types::SheetData {
                name: "Active".into(),
                rows: 512,
                cols: 2,
                cells: (0..512)
                    .map(|row| domain_types::CellData {
                        row,
                        col: 0,
                        value: CellValue::number((row + 1) as f64),
                        ..Default::default()
                    })
                    .collect(),
                floating_objects: vec![
                    serde_json::from_value(serde_json::json!({
                        "id":"shape-1","type":"shape","shapeType":"rect",
                        "anchor":{"anchorRow":1,"anchorCol":1},"width":10,"height":10
                    }))
                    .unwrap(),
                ],
                ..Default::default()
            },
            domain_types::SheetData {
                name: "Remaining".into(),
                rows: 1,
                cols: 1,
                cells: vec![domain_types::CellData {
                    row: 0,
                    col: 0,
                    formula: Some("SUM(Active!A1:A512)".into()),
                    value: CellValue::number(0.0),
                    ..Default::default()
                }],
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    xlsx_parser::write::write_xlsx_from_parse_output(&output).unwrap()
}

#[test]
fn completion_reuses_active_native_payload_and_metadata_identities() {
    let bytes = native_range_workbook();
    let (mut engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    engine.import_from_xlsx_bytes_deferred(&bytes).unwrap();
    let active = engine.mirror().sheet_by_name("Active").unwrap();
    let remaining = engine.mirror().sheet_by_name("Remaining").unwrap();
    assert_eq!(engine.get_all_sheet_ids().len(), 2);
    let original_sheet = engine.mirror().get_sheet(&active).unwrap();
    let original_payload = original_sheet
        .iter_ranges()
        .next()
        .unwrap()
        .1
        .values
        .clone();
    let original_rows = original_sheet.row_axis.clone();
    let original_anchor = engine.get_all_floating_objects_typed(&active)[0]
        .common
        .anchor_cell_id
        .clone();
    assert!(
        engine
            .mirror()
            .get_cell_value_at(&remaining, cell_types::SheetPos::new(0, 0))
            .is_none()
    );
    assert_eq!(
        engine.deferred_hydration.as_ref().unwrap().raw_xlsx_bytes,
        bytes
    );
    engine.complete_deferred_hydration().unwrap();
    assert!(engine.deferred_hydration.is_none());
    let completed_sheet = engine.mirror().get_sheet(&active).unwrap();
    assert!(
        Arc::ptr_eq(
            &original_payload,
            &completed_sheet.iter_ranges().next().unwrap().1.values
        ),
        "the loaded payload must not decode a second time"
    );
    assert!(Arc::ptr_eq(&original_rows, &completed_sheet.row_axis));
    assert_eq!(
        engine.get_all_floating_objects_typed(&active)[0]
            .common
            .anchor_cell_id,
        original_anchor
    );
    engine
        .recalculate_with_options(&snapshot_types::RecalcOptions {
            iterative: Some(false),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&remaining, cell_types::SheetPos::new(0, 0)),
        Some(&CellValue::number(131_328.0))
    );
}

#[test]
fn failed_remaining_sheet_parse_preserves_loaded_state_and_can_retry() {
    let bytes = native_range_workbook();
    let (mut engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    engine.import_from_xlsx_bytes_deferred(&bytes).unwrap();
    let active = engine.mirror().sheet_by_name("Active").unwrap();
    let payload = engine
        .mirror()
        .get_sheet(&active)
        .unwrap()
        .iter_ranges()
        .next()
        .unwrap()
        .1
        .values
        .clone();
    let high_water = engine.stores.grid_id_alloc.high_water_mark();
    engine.deferred_hydration.as_mut().unwrap().raw_xlsx_bytes = vec![0, 1, 2];
    assert!(engine.complete_deferred_hydration().is_err());
    assert!(engine.deferred_hydration.is_some());
    assert_eq!(engine.stores.grid_id_alloc.high_water_mark(), high_water);
    assert!(Arc::ptr_eq(
        &payload,
        &engine
            .mirror()
            .get_sheet(&active)
            .unwrap()
            .iter_ranges()
            .next()
            .unwrap()
            .1
            .values
    ));
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&active, cell_types::SheetPos::new(511, 0)),
        Some(&CellValue::number(512.0))
    );
    engine.deferred_hydration.as_mut().unwrap().raw_xlsx_bytes = bytes;
    engine.complete_deferred_hydration().unwrap();
    assert!(engine.deferred_hydration.is_none());
}
