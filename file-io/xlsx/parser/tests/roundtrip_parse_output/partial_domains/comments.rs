use std::sync::Arc;

use super::super::fixtures::ZipBuilder;
use super::super::helpers::{cell, make_single_sheet};
use domain_types::domain::floating_object::{
    AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
    FormControlData, FormControlOoxmlProps, FormControlWorksheetControlPr,
};
use domain_types::{Comment, CommentType};
use value_types::CellValue;
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::{
    REL_COMMENTS, REL_CTRL_PROP, REL_IMAGE, REL_VML_DRAWING, resolve_relationship_target,
};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

const NOTE_IMAGE: &[u8] = b"\x89PNG\r\n\x1a\nnote-image";

#[test]
fn note_comment_export_registers_comments_and_vml_package_graph() {
    let mut output = make_single_sheet(
        "Comments",
        vec![cell(0, 0, CellValue::Text(Arc::from("noted")))],
    );
    output.sheets[0].comments = vec![Comment {
        id: "note-1".to_string(),
        cell_ref: "A1".to_string(),
        author: "Modeled Author".to_string(),
        content: Some("Modeled note package comment".to_string()),
        comment_type: CommentType::Note,
        ..Default::default()
    }];

    let bytes = write_xlsx_from_parse_output(&output).expect("note comment export should succeed");
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    );
    let comments_xml = String::from_utf8(archive.read_file("xl/comments1.xml").unwrap()).unwrap();
    let vml_xml = String::from_utf8(archive.read_file("xl/drawings/vmlDrawing1.vml").unwrap())
        .expect("VML note drawing should be UTF-8");
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    let comments_rel = sheet_rels
        .iter()
        .find(|rel| rel.rel_type == REL_COMMENTS)
        .expect("worksheet should relate to comments XML");
    let comments_path =
        resolve_relationship_target(Some("xl/worksheets/sheet1.xml"), &comments_rel.target)
            .expect("comments target should resolve");
    let vml_rel = sheet_rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING)
        .expect("worksheet should relate to comment VML");
    let vml_path = resolve_relationship_target(Some("xl/worksheets/sheet1.xml"), &vml_rel.target)
        .expect("VML target should resolve");

    assert!(worksheet_xml.contains("<legacyDrawing "));
    assert_eq!(comments_path, "xl/comments1.xml");
    assert_eq!(vml_path, "xl/drawings/vmlDrawing1.vml");
    assert!(comments_xml.contains("Modeled note package comment"));
    assert!(vml_xml.contains("_x0000_s"));
    assert!(content_types.contains(r#"PartName="/xl/comments1.xml""#));
    assert!(content_types.contains("application/vnd.openxmlformats-officedocument.vmlDrawing"));

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
    let (roundtripped, _diagnostics) =
        parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert!(
        roundtripped.sheets[0].comments.iter().any(|comment| {
            comment.comment_type == CommentType::Note && comment.cell_ref == "A1"
        })
    );
}

#[test]
fn imported_note_comment_vml_image_roundtrips_media_part_and_relationship() {
    let imported = note_comment_vml_image_fixture(Some(NOTE_IMAGE));
    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("fixture should parse successfully");
    let note = parsed.sheets[0]
        .comments
        .iter()
        .find(|comment| comment.comment_type == CommentType::Note && comment.cell_ref == "A1")
        .expect("imported note should exist");
    assert_eq!(note.note_images.len(), 1);
    assert_eq!(note.note_images[0].bytes, NOTE_IMAGE);

    let exported = write_xlsx_from_parse_output(&parsed).expect("note image export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let vml_path = worksheet_vml_path(&archive);
    let vml_xml = String::from_utf8(archive.read_file(&vml_path).unwrap()).unwrap();
    let vml_rels = parse_all_rels(
        &archive
            .read_file(&part_relationships_path(&vml_path))
            .expect("comment VML relationships should be emitted"),
    );
    let image_rel = vml_rels
        .iter()
        .find(|rel| rel.rel_type == REL_IMAGE)
        .expect("comment VML should relate to note image media");
    let image_path = resolve_relationship_target(Some(&vml_path), &image_rel.target)
        .expect("image target should resolve");

    assert!(vml_xml.contains("<v:imagedata "));
    assert!(vml_xml.contains(&format!(r#"o:relid="{}""#, image_rel.id)));
    assert_eq!(image_path, "xl/media/note.png");
    assert_eq!(archive.read_file(&image_path).unwrap(), NOTE_IMAGE);
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (roundtripped, _diagnostics) =
        parse_xlsx_to_output(&exported).expect("exported XLSX should parse back");
    let roundtripped_note = roundtripped.sheets[0]
        .comments
        .iter()
        .find(|comment| comment.comment_type == CommentType::Note && comment.cell_ref == "A1")
        .expect("roundtripped note should exist");
    assert_eq!(roundtripped_note.note_images.len(), 1);
    assert_eq!(roundtripped_note.note_images[0].bytes, NOTE_IMAGE);
}

#[test]
fn note_image_and_form_control_share_comment_vml_without_losing_relationships() {
    let imported = note_comment_vml_image_fixture(Some(NOTE_IMAGE));
    let (mut output, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("note-image fixture should parse");
    output.sheets[0].floating_objects = vec![FloatingObject {
        common: FloatingObjectCommon {
            id: "form-control-1".to_string(),
            anchor: FloatingObjectAnchor {
                anchor_mode: AnchorMode::OneCell,
                anchor_row: 1,
                anchor_col: 1,
                ..Default::default()
            },
            width: 100.0,
            height: 30.0,
            name: "Modeled check".to_string(),
            ..Default::default()
        },
        data: FloatingObjectData::FormControl(FormControlData {
            control_type: "CheckBox".to_string(),
            cell_link: Some("$A$1".to_string()),
            input_range: None,
            ooxml: Some(FormControlOoxmlProps {
                control_pr: Some(FormControlWorksheetControlPr {
                    linked_cell: Some("$A$1".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
        }),
    }];

    let bytes = write_xlsx_from_parse_output(&output)
        .expect("note image plus form control export should succeed");
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let sheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .expect("worksheet relationships should be emitted"),
    );
    assert_eq!(
        sheet_rels
            .iter()
            .filter(|rel| rel.rel_type == REL_VML_DRAWING)
            .count(),
        1
    );
    assert!(sheet_rels.iter().any(|rel| rel.rel_type == REL_COMMENTS));
    assert!(sheet_rels.iter().any(|rel| rel.rel_type == REL_CTRL_PROP));
    let vml_path = worksheet_vml_path(&archive);
    let vml_xml = String::from_utf8(archive.read_file(&vml_path).unwrap()).unwrap();
    assert!(vml_xml.contains("<v:imagedata "));
    assert!(vml_xml.contains(r#"ObjectType="Checkbox""#));

    let vml_rels = parse_all_rels(
        &archive
            .read_file(&part_relationships_path(&vml_path))
            .expect("shared VML relationships should be emitted"),
    );
    let image_rel = vml_rels
        .iter()
        .find(|rel| rel.rel_type == REL_IMAGE)
        .expect("shared VML should relate to note image media");
    assert!(vml_xml.contains(&format!(r#"o:relid="{}""#, image_rel.id)));
    let image_path = resolve_relationship_target(Some(&vml_path), &image_rel.target)
        .expect("image target should resolve");
    assert_eq!(image_path, "xl/media/note.png");
    assert_eq!(archive.read_file(&image_path).unwrap(), NOTE_IMAGE);

    let (roundtripped, _diagnostics) =
        parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    assert_eq!(roundtripped.sheets[0].comments[0].note_images.len(), 1);
    assert!(
        roundtripped.sheets[0]
            .floating_objects
            .iter()
            .any(|object| matches!(object.data, FloatingObjectData::FormControl(_)))
    );
}

#[test]
fn imported_note_comment_missing_vml_image_payload_does_not_block_export() {
    let imported = note_comment_vml_image_fixture(None);
    let (parsed, _diagnostics) = parse_xlsx_to_output(&imported)
        .expect("fixture should parse despite missing media payload");
    let note = parsed.sheets[0]
        .comments
        .iter()
        .find(|comment| comment.comment_type == CommentType::Note && comment.cell_ref == "A1")
        .expect("imported note should exist");
    assert!(note.note_images.is_empty());

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("missing note image payload should not block");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let vml_path = worksheet_vml_path(&archive);
    let vml_xml = String::from_utf8(archive.read_file(&vml_path).unwrap()).unwrap();

    assert!(!vml_xml.contains("<v:imagedata "));
    if let Ok(rels_xml) = archive.read_file(&part_relationships_path(&vml_path)) {
        let vml_rels = parse_all_rels(&rels_xml);
        assert!(!vml_rels.iter().any(|rel| rel.rel_type == REL_IMAGE));
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_note_comment_external_vml_image_link_roundtrips_without_media_part() {
    let imported = note_comment_external_vml_image_fixture();
    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("external image fixture should parse");
    let note = parsed.sheets[0]
        .comments
        .iter()
        .find(|comment| comment.comment_type == CommentType::Note && comment.cell_ref == "A1")
        .expect("imported note should exist");
    assert_eq!(note.note_images.len(), 1);
    assert_eq!(
        note.note_images[0].original_target,
        "https://example.invalid/note.png"
    );
    assert_eq!(note.note_images[0].target_mode.as_deref(), Some("External"));
    assert!(note.note_images[0].bytes.is_empty());

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("external note image link should export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let vml_path = worksheet_vml_path(&archive);
    let vml_xml = String::from_utf8(archive.read_file(&vml_path).unwrap()).unwrap();
    let vml_rels = parse_all_rels(
        &archive
            .read_file(&part_relationships_path(&vml_path))
            .expect("comment VML relationships should be emitted"),
    );
    let image_rel = vml_rels
        .iter()
        .find(|rel| rel.rel_type == REL_IMAGE)
        .expect("comment VML should relate to external note image");

    assert!(vml_xml.contains(&format!(r#"o:relid="{}""#, image_rel.id)));
    assert_eq!(image_rel.target, "https://example.invalid/note.png");
    assert_eq!(image_rel.target_mode.as_deref(), Some("External"));
    assert!(archive.read_file("xl/media/note.png").is_err());
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn worksheet_vml_path(archive: &XlsxArchive) -> String {
    let sheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    );
    let vml_rel = sheet_rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING)
        .expect("worksheet should relate to comment VML");
    resolve_relationship_target(Some("xl/worksheets/sheet1.xml"), &vml_rel.target)
        .expect("VML target should resolve")
}

fn note_comment_vml_image_fixture(image: Option<&[u8]>) -> Vec<u8> {
    note_comment_fixture_with_vml_rels(&fixture_vml_rels(), image)
}

fn note_comment_external_vml_image_fixture() -> Vec<u8> {
    note_comment_fixture_with_vml_rels(&fixture_external_vml_rels(), None)
}

fn note_comment_fixture_with_vml_rels(vml_rels: &str, image: Option<&[u8]>) -> Vec<u8> {
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", fixture_content_types().as_bytes())
        .add_deflate("_rels/.rels", fixture_root_rels().as_bytes())
        .add_deflate(
            "xl/_rels/workbook.xml.rels",
            fixture_workbook_rels().as_bytes(),
        )
        .add_deflate("xl/workbook.xml", fixture_workbook().as_bytes())
        .add_deflate("xl/worksheets/sheet1.xml", fixture_worksheet().as_bytes())
        .add_deflate(
            "xl/worksheets/_rels/sheet1.xml.rels",
            fixture_worksheet_rels().as_bytes(),
        )
        .add_deflate("xl/comments1.xml", fixture_comments().as_bytes())
        .add_deflate("xl/drawings/vmlDrawing1.vml", fixture_vml().as_bytes())
        .add_deflate(
            "xl/drawings/_rels/vmlDrawing1.vml.rels",
            vml_rels.as_bytes(),
        );
    if let Some(image) = image {
        builder.add_deflate("xl/media/note.png", image);
    }
    builder.build()
}

fn fixture_content_types() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>
</Types>"#
        .to_string()
}

fn fixture_root_rels() -> String {
    rels_xml(&[(
        "rIdWorkbook",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        "xl/workbook.xml",
    )])
}

fn fixture_workbook_rels() -> String {
    rels_xml(&[(
        "rIdSheet1",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        "worksheets/sheet1.xml",
    )])
}

fn fixture_worksheet_rels() -> String {
    rels_xml(&[
        ("rIdComments", REL_COMMENTS, "../comments1.xml"),
        ("rIdVml", REL_VML_DRAWING, "../drawings/vmlDrawing1.vml"),
    ])
}

fn fixture_vml_rels() -> String {
    rels_xml(&[("rIdNoteImage", REL_IMAGE, "../media/note.png")])
}

fn fixture_external_vml_rels() -> String {
    rels_xml_with_target_mode(&[(
        "rIdNoteImage",
        REL_IMAGE,
        "https://example.invalid/note.png",
        Some("External"),
    )])
}

fn fixture_workbook() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rIdSheet1"/></sheets></workbook>"#
        .to_string()
}

fn fixture_worksheet() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1" t="str"><v>noted</v></c></row></sheetData><legacyDrawing r:id="rIdVml"/></worksheet>"#
        .to_string()
}

fn fixture_comments() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Imported Author</author></authors><commentList><comment ref="A1" authorId="0"><text><r><t>Imported note with image</t></r></text></comment></commentList></comments>"#
        .to_string()
}

fn fixture_vml() -> String {
    r##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"/><v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute;margin-left:15pt;margin-top:2pt;width:96pt;height:55.5pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:imagedata o:relid="rIdNoteImage"/><v:shadow color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>1, 15, 0, 2, 3, 31, 4, 14</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape></xml>"##
        .to_string()
}

fn rels_xml(rels: &[(&str, &str, &str)]) -> String {
    rels_xml_with_target_mode(
        &rels
            .iter()
            .map(|(id, rel_type, target)| (*id, *rel_type, *target, None))
            .collect::<Vec<_>>(),
    )
}

fn rels_xml_with_target_mode(rels: &[(&str, &str, &str, Option<&str>)]) -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (id, rel_type, target, target_mode) in rels {
        let target_mode_attr = target_mode
            .map(|target_mode| format!(r#" TargetMode="{target_mode}""#))
            .unwrap_or_default();
        xml.push_str(&format!(
            r#"<Relationship Id="{id}" Type="{rel_type}" Target="{target}"{target_mode_attr}/>"#
        ));
    }
    xml.push_str("</Relationships>");
    xml
}

fn part_relationships_path(part_path: &str) -> String {
    let Some((dir, file_name)) = part_path.rsplit_once('/') else {
        return format!("{part_path}.rels");
    };
    format!("{dir}/_rels/{file_name}.rels")
}
