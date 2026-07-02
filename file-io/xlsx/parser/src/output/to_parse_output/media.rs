use super::*;
use base64::Engine as _;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OwnedBinaryPart {
    pub package_path: String,
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
}

pub(super) type BinaryPartMap = HashMap<String, OwnedBinaryPart>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ResolvedOwnedBinaryPart {
    pub relationship_id: String,
    pub original_target: String,
    pub package_path: String,
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
}

pub(super) fn build_binary_part_map(result: &FullParseResult) -> BinaryPartMap {
    let mut parts = HashMap::new();

    for part in &result.imported_media_parts {
        insert_binary_part(&mut parts, part);
    }
    for part in &result.imported_ole_parts {
        insert_binary_part(&mut parts, part);
    }

    parts
}

fn insert_binary_part(
    parts: &mut BinaryPartMap,
    part: &crate::output::results::ImportedBinaryPart,
) {
    let package_path = domain_types::normalize_package_path(&part.path);
    parts.insert(
        package_path.clone(),
        OwnedBinaryPart {
            package_path,
            content_type: part.content_type.clone(),
            bytes: part.bytes.clone(),
        },
    );
}

pub(super) fn resolve_relationship_payload(
    binary_parts: &BinaryPartMap,
    owner_part_path: Option<&str>,
    relationship: &ooxml_types::shared::OpcRelationship,
) -> Option<ResolvedOwnedBinaryPart> {
    if is_external_target_mode(relationship.target_mode.as_deref()) {
        return None;
    }

    let package_path =
        crate::infra::opc::resolve_relationship_target(owner_part_path, &relationship.target)
            .ok()
            .map(|path| domain_types::normalize_package_path(&path))?;
    let payload = binary_parts.get(&package_path)?;

    Some(ResolvedOwnedBinaryPart {
        relationship_id: relationship.id.clone(),
        original_target: relationship.target.clone(),
        package_path: payload.package_path.clone(),
        content_type: payload.content_type.clone(),
        bytes: payload.bytes.clone(),
    })
}

pub(super) fn resolve_package_payload(
    binary_parts: &BinaryPartMap,
    package_path: &str,
) -> Option<OwnedBinaryPart> {
    let package_path = domain_types::normalize_package_path(package_path);
    binary_parts.get(&package_path).cloned()
}

pub(super) fn data_url_for_payload(content_type: Option<&str>, bytes: &[u8]) -> String {
    let mime = content_type
        .filter(|content_type| content_type.starts_with("image/"))
        .or_else(|| image_mime_type_for_bytes(bytes))
        .unwrap_or("application/octet-stream");
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{encoded}")
}

fn is_external_target_mode(mode: Option<&str>) -> bool {
    mode.is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
}

pub(super) fn image_mime_type_for_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        Some("image/tiff")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_mime_type_for_bytes_recognizes_jpeg_jfif_payload() {
        assert_eq!(
            image_mime_type_for_bytes(b"\xff\xd8\xff\xe0"),
            Some("image/jpeg")
        );
    }

    #[test]
    fn data_url_for_payload_detects_png_and_jpeg_without_content_type() {
        assert!(
            data_url_for_payload(None, b"\x89PNG\r\n\x1a\npayload")
                .starts_with("data:image/png;base64,")
        );
        assert!(
            data_url_for_payload(None, b"\xff\xd8\xff\xe0payload")
                .starts_with("data:image/jpeg;base64,")
        );
    }

    #[test]
    fn relationship_payload_resolves_absolute_and_relative_targets_against_owner() {
        let binary_parts = HashMap::from([(
            "xl/media/image1.png".to_string(),
            OwnedBinaryPart {
                package_path: "xl/media/image1.png".to_string(),
                content_type: Some("image/png".to_string()),
                bytes: vec![1, 2, 3],
            },
        )]);

        for target in ["/xl/media/image1.png", "../media/image1.png"] {
            let rel = ooxml_types::shared::OpcRelationship {
                id: "rId1".to_string(),
                rel_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                        .to_string(),
                target: target.to_string(),
                target_mode: None,
            };
            let payload =
                resolve_relationship_payload(&binary_parts, Some("xl/drawings/drawing1.xml"), &rel)
                    .expect("payload");

            assert_eq!(payload.original_target, target);
            assert_eq!(payload.package_path, "xl/media/image1.png");
            assert_eq!(payload.bytes, vec![1, 2, 3]);
        }
    }

    #[test]
    fn relationship_payload_does_not_resolve_external_targets() {
        let binary_parts = HashMap::from([(
            "xl/media/image1.png".to_string(),
            OwnedBinaryPart {
                package_path: "xl/media/image1.png".to_string(),
                content_type: Some("image/png".to_string()),
                bytes: vec![1, 2, 3],
            },
        )]);
        let rel = ooxml_types::shared::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                .to_string(),
            target: "/xl/media/image1.png".to_string(),
            target_mode: Some("External".to_string()),
        };

        assert!(
            resolve_relationship_payload(&binary_parts, Some("xl/drawings/drawing1.xml"), &rel)
                .is_none()
        );
    }
}
