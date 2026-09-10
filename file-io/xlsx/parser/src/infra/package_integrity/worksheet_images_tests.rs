use super::{PackageIntegrityError, validate_archive_package_integrity};
use crate::infra::opc::{REL_CTRL_PROP, REL_IMAGE, REL_OLE_OBJECT};
use crate::{XlsxArchive, write::ZipWriter};

fn fixture(body: &str, image_id: &str) -> Vec<u8> {
    fixture_with_images(body, &[image_id])
}

fn fixture_with_images(body: &str, image_ids: &[&str]) -> Vec<u8> {
    let worksheet = format!(
        r#"<s:worksheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:preview="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{body}</s:worksheet>"#
    );
    let image_relationships: String = image_ids
        .iter()
        .map(|id| {
            format!(r#"<Relationship Id="{id}" Type="{REL_IMAGE}" Target="../media/preview.png"/>"#)
        })
        .collect();
    let relationships = format!(
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{image_relationships}<Relationship Id="rOle" Type="{REL_OLE_OBJECT}" Target="../embeddings/object.bin"/><Relationship Id="rControl" Type="{REL_CTRL_PROP}" Target="../ctrlProps/control.xml"/></Relationships>"#
    );
    let mut zip = ZipWriter::new();
    for (path, data) in [
        ("xl/worksheets/sheet1.xml", worksheet.as_bytes()),
        (
            "xl/worksheets/_rels/sheet1.xml.rels",
            relationships.as_bytes(),
        ),
        ("xl/media/preview.png", b"image".as_slice()),
        ("xl/embeddings/object.bin", b"object".as_slice()),
        ("xl/ctrlProps/control.xml", b"<control/>".as_slice()),
    ] {
        zip.add_file(path, data.to_vec());
    }
    zip.finish().unwrap()
}

#[test]
fn worksheet_images_accept_owned_ole_and_control_previews_with_namespace_aliases() {
    for body in [
        r#"<s:oleObjects><s:oleObject shapeId="2049" r:id="rOle"><s:objectPr preview:id="rPreview"/></s:oleObject></s:oleObjects>"#,
        r#"<s:controls><s:control shapeId="2049" r:id="rControl"><s:controlPr preview:id="rPreview"/></s:control></s:controls>"#,
        r#"<s:oleObjects xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:AlternateContent><mc:Choice Requires="s"><s:oleObject shapeId="2049" r:id="rOle"><s:objectPr preview:id="rPreview"/></s:oleObject></mc:Choice><mc:Fallback><s:oleObject shapeId="2049" r:id="rOle"/></mc:Fallback></mc:AlternateContent></s:oleObjects>"#,
    ] {
        let bytes = fixture(body, "rPreview");
        validate_archive_package_integrity(&XlsxArchive::new(&bytes).unwrap()).unwrap();
    }
}

#[test]
fn worksheet_images_reject_orphan_wrong_owner_and_wrong_namespace_references() {
    for body in [
        "<s:sheetData/>",
        r#"<s:objectPr preview:id="rPreview"/>"#,
        r#"<s:drawing preview:id="rPreview"/>"#,
        r#"<s:oleObjects><s:oleObject shapeId="2049" r:id="rOle"><s:objectPr preview:id="differentImage"/></s:oleObject></s:oleObjects>"#,
        r#"<s:oleObjects><s:oleObject shapeId="2049" r:id="rControl"><s:objectPr preview:id="rPreview"/></s:oleObject></s:oleObjects>"#,
        r#"<s:oleObjects><s:oleObject r:id="rOle"><s:objectPr preview:id="rPreview"/></s:oleObject></s:oleObjects>"#,
        r#"<s:oleObjects><s:oleObject shapeId="2049" r:id="rOle"><s:objectPr xmlns:preview="urn:wrong" preview:id="rPreview"/></s:oleObject></s:oleObjects>"#,
        r#"<s:oleObjects><s:oleObject shapeId="2049" r:id="rOle"><objectPr xmlns="urn:wrong" preview:id="rPreview"/></s:oleObject></s:oleObjects>"#,
        r#"<s:oleObjects><s:oleObject shapeId="2049" r:id="rOle"><s:controlPr preview:id="rPreview"/></s:oleObject></s:oleObjects>"#,
    ] {
        let bytes = fixture(body, "rPreview");
        let errors =
            validate_archive_package_integrity(&XlsxArchive::new(&bytes).unwrap()).unwrap_err();
        assert!(errors.iter().any(|error| matches!(error, PackageIntegrityError::InvalidRelationshipTarget { id, rel_type, reason, .. } if id == "rPreview" && rel_type == REL_IMAGE && reason.contains("no live background picture or OLE/control preview reference"))), "{body}: {errors:?}");
    }
}

#[test]
fn worksheet_images_accept_direct_background_pictures_with_namespace_aliases() {
    for body in [
        r#"<s:picture r:id="rPreview"/>"#,
        r#"<s:picture preview:id="rPreview"></s:picture>"#,
        r#"<picture xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r:id="rPreview"/>"#,
    ] {
        let bytes = fixture(body, "rPreview");
        validate_archive_package_integrity(&XlsxArchive::new(&bytes).unwrap()).unwrap();
    }
}

#[test]
fn worksheet_background_pictures_require_direct_owner_namespace_and_image_identity() {
    for body in [
        r#"<s:sheetData><s:picture r:id="rPreview"/></s:sheetData>"#,
        r#"<s:oleObjects><s:oleObject shapeId="2049" r:id="rOle"><s:picture r:id="rPreview"/></s:oleObject></s:oleObjects>"#,
        r#"<picture xmlns="urn:wrong" r:id="rPreview"/>"#,
        r#"<s:picture xmlns:preview="urn:wrong" preview:id="rPreview"/>"#,
        r#"<s:picture id="rPreview"/>"#,
        r#"<s:picture/>"#,
        r#"<s:picture r:id="differentImage"/>"#,
        r#"<s:picture r:id="rOle"/>"#,
        r#"<s:picture r:id="rControl"/>"#,
    ] {
        let bytes = fixture(body, "rPreview");
        let errors =
            validate_archive_package_integrity(&XlsxArchive::new(&bytes).unwrap()).unwrap_err();
        assert!(
            errors.iter().any(|error| matches!(error,
            PackageIntegrityError::InvalidRelationshipTarget { id, rel_type, .. }
            if id == "rPreview" && rel_type == REL_IMAGE)),
            "{body}: {errors:?}"
        );
    }
}

#[test]
fn a_live_background_picture_does_not_authorize_an_unreferenced_image_relationship() {
    let bytes = fixture_with_images(r#"<s:picture r:id="rPreview"/>"#, &["rPreview", "rOrphan"]);
    let errors =
        validate_archive_package_integrity(&XlsxArchive::new(&bytes).unwrap()).unwrap_err();
    let invalid_images: Vec<_> = errors
        .iter()
        .filter_map(|error| match error {
            PackageIntegrityError::InvalidRelationshipTarget { id, rel_type, .. }
                if rel_type == REL_IMAGE =>
            {
                Some(id.as_str())
            }
            _ => None,
        })
        .collect();
    assert_eq!(invalid_images, vec!["rOrphan"], "{errors:?}");
}
