//! Workbook date-system metadata must reach production formula evaluation.
use super::super::ComputeEngine;
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

fn assert_date(engine: &ComputeEngine, expected: &str) {
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
fn text_date_system_survives_xlsx_import_rebuild_and_native_rebuild() {
    for (date1904, expected) in [(false, "1900-01-01"), (true, "1904-01-02")] {
        let bytes = workbook_bytes(date1904);
        let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
        engine.recalculate().unwrap();
        assert_date(&engine, expected);
        engine.rebuild_compute_core().unwrap();
        assert_date(&engine, expected);
        let replayed = super::helpers::rebuild_native_engine(&engine);
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
fn text_date_system_settings_updates_invalidate_calculation_and_native_rebuild() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook_bytes(false)).unwrap();
    engine.recalculate().unwrap();
    assert_date(&engine, "1900-01-01");

    engine
        .set_workbook_setting("date1904", serde_json::json!(true))
        .unwrap();
    engine.recalculate().unwrap();
    assert_date(&engine, "1904-01-02");
    let peer = super::helpers::rebuild_native_engine(&engine);
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
