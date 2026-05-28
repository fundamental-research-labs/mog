//! OPC package integrity validation for XLSX archives.
//!
//! This module validates cross-part package invariants that individual feature
//! writers cannot prove locally.

mod content_types;
mod error;
mod modeled_parts;
mod paths;
mod refs;
mod relationships;

#[cfg(test)]
mod tests;

use crate::zip::XlsxArchive;

use self::content_types::validate_content_types;
pub use self::error::PackageIntegrityError;
use self::modeled_parts::validate_modeled_part_invariants;
use self::relationships::collect_relationships;

pub fn validate_archive_package_integrity(
    archive: &XlsxArchive<'_>,
) -> Result<(), Vec<PackageIntegrityError>> {
    let mut errors = Vec::new();
    let relationships_by_part = collect_relationships(archive, &mut errors);

    validate_content_types(archive, &mut errors);
    if archive.contains("[Content_Types].xml") && archive.contains("_rels/.rels") {
        validate_modeled_part_invariants(archive, &relationships_by_part, &mut errors);
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}
