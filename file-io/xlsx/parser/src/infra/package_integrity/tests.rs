use super::*;
use crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES;
use crate::infra::opc::{REL_SHARED_STRINGS, REL_THREADED_COMMENT, REL_VML_DRAWING, REL_WORKSHEET};
use crate::write::ZipWriter;
use crate::zip::XlsxArchive;

const CT_VML_DRAWING: &str = "application/vnd.openxmlformats-officedocument.vmlDrawing";

fn archive(entries: &[(&str, &[u8])]) -> XlsxArchive<'static> {
    let mut zip = ZipWriter::new();
    for (path, data) in entries {
        zip.add_file(path, data.to_vec());
    }
    let bytes = zip.finish().expect("zip should finish");
    let leaked = Box::leak(bytes.into_boxed_slice());
    XlsxArchive::new(leaked).expect("archive should open")
}

fn valid_content_types(extra: &str) -> Vec<u8> {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
{extra}</Types>"#
    )
    .into_bytes()
}

fn root_rels() -> &'static [u8] {
    br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>"#
}

fn workbook_rels(extra: &str) -> Vec<u8> {
    format!(
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>{extra}</Relationships>"#
    )
    .into_bytes()
}

#[test]
fn valid_internal_relationship_target_passes() {
    let archive = archive(&[
        ("xl/workbook.xml", b"<workbook/>"),
        (
            "xl/_rels/workbook.xml.rels",
            br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        ),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
    ]);

    validate_archive_package_integrity(&archive).expect("package should be valid");
}

#[test]
fn missing_internal_relationship_target_fails() {
    let archive = archive(&[
        ("xl/workbook.xml", b"<workbook/>"),
        (
            "xl/_rels/workbook.xml.rels",
            br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/missing.xml"/></Relationships>"#,
        ),
    ]);

    let errors = validate_archive_package_integrity(&archive).expect_err("target is missing");
    assert!(matches!(
        errors.as_slice(),
        [PackageIntegrityError::MissingRelationshipTarget {
            rel_type,
            resolved_path,
            ..
        }] if rel_type == REL_WORKSHEET && resolved_path == "xl/worksheets/missing.xml"
    ));
    assert!(errors[0].to_string().contains("owner part=xl/workbook.xml"));
}

#[test]
fn fragment_only_relationship_target_passes_without_part_lookup() {
    let archive = archive(&[
        ("xl/drawings/drawing1.xml", b"<xdr:wsDr/>"),
        (
            "xl/drawings/_rels/drawing1.xml.rels",
            br##"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="#Summary!A1"/></Relationships>"##,
        ),
    ]);

    validate_archive_package_integrity(&archive)
        .expect("fragment-only target is not a package part");
}

#[test]
fn relationship_target_with_fragment_validates_base_part() {
    let archive = archive(&[
        ("xl/workbook.xml", b"<workbook/>"),
        (
            "xl/_rels/workbook.xml.rels",
            br##"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml#A1"/></Relationships>"##,
        ),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
    ]);

    validate_archive_package_integrity(&archive).expect("base package part exists");
}

#[test]
fn missing_relationship_target_with_fragment_fails_on_base_part() {
    let archive = archive(&[
        ("xl/workbook.xml", b"<workbook/>"),
        (
            "xl/_rels/workbook.xml.rels",
            br##"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/missing.xml#A1"/></Relationships>"##,
        ),
    ]);

    let errors = validate_archive_package_integrity(&archive).expect_err("target is missing");
    assert!(matches!(
        errors.as_slice(),
        [PackageIntegrityError::MissingRelationshipTarget { resolved_path, .. }]
            if resolved_path == "xl/worksheets/missing.xml"
    ));
}

#[test]
fn missing_relationship_owner_fails() {
    let archive = archive(&[(
        "xl/worksheets/_rels/sheet1.xml.rels",
        br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#,
    )]);

    let errors = validate_archive_package_integrity(&archive).expect_err("owner is missing");
    assert!(matches!(
        errors.as_slice(),
        [PackageIntegrityError::MissingRelationshipOwner { owner_path, .. }]
            if owner_path == "xl/worksheets/sheet1.xml"
    ));
}

#[test]
fn content_type_override_for_missing_part_fails() {
    let content_types = valid_content_types(
        r#"<Override PartName="/xl/missing.xml" ContentType="application/xml"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
    ]);

    let errors = validate_archive_package_integrity(&archive).expect_err("override is stale");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::ContentTypeForMissingPart { part_path, .. }
            if part_path == "xl/missing.xml"
    )));
}

#[test]
fn emitted_shared_strings_without_workbook_relationship_fails() {
    let content_types = valid_content_types(
        r#"<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        ("xl/sharedStrings.xml", b"<sst/>"),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
    ]);

    let errors =
        validate_archive_package_integrity(&archive).expect_err("shared strings rel missing");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingRequiredRelationship { rel_type, target_path, .. }
            if *rel_type == REL_SHARED_STRINGS && target_path == "xl/sharedStrings.xml"
    )));
}

#[test]
fn worksheet_r_id_without_matching_sheet_relationship_fails() {
    let content_types = valid_content_types("");
    let workbook_rels = workbook_rels("");
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        (
            "xl/worksheets/sheet1.xml",
            br#"<worksheet><drawing r:id="rId9"/></worksheet>"#,
        ),
    ]);

    let errors =
        validate_archive_package_integrity(&archive).expect_err("worksheet r:id is dangling");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingWorksheetRelationshipReference { id, .. } if id == "rId9"
    )));
}

#[test]
fn drawing_embed_without_matching_drawing_relationship_fails() {
    let content_types = valid_content_types(
        r#"<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>"#;
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        (
            "xl/worksheets/sheet1.xml",
            br#"<worksheet><drawing r:id="rIdDrawing"/></worksheet>"#,
        ),
        ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
        (
            "xl/drawings/drawing1.xml",
            br#"<xdr:wsDr><xdr:pic><a:blip r:embed="rIdImage"/></xdr:pic></xdr:wsDr>"#,
        ),
    ]);

    let errors =
        validate_archive_package_integrity(&archive).expect_err("drawing r:embed is dangling");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingPartRelationshipReference {
            part_path,
            id,
            attr_name,
            ..
        } if part_path == "xl/drawings/drawing1.xml"
            && id == "rIdImage"
            && attr_name == "r:embed"
    )));
}

#[test]
fn chart_id_without_matching_chart_relationship_fails() {
    let content_types = valid_content_types(
        r#"<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>"#;
    let drawing_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#;
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        (
            "xl/worksheets/sheet1.xml",
            br#"<worksheet><drawing r:id="rIdDrawing"/></worksheet>"#,
        ),
        ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
        (
            "xl/drawings/drawing1.xml",
            br#"<xdr:wsDr><c:chart r:id="rIdChart"/></xdr:wsDr>"#,
        ),
        ("xl/drawings/_rels/drawing1.xml.rels", drawing_rels),
        (
            "xl/charts/chart1.xml",
            br#"<c:chartSpace><c:externalData r:id="rIdExternalData"/></c:chartSpace>"#,
        ),
    ]);

    let errors = validate_archive_package_integrity(&archive).expect_err("chart r:id is dangling");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingPartRelationshipReference {
            part_path,
            id,
            attr_name,
            ..
        } if part_path == "xl/charts/chart1.xml"
            && id == "rIdExternalData"
            && attr_name == "r:id"
    )));
}

#[test]
fn vml_image_relid_without_matching_vml_relationship_fails() {
    let content_types = valid_content_types(
        r#"<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        (
            "xl/worksheets/sheet1.xml",
            br#"<worksheet><legacyDrawing r:id="rIdVml"/></worksheet>"#,
        ),
        ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
        (
            "xl/drawings/vmlDrawing1.vml",
            br#"<xml><v:shape><v:imagedata o:relid="rIdImage"/></v:shape></xml>"#,
        ),
    ]);

    let errors =
        validate_archive_package_integrity(&archive).expect_err("VML image rel is dangling");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingPartRelationshipReference {
            part_path,
            id,
            attr_name,
            ..
        } if part_path == "xl/drawings/vmlDrawing1.vml"
            && id == "rIdImage"
            && attr_name == "o:relid"
    )));
}

#[test]
fn vml_part_without_content_type_fails() {
    let content_types = valid_content_types("");
    let workbook_rels = workbook_rels("");
    let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        (
            "xl/worksheets/sheet1.xml",
            br#"<worksheet><legacyDrawing r:id="rIdVml"/></worksheet>"#,
        ),
        ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
        ("xl/drawings/vmlDrawing1.vml", br#"<xml/>"#),
    ]);

    let errors =
        validate_archive_package_integrity(&archive).expect_err("VML content type missing");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingRequiredContentType {
            part_path,
            content_type
        } if part_path == "xl/drawings/vmlDrawing1.vml" && *content_type == CT_VML_DRAWING
    )));
}

#[test]
fn vml_part_without_sheet_relationship_fails() {
    let content_types = valid_content_types(
        r#"<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        ("xl/worksheets/sheet1.xml", br#"<worksheet/>"#),
        ("xl/drawings/vmlDrawing1.vml", br#"<xml/>"#),
    ]);

    let errors =
        validate_archive_package_integrity(&archive).expect_err("VML relationship missing");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingRequiredRelationship {
            rels_path,
            rel_type,
            target_path
        } if rels_path == "*"
            && *rel_type == REL_VML_DRAWING
            && target_path == "xl/drawings/vmlDrawing1.vml"
    )));
}

#[test]
fn vml_image_relid_with_matching_vml_relationship_passes() {
    let content_types = valid_content_types(
        r#"<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Default Extension="png" ContentType="image/png"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let sheet_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdVml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;
    let vml_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#;
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        (
            "xl/worksheets/sheet1.xml",
            br#"<worksheet><legacyDrawing r:id="rIdVml"/></worksheet>"#,
        ),
        ("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels),
        (
            "xl/drawings/vmlDrawing1.vml",
            br#"<xml><v:shape><v:imagedata o:relid="rIdImage"/></v:shape></xml>"#,
        ),
        ("xl/drawings/_rels/vmlDrawing1.vml.rels", vml_rels),
        ("xl/media/image1.png", b"png"),
    ]);

    validate_archive_package_integrity(&archive)
        .expect("matching VML image relationship should be valid");
}

#[test]
fn emitted_taskpanes_without_root_relationship_fails() {
    let content_types = valid_content_types(
        r#"<Override PartName="/xl/webextensions/taskpanes.xml" ContentType="application/vnd.ms-office.webextensiontaskpanes+xml"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        ("xl/webextensions/taskpanes.xml", b"<wetp:taskpanes/>"),
    ]);

    let errors = validate_archive_package_integrity(&archive).expect_err("taskpanes rel missing");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingRequiredRelationship { rel_type, target_path, .. }
            if *rel_type == REL_WEB_EXTENSION_TASKPANES
                && target_path == "xl/webextensions/taskpanes.xml"
    )));
}

#[test]
fn emitted_threaded_comment_without_sheet_relationship_fails() {
    let content_types = valid_content_types(
        r#"<Override PartName="/xl/threadedComments/threadedComment1.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/>"#,
    );
    let workbook_rels = workbook_rels("");
    let archive = archive(&[
        ("[Content_Types].xml", &content_types),
        ("_rels/.rels", root_rels()),
        ("xl/workbook.xml", b"<workbook/>"),
        ("xl/_rels/workbook.xml.rels", &workbook_rels),
        ("xl/styles.xml", b"<styleSheet/>"),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        (
            "xl/threadedComments/threadedComment1.xml",
            b"<ThreadedComments/>",
        ),
    ]);

    let errors =
        validate_archive_package_integrity(&archive).expect_err("threaded comment rel missing");
    assert!(errors.iter().any(|error| matches!(
        error,
        PackageIntegrityError::MissingRequiredRelationship { rel_type, target_path, .. }
            if *rel_type == REL_THREADED_COMMENT
                && target_path == "xl/threadedComments/threadedComment1.xml"
    )));
}
