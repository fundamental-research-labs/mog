//! Authored chart titles must export `<c:overlay val="0"/>` (#338).

use compute_core::storage::engine::ComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};
use xlsx_parser::zip::XlsxArchive;

fn snapshot_with_chart_data() -> WorkbookSnapshot {
    let mut cells = vec![CellData {
        cell_id: "a0000000-0000-0000-0000-000000000001".into(),
        row: 0,
        col: 0,
        value: CellValue::Text("Month".into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }];
    cells.push(CellData {
        cell_id: "a0000000-0000-0000-0000-000000000002".into(),
        row: 0,
        col: 1,
        value: CellValue::Text("Units".into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });
    for i in 0..4u32 {
        cells.push(CellData {
            cell_id: format!("a0000000-0000-0000-0000-{:012x}", 10 + i),
            row: i + 1,
            col: 0,
            value: CellValue::Text(format!("M{i}").into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: format!("a0000000-0000-0000-0000-{:012x}", 20 + i),
            row: i + 1,
            col: 1,
            value: CellValue::Number(FiniteF64::must(10.0 + f64::from(i) * 3.0)),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 10,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

#[test]
fn authored_chart_titles_export_overlay() {
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot_with_chart_data()).unwrap();
    let sid = *engine.cell_store().sheet_ids().next().unwrap();
    engine
        .create_chart(
            &sid,
            &serde_json::json!({
                "type": "column",
                "dataRange": "Sheet1!A1:B5",
                "title": "Monthly Units",
                "axis": {
                    "categoryAxis": { "title": "Month", "visible": true },
                    "valueAxis": { "title": "Units Sold", "visible": true }
                }
            }),
        )
        .unwrap();
    let exported = engine.export_to_xlsx_bytes().expect("export");
    let archive = XlsxArchive::new(&exported).unwrap();
    let chart = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();
    assert!(chart.contains(">Monthly Units<"), "{chart}");
    assert!(chart.contains(">Month<"), "{chart}");
    assert!(chart.contains(">Units Sold<"), "{chart}");
    assert!(
        chart.matches(r#"<c:overlay val="0"/>"#).count() >= 3,
        "authored titles must emit overlay: {chart}"
    );
}
