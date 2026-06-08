use cell_types::{CellId, SheetId, SheetPos};
use compute_core::bridge_types::CellInput;
use compute_core::engine_types::fill::{BridgeAutoFillRequest, BridgeFillRangeSpec};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{RecalcOptions, WorkbookSnapshot};
use value_types::{CellError, CellValue};
use xlsx_parser::write::ZipWriter;

fn minimal_xlsx(
    sheet_name: &str,
    sheet_xml: &'static [u8],
    workbook_extra: &'static [u8],
) -> Vec<u8> {
    let workbook_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets>
  {}
</workbook>"#,
        String::from_utf8_lossy(workbook_extra)
    );

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
    .add_file("xl/workbook.xml", workbook_xml.into_bytes())
    .add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file("xl/worksheets/sheet1.xml", sheet_xml.to_vec());
    zip.finish()
        .expect("minimal XLSX fixture should be writable")
}

fn first_sheet_id(engine: &YrsComputeEngine) -> SheetId {
    SheetId::from_uuid_str(
        engine
            .get_all_sheet_ids()
            .first()
            .expect("workbook should have a first sheet"),
    )
    .expect("sheet id should parse")
}

fn cell_id_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(
        &engine
            .get_cell_id_at(sheet_id, row, col)
            .unwrap_or_else(|| panic!("cell at row {row} col {col} should have an id")),
    )
    .expect("cell id should parse")
}

fn value_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> CellValue {
    engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

fn fill_request(
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    tgt_start_row: u32,
    tgt_start_col: u32,
    tgt_end_row: u32,
    tgt_end_col: u32,
) -> BridgeAutoFillRequest {
    BridgeAutoFillRequest {
        source_range: BridgeFillRangeSpec {
            start_row: src_start_row,
            start_col: src_start_col,
            end_row: src_end_row,
            end_col: src_end_col,
        },
        target_range: BridgeFillRangeSpec {
            start_row: tgt_start_row,
            start_col: tgt_start_col,
            end_row: tgt_end_row,
            end_col: tgt_end_col,
        },
        direction: "down".to_string(),
        mode: "auto".to_string(),
        include_formulas: true,
        include_values: true,
        include_formats: true,
        step_value: 1.0,
    }
}

#[test]
fn imported_autofill_preserves_blank_reference_vector_formulas() {
    let bytes = minimal_xlsx(
        "Autofill",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="AD2:AD2"/>
  <sheetData>
    <row r="2"><c r="AD2"><f>IF(Q2="","",YEAR(Q2))</f><v>0</v></c></row>
  </sheetData>
</worksheet>"#,
        b"",
    );
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).expect("bootstrap engine");
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred import xlsx");
    engine
        .complete_deferred_hydration()
        .expect("complete deferred hydration");
    let sheet_id = first_sheet_id(&engine);

    let request = fill_request(1, 29, 1, 29, 1, 29, 6760, 29);
    engine.auto_fill(&sheet_id, request).expect("autofill");

    let expected = [
        (1, "=IF(Q2=\"\",\"\",YEAR(Q2))"),
        (2, "=IF(Q3=\"\",\"\",YEAR(Q3))"),
        (99, "=IF(Q100=\"\",\"\",YEAR(Q100))"),
        (6668, "=IF(Q6669=\"\",\"\",YEAR(Q6669))"),
        (6760, "=IF(Q6761=\"\",\"\",YEAR(Q6761))"),
    ];
    for (row, formula) in expected {
        let cell_id = cell_id_at(&engine, &sheet_id, row, 29);
        let active = engine.get_active_cell(&sheet_id, &cell_id);
        assert_eq!(
            active.formula.as_deref(),
            Some(formula),
            "AD{} should expose its adjusted imported formula",
            row + 1
        );
    }
}

#[test]
fn imported_data_table_recalc_mutation_preserves_cached_table_values() {
    let bytes = minimal_xlsx(
        "DataTable",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:E4"/>
  <sheetData>
    <row r="1"><c r="A1"><v>0.05</v></c><c r="E1"><v>1</v></c></row>
    <row r="2"><c r="A2"><v>100</v></c><c r="B2"><f t="dataTable" ref="B2:C3" r1="$A$1" r2="$A$2" dt2D="1"/><v>5</v></c><c r="C2"><v>10</v></c></row>
    <row r="3"><c r="A3"><f>A1*A2</f><v>5</v></c><c r="B3"><v>5.5</v></c><c r="C3"><v>11</v></c><c r="D3"><f>SUM(B3:C3)</f><v>16.5</v></c></row>
    <row r="4"><c r="D4"><f>D3+E1</f><v>17.5</v></c></row>
  </sheetData>
</worksheet>"#,
        br#"<calcPr calcId="191029" calcMode="auto"/>"#,
    );
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).expect("bootstrap engine");
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred import xlsx");
    engine
        .complete_deferred_hydration()
        .expect("complete deferred hydration");
    let sheet_id = first_sheet_id(&engine);

    assert_eq!(value_at(&engine, &sheet_id, 1, 1), CellValue::number(5.0));
    assert_eq!(value_at(&engine, &sheet_id, 2, 1), CellValue::number(5.5));
    assert_eq!(value_at(&engine, &sheet_id, 2, 2), CellValue::number(11.0));

    engine
        .batch_set_cells_by_position(
            vec![(
                sheet_id,
                0,
                4,
                CellInput::Value {
                    value: CellValue::number(2.0),
                },
            )],
            true,
        )
        .expect("mutate E1 through SDK batch-position path");
    engine
        .recalculate_with_options(&RecalcOptions::default())
        .expect("calculate after mutation through API full-recalc path");

    let data_table_cells = [
        ("B2", 1, 1, CellValue::number(5.0)),
        ("B3", 2, 1, CellValue::number(5.5)),
        ("C3", 2, 2, CellValue::number(11.0)),
    ];
    for (label, row, col, expected) in data_table_cells {
        let actual = value_at(&engine, &sheet_id, row, col);
        assert_ne!(
            actual,
            CellValue::Error(CellError::Calc, None),
            "{label} must not be replaced with #CALC!"
        );
        assert_eq!(actual, expected, "{label} cached value should be preserved");
    }

    assert_eq!(value_at(&engine, &sheet_id, 2, 3), CellValue::number(16.5));
    assert_eq!(value_at(&engine, &sheet_id, 3, 3), CellValue::number(18.5));
}
