use super::super::fixtures::ZipBuilder;
use domain_types::domain::print::HfImagePosition;
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::{
    REL_IMAGE, REL_OFFICE_DOCUMENT, REL_VML_DRAWING, REL_WORKSHEET, resolve_relationship_target,
};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

#[test]
fn imported_header_footer_vml_image_roundtrips_media_part_and_relationship() {
    assert_header_footer_image_roundtrips("/xl/media/header.png");
    assert_header_footer_image_roundtrips("../media/header.png");
}

fn assert_header_footer_image_roundtrips(image_target: &str) {
    let imported = create_header_footer_image_xlsx(image_target);
    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("fixture should parse to ParseOutput");

    assert_eq!(parsed.sheets[0].hf_images.len(), 1);
    let image = &parsed.sheets[0].hf_images[0];
    assert_eq!(image.position, HfImagePosition::CenterHeader);
    assert_eq!(image.title, "CH");
    assert!(image.src.starts_with("data:image/png;base64,"));

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("ParseOutput export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");

    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(worksheet_xml.contains("<legacyDrawingHF "));

    let worksheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    );
    let vml_rel = worksheet_rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING)
        .expect("worksheet should relate to header/footer VML");
    let vml_path = resolve_relationship_target(Some("xl/worksheets/sheet1.xml"), &vml_rel.target)
        .expect("worksheet VML target should resolve");

    let vml_xml = String::from_utf8(archive.read_file(&vml_path).unwrap()).unwrap();
    assert!(vml_xml.contains(r#"id="CH""#));
    assert!(vml_xml.contains(r#"o:relid="rId1""#));

    let vml_rels_path = part_relationships_path(&vml_path);
    let vml_rels = parse_all_rels(&archive.read_file(&vml_rels_path).unwrap());
    let image_rels: Vec<_> = vml_rels
        .iter()
        .filter(|rel| rel.rel_type == REL_IMAGE)
        .collect();
    assert_eq!(image_rels.len(), 1);
    let image_path = resolve_relationship_target(Some(&vml_path), &image_rels[0].target)
        .expect("VML image target should resolve");

    assert_eq!(
        archive.read_file(&image_path).unwrap(),
        b"\x89PNG\r\n\x1a\nheader image payload".to_vec()
    );

    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));

    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (roundtripped, _diagnostics) =
        parse_xlsx_to_output(&exported).expect("exported XLSX should parse back");
    assert_eq!(roundtripped.sheets[0].hf_images.len(), 1);
    assert_eq!(
        roundtripped.sheets[0].hf_images[0].position,
        HfImagePosition::CenterHeader
    );
    assert!(
        roundtripped.sheets[0].hf_images[0]
            .src
            .starts_with("data:image/png;base64,")
    );
}

fn create_header_footer_image_xlsx(image_target: &str) -> Vec<u8> {
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", content_types_xml().as_bytes())
        .add_deflate("_rels/.rels", root_rels_xml().as_bytes())
        .add_deflate("xl/_rels/workbook.xml.rels", workbook_rels_xml().as_bytes())
        .add_deflate("xl/workbook.xml", workbook_xml().as_bytes())
        .add_deflate("xl/worksheets/sheet1.xml", worksheet_xml().as_bytes())
        .add_deflate(
            "xl/worksheets/_rels/sheet1.xml.rels",
            worksheet_rels_xml().as_bytes(),
        )
        .add_deflate("xl/drawings/vmlDrawing1.vml", vml_xml().as_bytes())
        .add_deflate(
            "xl/drawings/_rels/vmlDrawing1.vml.rels",
            vml_rels_xml(image_target).as_bytes(),
        )
        .add_deflate(
            "xl/drawings/vmlDrawingComments.vml",
            ordinary_vml_xml().as_bytes(),
        )
        .add_deflate(
            "xl/drawings/_rels/vmlDrawingComments.vml.rels",
            ordinary_vml_rels_xml().as_bytes(),
        )
        .add_deflate(
            "xl/media/header.png",
            b"\x89PNG\r\n\x1a\nheader image payload",
        );
    builder.add_deflate(
        "xl/media/comment.png",
        b"\x89PNG\r\n\x1a\ncomment image payload",
    );
    builder.build()
}

fn content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#
        .to_string()
}

fn root_rels_xml() -> String {
    rels_xml(&[("rIdWorkbook", REL_OFFICE_DOCUMENT, "xl/workbook.xml", None)])
}

fn workbook_rels_xml() -> String {
    rels_xml(&[("rIdSheet1", REL_WORKSHEET, "worksheets/sheet1.xml", None)])
}

fn worksheet_rels_xml() -> String {
    rels_xml(&[
        (
            "rIdCommentVml",
            REL_VML_DRAWING,
            "/xl/drawings/vmlDrawingComments.vml",
            None,
        ),
        (
            "rIdHeaderFooterVml",
            REL_VML_DRAWING,
            "/xl/drawings/vmlDrawing1.vml",
            None,
        ),
    ])
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
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <headerFooter><oddHeader>&amp;C&amp;G</oddHeader></headerFooter>
  <legacyDrawing r:id="rIdCommentVml"/>
  <legacyDrawingHF r:id="rIdHeaderFooterVml"/>
</worksheet>"#
        .to_string()
}

fn vml_xml() -> String {
    r##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype><v:shape id="CH" o:spid="_x0000_s13313" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:46pt;height:46pt;z-index:13313"><v:imagedata o:relid="rIdImage" o:title="CH"/><o:lock v:ext="edit" rotation="t"/></v:shape></xml>"##
        .to_string()
}

fn vml_rels_xml(image_target: &str) -> String {
    rels_xml(&[("rIdImage", REL_IMAGE, image_target, None)])
}

fn ordinary_vml_xml() -> String {
    r##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="LH" o:spid="_x0000_s1025" type="#_x0000_t75"><v:imagedata o:relid="rIdOrdinaryImage" o:title="LH"/></v:shape></xml>"##
        .to_string()
}

fn ordinary_vml_rels_xml() -> String {
    rels_xml(&[("rIdOrdinaryImage", REL_IMAGE, "/xl/media/comment.png", None)])
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

fn part_relationships_path(part_path: &str) -> String {
    let Some((dir, file_name)) = part_path.rsplit_once('/') else {
        return format!("_rels/{part_path}.rels");
    };
    format!("{dir}/_rels/{file_name}.rels")
}
