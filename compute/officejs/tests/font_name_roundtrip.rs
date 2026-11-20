//! Explicit Office.js font names must replace inherited XLSX theme selection.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use regex::Regex;
use xlsx_parser::domain::styles::read::parse_styles;
use xlsx_parser::domain::styles::types::FontScheme;
use xlsx_parser::write::ZipWriter;
use xlsx_parser::zip::XlsxArchive;

fn themed_workbook(scheme: FontScheme) -> Vec<u8> {
    let name = "Calibri";
    let size = "11";
    let scheme = scheme.to_ooxml();
    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
    </Types>"#
            .to_vec(),
    );
    zip.add_file(
        "_rels/.rels",
        br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/workbook.xml",
        br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
    </workbook>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
    </Relationships>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/worksheets/sheet1.xml",
        br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData><row r="1"><c r="A1" s="0"><v>1</v></c><c r="B1" s="0"><v>2</v></c><c r="C1" s="0"><v>3</v></c></row></sheetData>
    </worksheet>"#
            .to_vec(),
    );
    let styles = format!(
        r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="1"><font><sz val="{size}"/><color theme="1"/><name val="{name}"/><family val="2"/><scheme val="{scheme}"/></font></fonts>
      <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
      <borders count="1"><border/></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
    </styleSheet>"#
    );
    zip.add_file("xl/styles.xml", styles.into_bytes());
    zip.add_file(
        "xl/theme/theme1.xml",
        format!(
            r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
      <a:themeElements>
        <a:clrScheme name="Office">
          <a:dk1><a:srgbClr val="000000"/></a:dk1>
          <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
          <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
          <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
          <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
          <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
          <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
          <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
          <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
          <a:accent6><a:srgbClr val="F79646"/></a:accent6>
          <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
          <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
        </a:clrScheme>
        <a:fontScheme name="Office">
          <a:majorFont><a:latin typeface="{name}"/></a:majorFont>
          <a:minorFont><a:latin typeface="{name}"/></a:minorFont>
        </a:fontScheme>
        <a:fmtScheme name="Office">
          <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
          <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
          <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
          <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
        </a:fmtScheme>
      </a:themeElements>
    </a:theme>"#
        )
        .into_bytes(),
    );
    zip.finish().expect("font fixture")
}

fn assert_exported_font(
    bytes: &[u8],
    address: &str,
    name: &str,
    size: f64,
    scheme: Option<FontScheme>,
) {
    let archive = XlsxArchive::new(bytes).expect("XLSX archive");
    let sheet = String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let cell_pattern = Regex::new(&format!(r#"<c\b[^>]*\br="{address}"[^>]*>"#)).unwrap();
    let cell = cell_pattern.find(&sheet).expect("exported cell").as_str();
    let style_pattern = Regex::new(r#"\bs="(\d+)""#).unwrap();
    let style_id = style_pattern
        .captures(cell)
        .map_or(0, |capture| capture[1].parse::<usize>().unwrap());
    let styles_xml = archive.read_file("xl/styles.xml").unwrap();
    let styles = parse_styles(&styles_xml);
    let font_id = styles.cell_xfs[style_id].font_id.unwrap_or(0) as usize;
    let font = &styles.fonts[font_id];
    assert_eq!(font.name.as_deref(), Some(name), "{address} font name");
    assert_eq!(font.size, Some(size), "{address} font size");
    assert_eq!(font.scheme, scheme, "{address} font scheme");

    // Also check the referenced raw font record: even scheme="none" is not
    // the same as omitting the scheme element for an explicit font name.
    if scheme.is_none() {
        let styles_xml = String::from_utf8(styles_xml).unwrap();
        let font_pattern = Regex::new(r"(?s)<font>.*?</font>").unwrap();
        let font_xml = font_pattern.find_iter(&styles_xml).nth(font_id).unwrap();
        assert!(
            !font_xml.as_str().contains("<scheme"),
            "{address}: {}",
            font_xml.as_str()
        );
    }
}

fn assert_loaded_font(workbook: &Workbook, address: &str, name: &str, size: f64) {
    let output = run_office_js_with_workbook(
        workbook,
        &format!(
            r#"
            return await Excel.run(async context => {{
                const font = context.workbook.worksheets.getItem("Sheet1")
                    .getRange("{address}").format.font;
                font.load("name,size");
                await context.sync();
                return {{ name: font.name, size: font.size }};
            }});
            "#
        ),
    )
    .expect("load font through Office.js");
    assert_eq!(output.value["name"].as_str(), Some(name), "{address} name");
    assert_eq!(output.value["size"].as_f64(), Some(size), "{address} size");
}

fn edit_font(workbook: &Workbook, assignment: &str) {
    run_office_js_with_workbook(
        workbook,
        &format!(
            r#"
            await Excel.run(async context => {{
                const sheet = context.workbook.worksheets.getItem("Sheet1");
                const font = sheet.getRange("A1").format.font;
                {assignment}
                font.size = 10;
                sheet.getRange("C1").format.font.size = 14;
                await context.sync();
            }});
            "#
        ),
    )
    .expect("edit fonts through Office.js");
}

fn assert_themed_roundtrip(scheme: FontScheme, assignment: &str) {
    let input = themed_workbook(scheme);
    assert_exported_font(&input, "A1", "Calibri", 11.0, Some(scheme));
    let (workbook, _) = Workbook::from_xlsx_bytes(&input).expect("import themed workbook");
    assert_loaded_font(&workbook, "A1", "Calibri", 11.0);
    edit_font(&workbook, assignment);
    assert_loaded_font(&workbook, "A1", "Arial", 10.0);

    let exported = workbook.to_xlsx_bytes().expect("export edited workbook");
    let (reopened, _) = Workbook::from_xlsx_bytes(&exported).expect("reopen edited workbook");
    assert_exported_font(&exported, "A1", "Arial", 10.0, None);
    assert_loaded_font(&reopened, "A1", "Arial", 10.0);
    // An untouched neighbor and a size-only edit keep their theme selection.
    for (address, size) in [("B1", 11.0), ("C1", 14.0)] {
        assert_exported_font(&exported, address, "Calibri", size, Some(scheme));
        assert_loaded_font(&reopened, address, "Calibri", size);
    }
}

#[test]
fn direct_name_replaces_imported_minor_scheme() {
    assert_themed_roundtrip(FontScheme::Minor, r#"font.name = "Arial";"#);
}

#[test]
fn direct_name_replaces_imported_major_scheme() {
    assert_themed_roundtrip(FontScheme::Major, r#"font.name = "Arial";"#);
}

#[test]
fn font_set_name_replaces_imported_minor_scheme() {
    assert_themed_roundtrip(FontScheme::Minor, r#"font.set({name: "Arial"});"#);
}

#[test]
fn font_set_name_replaces_imported_major_scheme() {
    assert_themed_roundtrip(FontScheme::Major, r#"font.set({name: "Arial"});"#);
}

#[test]
fn explicit_name_on_blank_workbook_survives_reopening() {
    for assignment in [r#"font.name = "Arial";"#, r#"font.set({name: "Arial"});"#] {
        let (workbook, _) = Workbook::blank().expect("blank workbook");
        edit_font(&workbook, assignment);
        let exported = workbook
            .to_xlsx_bytes()
            .expect("export blank workbook edit");
        assert_exported_font(&exported, "A1", "Arial", 10.0, None);
        let (reopened, _) =
            Workbook::from_xlsx_bytes(&exported).expect("reopen blank workbook edit");
        assert_loaded_font(&reopened, "A1", "Arial", 10.0);
    }
}
