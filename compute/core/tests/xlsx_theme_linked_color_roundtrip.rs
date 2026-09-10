//! Theme-linked cell colors must survive import/export as theme+tint (#329).

use compute_core::storage::engine::ComputeEngine;
use xlsx_parser::write::ZipWriter;
use xlsx_parser::zip::XlsxArchive;

fn theme_linked_fixture() -> Vec<u8> {
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
      <sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>theme-linked</t></is></c></row></sheetData>
    </worksheet>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/styles.xml",
        br#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="2">
        <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
        <font><sz val="11"/><color theme="4" tint="0.2"/><name val="Calibri"/></font>
      </fonts>
      <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
      <borders count="1"><border/></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="2">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
      </cellXfs>
    </styleSheet>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/theme/theme1.xml",
        br#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
      <a:themeElements>
        <a:clrScheme name="Office">
          <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
          <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
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
          <a:majorFont><a:latin typeface="Cambria"/></a:majorFont>
          <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
        </a:fontScheme>
        <a:fmtScheme name="Office">
          <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
          <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
          <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
          <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
        </a:fmtScheme>
      </a:themeElements>
    </a:theme>"#
            .to_vec(),
    );
    zip.finish().expect("theme fixture")
}

#[test]
fn imported_theme_font_color_exports_theme_and_tint() {
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&theme_linked_fixture()).unwrap();
    let exported = engine.export_to_xlsx_bytes().expect("export");
    let styles = String::from_utf8(
        XlsxArchive::new(&exported)
            .unwrap()
            .read_file("xl/styles.xml")
            .unwrap(),
    )
    .unwrap();
    assert!(
        styles.contains(r#"theme="4""#),
        "theme slot must survive export: {styles}"
    );
    assert!(
        styles.contains(r#"tint="0.2""#) || styles.contains(r#"tint="0.20""#),
        "tint must survive export: {styles}"
    );
    assert!(
        !styles.to_ascii_uppercase().contains(r#"RGB="THEME:"#),
        "must not serialize theme strings as RGB: {styles}"
    );
}
