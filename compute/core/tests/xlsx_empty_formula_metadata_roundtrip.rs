//! Production-path regression for authored empty `<f>` elements.
//!
//! Array followers commonly carry an empty formula element with a cached
//! value.  The element is formula metadata, not an executable empty formula:
//! the parser must keep it typed, native storage must persist it without registering a
//! formula, and the exporter must replay it without changing the cache.  This
//! fixture also carries shared and data-table formulas to pin the neighboring
//! formula families at the same boundary.

use cell_types::SheetPos;
use compute_core::storage::engine::ComputeEngine;
use ooxml_types::worksheet::CellFormulaType;
use xlsx_parser::write::ZipWriter;

fn empty_formula_fixture() -> Vec<u8> {
    let content_types = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;
    let root_rels = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;
    let workbook_rels = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;
    let workbook = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#;
    let long_numeric_rows: String = (4..=260)
        .map(|row| {
            if row == 130 {
                format!(
                    "    <row r=\"{row}\"><c r=\"L{row}\"><f xml:space=\"preserve\" ca=\"1\"/><v>{row}</v></c></row>\n"
                )
            } else {
                format!(
                    "    <row r=\"{row}\"><c r=\"L{row}\"><v>{row}</v></c></row>\n"
                )
            }
        })
        .collect();
    let worksheet = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:L260"/>
  <sheetData>
    <row r="1">
      <c r="A1"><v>0.05</v></c>
      <c r="B1"><f t="array" ref="B1:C1" aca="1" ca="1">SUM(1,2)</f><v>3</v></c>
      <c r="C1" t="b"><f ca="1"/><v>0</v></c>
      <c r="D1"><f xml:space="preserve" ca="1"/><v/></c>
      <c r="E1"><f t="shared" si="7" ref="E1:E2">SUM(1,2)</f><v>3</v></c>
      <c r="F1"><f t="dataTable" ref="F1:G2" r1="$A$1" r2="$A$2" dt2D="1"/><v>5</v></c>
      <c r="G1"><v>10</v></c>
      <c r="H1"><v>100</v></c>
      <c r="I1" t="b"><f xml:space="preserve"/><v/></c>
      <c r="J1" t="e"><f/><v/></c>
      <c r="K1" t="str"><f/><v/></c>
    </row>
    <row r="2">
      <c r="A2"><v>100</v></c>
      <c r="E2"><f t="shared" si="7"/><v>3</v></c>
      <c r="F2"><v>5.5</v></c>
      <c r="G2"><v>11</v></c>
    </row>
{long_numeric_rows}  </sheetData>
</worksheet>"#
    );

    let mut zip = ZipWriter::new();
    zip.add_file("[Content_Types].xml", content_types.to_vec())
        .add_file("_rels/.rels", root_rels.to_vec())
        .add_file("xl/_rels/workbook.xml.rels", workbook_rels.to_vec())
        .add_file("xl/workbook.xml", workbook.to_vec())
        .add_file("xl/worksheets/sheet1.xml", worksheet.into_bytes());
    zip.finish().expect("write empty formula fixture")
}

fn cell_id_at(
    engine: &ComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
) -> cell_types::CellId {
    engine
        .cell_store()
        .resolve_cell_id(sheet_id, SheetPos::new(row, col))
        .unwrap_or_else(|| panic!("missing cell at row {row}, col {col}"))
}

#[test]
fn empty_formula_metadata_survives_parse_native_export_without_formula_registration() {
    let source = empty_formula_fixture();
    let (parsed_source, _) =
        xlsx_parser::parse_xlsx_to_output(&source).expect("parse source fixture");
    let source_sheet = &parsed_source.sheets[0];
    let source_array_follower = source_sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (0, 2))
        .expect("array follower C1");
    assert!(source_array_follower.formula.is_none());
    assert_eq!(
        source_array_follower.value,
        value_types::CellValue::Boolean(false)
    );
    assert!(
        source_array_follower
            .cell_formula
            .as_ref()
            .is_some_and(|formula| {
                formula.t == CellFormulaType::Normal && formula.ca && formula.text.is_empty()
            })
    );
    let source_standalone = source_sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (0, 3))
        .expect("standalone empty formula D1");
    assert!(source_standalone.formula.is_none());
    assert!(source_standalone.value.is_null());
    assert!(source_standalone.has_empty_cached_value);
    assert!(
        source_standalone
            .cell_formula
            .as_ref()
            .is_some_and(|formula| {
                formula.t == CellFormulaType::Normal && formula.ca && formula.text.is_empty()
            })
    );

    for (col, expected_type) in [(8, 3), (9, 4), (10, 6)] {
        let cell = source_sheet
            .cells
            .iter()
            .find(|cell| (cell.row, cell.col) == (0, col))
            .unwrap_or_else(|| panic!("typed empty formula cell at column {col}"));
        assert!(cell.formula.is_none());
        assert!(cell.has_empty_cached_value);
        assert_eq!(cell.formula_result_type, Some(expected_type));
        assert!(cell.cell_formula.as_ref().is_some_and(|formula| {
            formula.t == CellFormulaType::Normal && formula.text.is_empty()
        }));
    }
    assert!(
        source_standalone
            .formula_cache_provenance
            .formula_preserve_space
    );
    let source_range_marker = source_sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (129, 11))
        .expect("long numeric range marker L130");
    assert!(source_range_marker.formula.is_none());
    assert_eq!(
        source_range_marker.value,
        value_types::CellValue::number(130.0)
    );
    assert!(
        source_range_marker
            .cell_formula
            .as_ref()
            .is_some_and(|formula| {
                formula.t == CellFormulaType::Normal && formula.ca && formula.text.is_empty()
            })
    );
    assert!(
        source_range_marker
            .formula_cache_provenance
            .formula_preserve_space
    );

    let (engine, _) = ComputeEngine::from_xlsx_bytes(&source).expect("hydrate source fixture");
    let sheet_id = *engine.cell_store().sheet_ids().next().expect("sheet id");
    for (label, row, col) in [("array follower C1", 0, 2), ("standalone D1", 0, 3)] {
        let cell_id = cell_id_at(&engine, &sheet_id, row, col);
        assert_eq!(
            engine.get_formula(&cell_id),
            None,
            "{label} must not register an executable empty formula"
        );
    }

    let shared_follower = cell_id_at(&engine, &sheet_id, 1, 4);
    assert!(
        engine.get_formula(&shared_follower).is_some(),
        "shared follower E2 must remain an executable expanded formula"
    );

    let exported = engine.export_to_xlsx_bytes().expect("export fixture");
    let (round_tripped, _) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("parse exported fixture");
    let sheet = &round_tripped.sheets[0];

    let follower = sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (0, 2))
        .expect("exported array follower C1");
    assert!(follower.formula.is_none());
    assert_eq!(follower.value, value_types::CellValue::Boolean(false));
    assert!(follower.cell_formula.as_ref().is_some_and(|formula| {
        formula.t == CellFormulaType::Normal && formula.ca && formula.text.is_empty()
    }));

    let standalone = sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (0, 3))
        .expect("exported standalone empty formula D1");
    assert!(standalone.formula.is_none());
    assert!(standalone.value.is_null());
    assert!(standalone.has_empty_cached_value);
    assert!(standalone.cell_formula.as_ref().is_some_and(|formula| {
        formula.t == CellFormulaType::Normal && formula.ca && formula.text.is_empty()
    }));
    assert!(standalone.formula_cache_provenance.formula_preserve_space);

    for (col, expected_type) in [(8, 3), (9, 4), (10, 6)] {
        let cell = sheet
            .cells
            .iter()
            .find(|cell| (cell.row, cell.col) == (0, col))
            .unwrap_or_else(|| panic!("exported typed empty formula cell at column {col}"));
        assert!(cell.formula.is_none());
        assert!(cell.has_empty_cached_value);
        assert_eq!(cell.formula_result_type, Some(expected_type));
        assert!(cell.cell_formula.as_ref().is_some_and(|formula| {
            formula.t == CellFormulaType::Normal && formula.text.is_empty()
        }));
    }

    let range_marker = sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (129, 11))
        .expect("exported long numeric range marker L130");
    assert!(range_marker.formula.is_none());
    assert_eq!(range_marker.value, value_types::CellValue::number(130.0));
    assert!(range_marker.cell_formula.as_ref().is_some_and(|formula| {
        formula.t == CellFormulaType::Normal && formula.ca && formula.text.is_empty()
    }));
    assert!(range_marker.formula_cache_provenance.formula_preserve_space);

    let array_master = sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (0, 1))
        .expect("exported array master B1");
    assert_eq!(array_master.formula.as_deref(), Some("SUM(1,2)"));
    assert_eq!(array_master.array_ref.as_deref(), Some("B1:C1"));
    assert_eq!(
        array_master.cell_formula.as_ref().map(|formula| formula.t),
        Some(CellFormulaType::Array)
    );

    let shared_master = sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (0, 4))
        .expect("exported shared master E1");
    let shared_follower = sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (1, 4))
        .expect("exported shared follower E2");
    assert!(shared_master.formula.is_some());
    assert!(shared_follower.formula.is_some());
    assert_eq!(
        shared_master.cell_formula.as_ref().map(|formula| formula.t),
        Some(CellFormulaType::Shared)
    );
    assert_eq!(
        shared_follower
            .cell_formula
            .as_ref()
            .map(|formula| formula.t),
        Some(CellFormulaType::Shared)
    );

    let data_table_master = sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (0, 5))
        .expect("exported data-table master F1");
    assert_eq!(
        data_table_master
            .cell_formula
            .as_ref()
            .map(|formula| formula.t),
        Some(CellFormulaType::DataTable)
    );
    assert_eq!(round_tripped.data_table_regions.len(), 1);
}
