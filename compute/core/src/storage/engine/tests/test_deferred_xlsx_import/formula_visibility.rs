use super::*;
use value_types::{CellError, CellValue};
use xlsx_parser::write::ZipWriter;

fn formula_text_fixture_xlsx() -> Vec<u8> {
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Formulas".to_string(),
            rows: 3,
            cols: 4,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::number(10.0),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 1,
                    value: CellValue::number(20.0),
                    formula: Some("=A1*2".to_string()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    xlsx_parser::write::write_xlsx_from_parse_output(&output)
        .expect("formula text fixture should be writable")
}

fn sheets_type_conversion_fixture_xlsx() -> Vec<u8> {
    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#
            .to_vec(),
    )
    .add_file(
        "_rels/.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file(
        "xl/workbook.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#
            .to_vec(),
    )
    .add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file(
        "xl/worksheets/sheet1.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:A6"/>
  <sheetData>
    <row r="1"><c r="A1"><f>EPOCHTODATE(0,1)</f><v>25569</v></c></row>
    <row r="2"><c r="A2"><f>TO_DATE(1)</f><v>1</v></c></row>
    <row r="3"><c r="A3"><f>TO_DOLLARS(12.5)</f><v>12.5</v></c></row>
    <row r="4"><c r="A4"><f>TO_PERCENT(0.5)</f><v>0.5</v></c></row>
    <row r="5"><c r="A5"><f>TO_PURE_NUMBER(50%)</f><v>0.5</v></c></row>
    <row r="6"><c r="A6" t="str"><f>TO_TEXT(24)</f><v>24</v></c></row>
  </sheetData>
</worksheet>"#
            .to_vec(),
    );
    zip.finish()
        .expect("sheets type conversion fixture should be writable")
}

#[test]
fn deferred_xlsx_import_exposes_first_sheet_formula_text_before_graph_build() {
    let bytes = formula_text_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let sheet_id_hex = engine
        .get_all_sheet_ids()
        .first()
        .cloned()
        .expect("imported workbook should have a first sheet");
    let sheet_id = SheetId::from_uuid_str(&sheet_id_hex).unwrap();
    let b1_id = CellId::from_uuid_str(
        &engine
            .get_cell_id_at(&sheet_id, 0, 1)
            .expect("B1 formula cell should be materialized"),
    )
    .unwrap();

    assert_eq!(engine.get_formula(&b1_id), Some("=A1*2".to_string()));

    let raw = engine
        .get_raw_cell_data(&sheet_id, 0, 1, true)
        .expect("raw cell data should exist for B1");
    assert_eq!(raw.formula.as_deref(), Some("=A1*2"));

    let active = engine.get_active_cell(&sheet_id, &b1_id);
    assert_eq!(active.formula.as_deref(), Some("=A1*2"));

    let info = engine
        .get_cell_info(&sheet_id, 0, 1)
        .expect("cell info should identify B1 as a formula cell");
    assert_eq!(info.formula.as_deref(), Some("=A1*2"));

    let cell_data = engine
        .get_cell_data(&sheet_id, 0, 1)
        .expect("cell data should exist for B1");
    assert_eq!(
        cell_data.get("formula").and_then(|v| v.as_str()),
        Some("A1*2")
    );
    assert_eq!(engine.get_raw_value(&sheet_id, 0, 1), "=A1*2");

    let queried = engine.query_range(&sheet_id, 0, 1, 0, 1);
    assert_eq!(queried.cells.len(), 1);
    assert_eq!(queried.cells[0].formula.as_deref(), Some("=A1*2"));

    let identity = engine.get_range_with_identity(&sheet_id, 0, 1, 0, 1);
    assert_eq!(identity.len(), 1);
    assert_eq!(identity[0].formula_text.as_deref(), Some("=A1*2"));

    let viewport = engine.build_viewport_render_data_show_formulas(&sheet_id, 0, 0, 2, 2, true);
    let b1 = viewport
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 1)
        .expect("B1 should be present in the viewport");
    assert!(
        b1.flags & compute_wire::flags::HAS_FORMULA != 0,
        "viewport B1 should carry HAS_FORMULA, flags={:#x}",
        b1.flags,
    );
    assert_eq!(b1.formatted.as_deref(), Some("=A1*2"));
}

#[test]
fn deferred_xlsx_import_recalculates_sheets_type_conversion_functions() {
    let bytes = sheets_type_conversion_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let sheet_id_hex = engine
        .get_all_sheet_ids()
        .first()
        .cloned()
        .expect("imported workbook should have a first sheet");
    let sheet_id = SheetId::from_uuid_str(&sheet_id_hex).unwrap();

    let a1_id = CellId::from_uuid_str(
        &engine
            .get_cell_id_at(&sheet_id, 0, 0)
            .expect("A1 formula cell should be materialized"),
    )
    .unwrap();
    assert_eq!(
        engine.get_formula(&a1_id),
        Some("=EPOCHTODATE(0,1)".to_string())
    );

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");
    engine
        .recalculate()
        .expect("post-hydration recalculation should succeed");

    let expected = [
        (0, CellValue::number(25569.0)),
        (1, CellValue::number(1.0)),
        (2, CellValue::number(12.5)),
        (3, CellValue::number(0.5)),
        (4, CellValue::number(0.5)),
        (5, CellValue::Text("24".into())),
    ];
    for (row, expected_value) in expected {
        let actual = engine.get_cell_value(&sheet_id, row, 0);
        assert!(
            !matches!(actual, CellValue::Error(CellError::Name, _)),
            "A{} should not degrade to #NAME?",
            row + 1
        );
        assert_eq!(
            actual,
            expected_value,
            "unexpected post-recalc value for A{}",
            row + 1
        );
    }
}
