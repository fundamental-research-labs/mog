//! Workbook fonts survive load+export even when cells have no `s` attribute.

use compute_core::storage::engine::ComputeEngine;
use xlsx_parser::write::ZipWriter;
use xlsx_parser::zip::XlsxArchive;

fn workbook_with_normal_font(name: &str, size: &str) -> Vec<u8> {
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
      <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData>
    </worksheet>"#
            .to_vec(),
    );
    let styles = format!(
        r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="1"><font><sz val="{size}"/><color theme="1"/><name val="{name}"/><family val="2"/><scheme val="minor"/></font></fonts>
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

fn exported_styles(bytes: &[u8]) -> String {
    String::from_utf8(
        XlsxArchive::new(bytes)
            .unwrap()
            .read_file("xl/styles.xml")
            .unwrap(),
    )
    .unwrap()
}

fn exported_theme(bytes: &[u8]) -> String {
    String::from_utf8(
        XlsxArchive::new(bytes)
            .unwrap()
            .read_file("xl/theme/theme1.xml")
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn calibri_12_normal_font_survives_cells_without_style_index() {
    let (engine, _) =
        ComputeEngine::from_xlsx_bytes(&workbook_with_normal_font("Calibri", "12")).unwrap();
    let exported = engine.export_to_xlsx_bytes().expect("export");
    let styles = exported_styles(&exported);
    assert!(
        styles.contains(r#"<name val="Calibri"/>"#),
        "Calibri must survive export: {styles}"
    );
    assert!(
        styles.contains(r#"<sz val="12"/>"#),
        "12pt must survive export (not rewritten to 11): {styles}"
    );
}

#[test]
fn aptos_narrow_theme_font_is_not_rewritten_to_calibri() {
    let (engine, _) =
        ComputeEngine::from_xlsx_bytes(&workbook_with_normal_font("Aptos Narrow", "11")).unwrap();
    let exported = engine.export_to_xlsx_bytes().expect("export");
    let styles = exported_styles(&exported);
    let theme = exported_theme(&exported);
    assert!(
        styles.contains(r#"<name val="Aptos Narrow"/>"#),
        "Aptos Narrow must survive export: {styles}"
    );
    assert!(
        !styles.contains(r#"<name val="Calibri"/>"#),
        "must not replace workbook font with Calibri: {styles}"
    );
    assert!(
        theme.contains(r#"typeface="Aptos Narrow""#),
        "theme latin typeface must survive export: {theme}"
    );
}
