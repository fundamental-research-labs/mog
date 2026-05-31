use super::*;
use snapshot_types::properties::{CellMetadata, RegionBounds, RegionKind, RegionMeta};
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

fn data_table_minimal_fixture_xlsx() -> Vec<u8> {
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
  <dimension ref="A1:C3"/>
  <sheetData>
    <row r="1"><c r="A1"><v>2</v></c><c r="B1"><v>5</v></c><c r="C1"><v>10</v></c></row>
    <row r="2"><c r="A2"><v>3</v></c><c r="B2"><f t="dataTable" ref="B2:C3" r1="$A$1" r2="$A$2" dt2D="1"/><v>5</v></c><c r="C2"><v>10</v></c></row>
    <row r="3"><c r="B3"><v>5.5</v></c><c r="C3"><v>11</v></c></row>
  </sheetData>
</worksheet>"#
            .to_vec(),
    );
    zip.finish()
        .expect("minimal data table fixture should be writable")
}

fn assert_deferred_data_table_readback(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    is_anchor: bool,
    phase: &str,
) {
    let cell_id = CellId::from_uuid_str(
        &engine
            .get_cell_id_at(sheet_id, row, col)
            .unwrap_or_else(|| panic!("{phase}: data table cell should be materialized")),
    )
    .unwrap();
    let active = engine.get_active_cell(sheet_id, &cell_id);
    assert_eq!(
        active.formula.as_deref(),
        Some("=TABLE($A$2,$A$1)"),
        "{phase}: active cell should expose synthesized TABLE formula"
    );

    let metadata: CellMetadata = serde_json::from_value(
        active
            .metadata
            .clone()
            .unwrap_or_else(|| panic!("{phase}: active cell should expose region metadata")),
    )
    .expect("active cell metadata should deserialize");
    assert_eq!(metadata.is_array_formula, true, "{phase}: array flag");
    assert_eq!(metadata.is_cse_anchor, false, "{phase}: CSE anchor flag");
    assert_eq!(
        metadata.is_array_member, !is_anchor,
        "{phase}: array member flag"
    );
    assert_eq!(
        metadata.region,
        Some(RegionMeta {
            kind: RegionKind::DataTable,
            is_anchor,
            anchor_row: 1,
            anchor_col: 1,
            bounds: RegionBounds { rows: 2, cols: 2 },
        }),
        "{phase}: active-cell region metadata"
    );

    let cell_data = engine
        .get_cell_data(sheet_id, row, col)
        .unwrap_or_else(|| panic!("{phase}: get_cell_data should return the data table cell"));
    assert_eq!(
        cell_data.get("formula").and_then(|value| value.as_str()),
        Some("TABLE($A$2,$A$1)"),
        "{phase}: get_cell_data formula"
    );
    let region = cell_data
        .get("region")
        .unwrap_or_else(|| panic!("{phase}: get_cell_data should expose region"));
    assert_eq!(
        region.get("kind").and_then(|value| value.as_str()),
        Some("dataTable"),
        "{phase}: get_cell_data region kind"
    );
    assert_eq!(
        region.get("isAnchor").and_then(|value| value.as_bool()),
        Some(is_anchor),
        "{phase}: get_cell_data anchor flag"
    );
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
fn deferred_xlsx_import_exposes_data_table_region_metadata_before_full_hydration() {
    let bytes = data_table_minimal_fixture_xlsx();

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

    assert_eq!(
        engine.mirror().all_data_table_regions().len(),
        1,
        "deferred first-sheet snapshot must retain data table regions"
    );
    assert_deferred_data_table_readback(&engine, &sheet_id, 1, 1, true, "before full hydration");
    assert_deferred_data_table_readback(&engine, &sheet_id, 2, 2, false, "before full hydration");

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");
    assert_deferred_data_table_readback(&engine, &sheet_id, 1, 1, true, "after full hydration");
    assert_deferred_data_table_readback(&engine, &sheet_id, 2, 2, false, "after full hydration");
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
