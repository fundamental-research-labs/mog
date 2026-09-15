//! Tests for the cell parser module.

#![cfg(test)]

mod data_tables;
mod fast_parse;
mod format_import;
mod helpers;

/// Exercise the production worksheet stream using independent ZIP entry bytes.
/// This adapter only supplies archive/context fixtures; it contains no XML parser.
pub(crate) fn parse_streamed(
    xml: &[u8],
    strings: &[&str],
) -> (
    Vec<crate::FullCellData>,
    super::ParseExtras,
    Vec<ooxml_types::worksheet::RowHeight>,
) {
    let mut zip = crate::ZipWriter::new();
    zip.add_file("xl/worksheets/sheet1.xml", xml);
    let bytes = zip.finish().unwrap();
    let archive = crate::zip::XlsxArchive::new(&bytes).unwrap();
    let entry = archive
        .get_compressed_data("xl/worksheets/sheet1.xml")
        .unwrap();
    let strings: Vec<String> = strings.iter().map(|text| (*text).to_owned()).collect();
    let context = crate::output::to_parse_output::cell_context::CellConversionContext::new(
        &strings,
        &[],
        &[],
    );
    let parsed = crate::pipeline::streaming::stream_parse_worksheet(
        &entry, &strings, &context, 0, &mut None,
    )
    .unwrap();
    (parsed.cells, parsed.extras, parsed.row_heights)
}

/// Parse complete package fixtures through the same public load entry as users.
pub(crate) fn parse_public_sheet(xml: &[u8]) -> domain_types::SheetData {
    let mut zip = crate::ZipWriter::new();
    zip.add_file("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#);
    zip.add_file("_rels/.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#);
    zip.add_file("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#);
    zip.add_file("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#);
    zip.add_file("xl/worksheets/sheet1.xml", xml);
    let bytes = zip.finish().unwrap();
    crate::parse_xlsx_to_output(&bytes)
        .unwrap()
        .0
        .sheets
        .remove(0)
}
