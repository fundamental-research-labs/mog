//! CLI contracts for imported dynamic arrays.
//!
//! These fixtures intentionally use small, deterministic XLSX packages.  The
//! tests exercise the same `mog save`/`mog run` boundary used by callers and
//! then reopen the exported package through `compute_api::Workbook`.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

use compute_api::{Sheet, Workbook};
use value_types::{CellError, CellValue};
use xlsx_parser::{XlsxArchive, write::ZipWriter};

const DYNAMIC_METADATA: &str = r#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#;
const RICH_SHARED_STRINGS: &str = r#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><r><rPr><b/></rPr><t xml:space="preserve">stale </t></r><r><rPr><i/></rPr><t>text cache</t></r></si></sst>"#;

struct Fixture {
    directory: PathBuf,
}

impl Fixture {
    fn new(sheet_xml: &str) -> Self {
        Self::new_with_shared_strings(sheet_xml, None)
    }

    fn new_with_shared_strings(sheet_xml: &str, shared_strings: Option<&str>) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "mog-cli-array-contract-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).unwrap();

        let content_type_metadata = r#"<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>"#;
        let content_type_styles = r#"<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>"#;
        let content_type_shared_strings = shared_strings.map_or("", |_| {
            r#"<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>"#
        });
        let workbook_metadata_relationship = r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>"#;
        let workbook_styles_relationship = r#"<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#;
        let workbook_shared_strings_relationship = shared_strings.map_or("", |_| {
            r#"<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>"#
        });

        let mut zip = ZipWriter::new();
        zip.add_file(
            "[Content_Types].xml",
            format!(
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>{content_type_styles}{content_type_metadata}{content_type_shared_strings}</Types>"#
            )
            .into_bytes(),
        );
        zip.add_file(
            "_rels/.rels",
            br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_vec(),
        );
        zip.add_file(
            "xl/workbook.xml",
            br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="manual"/></workbook>"#.to_vec(),
        );
        zip.add_file(
            "xl/_rels/workbook.xml.rels",
            format!(
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>{workbook_styles_relationship}{workbook_metadata_relationship}{workbook_shared_strings_relationship}</Relationships>"#
            )
            .into_bytes(),
        );
        zip.add_file(
            "xl/styles.xml",
            br#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font/><font><b/></font></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>"#.to_vec(),
        );
        zip.add_file("xl/worksheets/sheet1.xml", sheet_xml.as_bytes().to_vec());
        zip.add_file("xl/metadata.xml", DYNAMIC_METADATA.as_bytes().to_vec());
        if let Some(shared_strings) = shared_strings {
            zip.add_file("xl/sharedStrings.xml", shared_strings.as_bytes().to_vec());
        }
        fs::write(directory.join("input.xlsx"), zip.finish().unwrap()).unwrap();
        Self { directory }
    }

    fn input(&self) -> PathBuf {
        self.directory.join("input.xlsx")
    }

    fn save(&self, input: &Path, recalculate: bool, output_name: &str) -> PathBuf {
        self.invoke(input, recalculate, None, output_name)
    }

    fn run(&self, input: &Path, recalculate: bool, script: &str, output_name: &str) -> PathBuf {
        self.invoke(input, recalculate, Some(script), output_name)
    }

    fn invoke(
        &self,
        input: &Path,
        recalculate: bool,
        script: Option<&str>,
        output_name: &str,
    ) -> PathBuf {
        let output = self.directory.join(output_name);
        let mut command = Command::new(env!("CARGO_BIN_EXE_mog"));
        command.arg(if script.is_some() { "run" } else { "save" });
        if recalculate {
            command.arg("--recalculate");
        }
        command.arg(input);
        if let Some(script) = script {
            let script_path = self.directory.join(format!("{output_name}.js"));
            fs::write(&script_path, script).unwrap();
            command.arg(script_path);
        }
        let result = command.arg(&output).output().unwrap();
        assert!(
            result.status.success(),
            "mog CLI failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        output
    }

    fn load(&self, path: &Path) -> Workbook {
        Workbook::from_xlsx_path(path.to_str().unwrap())
            .unwrap_or_else(|error| panic!("failed to reload {}: {error}", path.display()))
            .0
    }

    fn worksheet_xml(&self, path: &Path) -> String {
        let bytes = fs::read(path).unwrap();
        let archive = XlsxArchive::new(&bytes).unwrap();
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap()
    }

    fn styles_xml(&self, path: &Path) -> String {
        let bytes = fs::read(path).unwrap();
        let archive = XlsxArchive::new(&bytes).unwrap();
        String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap()
    }

    fn contains_entry(&self, path: &Path, entry_name: &str) -> bool {
        let bytes = fs::read(path).unwrap();
        XlsxArchive::new(&bytes).unwrap().contains(entry_name)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn dynamic_roundtrip_sheet() -> String {
    r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F3"/><sheetData>
<row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A3" aca="1" ca="1">_xlfn.SEQUENCE(3)</f><v>91</v></c><c r="C1" cm="1"><f t="array" ref="C1:D2" aca="1" ca="1">_xlfn.SEQUENCE(2,2)</f><v>201</v></c><c r="D1"><v>202</v></c><c r="E1"><f>SUM(A1:A3)</f><v>501</v></c><c r="F1"><f>SUM(C1:D2)</f><v>502</v></c></row>
<row r="2"><c r="A2" s="1"><f ca="1"/><v>92</v></c><c r="C2"><f ca="1"/><v>203</v></c><c r="D2"><v>204</v></c></row>
<row r="3"><c r="A3"><v>93</v></c></row>
</sheetData></worksheet>"#
        .to_string()
}

fn resize_sheet() -> String {
    r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D6"/><sheetData>
<row r="1"><c r="A1"><v>3</v></c><c r="B1"><v>11</v></c><c r="C1"><f>SUM(A2:A6)</f><v>999</v></c><c r="D1"><f>SUM(A3:A6)</f><v>888</v></c></row>
<row r="2"><c r="A2" cm="1"><f t="array" ref="A2:A4" aca="1" ca="1">_xlfn.SEQUENCE(A1)</f><v>91</v></c></row>
<row r="3"><c r="A3" s="1"><f ca="1"/><v>92</v></c></row>
<row r="4"><c r="A4"><v>93</v></c></row>
</sheetData></worksheet>"#
        .to_string()
}

fn overlap_sheet() -> String {
    r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A5"/><sheetData>
<row r="1"><c r="A1"><v>2</v></c></row>
<row r="2"><c r="A2" cm="1"><f t="array" ref="A2:A3" aca="1" ca="1">_xlfn.SEQUENCE(A1)</f><v>71</v></c></row>
<row r="3"><c r="A3"><v>72</v></c></row>
<row r="4"><c r="A4" cm="1"><f t="array" ref="A4:A5" aca="1" ca="1">_xlfn.SEQUENCE(2)</f><v>81</v></c></row>
<row r="5"><c r="A5"><v>82</v></c></row>
</sheetData></worksheet>"#
        .to_string()
}

fn rich_text_cached_dynamic_sheet() -> String {
    r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A3"/><sheetData>
<row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A3" aca="1" ca="1">_xlfn.SEQUENCE(3)</f><v>91</v></c></row>
<row r="2"><c r="A2"><f ca="1"/><v>92</v></c></row>
<row r="3"><c r="A3" t="s"><v>0</v></c></row>
</sheetData></worksheet>"#
        .to_string()
}

fn number(sheet: &Sheet, address: &str) -> f64 {
    match sheet.get_cell_value(address).unwrap() {
        CellValue::Number(value) => value.get(),
        value => panic!("{address} expected a number, got {value:?}"),
    }
}

fn assert_number(sheet: &Sheet, address: &str, expected: f64) {
    assert_eq!(number(sheet, address), expected, "{address}");
}

fn assert_empty(sheet: &Sheet, address: &str) {
    assert_eq!(
        sheet.get_cell_value(address).unwrap(),
        CellValue::Null,
        "{address} should be empty"
    );
}

fn assert_spill_error(sheet: &Sheet, address: &str) {
    assert_eq!(
        sheet.get_cell_value(address).unwrap(),
        CellValue::Error(CellError::Spill, None),
        "{address} should report #SPILL!"
    );
}

fn cell_fragment<'a>(worksheet_xml: &'a str, address: &str) -> &'a str {
    let needle = format!(r#"r="{address}""#);
    let marker = worksheet_xml
        .find(&needle)
        .unwrap_or_else(|| panic!("missing {address} in worksheet XML: {worksheet_xml}"));
    let start = worksheet_xml[..marker]
        .rfind("<c ")
        .unwrap_or_else(|| panic!("missing <c> start for {address}"));
    let opening_end = worksheet_xml[start..]
        .find('>')
        .map(|offset| start + offset)
        .unwrap_or_else(|| panic!("unterminated cell opening for {address}"));
    let opening = &worksheet_xml[start..=opening_end];
    if opening.ends_with("/>") {
        return opening;
    }
    let closing_start = opening_end + 1;
    let closing_end = worksheet_xml[closing_start..]
        .find("</c>")
        .map(|offset| closing_start + offset + "</c>".len())
        .unwrap_or_else(|| panic!("unterminated cell {address}"));
    &worksheet_xml[start..closing_end]
}

fn assert_empty_formula_marker(worksheet_xml: &str, address: &str) {
    let cell = cell_fragment(worksheet_xml, address);
    assert!(
        cell.contains("<f"),
        "{address} lost its formula marker: {cell}"
    );
    assert!(cell.contains(r#"ca="1""#), "{address} lost ca=1: {cell}");
    assert!(
        !cell.contains("SEQUENCE"),
        "{address} became an independent formula: {cell}"
    );
}

fn assert_unmarked_spill_child(worksheet_xml: &str, address: &str) {
    let cell = cell_fragment(worksheet_xml, address);
    assert!(
        !cell.contains("<f"),
        "{address} unexpectedly gained formula metadata: {cell}"
    );
}

fn xml_attribute<'a>(opening: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!("{name}=\"");
    let start = opening.find(&needle)? + needle.len();
    let rest = &opening[start..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

fn indexed_element<'a>(section: &'a str, element: &str, index: usize) -> Option<&'a str> {
    let tag_name = element.strip_prefix('<')?;
    let closing = format!("</{tag_name}>");
    let mut cursor = 0;
    let mut found = 0;
    while let Some(offset) = section[cursor..].find(element) {
        let start = cursor + offset;
        let boundary = section.as_bytes().get(start + element.len()).copied()?;
        if !matches!(boundary, b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'>') {
            cursor = start + element.len();
            continue;
        }
        let opening_end = section[start..].find('>')? + start;
        let end = if section[..=opening_end].ends_with("/>") {
            opening_end + 1
        } else {
            section[opening_end + 1..].find(&closing)? + opening_end + 1 + closing.len()
        };
        if found == index {
            return Some(&section[start..end]);
        }
        found += 1;
        cursor = end;
    }
    None
}

fn cell_style_id(cell: &str) -> Option<usize> {
    let opening_end = cell.find('>')?;
    xml_attribute(&cell[..=opening_end], "s")?.parse().ok()
}

fn cell_style_is_bold(styles_xml: &str, worksheet_xml: &str, address: &str) -> bool {
    let cell = cell_fragment(worksheet_xml, address);
    let style_id = cell_style_id(cell).unwrap_or(0);
    let Some(cell_xfs_start) = styles_xml.find("<cellXfs") else {
        return false;
    };
    let Some(cell_xfs_end) = styles_xml[cell_xfs_start..]
        .find("</cellXfs>")
        .map(|end| end + cell_xfs_start)
    else {
        return false;
    };
    let cell_xfs = &styles_xml[cell_xfs_start..cell_xfs_end];
    let Some(xf) = indexed_element(cell_xfs, "<xf", style_id) else {
        return false;
    };
    let Some(xf_opening_end) = xf.find('>') else {
        return false;
    };
    let font_id = xml_attribute(&xf[..=xf_opening_end], "fontId")
        .and_then(|font_id| font_id.parse::<usize>().ok())
        .unwrap_or(0);

    let Some(fonts_start) = styles_xml.find("<fonts") else {
        return false;
    };
    let Some(fonts_end) = styles_xml[fonts_start..]
        .find("</fonts>")
        .map(|end| end + fonts_start)
    else {
        return false;
    };
    let fonts = &styles_xml[fonts_start..fonts_end];
    let Some(font) = indexed_element(fonts, "<font", font_id) else {
        return false;
    };
    let Some(bold) = font.find("<b") else {
        return false;
    };
    let Some(bold_end) = font[bold..].find('>').map(|end| bold + end) else {
        return false;
    };
    let bold_opening = &font[bold..=bold_end];
    xml_attribute(bold_opening, "val").is_none_or(|value| {
        !matches!(
            value.to_ascii_lowercase().as_str(),
            "0" | "false" | "off" | "no"
        )
    })
}

#[track_caller]
fn assert_cell_bold(styles_xml: &str, worksheet_xml: &str, address: &str, expected: bool) {
    assert_eq!(
        cell_style_is_bold(styles_xml, worksheet_xml, address),
        expected,
        "{address} exported XF does not resolve to the expected bold flag"
    );
}

#[test]
fn cli_save_preserves_dynamic_array_caches_and_marker_metadata() {
    let fixture = Fixture::new(&dynamic_roundtrip_sheet());
    let output = fixture.save(&fixture.input(), false, "preserve.xlsx");
    let workbook = fixture.load(&output);
    let sheet = workbook.sheet_by_index(0).unwrap();

    for (address, expected) in [
        ("A1", 91.0),
        ("A2", 92.0),
        ("A3", 93.0),
        ("C1", 201.0),
        ("C2", 203.0),
        ("D1", 202.0),
        ("D2", 204.0),
        ("E1", 501.0),
        ("F1", 502.0),
    ] {
        assert_number(&sheet, address, expected);
    }
    assert_eq!(
        sheet.get_formula("A1").unwrap().as_deref(),
        Some("=SEQUENCE(3)")
    );
    assert_eq!(
        sheet.get_formula("C1").unwrap().as_deref(),
        Some("=SEQUENCE(2,2)")
    );
    assert_eq!(sheet.get_formula("A2").unwrap(), None);
    assert_eq!(sheet.get_formula("C2").unwrap(), None);

    let worksheet_xml = fixture.worksheet_xml(&output);
    assert!(fixture.contains_entry(&output, "xl/metadata.xml"));
    assert_empty_formula_marker(&worksheet_xml, "A2");
    assert_empty_formula_marker(&worksheet_xml, "C2");
    assert_unmarked_spill_child(&worksheet_xml, "A3");
    assert_unmarked_spill_child(&worksheet_xml, "D1");
    assert_unmarked_spill_child(&worksheet_xml, "D2");
    assert!(cell_fragment(&worksheet_xml, "A1").contains(r#"ref="A1:A3""#));
    assert!(cell_fragment(&worksheet_xml, "C1").contains(r#"ref="C1:D2""#));
}

#[test]
fn cli_save_recalculate_refreshes_complete_1d_and_2d_arrays_and_dependents() {
    let fixture = Fixture::new(&dynamic_roundtrip_sheet());
    let output = fixture.save(&fixture.input(), true, "recalculated.xlsx");
    let workbook = fixture.load(&output);
    let sheet = workbook.sheet_by_index(0).unwrap();

    for (address, expected) in [
        ("A1", 1.0),
        ("A2", 2.0),
        ("A3", 3.0),
        ("C1", 1.0),
        ("D1", 2.0),
        ("C2", 3.0),
        ("D2", 4.0),
        ("E1", 6.0),
        ("F1", 10.0),
    ] {
        assert_number(&sheet, address, expected);
    }

    assert_eq!(
        sheet.get_formula("A1").unwrap().as_deref(),
        Some("=SEQUENCE(3)")
    );
    assert_eq!(
        sheet.get_formula("C1").unwrap().as_deref(),
        Some("=SEQUENCE(2,2)")
    );

    let worksheet_xml = fixture.worksheet_xml(&output);
    assert!(fixture.contains_entry(&output, "xl/metadata.xml"));
    assert_empty_formula_marker(&worksheet_xml, "A2");
    assert_empty_formula_marker(&worksheet_xml, "C2");
    assert_unmarked_spill_child(&worksheet_xml, "A3");
    assert_unmarked_spill_child(&worksheet_xml, "D1");
    assert_unmarked_spill_child(&worksheet_xml, "D2");
}

#[test]
fn cli_save_recalculate_replaces_rich_text_cached_spill_child_with_numeric_projection() {
    let fixture = Fixture::new_with_shared_strings(
        &rich_text_cached_dynamic_sheet(),
        Some(RICH_SHARED_STRINGS),
    );
    let output = fixture.save(&fixture.input(), true, "rich-text-cache-recalculated.xlsx");
    let workbook = fixture.load(&output);
    let sheet = workbook.sheet_by_index(0).unwrap();

    assert_number(&sheet, "A1", 1.0);
    assert_number(&sheet, "A2", 2.0);
    assert_number(&sheet, "A3", 3.0);

    let worksheet_xml = fixture.worksheet_xml(&output);
    let a3 = cell_fragment(&worksheet_xml, "A3");
    assert_unmarked_spill_child(&worksheet_xml, "A3");
    assert!(
        !a3.contains(r#"t="str""#) && !a3.contains(r#"t="s""#),
        "stale string type survived: {a3}"
    );
    assert!(
        a3.contains("<v>3</v>"),
        "numeric projection was not exported: {a3}"
    );
}

#[test]
fn cli_run_recalculate_grows_shrinks_and_preserves_a_genuine_blocker() {
    let fixture = Fixture::new(&resize_sheet());
    let input_xml = fixture.worksheet_xml(&fixture.input());
    assert_cell_bold(
        &fixture.styles_xml(&fixture.input()),
        &input_xml,
        "A3",
        true,
    );

    let observed_before_edit = fixture.run(
        &fixture.input(),
        false,
        r#"await Excel.run(async context => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            const child = sheet.getRange("A3");
            child.format.font.load("bold");
            await context.sync();
            sheet.getRange("B2").values = [[child.format.font.bold ? 1 : 0]];
            await context.sync();
        });"#,
        "observed-before-edit.xlsx",
    );
    let observed_workbook = fixture.load(&observed_before_edit);
    let observed_sheet = observed_workbook.sheet_by_index(0).unwrap();
    assert_number(&observed_sheet, "B2", 1.0);

    let edited_without_recalc = fixture.run(
        &observed_before_edit,
        false,
        r#"await Excel.run(async context => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            sheet.getRange("B1").values = [[42]];
            sheet.getRange("A3").format.font.bold = false;
            await context.sync();
        });"#,
        "edited-preserve.xlsx",
    );
    let preserved_workbook = fixture.load(&edited_without_recalc);
    let preserved_sheet = preserved_workbook.sheet_by_index(0).unwrap();
    assert_number(&preserved_sheet, "A1", 3.0);
    assert_number(&preserved_sheet, "B1", 42.0);
    assert_number(&preserved_sheet, "B2", 1.0);
    for (address, expected) in [("A2", 91.0), ("A3", 92.0), ("A4", 93.0)] {
        assert_number(&preserved_sheet, address, expected);
    }
    assert_number(&preserved_sheet, "C1", 999.0);
    assert_number(&preserved_sheet, "D1", 888.0);
    for address in ["A5", "A6"] {
        assert_empty(&preserved_sheet, address);
    }
    let preserved_xml = fixture.worksheet_xml(&edited_without_recalc);
    assert_empty_formula_marker(&preserved_xml, "A3");
    assert_unmarked_spill_child(&preserved_xml, "A4");
    assert_cell_bold(
        &fixture.styles_xml(&edited_without_recalc),
        &preserved_xml,
        "A3",
        false,
    );

    let grown = fixture.run(
        &edited_without_recalc,
        true,
        r#"await Excel.run(async context => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            sheet.getRange("A1").values = [[5]];
            await context.sync();
        });"#,
        "grown.xlsx",
    );
    let grown_workbook = fixture.load(&grown);
    let grown_sheet = grown_workbook.sheet_by_index(0).unwrap();
    for (address, expected) in [
        ("A2", 1.0),
        ("A3", 2.0),
        ("A4", 3.0),
        ("A5", 4.0),
        ("A6", 5.0),
    ] {
        assert_number(&grown_sheet, address, expected);
    }
    assert_number(&grown_sheet, "C1", 15.0);
    assert_number(&grown_sheet, "D1", 14.0);
    assert_cell_bold(
        &fixture.styles_xml(&grown),
        &fixture.worksheet_xml(&grown),
        "A3",
        false,
    );

    let shrunk = fixture.run(
        &grown,
        true,
        r#"await Excel.run(async context => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            sheet.getRange("A1").values = [[2]];
            await context.sync();
        });"#,
        "shrunk.xlsx",
    );
    let shrunk_workbook = fixture.load(&shrunk);
    let shrunk_sheet = shrunk_workbook.sheet_by_index(0).unwrap();
    assert_number(&shrunk_sheet, "A2", 1.0);
    assert_number(&shrunk_sheet, "A3", 2.0);
    assert_number(&shrunk_sheet, "C1", 3.0);
    assert_number(&shrunk_sheet, "D1", 2.0);
    assert_cell_bold(
        &fixture.styles_xml(&shrunk),
        &fixture.worksheet_xml(&shrunk),
        "A3",
        false,
    );
    for address in ["A4", "A5", "A6"] {
        assert_empty(&shrunk_sheet, address);
    }

    let blocked = fixture.run(
        &shrunk,
        true,
        r#"await Excel.run(async context => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            sheet.getRange("A5").values = [[777]];
            sheet.getRange("A1").values = [[5]];
            await context.sync();
        });"#,
        "blocked.xlsx",
    );
    let blocked_workbook = fixture.load(&blocked);
    let blocked_sheet = blocked_workbook.sheet_by_index(0).unwrap();
    assert_spill_error(&blocked_sheet, "A2");
    assert_spill_error(&blocked_sheet, "C1");
    assert_number(&blocked_sheet, "D1", 777.0);
    assert_number(&blocked_sheet, "A5", 777.0);
    for address in ["A3", "A4", "A6"] {
        assert_empty(&blocked_sheet, address);
    }
}

#[test]
fn cli_run_recalculate_rejects_overlapping_growth_without_destroying_peer_array() {
    let fixture = Fixture::new(&overlap_sheet());
    let output = fixture.run(
        &fixture.input(),
        true,
        r#"await Excel.run(async context => {
            const sheet = context.workbook.worksheets.getItem("Sheet1");
            sheet.getRange("A1").values = [[3]];
            await context.sync();
        });"#,
        "overlap.xlsx",
    );
    let workbook = fixture.load(&output);
    let sheet = workbook.sheet_by_index(0).unwrap();
    assert_spill_error(&sheet, "A2");
    assert_empty(&sheet, "A3");
    assert_number(&sheet, "A4", 1.0);
    assert_number(&sheet, "A5", 2.0);
    assert_eq!(
        sheet.get_formula("A4").unwrap().as_deref(),
        Some("=SEQUENCE(2)")
    );
    assert!(cell_fragment(&fixture.worksheet_xml(&output), "A2").contains(r#"ref="A2""#));
}
