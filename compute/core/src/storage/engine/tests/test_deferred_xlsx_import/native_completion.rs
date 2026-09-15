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
    let active = engine.cell_store().sheet_by_name("Active").unwrap();
    let remaining = engine.cell_store().sheet_by_name("Remaining").unwrap();
    assert_eq!(engine.get_all_sheet_ids().len(), 2);
    let original_sheet = engine.cell_store().get_sheet(&active).unwrap();
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
    assert!(engine.get_cell_id_at(&remaining, 0, 0).is_some());
    engine.complete_deferred_hydration().unwrap();
    let completed_sheet = engine.cell_store().get_sheet(&active).unwrap();
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
            .cell_store()
            .get_cell_value_at(&remaining, cell_types::SheetPos::new(0, 0)),
        Some(&CellValue::number(131_328.0))
    );
}

#[test]
fn failed_stream_import_preserves_loaded_state_and_can_retry() {
    let bytes = native_range_workbook();
    let (mut engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    engine.import_from_xlsx_bytes_deferred(&bytes).unwrap();
    let active = engine.cell_store().sheet_by_name("Active").unwrap();
    let payload = engine
        .cell_store()
        .get_sheet(&active)
        .unwrap()
        .iter_ranges()
        .next()
        .unwrap()
        .1
        .values
        .clone();
    let high_water = engine.stores.grid_id_alloc.high_water_mark();
    let history = engine.get_undo_state();

    // Corrupt the later worksheet's compressed bytes. The first worksheet has
    // already streamed into the staged engine when this entry fails to inflate.
    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).unwrap();
    let entry = archive.find_entry("xl/worksheets/sheet2.xml").unwrap();
    let name_len =
        u16::from_le_bytes([bytes[entry.offset + 26], bytes[entry.offset + 27]]) as usize;
    let extra_len =
        u16::from_le_bytes([bytes[entry.offset + 28], bytes[entry.offset + 29]]) as usize;
    let data_offset = entry.offset + 30 + name_len + extra_len;
    let mut corrupt = bytes.clone();
    corrupt[data_offset..data_offset + entry.compressed_size].fill(0xff);
    assert!(engine.import_from_xlsx_bytes_deferred(&corrupt).is_err());

    assert_eq!(engine.stores.grid_id_alloc.high_water_mark(), high_water);
    assert_eq!(engine.get_undo_state(), history);
    assert!(Arc::ptr_eq(
        &payload,
        &engine
            .cell_store()
            .get_sheet(&active)
            .unwrap()
            .iter_ranges()
            .next()
            .unwrap()
            .1
            .values
    ));
    assert_eq!(
        engine.get_cell_value(&active, 511, 0),
        CellValue::number(512.0)
    );
    engine.import_from_xlsx_bytes_deferred(&bytes).unwrap();
    let active = engine.cell_store().sheet_by_name("Active").unwrap();
    assert_eq!(
        engine.get_cell_value(&active, 511, 0),
        CellValue::number(512.0)
    );
}
