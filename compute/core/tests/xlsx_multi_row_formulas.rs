//! Formula strings on later rows of a bulk write must survive export (#328).

use compute_core::storage::engine::ComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;
use xlsx_parser::zip::XlsxArchive;

fn blank_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "a0000000-0000-0000-0000-000000000001".into(),
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

#[test]
fn bulk_set_keeps_formula_strings_on_every_row_after_export() {
    let (mut engine, _) = ComputeEngine::from_snapshot(blank_snapshot()).unwrap();
    let sid = *engine.cell_store().sheet_ids().next().unwrap();
    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (0, 0, "100".into()),
                (0, 1, "=A1".into()),
                (0, 2, "=B1+B2".into()),
                (1, 0, "200".into()),
                (1, 1, "=A2".into()),
            ],
        )
        .unwrap();

    let exported = engine.export_to_xlsx_bytes().expect("export");
    let xml = String::from_utf8(
        XlsxArchive::new(&exported)
            .unwrap()
            .read_file("xl/worksheets/sheet1.xml")
            .unwrap(),
    )
    .unwrap();
    assert!(
        xml.contains("<f>A1</f>") || xml.contains("<f>=A1</f>"),
        "{xml}"
    );
    assert!(
        xml.contains("<f>A2</f>") || xml.contains("<f>=A2</f>"),
        "second-row formula lost: {xml}"
    );
}
