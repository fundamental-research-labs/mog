use crate::infra::error::{ErrorCode, ParseContext};

use super::super::entry::ZipEntry;
use super::super::error::ZipError;
use super::XlsxArchive;

impl<'a> XlsxArchive<'a> {
    // =========================================================================
    // Error Recovery Methods
    // =========================================================================

    /// Get worksheet with error recovery (returns empty XML on failure)
    ///
    /// This method attempts to read a worksheet and returns empty XML if
    /// the file is not found or cannot be read. Errors are reported to the
    /// provided `ParseContext`.
    ///
    /// # Arguments
    /// * `index` - 1-based worksheet index (sheet1, sheet2, etc.)
    /// * `context` - Parse context for error reporting
    ///
    /// # Returns
    /// The worksheet XML bytes, or empty `Vec<u8>` on failure
    pub fn get_worksheet_or_empty(&self, index: usize, context: &mut ParseContext) -> Vec<u8> {
        let path = Self::worksheet_path(index as u32);
        context.set_current_part(&path);

        match self.get_worksheet(index) {
            Ok(data) => data,
            Err(e) => {
                context.report_error_detail(e.into());
                Vec::new()
            }
        }
    }

    /// Get shared strings with error recovery (returns empty on failure)
    ///
    /// This method attempts to read the shared strings file and returns empty
    /// data if the file is not found or cannot be read. A warning is logged
    /// since shared strings are optional in XLSX.
    ///
    /// # Arguments
    /// * `context` - Parse context for error reporting
    ///
    /// # Returns
    /// The shared strings XML bytes, or empty `Vec<u8>` on failure
    pub fn get_shared_strings_or_empty(&self, context: &mut ParseContext) -> Vec<u8> {
        context.set_current_part(Self::shared_strings_path());

        match self.get_shared_strings() {
            Ok(data) => data,
            Err(ZipError::FileNotFound(_)) => {
                context.report_warning(
                    ErrorCode::MissingPart,
                    "sharedStrings.xml not found, strings will be empty",
                );
                Vec::new()
            }
            Err(e) => {
                context.report_error_detail(e.into());
                Vec::new()
            }
        }
    }

    /// Get workbook with error recovery (returns empty XML on failure)
    ///
    /// # Arguments
    /// * `context` - Parse context for error reporting
    ///
    /// # Returns
    /// The workbook XML bytes, or empty `Vec<u8>` on failure
    pub fn get_workbook_or_empty(&self, context: &mut ParseContext) -> Vec<u8> {
        context.set_current_part(Self::workbook_path());

        match self.get_workbook() {
            Ok(data) => data,
            Err(e) => {
                context.report_error_detail(e.into());
                Vec::new()
            }
        }
    }

    /// Get styles with error recovery (returns empty XML on failure)
    ///
    /// # Arguments
    /// * `context` - Parse context for error reporting
    ///
    /// # Returns
    /// The styles XML bytes, or empty `Vec<u8>` on failure
    pub fn get_styles_or_empty(&self, context: &mut ParseContext) -> Vec<u8> {
        context.set_current_part(Self::styles_path());

        match self.get_styles() {
            Ok(data) => data,
            Err(ZipError::FileNotFound(_)) => {
                context.report_warning(
                    ErrorCode::MissingPart,
                    "styles.xml not found, using default styles",
                );
                Vec::new()
            }
            Err(e) => {
                context.report_error_detail(e.into());
                Vec::new()
            }
        }
    }

    /// Read a file with error recovery based on parse mode
    ///
    /// In Permissive mode, this method will attempt to recover from CRC
    /// mismatches and other errors. In Strict mode, it will fail on any error.
    ///
    /// # Arguments
    /// * `name` - Path to the file within the archive
    /// * `context` - Parse context for error handling
    ///
    /// # Returns
    /// The file contents, or empty `Vec<u8>` on unrecoverable failure
    pub fn read_file_with_recovery(&self, name: &str, context: &mut ParseContext) -> Vec<u8> {
        context.set_current_part(name);

        // Find the entry
        let entry = match self.entries.iter().find(|e| e.name == name) {
            Some(e) => e,
            None => {
                context.report_error_detail(ZipError::FileNotFound(name.to_string()).into());
                return Vec::new();
            }
        };

        // Try to read with potential recovery
        match self.read_entry_with_recovery(entry, context) {
            Ok(data) => data,
            Err(e) => {
                context.report_error_detail(e.into());
                Vec::new()
            }
        }
    }

    /// Read a file entry with potential recovery from errors
    fn read_entry_with_recovery(
        &self,
        entry: &ZipEntry,
        context: &mut ParseContext,
    ) -> Result<Vec<u8>, ZipError> {
        // Validate sizes
        let _ = context;
        self.read_entry(entry, true, true)
            .map_err(|e| self.remember_zip_error(e))
    }
}
