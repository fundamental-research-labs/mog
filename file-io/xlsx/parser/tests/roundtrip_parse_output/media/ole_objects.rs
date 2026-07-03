use super::super::fixtures::ZipBuilder;
use domain_types::domain::floating_object::FloatingObjectData;
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::{
    REL_DRAWING, REL_IMAGE, REL_OFFICE_DOCUMENT, REL_OLE_OBJECT, REL_VML_DRAWING, REL_WORKSHEET,
    resolve_relationship_target,
};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

const OLE_BYTES: &[u8] = b"\xd0\xcf\x11\xe0ole object payload";
const PREVIEW_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nole preview payload";

#[test]
fn imported_ole_embedding_and_preview_roundtrips_owned_package_parts() {
    let imported = create_ole_object_xlsx();
    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("fixture should parse to ParseOutput");

    let ole = parsed.sheets[0]
        .floating_objects
        .iter()
        .find_map(|object| match &object.data {
            FloatingObjectData::OleObject(data) => Some(data),
            _ => None,
        })
        .expect("import should project the OLE object");
    assert_eq!(ole.prog_id, "Word.Document.12");
    assert!(
        ole.preview_image_src
            .as_ref()
            .is_some_and(|src| { src.starts_with("data:image/png;base64,") })
    );

    let ooxml = ole
        .ooxml
        .as_ref()
        .expect("OLE OOXML package authority should survive import");
    assert_eq!(
        ooxml
            .embedding
            .as_ref()
            .map(|embedding| embedding.bytes.as_slice()),
        Some(OLE_BYTES)
    );
    assert_eq!(
        ooxml
            .preview
            .as_ref()
            .map(|preview| preview.bytes.as_slice()),
        Some(PREVIEW_BYTES)
    );

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("ParseOutput export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    assert_eq!(
        package_parts_with_prefix(&archive, "xl/embeddings/"),
        vec!["xl/embeddings/oleObject1.bin".to_string()]
    );
    assert_eq!(
        package_parts_with_prefix(&archive, "xl/media/"),
        vec!["xl/media/olePreview.png".to_string()]
    );

    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    assert!(content_types.contains(
        r#"PartName="/xl/embeddings/oleObject1.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject""#
    ));
    assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));

    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(worksheet_xml.contains("<oleObjects>"));
    assert!(worksheet_xml.contains("<legacyDrawing "));
    assert!(!worksheet_xml.contains("<drawing "));

    let worksheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    );
    assert!(
        !worksheet_rels.iter().any(|rel| rel.rel_type == REL_DRAWING),
        "OLE-only export should not create an empty DrawingML part"
    );
    let ole_rel = worksheet_rels
        .iter()
        .find(|rel| rel.rel_type == REL_OLE_OBJECT)
        .expect("worksheet should relate to the OLE embedding");
    let embedding_path =
        resolve_relationship_target(Some("xl/worksheets/sheet1.xml"), &ole_rel.target)
            .expect("worksheet OLE target should resolve");
    assert_eq!(archive.read_file(&embedding_path).unwrap(), OLE_BYTES);

    let vml_rel = worksheet_rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING)
        .expect("worksheet should relate to OLE preview VML");
    let vml_path = resolve_relationship_target(Some("xl/worksheets/sheet1.xml"), &vml_rel.target)
        .expect("worksheet VML target should resolve");
    let vml_xml = String::from_utf8(archive.read_file(&vml_path).unwrap()).unwrap();
    assert!(vml_xml.contains(r#"id="_x0000_s2049""#));
    assert!(vml_xml.contains("v:imagedata"));

    let vml_rels = parse_all_rels(
        &archive
            .read_file(&part_relationships_path(&vml_path))
            .unwrap(),
    );
    let preview_rel = vml_rels
        .iter()
        .find(|rel| rel.rel_type == REL_IMAGE)
        .expect("VML should relate to the preview image");
    assert!(
        vml_xml.contains(&format!(r#"o:relid="{}""#, preview_rel.id)),
        "VML XML should reference the exported preview relationship id"
    );
    let preview_path = resolve_relationship_target(Some(&vml_path), &preview_rel.target)
        .expect("VML preview target should resolve");
    assert_eq!(archive.read_file(&preview_path).unwrap(), PREVIEW_BYTES);

    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (roundtripped, _diagnostics) =
        parse_xlsx_to_output(&exported).expect("exported XLSX should parse back");
    let roundtripped_ole = roundtripped.sheets[0]
        .floating_objects
        .iter()
        .find_map(|object| match &object.data {
            FloatingObjectData::OleObject(data) => Some(data),
            _ => None,
        })
        .unwrap_or_else(|| {
            panic!("exported OLE object should parse back; worksheet XML was: {worksheet_xml}")
        });
    let roundtripped_ooxml = roundtripped_ole.ooxml.as_ref().expect("roundtripped OOXML");
    assert_eq!(
        roundtripped_ooxml
            .embedding
            .as_ref()
            .map(|embedding| embedding.bytes.as_slice()),
        Some(OLE_BYTES)
    );
    assert_eq!(
        roundtripped_ooxml
            .preview
            .as_ref()
            .map(|preview| preview.bytes.as_slice()),
        Some(PREVIEW_BYTES)
    );
}

fn create_ole_object_xlsx() -> Vec<u8> {
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
            vml_rels_xml().as_bytes(),
        )
        .add_deflate("xl/embeddings/oleObject1.bin", OLE_BYTES)
        .add_deflate("xl/media/olePreview.png", PREVIEW_BYTES);
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
  <Override PartName="/xl/embeddings/oleObject1.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>
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
            "rIdOleObject",
            REL_OLE_OBJECT,
            "../embeddings/oleObject1.bin",
            None,
        ),
        (
            "rIdOleVml",
            REL_VML_DRAWING,
            "../drawings/vmlDrawing1.vml",
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
  <oleObjects>
    <oleObject progId="Word.Document.12" shapeId="2049" r:id="rIdOleObject"/>
  </oleObjects>
  <legacyDrawing r:id="rIdOleVml"/>
</worksheet>"#
        .to_string()
}

fn vml_xml() -> String {
    r##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><v:shape id="_x0000_s2049" type="#_x0000_t75"><v:imagedata o:relid="rIdPreview" o:title="preview"/></v:shape></xml>"##
        .to_string()
}

fn vml_rels_xml() -> String {
    rels_xml(&[("rIdPreview", REL_IMAGE, "../media/olePreview.png", None)])
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

fn package_parts_with_prefix(archive: &XlsxArchive<'_>, prefix: &str) -> Vec<String> {
    let mut parts: Vec<String> = archive
        .entries()
        .iter()
        .filter(|entry| entry.name.starts_with(prefix))
        .map(|entry| entry.name.clone())
        .collect();
    parts.sort();
    parts
}
