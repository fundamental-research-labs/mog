//! Stream-inflate XLSX load: cells land in the live store from the shipped
//! engine entry, without materializing a full worksheet XML document.

use std::cell::Cell;
use std::rc::Rc;

use cell_types::{SheetId, SheetPos};
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

    workbook_with_sheet(&sheet)
}

fn workbook_with_sheet(sheet: &str) -> Vec<u8> {
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
    zip.add_file("xl/worksheets/sheet1.xml", sheet.as_bytes().to_vec());
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
    assert_eq!(
        stats.cells_parsed, 8000,
        "each authored cell is parsed once"
    );
    assert_eq!(stats.bytes_decompressed, stats.uncompressed_size);
    assert_eq!(
        stats.retained_metadata_cells, 4000,
        "formula metadata is retained; plain numeric values live only in the store"
    );
    assert!(
        stats.max_cell_text_buffer < 64,
        "per-cell text scratch must not accumulate across the worksheet: {stats:?}"
    );
}

#[test]
fn cells_land_in_live_store_before_last_inflate_chunk() {
    let bytes = large_worksheet_xlsx();
    let saw_cell_before_last_chunk = Rc::new(Cell::new(false));
    let captured_sheet = Rc::new(Cell::new(None::<SheetId>));
    let flag = saw_cell_before_last_chunk.clone();
    let sheet_slot = captured_sheet.clone();
    let (engine, _) = ComputeEngine::from_xlsx_bytes_with_progress(&bytes, move |stats, store| {
        if stats.bytes_decompressed < stats.uncompressed_size {
            let Some(sheet_id) = store.sheet_ids().next() else {
                return;
            };
            if store
                .get_cell_value_at(sheet_id, SheetPos::new(0, 0))
                .is_some()
            {
                flag.set(true);
                if sheet_slot.get().is_none() {
                    sheet_slot.set(Some(*sheet_id));
                }
            }
        }
    })
    .expect("stream load with progress");

    assert!(
        engine.stream_load_stats().chunks_processed > 1,
        "expected multiple inflate chunks, got {}",
        engine.stream_load_stats().chunks_processed
    );
    assert!(
        saw_cell_before_last_chunk.get(),
        "authored cells must exist on the live CellStore before the last inflate chunk"
    );
    let sheet_id = captured_sheet.get().expect("mid-stream sheet id");
    assert!(
        engine.cell_store().get_sheet(&sheet_id).is_some(),
        "streamed SheetId must survive after load instead of being replaced"
    );
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sheet_id, SheetPos::new(0, 0))
            .cloned(),
        Some(CellValue::Number(FiniteF64::must(1.0)))
    );
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sheet_id, SheetPos::new(0, 1))
            .cloned(),
        Some(CellValue::Number(FiniteF64::must(2.0)))
    );
    let b1_id = engine
        .cell_store()
        .get_sheet(&sheet_id)
        .and_then(|sheet| sheet.authored_cell_id_at(SheetPos::new(0, 1)))
        .expect("B1 formula identity must survive classification");
    assert!(
        engine.cell_store().get_formula(&b1_id).is_some(),
        "B1 should keep its imported formula in the live store"
    );
}

#[test]
fn shared_formula_string_caches_decode_once_and_survive_save() {
    let bytes = workbook_with_sheet(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">
      <c r="A1" t="str"><f t="shared" si="0" ref="A1:B1">&quot;A&amp;B&quot;</f><v>A&amp;B</v></c>
      <c r="B1" t="str"><f t="shared" si="0"/><v>A&amp;B</v></c>
      <c r="C1" t="str"><v>_x0041_</v></c>
      <c r="D1" t="inlineStr"><is><t>&amp;amp;</t></is></c>
    </row></sheetData></worksheet>"#,
    );
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sheet = engine.cell_store().sheet_by_name("Data").unwrap();
    for (col, expected) in ["A&B", "A&B", "A", "&amp;"].iter().enumerate() {
        assert_eq!(
            engine.get_cell_value(&sheet, 0, col as u32),
            CellValue::from(*expected)
        );
    }
    let exported = engine.export_to_xlsx_bytes().unwrap();
    let parsed = xlsx_parser::parse_xlsx_to_output(&exported).unwrap().0;
    for (col, expected) in ["A&B", "A&B", "A", "&amp;"].iter().enumerate() {
        let cell = parsed.sheets[0]
            .cells
            .iter()
            .find(|c| c.row == 0 && c.col == col as u32)
            .unwrap();
        assert_eq!(cell.value, CellValue::from(*expected));
    }
}

#[test]
fn plain_values_do_not_accumulate_a_second_parsed_grid() {
    let mut xml = String::from(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
    );
    for row in 1..=10_000 {
        xml.push_str(&format!(
            r#"<row r="{row}"><c r="A{row}"><v>{row}</v></c></row>"#
        ));
    }
    xml.push_str("</sheetData></worksheet>");
    let bytes = workbook_with_sheet(&xml);
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let stats = engine.stream_load_stats();
    assert_eq!(stats.cells_parsed, 10_000);
    assert_eq!(
        stats.retained_metadata_cells, 0,
        "ordinary values must be owned only by the native store"
    );
    assert!(
        stats.max_cell_text_buffer < 64,
        "cell scratch must not accumulate worksheet strings"
    );
    assert!(stats.max_inflate_buffer < 2 * 65_536);
    let sheet = engine.cell_store().sheet_by_name("Data").unwrap();
    let stored = engine.cell_store().get_sheet(&sheet).unwrap();
    assert_eq!((stored.rows, stored.cols), (10_000, 1));
    assert_eq!((stored.identity_rows, stored.identity_cols), (10_000, 1));
    assert_eq!(
        engine.get_cell_value(&sheet, 9_999, 0),
        CellValue::number(10_000.0)
    );
}

#[test]
fn progress_can_load_another_workbook_without_clobbering_the_outer_load() {
    let bytes = workbook_with_sheet(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1"><v>17</v></c></row></sheetData></worksheet>"#,
    );
    let mut nested = false;
    let (engine, _) = ComputeEngine::from_xlsx_bytes_with_progress(&bytes, |_, _| {
        if !nested {
            nested = true;
            let (inner, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
            let sheet = inner.cell_store().sheet_by_name("Data").unwrap();
            assert_eq!(inner.get_cell_value(&sheet, 0, 1), CellValue::number(17.0));
        }
    })
    .unwrap();
    assert!(nested, "progress closure can borrow caller state");
    let sheet = engine.cell_store().sheet_by_name("Data").unwrap();
    assert_eq!(engine.get_cell_value(&sheet, 0, 0), CellValue::number(42.0));
    assert_eq!(engine.get_cell_value(&sheet, 0, 1), CellValue::number(17.0));
    assert_eq!(engine.stream_load_stats().cells_parsed, 2);
}

#[test]
fn large_dynamic_array_caches_are_not_promoted_to_authored_ranges() {
    let mut xml = String::from(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A300">_xlfn.SEQUENCE(300)</f><v>1001</v></c></row>"#,
    );
    for row in 2..=300 {
        xml.push_str(&format!(
            r#"<row r="{row}"><c r="A{row}"><v>{}</v></c></row>"#,
            row + 1000
        ));
    }
    xml.push_str("</sheetData></worksheet>");
    let base = workbook_with_sheet(&xml);
    let archive = xlsx_parser::XlsxArchive::new(&base).unwrap();
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let mut bytes = archive.read_file(&entry.name).unwrap();
        if entry.name == "[Content_Types].xml" {
            bytes = String::from_utf8(bytes).unwrap().replace("</Types>", r#"<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/></Types>"#).into_bytes();
        } else if entry.name == "xl/_rels/workbook.xml.rels" {
            bytes = String::from_utf8(bytes).unwrap().replace("</Relationships>", r#"<Relationship Id="rIdMetadata" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>"#).into_bytes();
        }
        zip.add_file(&entry.name, bytes);
    }
    zip.add_file("xl/metadata.xml", br#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#);
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&zip.finish().unwrap()).unwrap();
    let sheet = engine.cell_store().sheet_by_name("Data").unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&sheet)
            .unwrap()
            .iter_ranges()
            .count(),
        0,
        "derived spill caches must not become authored ranges at the 256-cell threshold"
    );
    engine.recalculate().unwrap();
    assert_eq!(
        engine.get_cell_value(&sheet, 299, 0),
        CellValue::number(300.0)
    );
    engine
        .set_cell_value_parsed(&sheet, 0, 0, "=SEQUENCE(2)")
        .unwrap();
    engine.recalculate().unwrap();
    assert_eq!(engine.get_cell_value(&sheet, 1, 0), CellValue::number(2.0));
    assert_eq!(engine.get_cell_value(&sheet, 299, 0), CellValue::Null);
}

#[test]
fn native_chart_fingerprints_match_collected_cross_sheet_values_and_rich_errors() {
    use domain_types::{
        CellData, CellMetadataRecord, FutureMetadataBlock, FutureMetadataGroup, MetadataType,
        ParseOutput, RichDataPart, SheetData, ValueMetadataBlock, WorkbookMetadata,
        WorkbookRichData,
    };
    let chart: domain_types::ChartSpec = serde_json::from_value(serde_json::json!({
        "chartType": "pie", "title": "Source values", "zIndex": 0,
        "position": {"anchorRow": 0, "anchorCol": 0, "anchorRowOffset": 0, "anchorColOffset": 0},
        "size": {"width": 500.0, "height": 300.0},
        "dataRange": "Sources!A1:B3"
    }))
    .unwrap();
    let rich_ns = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata";
    let metadata = WorkbookMetadata {
        metadata_types: vec![MetadataType { name: "XLRICHVALUE".into(), ..Default::default() }],
        future_metadata: vec![FutureMetadataGroup {
            name: "XLRICHVALUE".into(),
            blocks: vec![FutureMetadataBlock { raw_xml: format!("<extLst><ext uri=\"{{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}}\"><r:rvb xmlns:r=\"{rich_ns}\" i=\"0\"/></ext></extLst>") }],
        }],
        value_metadata: vec![ValueMetadataBlock { records: vec![CellMetadataRecord { t: 1, v: 0 }] }],
        rich_data: Some(WorkbookRichData { parts: vec![
            RichDataPart { path: "xl/richData/rdrichvalue.xml".into(), content_type: "application/vnd.ms-excel.rdrichvalue+xml".into(), data: format!("<rvData xmlns=\"{rich_ns}\" count=\"1\"><rv s=\"0\"><v>8</v><v>0</v></rv></rvData>").into_bytes(), ..Default::default() },
            RichDataPart { path: "xl/richData/rdrichvaluestructure.xml".into(), content_type: "application/vnd.ms-excel.rdrichvaluestructure+xml".into(), data: format!("<rvStructures xmlns=\"{rich_ns}\" count=\"1\"><s t=\"_error\"><k n=\"errorType\" t=\"i\"/><k n=\"subType\" t=\"i\"/></s></rvStructures>").into_bytes(), ..Default::default() },
        ], ..Default::default() }),
        ..Default::default()
    };
    let output = ParseOutput {
        metadata: Some(metadata),
        sheets: vec![
            SheetData {
                name: "Sources".into(),
                rows: 3,
                cols: 2,
                cells: vec![
                    CellData {
                        row: 0,
                        col: 0,
                        value: CellValue::from("Label"),
                        ..Default::default()
                    },
                    CellData {
                        row: 0,
                        col: 1,
                        value: CellValue::from("Value"),
                        ..Default::default()
                    },
                    CellData {
                        row: 1,
                        col: 0,
                        value: CellValue::from("Ordinary"),
                        ..Default::default()
                    },
                    CellData {
                        row: 1,
                        col: 1,
                        value: CellValue::number(42.0),
                        ..Default::default()
                    },
                    CellData {
                        row: 2,
                        col: 0,
                        value: CellValue::from("Rich error"),
                        ..Default::default()
                    },
                    CellData {
                        row: 2,
                        col: 1,
                        value: CellValue::Error(value_types::CellError::Value, None),
                        vm: Some(1),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            SheetData {
                name: "Chart".into(),
                charts: vec![chart],
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&output).unwrap();
    let collected = xlsx_parser::parse_xlsx_to_output(&bytes).unwrap().0;
    let expected = collected.sheets[1].charts[0]
        .standard_chart_provenance
        .as_ref()
        .unwrap()
        .source_fingerprint
        .clone();
    assert!(expected.is_some());
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let source = engine.cell_store().sheet_by_name("Sources").unwrap();
    assert!(matches!(
        engine.get_cell_value(&source, 2, 1),
        CellValue::Error(value_types::CellError::Spill, _)
    ));
    let chart_sheet = engine.cell_store().sheet_by_name("Chart").unwrap();
    let objects = engine.get_all_charts(&chart_sheet);
    let native = domain_types::ChartSpec::from_floating_object(&objects[0]).unwrap();
    assert_eq!(
        native.standard_chart_provenance.unwrap().source_fingerprint,
        expected
    );
    assert_eq!(
        native
            .standard_chart_export_authority
            .unwrap()
            .source_fingerprint,
        expected
    );
}
