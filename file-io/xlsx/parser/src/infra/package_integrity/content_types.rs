use crate::domain::content_types::read::ContentTypes;
use crate::zip::XlsxArchive;

use super::error::PackageIntegrityError;

pub(super) fn validate_content_types(
    archive: &XlsxArchive<'_>,
    errors: &mut Vec<PackageIntegrityError>,
) {
    let Ok(xml) = archive.read_file("[Content_Types].xml") else {
        return;
    };
    let Ok(content_types) = ContentTypes::parse(&xml) else {
        return;
    };

    for (part_path, content_type) in content_types.overrides() {
        if !archive.contains(part_path) {
            errors.push(PackageIntegrityError::ContentTypeForMissingPart {
                part_path: part_path.to_string(),
                content_type: content_type.to_string(),
            });
        }
    }
}

pub(super) fn require_content_type(
    archive: &XlsxArchive<'_>,
    part_path: &str,
    content_type: &'static str,
    errors: &mut Vec<PackageIntegrityError>,
) {
    let Ok(xml) = archive.read_file("[Content_Types].xml") else {
        return;
    };
    let Ok(content_types) = ContentTypes::parse(&xml) else {
        return;
    };
    if content_types.get_type(part_path) != Some(content_type) {
        errors.push(PackageIntegrityError::MissingRequiredContentType {
            part_path: part_path.to_string(),
            content_type,
        });
    }
}
