use std::fs;
use std::path::Path;

use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::REL_IMAGE;
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

fn drawing_image_parts(archive: &XlsxArchive<'_>) -> Vec<String> {
    let mut image_parts = Vec::new();

    for entry in archive
        .entries()
        .iter()
        .filter(|entry| is_drawing_relationship_part(&entry.name))
    {
        let rels_xml = archive
            .read_file(&entry.name)
            .expect("drawing relationship part should be readable");
        for rel in parse_all_rels(&rels_xml) {
            if rel.rel_type == REL_IMAGE && rel.target_mode.as_deref() != Some("External") {
                image_parts.push(resolve_relationship_target(&entry.name, &rel.target));
            }
        }
    }

    image_parts.sort();
    image_parts
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
