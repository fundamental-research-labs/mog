use std::fs;
use std::path::Path;

use super::super::fixtures::ZipBuilder;
use domain_types::domain::floating_object::FloatingObjectData;
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::{REL_DRAWING, REL_IMAGE, REL_OFFICE_DOCUMENT, REL_WORKSHEET};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

#[test]
fn imported_png_floating_object_exports_media_part_and_content_type() {
    assert_imported_image_fixture_exports_media("image-png.xlsx", "image/png", &["png"]);
}

#[test]
fn imported_jpeg_floating_object_exports_media_part_and_content_type() {
    assert_imported_image_fixture_exports_media("image-jpg.xlsx", "image/jpeg", &["jpeg", "jpg"]);
}

#[test]
fn imported_shared_drawing_media_target_roundtrips_as_shared_package_part() {
    let imported = create_drawing_fixture_xlsx(
        &drawing_xml_for_blips(&[
            (1, "Shared Image 1", 2, r#"r:embed="rIdImage1""#),
            (2, "Shared Image 2", 6, r#"r:embed="rIdImage2""#),
        ]),
        &rels_xml(&[
            ("rIdImage1", REL_IMAGE, "/xl/media/shared.png", None),
            ("rIdImage2", REL_IMAGE, "/xl/media/shared.png", None),
        ]),
        &[("xl/media/shared.png", b"\x89PNG\r\n\x1a\nshared payload")],
    );

    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("fixture should parse to ParseOutput");
    let pictures = parsed_picture_sources(&parsed);
    assert_eq!(pictures.len(), 2);
    assert!(
        pictures
            .iter()
            .all(|src| src.starts_with("data:image/png;base64,"))
    );
    assert_eq!(pictures[0], pictures[1]);

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("ParseOutput export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");

    assert_eq!(
        media_part_names(&archive),
        vec!["xl/media/shared.png".to_string()],
        "shared drawing media should be emitted once as a package part"
    );
    assert_eq!(
        drawing_image_parts(&archive),
        vec![
            "xl/media/shared.png".to_string(),
            "xl/media/shared.png".to_string()
        ],
        "each picture edge should still point at the shared media part"
    );

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_external_drawing_image_link_roundtrips_without_media_part() {
    let target = "https://example.invalid/image.png";
    let imported = create_drawing_fixture_xlsx(
        &drawing_xml_for_blips(&[(1, "External Image", 2, r#"r:link="rIdLinkedImage""#)]),
        &rels_xml(&[("rIdLinkedImage", REL_IMAGE, target, Some("External"))]),
        &[],
    );

    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("fixture should parse to ParseOutput");
    let picture = parsed.sheets[0]
        .floating_objects
        .iter()
        .find_map(|object| match &object.data {
            FloatingObjectData::Picture(data) => Some(data),
            _ => None,
        })
        .expect("import should project the linked picture");
    let ooxml = picture
        .ooxml
        .as_ref()
        .expect("picture OOXML should survive import");
    assert!(ooxml.embedded_media.is_none());
    assert_eq!(
        ooxml.picture.blip_fill.link_id.as_deref(),
        Some("rIdLinkedImage")
    );
    assert!(ooxml.relationships.iter().any(|rel| {
        rel.id == "rIdLinkedImage"
            && rel.rel_type == REL_IMAGE
            && rel.target == target
            && rel.target_mode.as_deref() == Some("External")
    }));

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("ParseOutput export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let image_rels = drawing_image_relationships(&archive);

    assert_eq!(image_rels.len(), 1);
    assert!(
        drawing_xml.contains(&format!(r#"r:link="{}""#, image_rels[0].id)),
        "drawing XML should reference the exported external image relationship; XML was {drawing_xml}"
    );
    assert!(!drawing_xml.contains("r:embed="));
    assert_eq!(media_part_names(&archive), Vec::<String>::new());
    assert_eq!(image_rels[0].target, target);
    assert_eq!(image_rels[0].target_mode.as_deref(), Some("External"));

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn assert_imported_image_fixture_exports_media(
    fixture_name: &str,
    expected_content_type: &str,
    expected_extensions: &[&str],
) {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("test-corpus/parity/floating-objects")
        .join(fixture_name);
    let fixture_bytes = fs::read(&fixture_path).unwrap_or_else(|err| {
        panic!(
            "fixture {} should be readable: {err}",
            fixture_path.display()
        )
    });

    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&fixture_bytes).expect("fixture should parse to ParseOutput");
    let exported =
        write_xlsx_from_parse_output(&parsed).expect("ParseOutput export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");

    let image_parts = drawing_image_parts(&archive);
    assert_eq!(
        image_parts.len(),
        1,
        "{fixture_name} should export exactly one drawing image relationship"
    );

    let image_part = &image_parts[0];
    assert!(
        image_part.starts_with("xl/media/"),
        "{fixture_name} drawing image relationship should resolve to xl/media/*, got {image_part}"
    );
    assert!(
        archive.contains(image_part),
        "{fixture_name} drawing image target {image_part} should be emitted as a ZIP part"
    );

    let extension = image_part
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .expect("image media part should have an extension");
    assert!(
        expected_extensions.contains(&extension),
        "{fixture_name} should export a {:?} media extension, got {extension} in {image_part}",
        expected_extensions
    );

    let content_types = String::from_utf8(
        archive
            .read_file("[Content_Types].xml")
            .expect("exported content types should exist"),
    )
    .expect("[Content_Types].xml should be UTF-8");
    assert!(
        content_types.contains(&format!(
            r#"<Default Extension="{extension}" ContentType="{expected_content_type}"/>"#
        )),
        "{fixture_name} should register a default content type for emitted media extension {extension}; [Content_Types].xml was {content_types}"
    );

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn create_drawing_fixture_xlsx(
    drawing_xml: &str,
    drawing_rels_xml: &str,
    media_parts: &[(&str, &[u8])],
) -> Vec<u8> {
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
        .add_deflate("xl/drawings/drawing1.xml", drawing_xml.as_bytes())
        .add_deflate(
            "xl/drawings/_rels/drawing1.xml.rels",
            drawing_rels_xml.as_bytes(),
        );

    for (path, bytes) in media_parts {
        builder.add_deflate(path, bytes);
    }

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
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
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
    rels_xml(&[(
        "rIdDrawing1",
        REL_DRAWING,
        "/xl/drawings/drawing1.xml",
        None,
    )])
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
  <drawing r:id="rIdDrawing1"/>
</worksheet>"#
        .to_string()
}

fn drawing_xml_for_blips(blips: &[(u32, &str, u32, &str)]) -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">"#,
    );

    for (id, name, row, blip_attr) in blips {
        xml.push_str(&format!(
            r#"<oneCellAnchor><from><col>0</col><colOff>0</colOff><row>{row}</row><rowOff>0</rowOff></from><ext cx="762000" cy="762000"/><pic><nvPicPr><cNvPr id="{id}" name="{name}" descr="Picture"/><cNvPicPr/></nvPicPr><blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" cstate="print" {blip_attr}/><a:stretch xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:fillRect/></a:stretch></blipFill><spPr><a:prstGeom xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" prst="rect"/></spPr></pic><clientData/></oneCellAnchor>"#
        ));
    }

    xml.push_str("</wsDr>");
    xml
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

fn parsed_picture_sources(parsed: &domain_types::ParseOutput) -> Vec<String> {
    parsed.sheets[0]
        .floating_objects
        .iter()
        .filter_map(|object| match &object.data {
            FloatingObjectData::Picture(data) => Some(data.src.clone()),
            _ => None,
        })
        .collect()
}

fn media_part_names(archive: &XlsxArchive<'_>) -> Vec<String> {
    let mut media_parts: Vec<_> = archive
        .entries()
        .iter()
        .filter(|entry| entry.name.starts_with("xl/media/"))
        .map(|entry| entry.name.clone())
        .collect();
    media_parts.sort();
    media_parts
}

fn drawing_image_parts(archive: &XlsxArchive<'_>) -> Vec<String> {
    let mut image_parts = Vec::new();

    for (owner_rels_path, rel) in drawing_image_relationships_by_owner(archive) {
        if rel.target_mode.as_deref() != Some("External") {
            image_parts.push(resolve_relationship_target(&owner_rels_path, &rel.target));
        }
    }

    image_parts.sort();
    image_parts
}

fn drawing_image_relationships(
    archive: &XlsxArchive<'_>,
) -> Vec<ooxml_types::shared::OpcRelationship> {
    drawing_image_relationships_by_owner(archive)
        .into_iter()
        .map(|(_, rel)| rel)
        .collect()
}

fn drawing_image_relationships_by_owner(
    archive: &XlsxArchive<'_>,
) -> Vec<(String, ooxml_types::shared::OpcRelationship)> {
    let mut relationships = Vec::new();

    for entry in archive
        .entries()
        .iter()
        .filter(|entry| is_drawing_relationship_part(&entry.name))
    {
        let rels_xml = archive
            .read_file(&entry.name)
            .expect("drawing relationship part should be readable");
        for rel in parse_all_rels(&rels_xml) {
            if rel.rel_type == REL_IMAGE {
                relationships.push((entry.name.clone(), rel));
            }
        }
    }

    relationships.sort_by(|(_, a), (_, b)| a.id.cmp(&b.id));
    relationships
}

fn is_drawing_relationship_part(path: &str) -> bool {
    path.starts_with("xl/drawings/_rels/")
        && path.ends_with(".xml.rels")
        && path.contains("/drawing")
}

fn resolve_relationship_target(owner_rels_path: &str, target: &str) -> String {
    if let Some(package_absolute) = target.strip_prefix('/') {
        return normalize_package_path(package_absolute);
    }

    let owner_part = owner_rels_path
        .replace("/_rels/", "/")
        .strip_suffix(".rels")
        .expect("relationship part should end with .rels")
        .to_string();
    let base_dir = owner_part
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or("");

    normalize_package_path(&format!("{base_dir}/{target}"))
}

fn normalize_package_path(path: &str) -> String {
    let mut segments = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            segment => segments.push(segment),
        }
    }
    segments.join("/")
}
