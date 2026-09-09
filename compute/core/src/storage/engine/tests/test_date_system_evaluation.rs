//! Workbook date-system metadata must reach production formula evaluation.
use super::super::YrsComputeEngine;
use super::helpers::cell_value_at;
use domain_types::{CellData, ParseOutput, SheetData, domain::workbook::WorkbookProperties};
use value_types::CellValue;

fn workbook_bytes(date1904: bool) -> Vec<u8> {
    let input = ParseOutput {
        workbook_properties: Some(WorkbookProperties {
            date1904,
            ..Default::default()
        }),
        sheets: vec![SheetData {
            name: "Dates".into(),
            rows: 1,
            cols: 3,
            cells: vec![
                CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::from(1.0),
                    ..Default::default()
                },
                CellData {
                    row: 0,
                    col: 1,
                    formula: Some("TEXT(A1,\"yyyy-mm-dd\")".into()),
                    ..Default::default()
                },
                CellData {
                    row: 0,
                    col: 2,
                    formula: Some("TEXT({1;2},\"yyyy-mm-dd\")".into()),
                    array_ref: Some("C1:C2".into()),
                    cell_formula: Some(ooxml_types::worksheet::CellFormula {
                        t: ooxml_types::worksheet::CellFormulaType::Array,
                        r#ref: Some("C1:C2".into()),
                        text: "TEXT({1;2},\"yyyy-mm-dd\")".into(),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    xlsx_parser::write::write_xlsx_from_parse_output(&input).unwrap()
}

fn assert_date(engine: &YrsComputeEngine, expected: &str) {
    let sheet_id = engine.stores.storage.sheet_order()[0];
    assert_eq!(
        cell_value_at(engine, &sheet_id, 0, 1),
        CellValue::from(expected)
    );
    assert_eq!(
        cell_value_at(engine, &sheet_id, 0, 2),
        CellValue::from(expected)
    );
    assert_eq!(
        cell_value_at(engine, &sheet_id, 1, 2),
        CellValue::from(if expected == "1900-01-01" {
            "1900-01-02"
        } else {
            "1904-01-03"
        })
    );
}

#[test]
fn text_date_system_survives_xlsx_import_rebuild_and_yrs_replay() {
    for (date1904, expected) in [(false, "1900-01-01"), (true, "1904-01-02")] {
        let bytes = workbook_bytes(date1904);
        let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).unwrap();
        engine.recalculate().unwrap();
        assert_date(&engine, expected);
        engine.rebuild_compute_core().unwrap();
        assert_date(&engine, expected);
        let state = compute_collab::encode_full_state(engine.storage().doc());
        let (replayed, _) = YrsComputeEngine::from_yrs_state(&state).unwrap();
        assert_date(&replayed, expected);
        // Import into an existing engine must install the date system before
        // its initial calculation (this constructor rebuilds the mirror).
        engine
            .import_from_xlsx_bytes(&workbook_bytes(!date1904), true)
            .unwrap();
        assert_date(&engine, if date1904 { "1900-01-01" } else { "1904-01-02" });
    }
}

#[test]
fn text_date_system_settings_updates_invalidate_calculation_and_sync() {
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&workbook_bytes(false)).unwrap();
    engine.recalculate().unwrap();
    assert_date(&engine, "1900-01-01");
    let state = compute_collab::encode_full_state(engine.storage().doc());
    let (mut peer, _) = YrsComputeEngine::from_yrs_state(&state).unwrap();

    engine
        .set_workbook_setting("date1904", serde_json::json!(true))
        .unwrap();
    engine.recalculate().unwrap();
    assert_date(&engine, "1904-01-02");
    let update = engine.encode_diff(&peer.encode_state_vector()).unwrap();
    peer.apply_sync_update_legacy(&update).unwrap();
    assert_date(&peer, "1904-01-02");

    engine
        .patch_workbook_settings(
            serde_json::from_value(serde_json::json!({"date1904": false})).unwrap(),
        )
        .unwrap();
    engine.recalculate().unwrap();
    assert_date(&engine, "1900-01-01");
    let mut settings = engine.get_workbook_settings();
    settings.date1904 = true;
    engine.set_workbook_settings(settings).unwrap();
    engine.recalculate().unwrap();
    assert_date(&engine, "1904-01-02");
    engine.reset_workbook_settings().unwrap();
    engine.recalculate().unwrap();
    assert_date(&engine, "1900-01-01");
}

#[test]
fn cf_literal_dates_refresh_on_date_system_settings_changes() {
    use super::helpers::{sheet_id, simple_snapshot};
    use snapshot_types::RecalcOptions;
    use value_types::FiniteF64;

    let mut snapshot = simple_snapshot();
    snapshot.sheets[0].cells.truncate(1);
    // January 1, 1904 in the 1900 system; January 2, 1908 in 1904.
    snapshot.sheets[0].cells[0].value = CellValue::number(1462.0);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sid = sheet_id();
    engine
        .recalculate_with_options(&RecalcOptions {
            timestamp_serial: Some(FiniteF64::must(1462.75)),
            ..Default::default()
        })
        .unwrap();
    engine
        .add_cf_rule(
            &sid,
            serde_json::json!({
                "id": "calendar-format", "sheetId": sid.to_uuid_string(),
                "ranges": [{"startRow": 0, "startCol": 0, "endRow": 0, "endCol": 0}],
                "rules": [{"id": "calendar-today", "type": "timePeriod", "priority": 1,
                    "timePeriod": "today", "style": {"bold": true}}]
            }),
        )
        .unwrap();
    assert_eq!(
        engine.get_displayed_cell_properties(&sid, 0, 0).bold,
        Some(true)
    );

    // Displayed properties resolve the non-CF font default to false.
    engine
        .set_workbook_setting("date1904", serde_json::json!(true))
        .unwrap();
    assert_eq!(
        engine.get_displayed_cell_properties(&sid, 0, 0).bold,
        Some(false)
    );
    assert_eq!(
        cell_value_at(&engine, &sid, 0, 0),
        CellValue::number(1462.0)
    );

    engine
        .patch_workbook_settings(
            serde_json::from_value(serde_json::json!({"date1904": false})).unwrap(),
        )
        .unwrap();
    assert_eq!(
        engine.get_displayed_cell_properties(&sid, 0, 0).bold,
        Some(true)
    );

    let mut settings = engine.get_workbook_settings();
    settings.date1904 = true;
    engine.set_workbook_settings(settings).unwrap();
    assert_eq!(
        engine.get_displayed_cell_properties(&sid, 0, 0).bold,
        Some(false)
    );
    engine.reset_workbook_settings().unwrap();
    assert_eq!(
        engine.get_displayed_cell_properties(&sid, 0, 0).bold,
        Some(true)
    );

    // Explicit recalculation must preserve the same cache result with no
    // formula cells and no numeric changes to drive CF invalidation.
    engine
        .recalculate_with_options(&RecalcOptions {
            timestamp_serial: Some(FiniteF64::must(1462.75)),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        engine.get_displayed_cell_properties(&sid, 0, 0).bold,
        Some(true)
    );
}
