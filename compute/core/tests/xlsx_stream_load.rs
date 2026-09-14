//! Stream-inflate XLSX load: cells land in the live store from the shipped
//! engine entry, without materializing a full worksheet XML document.

use cell_types::SheetPos;
use compute_core::storage::engine::ComputeEngine;
use value_types::{CellValue, FiniteF64};
use xlsx_parser::ZipWriter;

fn large_worksheet_xlsx() -> Vec<u8> {
    let mut sheet = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B4000"/>
  <sheetData>
"#,
    );
    for row in 1..=4000u32 {
        let value = row as f64;
        sheet.push_str(&format!(
            r#"<row r="{row}"><c r="A{row}"><v>{value}</v></c><c r="B{row}"><f>A{row}*2</f><v>{}</v></c></row>"#,
            value * 2.0
        ));
    }
    sheet.push_str("</sheetData></worksheet>");
    assert!(
        sheet.len() > 128 * 1024,
        "fixture XML must span multiple 64KiB inflate chunks, got {}",
        sheet.len()
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
    );
    zip.add_file(
        "_rels/.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/workbook.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#
            .to_vec(),
    );
    zip.add_file("xl/worksheets/sheet1.xml", sheet.into_bytes());
    zip.finish().expect("large worksheet xlsx")
}

#[test]
fn from_xlsx_bytes_streams_large_sheet_into_live_store() {
    let bytes = large_worksheet_xlsx();
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).expect("stream load");
    let sheet_id = *engine.cell_store().sheet_ids().next().expect("sheet");

    let a1 = engine
        .cell_store()
        .get_cell_value_at(&sheet_id, SheetPos::new(0, 0))
        .cloned();
    assert_eq!(a1, Some(CellValue::Number(FiniteF64::must(1.0))));

    let a4000 = engine
        .cell_store()
        .get_cell_value_at(&sheet_id, SheetPos::new(3999, 0))
        .cloned();
    assert_eq!(a4000, Some(CellValue::Number(FiniteF64::must(4000.0))));

    let b1 = engine
        .cell_store()
        .get_cell_value_at(&sheet_id, SheetPos::new(0, 1))
        .cloned();
    assert_eq!(b1, Some(CellValue::Number(FiniteF64::must(2.0))));
    let b1_id = engine
        .cell_store()
        .get_sheet(&sheet_id)
        .expect("sheet store")
        .authored_cell_id_at(SheetPos::new(0, 1))
        .expect("B1 identity");
    assert!(
        engine.cell_store().get_formula(&b1_id).is_some(),
        "B1 should keep its imported formula in the live store"
    );

    let stats = engine.stream_load_stats();
    assert!(
        stats.chunks_processed > 1,
        "expected multiple inflate chunks, got {}",
        stats.chunks_processed
    );
    assert!(
        stats.cells_emitted_before_last_chunk > 0,
        "cells should appear before the inflate stream finishes"
    );
    assert!(
        stats.max_inflate_buffer < stats.uncompressed_size / 2,
        "retained inflate/XML window {} should be far smaller than uncompressed worksheet {}",
        stats.max_inflate_buffer,
        stats.uncompressed_size
    );
    assert!(
        stats.cells_parsed >= 8000,
        "expected 8000 authored cells, parsed {}",
        stats.cells_parsed
    );
}
