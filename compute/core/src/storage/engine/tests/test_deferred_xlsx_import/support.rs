use super::*;
use value_types::CellValue;
use xlsx_parser::write::ZipWriter;

#[derive(Clone, Copy)]
pub(super) enum DeferredCalcFixtureMode {
    FullCalcOnLoad,
    ForceFullCalcManual,
    Control,
}

pub(super) fn style_only_empty_fill_fixture_xlsx() -> Vec<u8> {
    let output = domain_types::ParseOutput {
        style_palette: vec![domain_types::DocumentFormat {
            fill: Some(domain_types::FillFormat {
                background_color: Some("#FFEE00".to_string()),
                pattern_type: Some("solid".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }],
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 1,
                value: CellValue::Text("anchor".into()),
                ..Default::default()
            }],
            authored_style_runs: vec![domain_types::AuthoredStyleRun {
                start_row: 0,
                start_col: 0,
                end_row: 2,
                end_col: 2,
                style_id: 0,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    xlsx_parser::write::write_xlsx_from_parse_output(&output)
        .expect("style-only empty fill fixture should be writable")
}

pub(super) fn basic_import_fixture_xlsx() -> Vec<u8> {
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 3,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text("Name".into()),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Score".into()),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 1,
                    col: 0,
                    value: CellValue::Text("Alice".into()),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 1,
                    col: 1,
                    value: CellValue::number(42.0),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    xlsx_parser::write::write_xlsx_from_parse_output(&output)
        .expect("basic import fixture should be writable")
}

pub(super) fn assert_viewport_empty_cell_fill(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    phase: &str,
) {
    let viewport = engine.build_viewport_render_data(sheet_id, row, col, row + 1, col + 1);
    let cell = viewport
        .cells
        .iter()
        .find(|cell| cell.row == row && cell.col == col)
        .unwrap_or_else(|| panic!("{phase}: viewport cell {row},{col} should be present"));
    let format = viewport
        .format_palette
        .get(cell.format_idx as usize)
        .unwrap_or_else(|| panic!("{phase}: viewport format index should be valid"));
    assert_eq!(
        format.background_color.as_deref(),
        Some("#FFEE00"),
        "{phase}: style-only empty cell fill should render through the viewport path; got {format:?}",
    );
}

pub(super) fn deferred_calc_fixture_xlsx(mode: DeferredCalcFixtureMode) -> Vec<u8> {
    let calc_pr = match mode {
        DeferredCalcFixtureMode::FullCalcOnLoad => {
            r#"<calcPr calcMode="autoNoTable" fullCalcOnLoad="1" iterate="1" iterateCount="12" iterateDelta="0.0001"/>"#
        }
        DeferredCalcFixtureMode::ForceFullCalcManual => {
            r#"<calcPr calcMode="manual" forceFullCalc="1"/>"#
        }
        DeferredCalcFixtureMode::Control => r#"<calcPr calcMode="auto"/>"#,
    };
    let workbook = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  {calc_pr}
  <sheets>
    <sheet name="First" sheetId="1" r:id="rId1"/>
    <sheet name="Second" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"#
    );
    let sheet1 = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B1"/>
  <sheetData>
    <row r="1"><c r="A1"><v>2</v></c><c r="B1"><f>A1*3</f><v></v></c></row>
  </sheetData>
</worksheet>"#;
    let sheet2 = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B1"/>
  <sheetData>
    <row r="1"><c r="A1"><v>4</v></c><c r="B1"><f>A1+5</f><v></v></c></row>
  </sheetData>
</worksheet>"#;

    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
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
    .add_file("xl/workbook.xml", workbook.into_bytes())
    .add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file("xl/worksheets/sheet1.xml", sheet1.as_bytes().to_vec())
    .add_file("xl/worksheets/sheet2.xml", sheet2.as_bytes().to_vec());
    zip.finish().expect("write deferred calc fixture")
}

pub(super) fn named_range_concat_fixture_xlsx() -> Vec<u8> {
    let workbook = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Model" sheetId="1" r:id="rId1"/>
  </sheets>
  <definedNames>
    <definedName name="Company_Name">Model!$A$1</definedName>
    <definedName name="Scenario">Model!$A$2</definedName>
  </definedNames>
  <calcPr calcId="191029"/>
</workbook>"#;
    let sheet1 = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B2"/>
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>1</v></c>
      <c r="B2" t="str">
        <f>Company_Name&amp;" - Operating Model - "&amp;Scenario&amp;" Case"</f>
        <v>Central Japan Railway Co. - Operating Model - Base Case</v>
      </c>
    </row>
  </sheetData>
</worksheet>"#;
    let shared_strings = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>Central Japan Railway Co.</t></si>
  <si><t>Base</t></si>
</sst>"#;

    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
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
    .add_file("xl/workbook.xml", workbook.as_bytes().to_vec())
    .add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file("xl/worksheets/sheet1.xml", sheet1.as_bytes().to_vec())
    .add_file("xl/sharedStrings.xml", shared_strings.as_bytes().to_vec());
    zip.finish().expect("write named-range concat fixture")
}

pub(super) fn sheet_ids(engine: &YrsComputeEngine) -> (SheetId, SheetId) {
    let ids = engine.get_all_sheet_ids();
    assert_eq!(ids.len(), 2, "fixture should import two sheets");
    (
        SheetId::from_uuid_str(&ids[0]).unwrap(),
        SheetId::from_uuid_str(&ids[1]).unwrap(),
    )
}

pub(super) fn assert_changed_formula(
    mutation: &snapshot_types::MutationResult,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    expected: f64,
) {
    let change = mutation
        .recalc
        .changed_cells
        .iter()
        .find(|change| {
            change.sheet_id == sheet_id.to_uuid_string()
                && change
                    .position
                    .as_ref()
                    .is_some_and(|pos| pos.row == row && pos.col == col)
        })
        .unwrap_or_else(|| {
            panic!(
                "missing changed formula at sheet={} row={row} col={col}; changes={:?}",
                sheet_id.to_uuid_string(),
                mutation.recalc.changed_cells
            )
        });
    assert_eq!(change.value, CellValue::number(expected));
    assert!(
        change
            .display_text
            .as_deref()
            .is_some_and(|text| !text.is_empty()),
        "changed formula should carry display_text: {change:?}",
    );
    assert!(
        change.extra_flags & compute_wire::flags::HAS_FORMULA != 0,
        "changed formula should carry HAS_FORMULA: {change:?}",
    );
}
