use crate::domain::controls::types::OleObject as ParserOleObject;
use crate::domain::controls::write_ole::{
    OleWriter, ole_object_relationship_target, ole_object_zip_path,
};
use ooxml_types::ole::{CellAnchorPoint, DvAspect, ObjectAnchor, ObjectProperties, OleUpdate};

fn make_basic_ole() -> ParserOleObject {
    let mut obj = ParserOleObject::new("Word.Document.12".to_string(), 1025);
    obj.r_id = Some("rId1".to_string());
    obj
}

fn make_full_ole() -> ParserOleObject {
    let mut obj = ParserOleObject::new("Excel.Sheet.12".to_string(), 1026);
    obj.r_id = Some("rId2".to_string());
    obj.dv_aspect = DvAspect::Icon;
    obj.ole_update = OleUpdate::OnCall;
    obj.auto_load = true;
    obj.object_pr = Some(ObjectProperties {
        default_size: false,
        auto_pict: false,
        anchor: Some(ObjectAnchor {
            move_with_cells: true,
            size_with_cells: false,
            from: CellAnchorPoint {
                col: 1,
                col_offset: 0,
                row: 2,
                row_offset: 0,
            },
            to: CellAnchorPoint {
                col: 5,
                col_offset: 0,
                row: 10,
                row_offset: 0,
            },
        }),
        ..ObjectProperties::default()
    });
    obj
}

#[test]
fn test_write_basic_ole_object() {
    let writer = OleWriter::new(vec![make_basic_ole()]);
    let r_ids = vec!["rId5".to_string()];
    let xml = writer.write_ole_objects(&r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<oleObjects>"));
    assert!(xml_str.contains("</oleObjects>"));
    assert!(xml_str.contains("mc:AlternateContent"));
    assert!(xml_str.contains("mc:Choice"));
    assert!(xml_str.contains("mc:Fallback"));
    assert!(xml_str.contains("progId=\"Word.Document.12\""));
    assert!(xml_str.contains("shapeId=\"1025\""));
    assert!(xml_str.contains("r:id=\"rId5\""));
    assert!(!xml_str.contains("dvAspect="));
    assert!(!xml_str.contains("oleUpdate="));
    assert!(!xml_str.contains("autoLoad="));
}

#[test]
fn test_write_full_ole_object() {
    let writer = OleWriter::new(vec![make_full_ole()]);
    let r_ids = vec!["rId6".to_string()];
    let xml = writer.write_ole_objects(&r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("progId=\"Excel.Sheet.12\""));
    assert!(xml_str.contains("dvAspect=\"DVASPECT_ICON\""));
    assert!(xml_str.contains("oleUpdate=\"OLEUPDATE_ONCALL\""));
    assert!(xml_str.contains("autoLoad=\"true\""));
    assert!(xml_str.contains("shapeId=\"1026\""));
    assert!(xml_str.contains("r:id=\"rId6\""));
}

#[test]
fn test_write_object_pr() {
    let writer = OleWriter::new(vec![make_full_ole()]);
    let r_ids = vec!["rId6".to_string()];
    let xml = writer.write_ole_objects(&r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<objectPr"));
    assert!(xml_str.contains("defaultSize=\"0\""));
    assert!(xml_str.contains("autoPict=\"0\""));
    assert!(xml_str.contains("<anchor"));
    assert!(xml_str.contains("moveWithCells=\"1\""));
    assert!(xml_str.contains("<xdr:col>1</xdr:col>"));
    assert!(xml_str.contains("<xdr:row>2</xdr:row>"));
    assert!(xml_str.contains("<xdr:col>5</xdr:col>"));
    assert!(xml_str.contains("<xdr:row>10</xdr:row>"));
}

#[test]
fn test_write_multiple_ole_objects() {
    let writer = OleWriter::new(vec![make_basic_ole(), make_full_ole()]);
    let r_ids = vec!["rId5".to_string(), "rId6".to_string()];
    let xml = writer.write_ole_objects(&r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("Word.Document.12"));
    assert!(xml_str.contains("Excel.Sheet.12"));
    assert!(xml_str.contains("r:id=\"rId5\""));
    assert!(xml_str.contains("r:id=\"rId6\""));
}

#[test]
fn test_write_empty_ole_objects() {
    let writer = OleWriter::new(vec![]);
    let r_ids: Vec<String> = vec![];
    let xml = writer.write_ole_objects(&r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<oleObjects>"));
    assert!(xml_str.contains("</oleObjects>"));
    assert!(!xml_str.contains("mc:AlternateContent"));
}

#[test]
fn test_writer_is_empty() {
    let writer = OleWriter::new(vec![]);
    assert!(writer.is_empty());
    assert_eq!(writer.len(), 0);

    let writer2 = OleWriter::new(vec![make_basic_ole()]);
    assert!(!writer2.is_empty());
    assert_eq!(writer2.len(), 1);
}

#[test]
fn test_ole_object_relationship_target() {
    assert_eq!(
        ole_object_relationship_target(1),
        "../embeddings/oleObject1.bin"
    );
    assert_eq!(
        ole_object_relationship_target(3),
        "../embeddings/oleObject3.bin"
    );
}

#[test]
fn test_ole_object_zip_path() {
    assert_eq!(ole_object_zip_path(1), "xl/embeddings/oleObject1.bin");
    assert_eq!(ole_object_zip_path(5), "xl/embeddings/oleObject5.bin");
}

#[test]
fn test_write_ole_without_object_pr() {
    let writer = OleWriter::new(vec![make_basic_ole()]);
    let r_ids = vec!["rId1".to_string()];
    let xml = writer.write_ole_objects(&r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(!xml_str.contains("<objectPr"));
    assert!(!xml_str.contains("</objectPr>"));
}

#[test]
fn test_write_object_pr_without_anchor() {
    let mut obj = make_basic_ole();
    obj.object_pr = Some(ObjectProperties {
        default_size: false,
        ..ObjectProperties::default()
    });

    let writer = OleWriter::new(vec![obj]);
    let r_ids = vec!["rId1".to_string()];
    let xml = writer.write_ole_objects(&r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("objectPr"));
    assert!(xml_str.contains("defaultSize=\"0\""));
    assert!(!xml_str.contains("<anchor"));
}

#[test]
fn test_write_ole_with_link() {
    let mut obj = make_basic_ole();
    obj.link_path = Some("file:///C:/Documents/test.docx".to_string());

    let writer = OleWriter::new(vec![obj]);
    let r_ids = vec!["rId1".to_string()];
    let xml = writer.write_ole_objects(&r_ids);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("link=\"file:///C:/Documents/test.docx\""));
}

#[test]
fn test_register_content_types() {
    use crate::domain::content_types::write::ContentTypesManager;
    use crate::infra::imported_parts::ImportedPackageParts;

    let mut pt = ImportedPackageParts::new();
    pt.record("xl/embeddings/oleObject1.bin".to_string(), vec![1, 2, 3]);
    pt.record("xl/media/image1.emf".to_string(), vec![4, 5, 6]);

    let mut ct = ContentTypesManager::with_xlsx_defaults();
    OleWriter::register_content_types(&mut ct, &pt);

    let xml = ct.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("/xl/embeddings/oleObject1.bin"));
    assert!(xml_str.contains("/xl/media/image1.emf"));
    assert!(xml_str.contains("Extension=\"bin\""));
    assert!(xml_str.contains("Extension=\"emf\""));
}

#[test]
fn test_add_ole_relationships() {
    use crate::write::relationships::RelationshipManager;

    let mut rels = RelationshipManager::new();
    let objects = vec![make_basic_ole(), make_full_ole()];
    let r_ids = OleWriter::add_ole_relationships(&mut rels, &objects);

    assert_eq!(r_ids.len(), 2);
    assert_eq!(r_ids[0], "rId1");
    assert_eq!(r_ids[1], "rId2");
    assert_eq!(rels.len(), 2);

    let xml = rels.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("oleObject1.bin"));
    assert!(xml_str.contains("oleObject2.bin"));
    assert!(xml_str.contains("oleObject"));
}
