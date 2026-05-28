use compute_core::storage::engine::YrsComputeEngine;
use xlsx_parser::write::{ZipWriter, to_a1};

#[test]
fn l2_roundtrip_preserves_explicit_styleless_blank_cells() {
    let blank_cols = 110..=164;
    let original = explicit_blank_fixture_xlsx(blank_cols.clone());
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&original).expect("import xlsx");
    let exported_parse = engine
        .export_to_parse_output()
        .expect("export parse output");
    assert!(
        exported_parse.parse_output.sheets[0]
            .cells
            .iter()
            .any(|cell| cell.row == 64 && cell.col == 110 && cell.value.is_null()),
        "engine ParseOutput export should replay explicit blank cells"
    );
    let exported = engine.export_to_xlsx_bytes().expect("export xlsx");
    let (reparsed, _diagnostics) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("parse exported xlsx");

    let sheet = &reparsed.sheets[0];
    for col in blank_cols {
        assert!(
            sheet
                .cells
                .iter()
                .any(|cell| cell.row == 64 && cell.col == col && cell.value.is_null()),
            "missing explicit blank cell at row 64 col {col}"
        );
    }
}

fn explicit_blank_fixture_xlsx(blank_cols: impl Iterator<Item = u32>) -> Vec<u8> {
    let mut blank_cells = String::new();
    for col in blank_cols {
        blank_cells.push_str(&format!(r#"<c r="{}"/>"#, to_a1(64, col)));
    }

    let worksheet = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="B65:FI65"/>
  <sheetData>
    <row r="65"><c r="B65"><v>1</v></c>{blank_cells}</row>
  </sheetData>
</worksheet>"#
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
    .add_file(
        "xl/workbook.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Explicit blanks" sheetId="1" r:id="rId1"/>
  </sheets>
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
    .add_file("xl/worksheets/sheet1.xml", worksheet.into_bytes());
    zip.finish().expect("write explicit blank fixture")
}
