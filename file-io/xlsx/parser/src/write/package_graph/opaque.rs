use super::{CT_JPEG, CT_PNG, PackagePart, PackagePartKind, normalize_part_path};

pub(super) fn imported_opaque_part(
    path: &str,
    content_type: Option<String>,
    bytes: Vec<u8>,
) -> PackagePart {
    let normalized = normalize_part_path(path);
    let default_extension = content_type.is_none().then(|| {
        normalized
            .rsplit_once('.')
            .map(|(_, extension)| extension.to_ascii_lowercase())
            .unwrap_or_else(|| "bin".to_string())
    });
    let default_extension = default_extension.map(|extension| {
        let content_type = match extension.as_str() {
            "bin" if normalized.starts_with("xl/printerSettings/") => {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"
                    .to_string()
            }
            "xml" => "application/xml".to_string(),
            "rels" => "application/vnd.openxmlformats-package.relationships+xml".to_string(),
            "png" => CT_PNG.to_string(),
            "jpg" | "jpeg" => CT_JPEG.to_string(),
            other => format!("application/octet-stream; extension={other}"),
        };
        (extension, content_type)
    });
    PackagePart {
        path: normalized,
        content_type,
        default_extension,
        kind: PackagePartKind::Opaque,
        semantic_kind: Some(domain_types::XlsxPackagePartKind::OpaqueInert),
        bytes: Some(bytes),
    }
}

pub(super) fn same_inert_cluster(owner_path: &str, target_path: &str) -> bool {
    let owner_path = normalize_part_path(owner_path);
    let target_path = normalize_part_path(target_path);
    if owner_path.starts_with("customXml/") {
        target_path.starts_with("customXml/")
    } else if owner_path.starts_with("xl/revisions/") {
        target_path.starts_with("xl/revisions/")
    } else if owner_path.starts_with("xl/printerSettings/") {
        target_path.starts_with("xl/printerSettings/")
    } else if owner_path.starts_with("xl/webextensions/") {
        target_path.starts_with("xl/webextensions/")
    } else if owner_path.starts_with("docProps/thumbnail.") {
        target_path.starts_with("docProps/thumbnail.")
    } else if owner_path == "docMetadata/LabelInfo.xml" {
        target_path == "docMetadata/LabelInfo.xml"
    } else if owner_path.starts_with("xl/customProperty") && owner_path.ends_with(".bin") {
        target_path.starts_with("xl/customProperty") && target_path.ends_with(".bin")
    } else {
        false
    }
}
