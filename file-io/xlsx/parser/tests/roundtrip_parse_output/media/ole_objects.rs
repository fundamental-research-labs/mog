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
const PREVIEW_STYLE: &str =
    "position:absolute;margin-left:782677.5pt;margin-top:0;width:67.5pt;height:51pt;z-index:1";
const PREVIEW_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nole preview payload";

#[test]
fn imported_ole_embedding_and_preview_roundtrips_owned_package_parts() {
    let imported = create_ole_object_xlsx();
    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("fixture should parse to ParseOutput");
    assert!(
        !parsed.sheets[0]
            .floating_objects
            .iter()
            .any(|object| matches!(object.data, FloatingObjectData::FormControl(_))),
        "OLE preview VML must not become a second form control"
    );

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
    assert!(!worksheet_xml.contains("<controls"));
    assert!(worksheet_xml.contains(r#"Requires="x14""#));
    let fallback = worksheet_xml
        .split("<mc:Fallback>")
        .nth(1)
        .unwrap()
        .split("</mc:Fallback>")
        .next()
        .unwrap();
    assert!(fallback.contains("<oleObject ") && fallback.contains(r#"shapeId="2049""#));
    assert!(!fallback.contains("objectPr"));

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
    assert!(vml_xml.contains(&format!(r#"style="{PREVIEW_STYLE}""#)));
    assert!(vml_xml.contains(r#"fillcolor="window [65]""#));
    assert!(vml_xml.contains(r#"strokecolor="windowText [64]""#));
    assert!(vml_xml.contains(r#"cropbottom="13107f""#));
    assert!(vml_xml.contains(r#"o:title="preview""#));
    assert!(vml_xml.contains(r#"opacity=".3""#));
    assert!(vml_xml.contains(r#"data="8""#));
    assert!(vml_xml.contains(r#"o:preferrelative="t""#));
    assert!(vml_xml.contains("<x:SizeWithCells"));
    assert!(vml_xml.contains("<x:CF>Pict</x:CF>"));
    assert!(vml_xml.contains("1, -2, 2, 0, 3, 15, 6, 0"));

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

#[test]
fn imported_ole_preview_respects_live_geometry_media_and_owner_deletion() {
    let (mut parsed, _) = parse_xlsx_to_output(&create_ole_object_xlsx()).unwrap();
    let object = parsed.sheets[0]
        .floating_objects
        .iter_mut()
        .find(|object| matches!(object.data, FloatingObjectData::OleObject(_)))
        .unwrap();
    assert_eq!(object.common.width, 90.0);
    assert_eq!(object.common.height, 68.0);
    assert_eq!(object.common.anchor.anchor_col_offset, -19_050);
    object.common.anchor.anchor_col = 8;
    object.common.anchor.anchor_row = 9;
    object.common.anchor.anchor_col_offset = 28_575;
    object.common.anchor.anchor_row_offset = 38_100;
    object.common.anchor.end_col = Some(10);
    object.common.anchor.end_row = Some(12);
    object.common.anchor.end_col_offset = Some(47_625);
    object.common.anchor.end_row_offset = Some(57_150);
    object.common.width = 160.0;
    object.common.height = 100.0;
    object.common.visible = false;
    let FloatingObjectData::OleObject(data) = &mut object.data else {
        unreachable!()
    };
    let props = data.ooxml.as_mut().unwrap();
    props.shape_id = 4097;
    let preview = props.preview.as_mut().unwrap();
    preview.bytes = b"replacement preview".to_vec();
    preview.path = "xl/media/replacedPreview.png".into();
    preview.relationship_id = Some("rIdNewPreview".into());
    let exported = write_xlsx_from_parse_output(&parsed).unwrap();
    let archive = XlsxArchive::new(&exported).unwrap();
    validate_archive_package_integrity(&archive).unwrap();
    let vml_path = archive
        .entries()
        .iter()
        .find(|entry| entry.name.ends_with(".vml"))
        .unwrap()
        .name
        .clone();
    let xml = String::from_utf8(archive.read_file(&vml_path).unwrap()).unwrap();
    assert!(xml.contains("8, 3, 9, 4, 10, 5, 12, 6"));
    assert!(xml.contains("width:120pt") && xml.contains("height:75pt"));
    assert!(xml.contains("visibility:hidden"));
    assert!(!xml.contains("margin-left:") && !xml.contains("margin-top:"));
    assert!(xml.contains(r#"id="_x0000_s4097""#));
    assert!(!xml.contains("_x0000_s2049"));
    assert!(
        xml.contains(r#"cropbottom="13107f""#),
        "preview formatting must survive relationship replacement"
    );
    assert!(!xml.contains("rIdPreview"));
    let (roundtripped, _) = parse_xlsx_to_output(&exported).unwrap();
    let object = roundtripped.sheets[0]
        .floating_objects
        .iter()
        .find(|object| matches!(object.data, FloatingObjectData::OleObject(_)))
        .unwrap();
    assert_eq!(object.common.anchor.anchor_col, 8);
    assert_eq!(object.common.anchor.anchor_row, 9);
    assert_eq!(object.common.anchor.end_col_offset, Some(47_625));
    assert_eq!(object.common.width, 160.0);
    assert_eq!(object.common.height, 100.0);
    assert!(!object.common.visible);
    let FloatingObjectData::OleObject(data) = &object.data else {
        unreachable!()
    };
    assert_eq!(
        data.ooxml.as_ref().unwrap().preview.as_ref().unwrap().bytes,
        b"replacement preview"
    );

    // Removing the preview also removes its relationship-bearing VML child.
    let FloatingObjectData::OleObject(data) = &mut parsed.sheets[0].floating_objects[0].data else {
        unreachable!()
    };
    data.ooxml.as_mut().unwrap().preview = None;
    let without_preview = write_xlsx_from_parse_output(&parsed).unwrap();
    let archive = XlsxArchive::new(&without_preview).unwrap();
    validate_archive_package_integrity(&archive).unwrap();
    assert!(package_parts_with_prefix(&archive, "xl/media/").is_empty());
    let xml = String::from_utf8(archive.read_file(&vml_path).unwrap()).unwrap();
    assert!(!xml.contains("imagedata"));

    parsed.sheets[0].floating_objects.clear();
    let deleted = write_xlsx_from_parse_output(&parsed).unwrap();
    let archive = XlsxArchive::new(&deleted).unwrap();
    validate_archive_package_integrity(&archive).unwrap();
    assert!(package_parts_with_prefix(&archive, "xl/embeddings/").is_empty());
    assert!(package_parts_with_prefix(&archive, "xl/media/").is_empty());
    assert!(
        !archive
            .entries()
            .iter()
            .any(|entry| entry.name.ends_with(".vml"))
    );
    let worksheet =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(!worksheet.contains("oleObjects") && !worksheet.contains("controls"));
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
            "rIdWorksheetPreview",
            REL_IMAGE,
            "../media/olePreview.png",
            None,
        ),
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
    <oleObject progId="Word.Document.12" shapeId="2049" r:id="rIdOleObject"><objectPr defaultSize="0" r:id="rIdWorksheetPreview"><anchor moveWithCells="1" sizeWithCells="1"><from xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:col>1</xdr:col><xdr:colOff>-19050</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></from><to xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:col>3</xdr:col><xdr:colOff>142875</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></to></anchor></objectPr></oleObject>
  </oleObjects>
  <legacyDrawing r:id="rIdOleVml"/>
</worksheet>"#
        .to_string()
}

fn vml_xml() -> String {
    format!(
        r##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="8"/></o:shapelayout><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe"><v:stroke joinstyle="miter"/></v:shapetype><v:shape id="_x0000_s2049" type="#_x0000_t75" style="{PREVIEW_STYLE}" filled="t" fillcolor="window [65]" stroked="t" strokecolor="windowText [64]" o:insetmode="auto"><v:imagedata o:relid="rIdPreview" o:title="preview" cropbottom="13107f"/><v:shadow on="t" opacity=".3"/><x:ClientData ObjectType="Pict"><x:Anchor>1, -2, 2, 0, 3, 15, 6, 0</x:Anchor><x:SizeWithCells/><x:CF>Pict</x:CF></x:ClientData></v:shape></xml>"##
    )
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
