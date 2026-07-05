use super::fixtures::ZipBuilder;
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::{REL_IMAGE, REL_METADATA, REL_OFFICE_DOCUMENT, REL_WORKSHEET};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

const IMAGE_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nrich-data-image";
const METADATA_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><valueMetadata count="1"><bk><rc t="0" v="0"/></bk></valueMetadata></metadata>"#;
const RICH_VALUE_REL_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><rel r:id="rIdImage"/></richValueRels>"#;
const RICH_VALUE_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><rv s="0"><v>0</v></rv></rvData>"#;

#[test]
fn imported_rich_data_media_relationship_roundtrips_without_data_loss() {
    let imported = create_rich_data_xlsx();
    let (parsed, diagnostics) =
        parse_xlsx_to_output(&imported).expect("richData fixture should parse");

    assert!(
        diagnostics
            .errors
            .iter()
            .all(|error| !error.message.contains("Dropped XLSX import data")),
        "richData fixture must not be reported as dropped: {:?}",
        diagnostics.errors
    );
    let rich_data = parsed
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.rich_data.as_ref())
        .expect("richData package facts should be imported");
    assert!(
        rich_data
            .parts
            .iter()
            .any(|part| part.path == "xl/richData/richValueRel.xml"
                && part.data == RICH_VALUE_REL_XML.as_bytes())
    );
    assert!(
        rich_data
            .related_parts
            .iter()
            .any(|part| part.path == "xl/media/image1.png" && part.data == IMAGE_BYTES)
    );

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("richData ParseOutput export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    assert_eq!(
        archive.read_file("xl/metadata.xml").unwrap(),
        METADATA_XML.as_bytes()
    );
    assert_eq!(
        archive.read_file("xl/richData/richValueRel.xml").unwrap(),
        RICH_VALUE_REL_XML.as_bytes()
    );
    assert_eq!(
        archive.read_file("xl/richData/rdrichvalue.xml").unwrap(),
        RICH_VALUE_XML.as_bytes()
    );
    assert_eq!(
        archive.read_file("xl/media/image1.png").unwrap(),
        IMAGE_BYTES
    );

    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(
        worksheet_xml.contains(r#"vm="1""#),
        "current value metadata refs must survive export: {worksheet_xml}"
    );
    let rich_value_rels = parse_all_rels(
        &archive
            .read_file("xl/richData/_rels/richValueRel.xml.rels")
            .unwrap(),
    );
    assert!(
        rich_value_rels.iter().any(|rel| {
            rel.id == "rIdImage" && rel.rel_type == REL_IMAGE && rel.target == "../media/image1.png"
        }),
        "richData-owned image relationship must survive: {rich_value_rels:?}"
    );

    let (roundtripped, roundtrip_diagnostics) =
        parse_xlsx_to_output(&exported).expect("exported richData should parse back");
    assert!(
        roundtrip_diagnostics
            .errors
            .iter()
            .all(|error| !error.message.contains("Dropped XLSX import data")),
        "roundtripped richData must not be reported as dropped: {:?}",
        roundtrip_diagnostics.errors
    );
    let roundtrip_rich_data = roundtripped
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.rich_data.as_ref())
        .expect("roundtripped richData package facts should remain present");
    assert!(
        roundtrip_rich_data
            .related_parts
            .iter()
            .any(|part| part.path == "xl/media/image1.png" && part.data == IMAGE_BYTES)
    );
}

fn create_rich_data_xlsx() -> Vec<u8> {
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", content_types_xml().as_bytes())
        .add_deflate("_rels/.rels", root_rels_xml().as_bytes())
        .add_deflate("xl/_rels/workbook.xml.rels", workbook_rels_xml().as_bytes())
        .add_deflate("xl/workbook.xml", workbook_xml().as_bytes())
        .add_deflate("xl/worksheets/sheet1.xml", worksheet_xml().as_bytes())
        .add_deflate("xl/metadata.xml", METADATA_XML.as_bytes())
        .add_deflate(
            "xl/richData/richValueRel.xml",
            RICH_VALUE_REL_XML.as_bytes(),
        )
        .add_deflate("xl/richData/rdrichvalue.xml", RICH_VALUE_XML.as_bytes())
        .add_deflate(
            "xl/richData/_rels/richValueRel.xml.rels",
            rich_value_rels_xml().as_bytes(),
        )
        .add_deflate("xl/media/image1.png", IMAGE_BYTES);
    builder.build()
}

fn content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>
  <Override PartName="/xl/richData/richValueRel.xml" ContentType="application/vnd.ms-excel.richvaluerel+xml"/>
  <Override PartName="/xl/richData/rdrichvalue.xml" ContentType="application/vnd.ms-excel.rdrichvalue+xml"/>
</Types>"#
        .to_string()
}

fn root_rels_xml() -> String {
    rels_xml(&[("rIdWorkbook", REL_OFFICE_DOCUMENT, "xl/workbook.xml", None)])
}

fn workbook_rels_xml() -> String {
    rels_xml(&[
        ("rIdSheet1", REL_WORKSHEET, "worksheets/sheet1.xml", None),
        ("rIdMetadata", REL_METADATA, "metadata.xml", None),
    ])
}

fn rich_value_rels_xml() -> String {
    rels_xml(&[("rIdImage", REL_IMAGE, "../media/image1.png", None)])
}

fn workbook_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rIdSheet1"/>
  </sheets>
</workbook>"#
        .to_string()
}

fn worksheet_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="str" vm="1"><v>image</v></c></row>
  </sheetData>
</worksheet>"#
        .to_string()
}

fn rels_xml(relationships: &[(&str, &str, &str, Option<&str>)]) -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (id, rel_type, target, target_mode) in relationships {
        xml.push_str(&format!(
            r#"<Relationship Id="{id}" Type="{rel_type}" Target="{target}""#
        ));
        if let Some(target_mode) = target_mode {
            xml.push_str(&format!(r#" TargetMode="{target_mode}""#));
        }
        xml.push_str("/>");
    }
    xml.push_str("</Relationships>");
    xml
}
