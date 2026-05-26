//! Regression coverage for the XLSX deferred-open production path.

use super::super::*;
use super::helpers::*;
use cell_types::PayloadEncoding;
use value_types::{CellError, CellValue};
use xlsx_parser::write::ZipWriter;

#[derive(Clone, Copy)]
enum DeferredCalcFixtureMode {
    FullCalcOnLoad,
    ForceFullCalcManual,
    Control,
}

fn mixed_deferred_value(row: u32, col: u32) -> CellValue {
    match (row + col) % 3 {
        0 => CellValue::Text(format!("mixed-{col}-{row}").into()),
        1 => CellValue::Boolean(row % 2 == 0),
        _ => CellValue::from(CellError::Ref),
    }
}

fn assert_mixed_grid_visible(engine: &YrsComputeEngine, sheet_id: &SheetId, rows: u32, cols: u32) {
    for &(row, col) in &[
        (0, 0),
        (1, 0),
        (2, 0),
        (3, 0),
        (rows - 1, 0),
        (rows - 2, 0),
        (rows - 3, 1),
        (rows - 4, cols - 1),
    ] {
        assert_eq!(
            engine.get_cell_value(sheet_id, row, col),
            mixed_deferred_value(row, col),
            "mismatched deferred mixed value at row={row}, col={col}",
        );
    }
}

fn assert_mixed_cbor_ranges(engine: &YrsComputeEngine, sheet_id: &SheetId, rows: u32, cols: u32) {
    let sheet = engine
        .mirror()
        .get_sheet(sheet_id)
        .expect("mixed-cbor sheet should exist in mirror");
    let mixed_ranges: Vec<_> = sheet
        .iter_ranges()
        .map(|(_, range)| range)
        .filter(|range| range.encoding == PayloadEncoding::MixedCbor)
        .collect();

    assert_eq!(
        mixed_ranges.len(),
        cols as usize,
        "column-oriented classifier should promote one MixedCbor range per long mixed column",
    );
    for range in mixed_ranges {
        assert_eq!(range.num_rows(), rows);
        assert_eq!(range.num_cols(), 1);
    }
}

fn assert_mixed_counta_formula(engine: &mut YrsComputeEngine, sheet_id: &SheetId, rows: u32) {
    let col_len = engine
        .mirror()
        .get_sheet(sheet_id)
        .and_then(|sheet| sheet.get_column_slice(0))
        .map(|col| col.len())
        .unwrap_or(0);
    assert_eq!(
        col_len, rows as usize,
        "MixedCbor column data must be fully materialized for formula range aggregation",
    );

    let formula_cell_id = CellId::from_uuid_str("f2000000-0000-4000-8000-000000000044").unwrap();
    engine
        .set_cell(
            sheet_id,
            formula_cell_id,
            0,
            3,
            crate::bridge_types::CellInput::Parse {
                text: format!("=COUNTA(A1:A{rows})"),
            },
        )
        .expect("COUNTA formula over MixedCbor import column should be accepted");

    assert_eq!(
        engine.get_cell_value(sheet_id, 0, 3),
        CellValue::number(rows as f64),
        "COUNTA must aggregate every MixedCbor range cell, not just the first materialized row",
    );
}

fn style_only_empty_fill_fixture_xlsx() -> Vec<u8> {
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

    xlsx_parser::write::write_xlsx_from_parse_output(&output, None)
        .expect("style-only empty fill fixture should be writable")
}

fn assert_viewport_empty_cell_fill(
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

fn deferred_calc_fixture_xlsx(mode: DeferredCalcFixtureMode) -> Vec<u8> {
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

fn named_range_concat_fixture_xlsx() -> Vec<u8> {
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

fn sheet_ids(engine: &YrsComputeEngine) -> (SheetId, SheetId) {
    let ids = engine.get_all_sheet_ids();
    assert_eq!(ids.len(), 2, "fixture should import two sheets");
    (
        SheetId::from_uuid_str(&ids[0]).unwrap(),
        SheetId::from_uuid_str(&ids[1]).unwrap(),
    )
}

fn assert_changed_formula(
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

#[test]
fn deferred_xlsx_full_calc_on_load_recalculates_empty_formula_caches_on_completion() {
    let bytes = deferred_calc_fixture_xlsx(DeferredCalcFixtureMode::FullCalcOnLoad);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    let (first, _second) = sheet_ids(&engine);
    assert_eq!(engine.get_cell_value(&first, 0, 1), CellValue::Null);

    let (_, mutation) = engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should honor fullCalcOnLoad");
    let (first, second) = sheet_ids(&engine);

    assert_eq!(engine.get_cell_value(&first, 0, 1), CellValue::number(6.0));
    assert_eq!(engine.get_cell_value(&second, 0, 1), CellValue::number(9.0));
    assert_changed_formula(&mutation, &first, 0, 1, 6.0);
    assert_changed_formula(&mutation, &second, 0, 1, 9.0);

    let settings = engine.get_calculation_settings();
    assert!(settings.full_calc_on_load);
    assert!(settings.enable_iterative_calculation);
    assert_eq!(settings.max_iterations, 12);
}

#[test]
fn deferred_xlsx_force_full_calc_recalculates_even_when_manual() {
    let bytes = deferred_calc_fixture_xlsx(DeferredCalcFixtureMode::ForceFullCalcManual);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let (_, mutation) = engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should honor forceFullCalc");
    let (first, second) = sheet_ids(&engine);

    assert_eq!(engine.get_cell_value(&first, 0, 1), CellValue::number(6.0));
    assert_eq!(engine.get_cell_value(&second, 0, 1), CellValue::number(9.0));
    assert_changed_formula(&mutation, &first, 0, 1, 6.0);
    assert_changed_formula(&mutation, &second, 0, 1, 9.0);
    assert!(!engine.get_calculation_settings().full_calc_on_load);

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("post-hydration export should preserve calc metadata");
    let archive = xlsx_parser::zip::XlsxArchive::new(&exported).expect("export should be a zip");
    let workbook_xml =
        String::from_utf8(archive.get_workbook().expect("workbook.xml should exist")).unwrap();
    assert!(
        workbook_xml.contains("forceFullCalc=\"1\""),
        "forceFullCalc must survive deferred completion/export: {workbook_xml}"
    );
}

#[test]
fn deferred_xlsx_without_force_calc_keeps_empty_formula_caches_until_explicit_recalc() {
    let bytes = deferred_calc_fixture_xlsx(DeferredCalcFixtureMode::Control);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let (_, mutation) = engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should not force ordinary workbooks");
    let (first, second) = sheet_ids(&engine);

    assert!(
        mutation.recalc.changed_cells.is_empty(),
        "ordinary deferred completion should not recalc: {:?}",
        mutation.recalc.changed_cells
    );
    assert_eq!(engine.get_cell_value(&first, 0, 1), CellValue::Null);
    assert_eq!(engine.get_cell_value(&second, 0, 1), CellValue::Null);

    let recalc = engine
        .recalculate_with_options(&snapshot_types::RecalcOptions {
            iterative: Some(false),
            max_iterations: Some(100),
            max_change: Some(value_types::FiniteF64::must(0.001)),
        })
        .expect("explicit post-hydration full recalc should populate formula values");
    assert_eq!(engine.get_cell_value(&first, 0, 1), CellValue::number(6.0));
    assert_eq!(engine.get_cell_value(&second, 0, 1), CellValue::number(9.0));
    assert!(
        recalc.changed_cells.iter().any(|change| {
            change.sheet_id == first.to_uuid_string()
                && change
                    .position
                    .as_ref()
                    .is_some_and(|pos| pos.row == 0 && pos.col == 1)
        }),
        "explicit recalc should report first-sheet formula: {:?}",
        recalc.changed_cells
    );
    assert!(
        recalc.changed_cells.iter().any(|change| {
            change.sheet_id == second.to_uuid_string()
                && change
                    .position
                    .as_ref()
                    .is_some_and(|pos| pos.row == 0 && pos.col == 1)
        }),
        "explicit recalc should report second-sheet formula: {:?}",
        recalc.changed_cells
    );
}

#[test]
fn deferred_xlsx_import_exposes_first_sheet_formula_text_before_graph_build() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dev/app-eval/scenarios/import-export/fixtures/formulas.xlsx");
    let bytes = std::fs::read(fixture).expect("formulas.xlsx fixture should be readable");

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
    // Deterministic fixture generated from hand-authored OOXML on 2026-05-24.
    // It contains real XLSX formula cells in A1:A6 and no snapshot shortcut.
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dev/api-eval/fixtures/sheets-type-conversion-functions.xlsx");
    let bytes = std::fs::read(fixture).expect("sheets type conversion fixture should be readable");

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

#[test]
fn deferred_xlsx_import_streams_long_mixed_cbor_ranges() {
    let rows = 1024;
    let cols = 3;
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dev/api-eval/fixtures/mixed-cbor-deferred-import.xlsx");
    let bytes = std::fs::read(fixture).expect("mixed-cbor fixture should be readable");

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred mixed-cbor XLSX import should succeed");

    let sheet_id_hex = engine
        .get_all_sheet_ids()
        .first()
        .cloned()
        .expect("imported mixed-cbor workbook should have a first sheet");
    let sheet_id = SheetId::from_uuid_str(&sheet_id_hex).unwrap();

    assert_mixed_grid_visible(&engine, &sheet_id, rows, cols);

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should stream MixedCbor ranges");

    assert_mixed_grid_visible(&engine, &sheet_id, rows, cols);
    assert_mixed_counta_formula(&mut engine, &sheet_id, rows);
    assert_mixed_cbor_ranges(&engine, &sheet_id, rows, cols);
}

#[test]
fn deferred_xlsx_export_rejects_partial_workbook_until_full_hydration() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dev/app-eval/scenarios/import-export/fixtures/multi-sheet.xlsx");
    let bytes = std::fs::read(fixture).expect("multi-sheet.xlsx fixture should be readable");

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let parse_err = engine
        .export_to_parse_output()
        .expect_err("parse output export must not read a partial deferred workbook");
    assert!(
        parse_err.to_string().contains("deferred XLSX hydration"),
        "partial export should fail with a materialization error, got {parse_err}",
    );
    let bytes_err = engine
        .export_to_xlsx_bytes()
        .expect_err("XLSX export must not serialize a partial deferred workbook");
    assert!(
        bytes_err.to_string().contains("deferred XLSX hydration"),
        "partial XLSX export should fail with a materialization error, got {bytes_err}",
    );

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");
    let exported = engine
        .export_to_xlsx_bytes()
        .expect("XLSX export should succeed after full hydration");
    let parsed = xlsx_api::parse(&exported).expect("exported XLSX should parse");
    assert!(
        parsed.output.sheets.len() >= 2,
        "post-hydration export should include non-initial sheets",
    );
}

#[test]
fn deferred_xlsx_import_exposes_first_sheet_formatting_before_full_hydration() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../file-io/xlsx/parser/test-corpus/parity/cells/basic-formatting.xlsx");
    let bytes = std::fs::read(fixture).expect("basic-formatting fixture should be readable");

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

    let a1_id = engine
        .get_cell_id_at(&sheet_id, 0, 0)
        .expect("A1 should be materialized on the deferred first sheet");
    let a1_format =
        engine.get_cell_format(&sheet_id, &CellId::from_uuid_str(&a1_id).unwrap(), 0, 0);
    assert_eq!(a1_format.bold, Some(true));

    let c2_id = engine
        .get_cell_id_at(&sheet_id, 1, 2)
        .expect("C2 should be materialized on the deferred first sheet");
    let c2_format =
        engine.get_cell_format(&sheet_id, &CellId::from_uuid_str(&c2_id).unwrap(), 1, 2);
    assert!(
        c2_format.background_color.is_some() || c2_format.pattern_foreground_color.is_some(),
        "C2 imported fill should be visible before complete_deferred_hydration; got {c2_format:?}"
    );

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");
    let c2_id_after = engine
        .get_cell_id_at(&sheet_id, 1, 2)
        .expect("C2 should remain materialized after full hydration");
    let c2_format_after = engine.get_cell_format(
        &sheet_id,
        &CellId::from_uuid_str(&c2_id_after).unwrap(),
        1,
        2,
    );
    assert!(
        c2_format_after.background_color.is_some()
            || c2_format_after.pattern_foreground_color.is_some(),
        "C2 imported fill should remain visible after full deferred hydration; got {c2_format_after:?}"
    );
}

#[test]
fn deferred_xlsx_import_emits_picture_floating_objects_before_full_hydration() {
    let (mut source, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let source_sheet_id = sheet_id();
    let picture_config = serde_json::json!({
        "type": "picture",
        "src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        "anchor": {
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffsetEmu": 0,
            "anchorColOffsetEmu": 0,
            "anchorMode": "oneCell",
            "extentCxEmu": 1905000,
            "extentCyEmu": 1428750
        },
        "width": 200.0,
        "height": 150.0,
        "visible": true,
        "printable": true,
        "flipH": false,
        "flipV": false,
        "opacity": 1.0,
        "rotation": 0.0,
        "name": "Deferred Picture"
    });
    source
        .create_floating_object(&source_sheet_id, &picture_config)
        .expect("picture creation should succeed");
    let exported = source
        .export_to_xlsx_bytes()
        .expect("source workbook with picture should export");
    let parsed_export = xlsx_api::parse(&exported).expect("exported XLSX should parse");
    assert_eq!(
        parsed_export.output.sheets[0].floating_objects.len(),
        1,
        "exported XLSX should contain one parsed picture floating object"
    );

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let (_patches, result) = imported
        .import_from_xlsx_bytes_deferred(&exported)
        .expect("deferred XLSX import should succeed");

    assert_eq!(
        result.floating_object_changes.len(),
        1,
        "deferred import must emit picture floating-object creation before full hydration"
    );
    let change = &result.floating_object_changes[0];
    assert!(
        matches!(
            change.kind,
            snapshot_types::FloatingObjectChangeKind::Created
        ),
        "deferred picture change must be Created, got {:?}",
        change.kind
    );
    assert_eq!(
        change.object_type,
        Some(domain_types::domain::floating_object::FloatingObjectKind::Picture)
    );
    assert!(
        change.data.is_some(),
        "deferred picture change must inline the typed object payload"
    );
    assert!(
        change
            .bounds
            .as_ref()
            .map(|b| b.width.get() > 0.0 && b.height.get() > 0.0)
            .unwrap_or(false),
        "deferred picture change must include positive render bounds, got {:?}",
        change.bounds
    );

    let sheet_id_after_import = imported
        .get_all_sheet_ids()
        .first()
        .cloned()
        .expect("deferred import should expose a sheet id");
    assert_eq!(
        change.sheet_id, sheet_id_after_import,
        "deferred picture change should be scoped to the imported sheet id"
    );
    let object = change.data.as_ref().unwrap();
    match &object.data {
        domain_types::domain::floating_object::FloatingObjectData::Picture(picture) => {
            assert!(
                picture.src.starts_with("data:image/png;base64,"),
                "hydrated picture src should be a browser-loadable data URL, got {}",
                picture.src
            );
        }
        other => panic!("deferred picture payload should be Picture data, got {other:?}"),
    }
    assert_eq!(
        object.common.sheet_id, sheet_id_after_import,
        "hydrated picture payload should carry the imported sheet id"
    );
}

#[test]
fn deferred_xlsx_import_and_completion_do_not_enqueue_provider_updates() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dev/app-eval/scenarios/import-export/fixtures/basic.xlsx");
    let bytes = std::fs::read(fixture).expect("basic.xlsx fixture should be readable");

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let pending_after_import = engine
        .drain_pending_updates()
        .expect("provider drain after import should not hit guardrail");
    assert!(
        pending_after_import.is_empty(),
        "deferred import bootstrap must be base state, not live provider updates; got {} update(s)",
        pending_after_import.len(),
    );

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let pending_after_completion = engine
        .drain_pending_updates()
        .expect("provider drain after deferred hydration should not hit guardrail");
    assert!(
        pending_after_completion.is_empty(),
        "deferred hydration completion must be base state, not live provider updates; got {} update(s)",
        pending_after_completion.len(),
    );

    let sheet_id = SheetId::from_uuid_str(
        engine
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .unwrap();
    engine
        .set_cell_value_as_text(&sheet_id, 4, 0, "post-import-edit")
        .expect("post-import edit should succeed");
    let pending_after_edit = engine
        .drain_pending_updates()
        .expect("provider drain after edit should not hit guardrail");
    assert!(
        !pending_after_edit.is_empty(),
        "post-import user edits must still flow through live provider updates",
    );
}

#[test]
fn deferred_xlsx_full_hydration_provider_replay_restores_imported_values() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dev/app-eval/scenarios/import-export/fixtures/basic.xlsx");
    let bytes = std::fs::read(fixture).expect("basic.xlsx fixture should be readable");

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    imported
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let persisted_bytes = compute_collab::encode_full_state(imported.storage().doc());

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update(&persisted_bytes)
        .expect("provider replay should accept deferred-hydrated full state");

    let sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();

    let a1 = replayed.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(a1, value_types::CellValue::Text(ref s) if s.as_ref() == "Name"),
        "deferred XLSX provider replay must restore A1 text; got {a1:?}",
    );
    let b1 = replayed.get_cell_value(&sheet_id, 0, 1);
    assert!(
        matches!(b1, value_types::CellValue::Text(ref s) if s.as_ref() == "Score"),
        "deferred XLSX provider replay must restore B1 text; got {b1:?}",
    );
}

#[test]
fn deferred_xlsx_provider_replay_preserves_style_only_empty_cell_fill() {
    let bytes = style_only_empty_fill_fixture_xlsx();

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    imported
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let sheet_id = SheetId::from_uuid_str(
        imported
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .unwrap();
    assert_viewport_empty_cell_fill(&imported, &sheet_id, 1, 0, "first-load import");

    let persisted_bytes = compute_collab::encode_full_state(imported.storage().doc());

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update(&persisted_bytes)
        .expect("provider replay should accept deferred-hydrated full state");

    let replayed_sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();
    assert_viewport_empty_cell_fill(&replayed, &replayed_sheet_id, 1, 0, "provider replay");
}

#[test]
fn deferred_xlsx_provider_replay_preserves_named_range_formula_semantics() {
    let bytes = named_range_concat_fixture_xlsx();
    let expected =
        CellValue::Text("Central Japan Railway Co. - Operating Model - Base Case".into());

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    imported
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let sheet_id = SheetId::from_uuid_str(
        imported
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .unwrap();
    assert_eq!(
        imported.get_cell_value(&sheet_id, 1, 1),
        expected,
        "first-load XLSX import should resolve Company_Name and Scenario in B2",
    );
    assert_eq!(
        imported
            .get_cell_info(&sheet_id, 1, 1)
            .and_then(|info| info.formula),
        Some(r#"=Company_Name&" - Operating Model - "&Scenario&" Case""#.to_string()),
        "first-load XLSX import should preserve B2 formula source",
    );

    let persisted_bytes = compute_collab::encode_full_state(imported.storage().doc());

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update(&persisted_bytes)
        .expect("provider replay should accept deferred-hydrated full state");

    let replayed_sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();

    assert_eq!(
        replayed.get_cell_value(&replayed_sheet_id, 1, 1),
        expected,
        "provider replay must preserve named-range formula semantics for B2",
    );
    assert_eq!(
        replayed
            .get_cell_info(&replayed_sheet_id, 1, 1)
            .and_then(|info| info.formula),
        Some(r#"=Company_Name&" - Operating Model - "&Scenario&" Case""#.to_string()),
        "provider replay must preserve B2 formula source",
    );
}

#[test]
fn deferred_xlsx_critical_provider_replay_restores_imported_values() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dev/app-eval/scenarios/import-export/fixtures/basic.xlsx");
    let bytes = std::fs::read(fixture).expect("basic.xlsx fixture should be readable");

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    let persisted_bytes = imported
        .encode_diff(&[0])
        .expect("critical deferred state should encode against empty SV");

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update(&persisted_bytes)
        .expect("provider replay should accept deferred critical state");

    let sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();

    let a1 = replayed.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(a1, value_types::CellValue::Text(ref s) if s.as_ref() == "Name"),
        "deferred XLSX critical replay must restore A1 text; got {a1:?}",
    );
    let b1 = replayed.get_cell_value(&sheet_id, 0, 1);
    assert!(
        matches!(b1, value_types::CellValue::Text(ref s) if s.as_ref() == "Score"),
        "deferred XLSX critical replay must restore B1 text; got {b1:?}",
    );

    match replayed.mirror().cell_render_at(&sheet_id, 0, 0) {
        crate::projection::CellRender::Plain(view) => assert!(
            matches!(view.value, value_types::CellValue::Text(s) if s.as_ref() == "Name"),
            "deferred XLSX critical replay must render range-backed A1 through the viewport path; got {:?}",
            view.value,
        ),
        other => panic!(
            "deferred XLSX critical replay must render range-backed A1 through the viewport path; got {other:?}",
        ),
    }
    match replayed.mirror().cell_render_at(&sheet_id, 0, 1) {
        crate::projection::CellRender::Plain(view) => assert!(
            matches!(view.value, value_types::CellValue::Text(s) if s.as_ref() == "Score"),
            "deferred XLSX critical replay must render range-backed B1 through the viewport path; got {:?}",
            view.value,
        ),
        other => panic!(
            "deferred XLSX critical replay must render range-backed B1 through the viewport path; got {other:?}",
        ),
    }
}

#[test]
fn deferred_xlsx_provider_replay_keeps_imported_values_after_later_edit_log() {
    use std::sync::{Arc, Mutex};

    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dev/app-eval/scenarios/import-export/fixtures/basic.xlsx");
    let bytes = std::fs::read(fixture).expect("basic.xlsx fixture should be readable");

    let (mut imported, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    imported
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    imported
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let persisted_snapshot = compute_collab::encode_full_state(imported.storage().doc());

    let captured: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_for_cb = Arc::clone(&captured);
    let _sub = compute_collab::subscribe_update_v1(imported.storage().doc(), move |bytes| {
        captured_for_cb.lock().unwrap().push(bytes.to_vec());
    });

    let sheet_id = SheetId::from_uuid_str(
        imported
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .unwrap();
    imported
        .set_cell_value_as_text(&sheet_id, 4, 0, "post-import-edit")
        .expect("post-import edit should succeed");

    let update_log = captured.lock().unwrap().clone();
    assert!(
        !update_log.is_empty(),
        "post-import edit should emit at least one provider update",
    );

    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    replayed
        .apply_sync_update(&persisted_snapshot)
        .expect("provider replay should accept imported full-state snapshot");
    for update in &update_log {
        replayed
            .apply_sync_update(update)
            .expect("provider replay should accept post-import update log entry");
    }

    let replayed_sheet_id = SheetId::from_uuid_str(
        replayed
            .get_all_sheet_ids()
            .first()
            .expect("replayed workbook should have a sheet"),
    )
    .unwrap();

    let a1 = replayed.get_cell_value(&replayed_sheet_id, 0, 0);
    assert!(
        matches!(a1, value_types::CellValue::Text(ref s) if s.as_ref() == "Name"),
        "provider replay must keep imported A1 after later edit log; got {a1:?}",
    );
    let b1 = replayed.get_cell_value(&replayed_sheet_id, 0, 1);
    assert!(
        matches!(b1, value_types::CellValue::Text(ref s) if s.as_ref() == "Score"),
        "provider replay must keep imported B1 after later edit log; got {b1:?}",
    );
    let a5 = replayed.get_cell_value(&replayed_sheet_id, 4, 0);
    assert!(
        matches!(a5, value_types::CellValue::Text(ref s) if s.as_ref() == "post-import-edit"),
        "provider replay must apply post-import edit A5; got {a5:?}",
    );

    let queried = replayed.query_range(&replayed_sheet_id, 0, 0, 4, 1);
    assert!(
        queried.cells.iter().any(|cell| {
            cell.row == 0
                && cell.col == 0
                && matches!(cell.value, value_types::CellValue::Text(ref s) if s.as_ref() == "Name")
        }),
        "provider replay query_range must include imported A1; got {:?}",
        queried.cells,
    );
    assert!(
        queried.cells.iter().any(|cell| {
            cell.row == 0
                && cell.col == 1
                && matches!(cell.value, value_types::CellValue::Text(ref s) if s.as_ref() == "Score")
        }),
        "provider replay query_range must include imported B1; got {:?}",
        queried.cells,
    );
    assert!(
        queried.cells.iter().any(|cell| {
            cell.row == 4
                && cell.col == 0
                && matches!(cell.value, value_types::CellValue::Text(ref s) if s.as_ref() == "post-import-edit")
        }),
        "provider replay query_range must include post-import edit A5; got {:?}",
        queried.cells,
    );
}
