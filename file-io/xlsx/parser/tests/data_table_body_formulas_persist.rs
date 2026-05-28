//! Stream D2 regression test (projection-family-unification plan).
//!
//! Asserts that a Data Table's body cells carry the synthesized
//! `TABLE($A$2,$A$1)` formula text in `ParseOutput.sheets[i].cells[j].formula`
//! after parsing, even though the OOXML representation only carries `<f>` on
//! the master cell.
//!
//! Architectural intent: the data model is symmetric (every region cell owns
//! its formula by construction); the OOXML asymmetry is a write-side
//! compactness, not a data-model property. Stripping body-cell formulas at
//! the read boundary leaks the OOXML compactness into compute-core, which
//! breaks the formula-bar / region-membership chokepoint downstream.

mod fixtures;

use fixtures::ZipBuilder;
use xlsx_parser::parse_xlsx_to_output;

/// Build a minimal XLSX containing a 2-variable Data Table at B2:C3 with the
/// master at B2. Mirrors `data-table-minimal.xlsx`'s shape.
fn build_data_table_xlsx() -> Vec<u8> {
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
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#;

    // Mirror data-table-minimal.xlsx exactly:
    //   A1=0.05, A2=100, A3=A1*A2 (cached 5)
    //   B2 = master <f t="dataTable" ref="B2:C3" r1="$A$1" r2="$A$2" dt2D="1"/> with cached <v>5</v>
    //   C2=10, B3=5.5, C3=11    (body cells: <v> only, no <f>)
    let worksheet = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:C3"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>
    <row r="1">
      <c r="A1"><v>0.05</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>100</v></c>
      <c r="B2"><f t="dataTable" ref="B2:C3" r1="$A$1" r2="$A$2" dt2D="1"/><v>5</v></c>
      <c r="C2"><v>10</v></c>
    </row>
    <row r="3">
      <c r="A3"><f>A1*A2</f><v>5</v></c>
      <c r="B3"><v>5.5</v></c>
      <c r="C3"><v>11</v></c>
    </row>
  </sheetData>
</worksheet>"#;

    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", content_types)
        .add_deflate("_rels/.rels", root_rels)
        .add_deflate("xl/_rels/workbook.xml.rels", workbook_rels)
        .add_deflate("xl/workbook.xml", workbook)
        .add_deflate("xl/worksheets/sheet1.xml", worksheet);

    builder.build()
}

fn find_cell<'a>(
    cells: &'a [domain_types::CellData],
    row: u32,
    col: u32,
) -> Option<&'a domain_types::CellData> {
    cells.iter().find(|c| c.row == row && c.col == col)
}

#[test]
fn data_table_master_carries_synthesized_formula() {
    let bytes = build_data_table_xlsx();
    let (output, _diag) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");
    let sheet = &output.sheets[0];

    let master = find_cell(&sheet.cells, 1, 1).expect("B2 should be present");
    let formula = master
        .formula
        .as_ref()
        .expect("B2 (master) should carry a synthesized TABLE() formula");
    assert_eq!(
        formula, "TABLE($A$2,$A$1)",
        "master synthesizes TABLE(r2, r1) per Excel's r1/r2 inversion"
    );
}

#[test]
fn data_table_body_cells_carry_synthesized_formula() {
    // The architectural assertion: every body cell of the Data Table rectangle
    // owns a synthesized `=TABLE(r2, r1)` formula text in the parser output.
    // Today (pre-fix) this assertion fails for B3, C2, C3 because the read
    // boundary `convert_cell` strips the formula whenever the OOXML cell
    // type isn't `CELL_TYPE_VAL_FORMULA` — i.e., whenever the cell lacked an
    // `<f>` element. Body cells are exactly that case.
    let bytes = build_data_table_xlsx();
    let (output, _diag) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");
    let sheet = &output.sheets[0];

    let body_positions = [(1u32, 2u32, "C2"), (2, 1, "B3"), (2, 2, "C3")];

    for (row, col, label) in body_positions {
        let cell = find_cell(&sheet.cells, row, col)
            .unwrap_or_else(|| panic!("{label} should be present in ParseOutput"));
        let formula = cell.formula.as_ref().unwrap_or_else(|| {
            panic!(
                "{label} (Data Table body cell) should carry the synthesized \
                 TABLE() formula by construction; got formula=None"
            )
        });
        assert_eq!(
            formula, "TABLE($A$2,$A$1)",
            "{label} body cell formula must equal master formula"
        );
    }
}

#[test]
fn data_table_region_metadata_present() {
    // Sanity check: the `data_table_regions` top-level field on ParseOutput
    // is populated for the master at B2:C3.
    let bytes = build_data_table_xlsx();
    let (output, _diag) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");
    assert_eq!(
        output.data_table_regions.len(),
        1,
        "exactly one Data Table region should be lowered"
    );
    let region = &output.data_table_regions[0];
    assert_eq!(region.start_row, 1);
    assert_eq!(region.start_col, 1);
    assert_eq!(region.end_row, 2);
    assert_eq!(region.end_col, 2);
}

#[test]
fn data_table_writer_suppresses_body_cell_formulas() {
    // Architectural pinning: the read boundary now propagates body-cell
    // formulas through the data model (post-D2), but the writer must NOT
    // emit `<f>` elements on body cells when re-serializing — only the
    // master cell carries `<f t="dataTable">`. The OOXML asymmetry is a
    // write-side compactness; this test pins it.
    use xlsx_parser::write::write_xlsx_from_parse_output;

    let bytes = build_data_table_xlsx();
    let (output, _diag) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");

    // Re-serialize without round-trip context so we observe the writer's
    // behavior on the data-model-only path.
    let written = write_xlsx_from_parse_output(&output).expect("write_xlsx_from_parse_output");

    // Round-trip back: parser output should be byte-equivalent in content
    // (same body-cell formulas surfaced), and the master should still carry
    // its data-table cell_formula.
    let (round_tripped, _diag2) = parse_xlsx_to_output(&written).expect("parse round 2");
    let sheet = &round_tripped.sheets[0];

    // Body cells still surface the synthesized formula (the read boundary
    // re-synthesizes it on every parse from the data_table_regions), so the
    // round-trip is stable.
    for (row, col, label) in [(1u32, 2u32, "C2"), (2, 1, "B3"), (2, 2, "C3")] {
        let cell = find_cell(&sheet.cells, row, col)
            .unwrap_or_else(|| panic!("{label} should be present after round-trip"));
        assert_eq!(
            cell.formula.as_deref(),
            Some("TABLE($A$2,$A$1)"),
            "{label} body cell formula must round-trip through writer + reader"
        );
        // And the body cell's cell_formula must remain None: the writer
        // correctly suppressed `<f>` on the body cell, so on re-parse the
        // OOXML cell_formula attribute is absent.
        assert!(
            cell.cell_formula.is_none(),
            "{label} must NOT round-trip with a `<f>` element (writer compactness contract)"
        );
    }

    // The master must still carry its data-table cell_formula after round-trip.
    let master = find_cell(&sheet.cells, 1, 1).expect("B2 should be present after round-trip");
    let cf = master
        .cell_formula
        .as_ref()
        .expect("master B2 must carry cell_formula after round-trip");
    use ooxml_types::worksheet::CellFormulaType;
    assert_eq!(
        cf.t,
        CellFormulaType::DataTable,
        "master cell_formula must be t=dataTable"
    );

    // And the data_table_regions must round-trip too.
    assert_eq!(
        round_tripped.data_table_regions.len(),
        1,
        "data_table_regions must round-trip"
    );
}
