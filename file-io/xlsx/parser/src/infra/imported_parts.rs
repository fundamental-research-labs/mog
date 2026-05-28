//! Imported opaque ZIP entry collection.
//!
//! This module provides a mechanism for collecting binary entries from the source
//! ZIP archive so import conversion can attach bytes to explicit modeled owners.
//!
//! # Use Cases
//!
//! - **OLE binary blobs**: `xl/embeddings/oleObject*.bin` files
//! - **Preview images**: `xl/media/image*.png` (associated with OLE objects)
//! - **Printer settings**: `xl/printerSettings/*.bin`
//! - **Embedded fonts**: `xl/fonts/*.fntdata` (future)
//!
//! # Architecture
//!
//! During import, binary entries are eagerly extracted from the source ZIP into
//! memory. Export paths should consume these bytes through current modeled owners.
//!
//! This is deliberately separate from the XML preservation system because:
//! 1. Binary data cannot be manipulated as XML fragments
//! 2. Binary blobs must be written as complete ZIP entries, not embedded in XML
//! 3. Content type registration is different (binary MIME types vs. XML)
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::imported_parts::ImportedPackageParts;
//!
//! let mut passthrough = ImportedPackageParts::new();
//!
//! // During import: record binary entries from source ZIP
//! passthrough.record("xl/embeddings/oleObject1.bin".to_string(), ole_bytes);
//! passthrough.record("xl/media/image1.emf".to_string(), preview_bytes);
//!
//! // During export: write all recorded entries to the output ZIP
//! for (path, data) in passthrough.entries() {
//!     zip_writer.add_file(path, data.to_vec());
//! }
//! ```

use crate::write::zip_writer::ZipWriter;

// =============================================================================
// ImportedPackageParts
// =============================================================================

/// Stores binary entries from the source ZIP for import conversion.
///
/// Used for OLE binary blobs, preview images, and other non-XML parts
/// that must be attached to current modeled owners during XLSX import.
#[derive(Debug, Clone, Default)]
pub struct ImportedPackageParts {
    /// ZIP path -> raw bytes pairs, stored in insertion order.
    entries: Vec<(String, Vec<u8>)>,
}

impl ImportedPackageParts {
    /// Create a new empty binary passthrough store.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Record a binary entry from the source ZIP.
    ///
    /// # Arguments
    /// * `zip_path` - The path within the ZIP archive (e.g., `"xl/embeddings/oleObject1.bin"`)
    /// * `data` - The raw binary content of the entry
    pub fn record(&mut self, zip_path: String, data: Vec<u8>) {
        // Avoid duplicates — only record if not already present
        if !self.contains(&zip_path) {
            self.entries.push((zip_path, data));
        }
    }

    /// Check if a path is already recorded.
    pub fn contains(&self, path: &str) -> bool {
        self.entries.iter().any(|(p, _)| p == path)
    }

    /// Write all recorded entries to the output ZIP writer.
    ///
    /// Entries are written using the default compression method of the ZipWriter.
    /// Binary blobs (`.bin`) are typically stored uncompressed or with low
    /// compression since they are already opaque binary data.
    pub fn write_all(&self, zip: &mut ZipWriter) {
        for (path, data) in &self.entries {
            zip.add_file(path, data.clone());
        }
    }

    /// Get all recorded paths (for content types registration).
    ///
    /// Returns an iterator over the ZIP paths of all recorded entries.
    pub fn paths(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(p, _)| p.as_str())
    }

    /// Get all recorded entries as (path, data) pairs.
    pub fn entries(&self) -> &[(String, Vec<u8>)] {
        &self.entries
    }

    /// Get the data for a specific path, if recorded.
    pub fn get(&self, path: &str) -> Option<&[u8]> {
        self.entries
            .iter()
            .find(|(p, _)| p == path)
            .map(|(_, d)| d.as_slice())
    }

    /// Check if there are no recorded entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Get the number of recorded entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Get the total byte size of all recorded entries.
    pub fn total_bytes(&self) -> usize {
        self.entries.iter().map(|(_, d)| d.len()).sum()
    }

    /// Merge another ImportedPackageParts into this one.
    ///
    /// Entries from `other` are appended, skipping any paths already present.
    pub fn merge(&mut self, other: ImportedPackageParts) {
        for (path, data) in other.entries {
            self.record(path, data);
        }
    }

    /// Take all entries, leaving the store empty.
    pub fn take(&mut self) -> Vec<(String, Vec<u8>)> {
        std::mem::take(&mut self.entries)
    }

    /// Clear all recorded entries.
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

// =============================================================================
// Archive Extraction Helpers
// =============================================================================

/// Extract OLE-related binary entries from a source ZIP archive.
///
/// Given a list of ZIP paths (e.g., resolved `data_path` and `preview_image_path`
/// from parsed OLE objects), reads each one from the archive and records it
/// in the passthrough store.
///
/// # Usage
///
/// Call this during the import phase after OLE objects are parsed and their
/// `data_path` / `preview_image_path` fields are resolved:
///
/// ```ignore
/// use xlsx_parser::imported_parts::ImportedPackageParts;
///
/// let mut passthrough = ImportedPackageParts::new();
/// for ole in &ole_objects {
///     if let Some(ref path) = ole.data_path {
///         passthrough.record_from_archive(&archive, path);
///     }
///     if let Some(ref path) = ole.preview_image_path {
///         passthrough.record_from_archive(&archive, path);
///     }
/// }
/// ```
impl ImportedPackageParts {
    /// Record a binary entry by reading it from an `XlsxArchive`.
    ///
    /// If the path does not exist in the archive, this is a no-op.
    ///
    /// # Arguments
    /// * `archive` - The source XLSX archive
    /// * `zip_path` - The path within the archive to extract
    pub fn record_from_archive(&mut self, archive: &crate::zip::XlsxArchive, zip_path: &str) {
        if self.contains(zip_path) {
            return;
        }
        if let Ok(data) = archive.read_file(zip_path) {
            self.record(zip_path.to_string(), data);
        }
    }

    /// Extract all OLE-related binary entries for a sheet.
    ///
    /// Scans the archive for `xl/embeddings/` entries associated with the given
    /// sheet's OLE objects and records them. Also records any preview images
    /// referenced by the OLE objects.
    ///
    /// # Arguments
    /// * `archive` - The source XLSX archive
    /// * `ole_data_paths` - Resolved data paths from OLE objects (e.g., `"xl/embeddings/oleObject1.bin"`)
    /// * `ole_preview_paths` - Resolved preview image paths (e.g., `"xl/media/image1.emf"`)
    pub fn record_ole_entries(
        &mut self,
        archive: &crate::zip::XlsxArchive,
        ole_data_paths: &[&str],
        ole_preview_paths: &[&str],
    ) {
        for path in ole_data_paths {
            self.record_from_archive(archive, path);
        }
        for path in ole_preview_paths {
            self.record_from_archive(archive, path);
        }
    }
}

// =============================================================================
// Content Type Helpers
// =============================================================================

/// Content type for OLE binary objects.
pub const CT_OLE_OBJECT: &str = "application/vnd.openxmlformats-officedocument.oleObject";

/// Content type for printer settings binary parts.
pub const CT_PRINTER_SETTINGS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings";

/// Infer the content type for a binary passthrough entry based on its path.
///
/// Returns a content type string suitable for `[Content_Types].xml`.
///
/// # Arguments
/// * `path` - The ZIP path of the entry (e.g., `"xl/embeddings/oleObject1.bin"`)
pub fn infer_content_type(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.starts_with("xl/printersettings/") && lower.ends_with(".bin") {
        CT_PRINTER_SETTINGS
    } else if lower.ends_with(".bin") {
        CT_OLE_OBJECT
    } else if lower.ends_with(".emf") {
        "image/x-emf"
    } else if lower.ends_with(".wmf") {
        "image/x-wmf"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpeg") || lower.ends_with(".jpg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "application/octet-stream"
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_is_empty() {
        let pt = ImportedPackageParts::new();
        assert!(pt.is_empty());
        assert_eq!(pt.len(), 0);
        assert_eq!(pt.total_bytes(), 0);
    }

    #[test]
    fn test_record_and_contains() {
        let mut pt = ImportedPackageParts::new();
        pt.record("xl/embeddings/oleObject1.bin".to_string(), vec![1, 2, 3]);

        assert!(!pt.is_empty());
        assert_eq!(pt.len(), 1);
        assert!(pt.contains("xl/embeddings/oleObject1.bin"));
        assert!(!pt.contains("xl/embeddings/oleObject2.bin"));
    }

    #[test]
    fn test_record_deduplicates() {
        let mut pt = ImportedPackageParts::new();
        pt.record("xl/embeddings/oleObject1.bin".to_string(), vec![1, 2, 3]);
        pt.record("xl/embeddings/oleObject1.bin".to_string(), vec![4, 5, 6]);

        assert_eq!(pt.len(), 1);
        // First recording wins
        assert_eq!(
            pt.get("xl/embeddings/oleObject1.bin"),
            Some(&[1u8, 2, 3][..])
        );
    }

    #[test]
    fn test_get() {
        let mut pt = ImportedPackageParts::new();
        pt.record("path/a.bin".to_string(), vec![10, 20]);
        pt.record("path/b.bin".to_string(), vec![30, 40]);

        assert_eq!(pt.get("path/a.bin"), Some(&[10u8, 20][..]));
        assert_eq!(pt.get("path/b.bin"), Some(&[30u8, 40][..]));
        assert_eq!(pt.get("path/c.bin"), None);
    }

    #[test]
    fn test_paths() {
        let mut pt = ImportedPackageParts::new();
        pt.record("xl/embeddings/oleObject1.bin".to_string(), vec![1]);
        pt.record("xl/media/image1.emf".to_string(), vec![2]);

        let paths: Vec<&str> = pt.paths().collect();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"xl/embeddings/oleObject1.bin"));
        assert!(paths.contains(&"xl/media/image1.emf"));
    }

    #[test]
    fn test_total_bytes() {
        let mut pt = ImportedPackageParts::new();
        pt.record("a.bin".to_string(), vec![1, 2, 3]);
        pt.record("b.bin".to_string(), vec![4, 5]);

        assert_eq!(pt.total_bytes(), 5);
    }

    #[test]
    fn test_merge() {
        let mut pt1 = ImportedPackageParts::new();
        pt1.record("a.bin".to_string(), vec![1]);

        let mut pt2 = ImportedPackageParts::new();
        pt2.record("b.bin".to_string(), vec![2]);
        pt2.record("a.bin".to_string(), vec![3]); // duplicate of pt1

        pt1.merge(pt2);

        assert_eq!(pt1.len(), 2);
        assert!(pt1.contains("a.bin"));
        assert!(pt1.contains("b.bin"));
        // Original value preserved for duplicates
        assert_eq!(pt1.get("a.bin"), Some(&[1u8][..]));
    }

    #[test]
    fn test_take() {
        let mut pt = ImportedPackageParts::new();
        pt.record("a.bin".to_string(), vec![1, 2, 3]);
        pt.record("b.bin".to_string(), vec![4, 5, 6]);

        let taken = pt.take();
        assert_eq!(taken.len(), 2);
        assert!(pt.is_empty());
    }

    #[test]
    fn test_clear() {
        let mut pt = ImportedPackageParts::new();
        pt.record("a.bin".to_string(), vec![1]);
        pt.clear();
        assert!(pt.is_empty());
    }

    #[test]
    fn test_infer_content_type() {
        assert_eq!(
            infer_content_type("xl/printerSettings/printerSettings1.bin"),
            CT_PRINTER_SETTINGS
        );
        assert_eq!(
            infer_content_type("xl/embeddings/oleObject1.bin"),
            CT_OLE_OBJECT
        );
        assert_eq!(infer_content_type("xl/media/image1.emf"), "image/x-emf");
        assert_eq!(infer_content_type("xl/media/image2.wmf"), "image/x-wmf");
        assert_eq!(infer_content_type("xl/media/image3.png"), "image/png");
        assert_eq!(infer_content_type("xl/media/image4.jpeg"), "image/jpeg");
        assert_eq!(infer_content_type("xl/media/image5.jpg"), "image/jpeg");
        assert_eq!(infer_content_type("xl/media/image6.gif"), "image/gif");
        assert_eq!(
            infer_content_type("xl/other/unknown.dat"),
            "application/octet-stream"
        );
    }

    #[test]
    fn test_entries() {
        let mut pt = ImportedPackageParts::new();
        pt.record("a.bin".to_string(), vec![1]);
        pt.record("b.bin".to_string(), vec![2]);

        let entries = pt.entries();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].0, "a.bin");
        assert_eq!(entries[1].0, "b.bin");
    }

    #[test]
    fn test_default_trait() {
        let pt = ImportedPackageParts::default();
        assert!(pt.is_empty());
    }

    #[test]
    fn test_write_all() {
        let mut pt = ImportedPackageParts::new();
        pt.record("xl/embeddings/oleObject1.bin".to_string(), vec![0xDE, 0xAD]);
        pt.record("xl/media/image1.emf".to_string(), vec![0xBE, 0xEF]);

        let mut zip = ZipWriter::new();
        pt.write_all(&mut zip);

        // Verify entries were added by finishing the ZIP
        let result = zip.finish();
        assert!(result.is_ok());
        let bytes = result.unwrap();
        // Basic check: ZIP should have content
        assert!(bytes.len() > 0);
    }
}
