//! Public-load contracts formerly spread across the removed lazy and parallel loaders.

#[allow(dead_code)]
mod fixtures;

use fixtures::ZipBuilder;
use value_types::CellValue;
use xlsx_parser::{DEFAULT_BUFFER_SIZE, parse_xlsx_to_output};

const NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const SHEET_PATH: &str = "xl/worksheets/sheet1.xml";

/// Use the independent test ZIP builder so these load checks also cover ordinary
/// ZIP headers without depending on the production streaming save implementation.
fn workbook(sheet: &str, deflate: bool) -> Vec<u8> {
    let workbook = format!(
        r#"<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" state="hidden" r:id="rId2"/></sheets><definedNames><definedName name="Input">Data!$A$1</definedName></definedNames><calcPr calcMode="manual" fullCalcOnLoad="1" forceFullCalc="1" iterate="1" iterateCount="12" iterateDelta="0.005"/></workbook>"#
    );
    let relationships = r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#;
    let empty = format!(r#"<worksheet xmlns="{NS}"><sheetData/></worksheet>"#);
    let shared_strings = format!(
        r#"<sst xmlns="{NS}" count="1" uniqueCount="1"><si><t>Shared &amp; decoded</t></si></sst>"#
    );
    let mut zip = ZipBuilder::new();
    for (name, data) in [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        ("xl/workbook.xml", workbook.as_str()),
        ("xl/_rels/workbook.xml.rels", relationships),
        (SHEET_PATH, sheet),
        ("xl/worksheets/sheet2.xml", empty.as_str()),
        ("xl/sharedStrings.xml", shared_strings.as_str()),
    ] {
        if deflate {
            zip.add_deflate(name, data.as_bytes());
        } else {
            zip.add_stored(name, data.as_bytes());
        }
    }
    zip.build()
}

fn assert_values(bytes: &[u8], expected: &[CellValue]) {
    let (output, _) = parse_xlsx_to_output(bytes).expect("valid streamed workbook");
    assert_eq!(output.sheets.len(), 2);
    let cells = &output.sheets[0].cells;
    assert_eq!(cells.len(), expected.len());
    for (col, (cell, expected)) in cells.iter().zip(expected).enumerate() {
        assert_eq!((cell.row, cell.col), (0, col as u32));
        assert_eq!(&cell.value, expected);
    }
}

#[test]
fn public_load_reads_prefixed_cells_for_store_and_deflate() {
    let sheet = format!(
        r#"<x:worksheet xmlns:x="{NS}"><x:sheetData><x:row r="1"><x:c r="A1"><x:v>42</x:v></x:c><x:c r="B1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>café 🧮 &amp; tea</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>"#
    );
    for deflate in [false, true] {
        assert_values(
            &workbook(&sheet, deflate),
            &[
                CellValue::number(42.0),
                CellValue::from("Shared & decoded"),
                CellValue::from("café 🧮 & tea"),
            ],
        );
    }
}

#[test]
fn public_load_preserves_tags_entities_and_utf8_split_across_chunks() {
    let header = format!(r#"<worksheet xmlns="{NS}"><sheetData><row r="1">"#);
    let cell = r#"<c r="A1" t="inlineStr"><is><t>café 🧮 &amp; tea</t></is></c>"#;
    // Move one chunk boundary through the cell start tag, multibyte text,
    // entity, and close tag. This tests production chunking for both ZIP modes.
    let split_points = [
        1,
        2,
        8,
        14,
        cell.find('é').unwrap() + 1,
        cell.find('🧮').unwrap() + 1,
        cell.find('🧮').unwrap() + 2,
        cell.find('🧮').unwrap() + 3,
        cell.find("&amp;").unwrap() + 2,
        cell.rfind("</c>").unwrap() + 2,
    ];
    for deflate in [false, true] {
        for split in split_points {
            let padding = " ".repeat(DEFAULT_BUFFER_SIZE - header.len() - split);
            let sheet = format!("{header}{padding}{cell}</row></sheetData></worksheet>");
            assert_values(
                &workbook(&sheet, deflate),
                &[CellValue::from("café 🧮 & tea")],
            );
        }
    }
}

#[test]
fn public_load_preserves_empty_hidden_sheets_and_workbook_metadata() {
    let sheet = format!(
        r#"<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>"#
    );
    for deflate in [false, true] {
        let (output, _) = parse_xlsx_to_output(&workbook(&sheet, deflate)).unwrap();
        assert_eq!(
            output
                .sheets
                .iter()
                .map(|sheet| sheet.name.as_str())
                .collect::<Vec<_>>(),
            ["Data", "Empty"]
        );
        assert!(output.sheets[1].cells.is_empty());
        assert_eq!(
            output.sheets[1].visibility,
            ooxml_types::workbook::SheetState::Hidden
        );
        assert_eq!(output.workbook_sheet_inventory.len(), 2);
        assert!(output.workbook_properties.as_ref().unwrap().date1904);
        assert_eq!(output.named_ranges.len(), 1);
        assert_eq!(output.named_ranges[0].name, "Input");
        assert_eq!(output.named_ranges[0].refers_to, "Data!$A$1");
        assert_eq!(
            output.calculation.calc_mode,
            domain_types::domain::workbook::CalcMode::Manual
        );
        assert!(output.calculation.full_calc_on_load);
        assert!(output.calculation.force_full_calc);
        assert!(output.calculation.iterate);
        assert_eq!(output.calculation.iterate_count, 12);
        assert_eq!(output.calculation.iterate_delta, 0.005);
    }
}

#[test]
fn public_load_rejects_empty_invalid_and_truncated_archives() {
    for bytes in [&[][..], b"not a ZIP archive", b"PK\x03\x04"] {
        assert!(parse_xlsx_to_output(bytes).is_err());
    }
    let sheet = format!(r#"<worksheet xmlns="{NS}"><sheetData/></worksheet>"#);
    for deflate in [false, true] {
        let bytes = workbook(&sheet, deflate);
        assert!(parse_xlsx_to_output(&bytes[..bytes.len() / 2]).is_err());
    }
}

#[test]
fn public_load_rejects_worksheet_crc_mismatch_for_store_and_deflate() {
    let sheet = format!(
        r#"<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>"#
    );
    for deflate in [false, true] {
        let mut bytes = workbook(&sheet, deflate);
        // Change the expected CRC in both headers, leaving the compressed
        // stream valid. Failure must come from validating the worksheet bytes.
        let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).unwrap();
        let local_offset = archive.find_entry(SHEET_PATH).unwrap().offset;
        let central_offset = bytes
            .windows(46 + SHEET_PATH.len())
            .position(|window| {
                window[..4] == *b"PK\x01\x02" && &window[46..] == SHEET_PATH.as_bytes()
            })
            .unwrap();
        bytes[local_offset + 14] ^= 1;
        bytes[central_offset + 16] ^= 1;
        let error =
            parse_xlsx_to_output(&bytes).expect_err("worksheet CRC mismatch must fail import");
        assert!(
            error.to_ascii_lowercase().contains("crc"),
            "unexpected error: {error}"
        );
    }
}

#[test]
fn public_load_rejects_truncated_worksheet_cell_stream() {
    let sheet = format!(r#"<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>42</v>"#);
    for deflate in [false, true] {
        assert!(
            parse_xlsx_to_output(&workbook(&sheet, deflate)).is_err(),
            "incomplete worksheet XML must fail import"
        );
    }
}

#[test]
fn public_load_preserves_outlines_without_materialized_cells() {
    // This metadata-only sheet contract previously lived in the removed
    // selected-sheet parser; unified loading must retain the same dimensions.
    let sheet = format!(
        r#"<worksheet xmlns="{NS}">
      <sheetPr><outlinePr summaryBelow="1" summaryRight="0"/></sheetPr>
      <dimension ref="A1:I12"/>
      <sheetFormatPr defaultRowHeight="15" outlineLevelRow="1" outlineLevelCol="1"/>
      <cols><col min="5" max="9" width="10.5" hidden="1" outlineLevel="1"/></cols>
      <sheetData><row r="6" outlineLevel="1" hidden="1"/><row r="7" outlineLevel="1" hidden="1"/><row r="8" collapsed="1"/></sheetData>
    </worksheet>"#
    );
    for deflate in [false, true] {
        let (output, _) = parse_xlsx_to_output(&workbook(&sheet, deflate)).unwrap();
        let sheet = &output.sheets[0];
        assert!(sheet.cells.is_empty());
        assert_eq!(sheet.dimensions.row_heights.len(), 3);
        assert_eq!(sheet.dimensions.row_heights[0].row, 5);
        assert_eq!(sheet.dimensions.row_heights[0].outline_level, Some(1));
        assert!(sheet.dimensions.row_heights[0].hidden);
        assert_eq!(sheet.dimensions.row_heights[2].row, 7);
        assert_eq!(sheet.dimensions.row_heights[2].collapsed, Some(true));
        for col in 4..9 {
            let dimension = sheet
                .dimensions
                .col_widths
                .iter()
                .find(|dimension| dimension.col == col)
                .unwrap();
            assert_eq!(dimension.width, 10.5);
            assert!(dimension.hidden);
            assert_eq!(dimension.outline_level, Some(1));
        }
        assert_eq!(sheet.dimensions.outline_level_row, Some(1));
        assert_eq!(sheet.dimensions.outline_level_col, Some(1));
        assert!(sheet.outline_properties.is_some());
    }
}

#[test]
fn public_load_preserves_one_cell_larger_than_an_inflate_chunk() {
    // A legal Excel string can exceed a 64KiB byte chunk in UTF-8 while staying
    // below the 32,767-character limit. Its closing tags arrive in a later chunk.
    let text = "表".repeat(30_000);
    let sheet = format!(
        r#"<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>{text}</t></is></c></row></sheetData></worksheet>"#
    );
    for deflate in [false, true] {
        assert_values(
            &workbook(&sheet, deflate),
            &[CellValue::from(text.as_str())],
        );
    }
}

#[test]
fn public_load_preserves_long_prefixed_sheet_data_split_across_chunks() {
    let prefix = "verylongprefixname";
    let header = format!(r#"<worksheet xmlns="{NS}" xmlns:{prefix}="{NS}">"#);
    let body = format!(
        r#"<{prefix}:sheetData><{prefix}:row r="1"><{prefix}:c r="A1"><{prefix}:v>42</{prefix}:v></{prefix}:c></{prefix}:row></{prefix}:sheetData>"#
    );
    for deflate in [false, true] {
        for split in [1, prefix.len(), body.rfind(":sheetData>").unwrap() + 5] {
            let padding = " ".repeat(DEFAULT_BUFFER_SIZE - header.len() - split);
            let sheet = format!("{header}{padding}{body}</worksheet>");
            assert_values(&workbook(&sheet, deflate), &[CellValue::number(42.0)]);
        }
    }
}

#[test]
fn public_load_preserves_formula_caches_types_and_sparse_coordinates() {
    let sheet = format!(
        r#"<worksheet xmlns="{NS}"><sheetData><row r="10"><c r="Z10"><f>SUM(A1:A9)</f><v>100</v></c><c r="AA10" t="b"><v>1</v></c><c r="AB10" t="e"><v>#N/A</v></c><c r="AC10"/></row><row r="100"><c r="XFD100"><v>42.5</v></c></row></sheetData></worksheet>"#
    );
    for deflate in [false, true] {
        let (output, _) = parse_xlsx_to_output(&workbook(&sheet, deflate)).unwrap();
        let cells = &output.sheets[0].cells;
        let at = |row, col| {
            cells
                .iter()
                .find(|cell| (cell.row, cell.col) == (row, col))
                .unwrap()
        };
        assert_eq!(at(9, 25).formula.as_deref(), Some("SUM(A1:A9)"));
        assert_eq!(at(9, 25).value, CellValue::number(100.0));
        assert_eq!(at(9, 26).value, CellValue::Boolean(true));
        assert_eq!(
            at(9, 27).value,
            CellValue::Error(value_types::CellError::Na, None)
        );
        assert_eq!(at(99, 16383).value, CellValue::number(42.5));
        assert!(
            cells
                .iter()
                .filter(|cell| (cell.row, cell.col) == (9, 28))
                .all(|cell| cell.value.is_null() && cell.formula.is_none())
        );
    }
}
