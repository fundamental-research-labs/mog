//! XLSX archive reader
//!
//! XLSX files are ZIP archives containing XML files. This module provides
//! the main `XlsxArchive` struct for reading files from the archive.

use crc32fast::Hasher;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use crate::infra::error::{ErrorCode, ParseContext};

use super::central_dir::{find_eocd, get_data_offset, parse_central_directory, parse_eocd};
use super::constants::{
    COMPRESSION_DEFLATE, COMPRESSION_STORE, MAX_RELATIONSHIP_PARTS, MAX_RELATIONSHIPS_PER_PART,
    MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE, MAX_TOTAL_RELATIONSHIP_RECORDS,
    MAX_UNCOMPRESSED_SIZE, MIN_EOCD_SIZE,
};
use super::decompress::decompress_deflate;
use super::entry::{CompressedEntry, ZipEntry};
use super::error::ZipError;

/// XLSX archive reader
///
/// Provides efficient access to files within an XLSX (ZIP) archive.
/// Parses the central directory on creation for O(1) file lookup.
pub struct XlsxArchive<'a> {
    /// Raw archive data
    data: &'a [u8],
    /// Indexed entries from the central directory
    entries: Vec<ZipEntry>,
    /// Cumulative materialized bytes charged through production archive reads.
    materialized_uncompressed: Cell<usize>,
    /// Relationship records charged once per `.rels` part name.
    relationship_record_counts: RefCell<HashMap<String, usize>>,
    /// First fatal safety read error observed through this archive.
    fatal_safety_error: RefCell<Option<ZipError>>,
}

impl<'a> XlsxArchive<'a> {
    /// Create a new XlsxArchive from raw bytes
    ///
    /// Parses the ZIP central directory to build an index of all files.
    ///
    /// # Arguments
    /// * `data` - Raw bytes of the ZIP/XLSX file
    ///
    /// # Returns
    /// * `Ok(XlsxArchive)` - Successfully parsed archive
    /// * `Err(ZipError)` - Invalid or corrupted archive
    pub fn new(data: &'a [u8]) -> Result<XlsxArchive<'a>, ZipError> {
        if data.len() < MIN_EOCD_SIZE {
            return Err(ZipError::UnexpectedEof);
        }

        // Verify ZIP signature at start
        if data.len() >= 4 && &data[0..4] != b"PK\x03\x04" {
            return Err(ZipError::InvalidFormat);
        }

        // Find End of Central Directory record
        let eocd_offset = find_eocd(data)?;

        // Parse EOCD to get central directory location
        let (cd_offset, cd_size, entry_count) = parse_eocd(data, eocd_offset)?;

        // Parse central directory entries
        let entries = parse_central_directory(data, cd_offset, cd_size, entry_count)?;

        let relationship_part_count = entries
            .iter()
            .filter(|entry| entry.name.ends_with(".rels"))
            .count();
        if relationship_part_count > MAX_RELATIONSHIP_PARTS {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_RELATIONSHIP_PARTS,
                actual: relationship_part_count,
            });
        }

        Ok(XlsxArchive {
            data,
            entries,
            materialized_uncompressed: Cell::new(0),
            relationship_record_counts: RefCell::new(HashMap::new()),
            fatal_safety_error: RefCell::new(None),
        })
    }

    /// Get the raw archive data
    pub fn data(&self) -> &[u8] {
        self.data
    }

    /// Read a file from the archive by name
    ///
    /// # Arguments
    /// * `name` - Path to the file within the archive
    ///
    /// # Returns
    /// * `Ok(Vec<u8>)` - Decompressed file contents
    /// * `Err(ZipError)` - File not found or decompression error
    pub fn read_file(&self, name: &str) -> Result<Vec<u8>, ZipError> {
        // Find the entry
        let entry = self
            .entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| ZipError::FileNotFound(name.to_string()))?;

        self.read_entry(entry, true, true)
            .map_err(|e| self.remember_zip_error(e))
    }

    /// Read a file verbatim for lossless passthrough.
    ///
    /// This preserves ZIP safety checks (size, decompression, CRC, and
    /// relationship-count limits) but skips the UTF-8 precondition for XML-like
    /// paths. Use this only for parts that are stored and re-emitted as opaque
    /// bytes, not for XML that the parser interprets.
    pub fn read_file_verbatim(&self, name: &str) -> Result<Vec<u8>, ZipError> {
        let entry = self
            .entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| ZipError::FileNotFound(name.to_string()))?;

        self.read_entry(entry, true, false)
            .map_err(|e| self.remember_zip_error(e))
    }

    /// Read a file using a ZipEntry reference
    fn read_entry(
        &self,
        entry: &ZipEntry,
        charge_materialized: bool,
        validate_xml_utf8: bool,
    ) -> Result<Vec<u8>, ZipError> {
        // Validate sizes
        if entry.uncompressed_size > MAX_UNCOMPRESSED_SIZE {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_UNCOMPRESSED_SIZE,
                actual: entry.uncompressed_size,
            });
        }

        // Get compressed data offset by parsing local file header
        let compressed_offset = get_data_offset(self.data, entry.offset)?;

        // Validate we have enough data
        let data_end = compressed_offset
            .checked_add(entry.compressed_size)
            .ok_or(ZipError::CorruptedArchive)?;
        if data_end > self.data.len() {
            return Err(ZipError::CorruptedArchive);
        }

        let compressed_data = &self.data[compressed_offset..data_end];

        let output = match entry.compression_method {
            COMPRESSION_STORE => {
                if entry.compressed_size != entry.uncompressed_size {
                    return Err(ZipError::DataCorruptionDetail(format!(
                        "{}: stored entry compressed size {} does not match uncompressed size {}",
                        entry.name, entry.compressed_size, entry.uncompressed_size
                    )));
                }
                if compressed_data.len() != entry.uncompressed_size {
                    return Err(ZipError::DataCorruptionDetail(format!(
                        "{}: stored entry actual data length {} does not match declared uncompressed size {}",
                        entry.name,
                        compressed_data.len(),
                        entry.uncompressed_size
                    )));
                }
                Ok(compressed_data.to_vec())
            }
            COMPRESSION_DEFLATE => {
                // DEFLATE compression - use raw deflate decompression
                let data = decompress_deflate(compressed_data, entry.uncompressed_size)?;
                if data.len() != entry.uncompressed_size {
                    return Err(ZipError::DataCorruptionDetail(format!(
                        "{}: decompressed size {} does not match declared uncompressed size {}",
                        entry.name,
                        data.len(),
                        entry.uncompressed_size
                    )));
                }
                Ok(data)
            }
            method => Err(ZipError::UnsupportedCompression(method)),
        }?;

        self.validate_crc(entry, &output)?;
        if validate_xml_utf8 {
            validate_xml_part_utf8(&entry.name, &output)?;
        }
        self.charge_relationship_records(entry, &output)?;
        if charge_materialized {
            self.charge_materialized(entry, output.len())?;
        }
        Ok(output)
    }

    /// Read a file directly into a pre-allocated buffer (zero-copy when possible)
    ///
    /// # Arguments
    /// * `name` - Path to the file within the archive
    /// * `output` - Pre-allocated buffer to write decompressed data
    ///
    /// # Returns
    /// Number of bytes written or a `ZipError`
    pub fn read_file_into(&self, name: &str, output: &mut [u8]) -> Result<usize, ZipError> {
        let entry = self
            .entries
            .iter()
            .find(|e| e.name == name)
            .ok_or_else(|| ZipError::FileNotFound(name.to_string()))?;

        let decompressed = self
            .read_entry(entry, false, true)
            .map_err(|e| self.remember_zip_error(e))?;
        if output.len() < decompressed.len() {
            return Err(ZipError::FileTooLargeDetail {
                limit: output.len(),
                actual: decompressed.len(),
            });
        }
        output[..decompressed.len()].copy_from_slice(&decompressed);
        self.charge_materialized(entry, decompressed.len())
            .map_err(|e| self.remember_zip_error(e))?;
        Ok(decompressed.len())
    }

    /// Get all entries in the archive
    pub fn entries(&self) -> &[ZipEntry] {
        &self.entries
    }

    /// Return the first fatal safety error observed by any archive read.
    pub fn fatal_safety_error(&self) -> Option<ZipError> {
        self.fatal_safety_error.borrow().clone()
    }

    /// Find an entry by name
    pub fn find_entry(&self, name: &str) -> Option<&ZipEntry> {
        self.entries.iter().find(|e| e.name == name)
    }

    /// Check if a file exists in the archive
    pub fn contains(&self, name: &str) -> bool {
        self.entries.iter().any(|e| e.name == name)
    }

    /// Get the shared strings XML file (xl/sharedStrings.xml)
    ///
    /// This file contains all unique strings used in the spreadsheet.
    pub fn get_shared_strings(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("xl/sharedStrings.xml")
    }

    /// Get a worksheet by 1-based index (xl/worksheets/sheet{N}.xml)
    ///
    /// # Arguments
    /// * `index` - 1-based worksheet index (sheet1, sheet2, etc.)
    pub fn get_worksheet(&self, index: usize) -> Result<Vec<u8>, ZipError> {
        let name = format!("xl/worksheets/sheet{}.xml", index);
        self.read_file(&name)
    }

    /// Get the styles XML file (xl/styles.xml)
    ///
    /// This file contains cell formatting, number formats, fonts, etc.
    pub fn get_styles(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("xl/styles.xml")
    }

    /// Get the workbook XML file (xl/workbook.xml)
    ///
    /// This file contains sheet names, defined names, and workbook settings.
    pub fn get_workbook(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("xl/workbook.xml")
    }

    /// Count the number of worksheets in the archive
    ///
    /// Counts files matching the pattern xl/worksheets/sheet*.xml
    pub fn worksheet_count(&self) -> usize {
        self.entries
            .iter()
            .filter(|e| e.name.starts_with("xl/worksheets/sheet") && e.name.ends_with(".xml"))
            .count()
    }

    /// List all worksheet names (just the sheet*.xml filenames)
    pub fn worksheet_names(&self) -> Vec<&str> {
        self.entries
            .iter()
            .filter_map(|e| {
                if e.name.starts_with("xl/worksheets/sheet") && e.name.ends_with(".xml") {
                    e.name.strip_prefix("xl/worksheets/")
                } else {
                    None
                }
            })
            .collect()
    }

    /// Get the relationships file for the workbook
    pub fn get_workbook_rels(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("xl/_rels/workbook.xml.rels")
    }

    /// Get the content types file
    pub fn get_content_types(&self) -> Result<Vec<u8>, ZipError> {
        self.read_file("[Content_Types].xml")
    }

    /// Get the shared strings file path
    pub fn shared_strings_path() -> &'static str {
        "xl/sharedStrings.xml"
    }

    /// Get the workbook file path
    pub fn workbook_path() -> &'static str {
        "xl/workbook.xml"
    }

    /// Get the worksheet file path for a given sheet number (1-indexed)
    pub fn worksheet_path(sheet_num: u32) -> String {
        format!("xl/worksheets/sheet{}.xml", sheet_num)
    }

    /// Get the styles file path
    pub fn styles_path() -> &'static str {
        "xl/styles.xml"
    }

    // =========================================================================
    // Streaming Support Methods
    // =========================================================================

    /// Get the raw compressed data for a file entry.
    ///
    /// This method returns the compressed bytes directly without decompressing,
    /// allowing for streaming decompression with `StreamingDeflate`.
    ///
    /// # Arguments
    /// * `name` - Path to the file within the archive
    ///
    /// # Returns
    /// * `Ok(CompressedEntry)` - The compressed data and metadata
    /// * `Err(ZipError)` - File not found or invalid entry
    ///
    /// # Example
    /// ```ignore
    /// use xlsx_parser::streaming::StreamingDeflate;
    ///
    /// let entry = archive.get_compressed_data("xl/worksheets/sheet1.xml")?;
    /// if entry.compression_method == 8 {
    ///     let mut decompressor = StreamingDeflate::new(
    ///         entry.data,
    ///         64 * 1024,
    ///         entry.uncompressed_size,
    ///         entry.output_limit,
    ///         entry.crc32,
    ///     )?;
    ///     while let Some(chunk) = decompressor.next_chunk()? {
    ///         // Process decompressed chunk
    ///     }
    /// }
    /// ```
    pub fn get_compressed_data(&self, name: &str) -> Result<CompressedEntry<'_>, ZipError> {
        let result = (|| {
            // Find the entry
            let entry = self
                .entries
                .iter()
                .find(|e| e.name == name)
                .ok_or_else(|| ZipError::FileNotFound(name.to_string()))?;

            // Get compressed data offset by parsing local file header
            let compressed_offset = get_data_offset(self.data, entry.offset)?;

            // Validate we have enough data
            let data_end = compressed_offset
                .checked_add(entry.compressed_size)
                .ok_or(ZipError::CorruptedArchive)?;
            if data_end > self.data.len() {
                return Err(ZipError::CorruptedArchive);
            }

            let compressed_data = &self.data[compressed_offset..data_end];

            Ok(CompressedEntry {
                name: entry.name.as_str(),
                data: compressed_data,
                compression_method: entry.compression_method,
                flags: entry.flags,
                uncompressed_size: entry.uncompressed_size,
                crc32: entry.crc32,
                output_limit: MAX_UNCOMPRESSED_SIZE,
            })
        })();

        result.map_err(|e| self.remember_zip_error(e))
    }

    /// Get the raw compressed data for a worksheet by 1-based index.
    ///
    /// This is a convenience method for streaming worksheet parsing.
    ///
    /// # Arguments
    /// * `index` - 1-based worksheet index (sheet1, sheet2, etc.)
    ///
    /// # Returns
    /// * `Ok(CompressedEntry)` - The compressed worksheet data
    /// * `Err(ZipError)` - Worksheet not found or invalid entry
    pub fn get_worksheet_compressed(&self, index: usize) -> Result<CompressedEntry<'_>, ZipError> {
        let name = format!("xl/worksheets/sheet{}.xml", index);
        self.get_compressed_data(&name)
    }

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

    fn validate_crc(&self, entry: &ZipEntry, data: &[u8]) -> Result<(), ZipError> {
        let mut hasher = Hasher::new();
        hasher.update(data);
        let actual_crc = hasher.finalize();
        if actual_crc != entry.crc32 {
            return Err(ZipError::DataCorruptionDetail(format!(
                "{}: CRC mismatch, declared compressed_size={}, declared uncompressed_size={}, actual_output_bytes={}, method={}, expected {:08x}, got {:08x}",
                entry.name,
                entry.compressed_size,
                entry.uncompressed_size,
                data.len(),
                entry.compression_method,
                entry.crc32,
                actual_crc
            )));
        }
        Ok(())
    }

    fn charge_materialized(&self, entry: &ZipEntry, bytes: usize) -> Result<(), ZipError> {
        let new_total = self
            .materialized_uncompressed
            .get()
            .checked_add(bytes)
            .ok_or(ZipError::FileTooLarge)?;
        if new_total > MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE,
                actual: new_total,
            });
        }
        self.materialized_uncompressed.set(new_total);
        let _ = entry;
        Ok(())
    }

    fn charge_relationship_records(&self, entry: &ZipEntry, data: &[u8]) -> Result<(), ZipError> {
        if !entry.name.ends_with(".rels") {
            return Ok(());
        }

        let record_count = count_relationship_elements(data);
        if record_count > MAX_RELATIONSHIPS_PER_PART {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_RELATIONSHIPS_PER_PART,
                actual: record_count,
            });
        }

        let mut charged = self.relationship_record_counts.borrow_mut();
        if charged.contains_key(&entry.name) {
            return Ok(());
        }

        let new_total = charged
            .values()
            .try_fold(record_count, |acc, value| acc.checked_add(*value))
            .ok_or(ZipError::FileTooLarge)?;
        if new_total > MAX_TOTAL_RELATIONSHIP_RECORDS {
            return Err(ZipError::FileTooLargeDetail {
                limit: MAX_TOTAL_RELATIONSHIP_RECORDS,
                actual: new_total,
            });
        }
        charged.insert(entry.name.clone(), record_count);
        Ok(())
    }

    fn remember_zip_error(&self, error: ZipError) -> ZipError {
        if error.is_safety_fatal() {
            let mut fatal = self.fatal_safety_error.borrow_mut();
            if fatal.is_none() {
                *fatal = Some(error.clone());
            }
        }
        error
    }
}

fn validate_xml_part_utf8(part_name: &str, data: &[u8]) -> Result<(), ZipError> {
    if !(part_name.ends_with(".xml") || part_name.ends_with(".rels")) {
        return Ok(());
    }
    std::str::from_utf8(data).map_err(|err| {
        ZipError::DataCorruptionDetail(format!(
            "{}: XML part is not valid UTF-8 at byte {}",
            part_name,
            err.valid_up_to()
        ))
    })?;
    Ok(())
}

fn count_relationship_elements(xml: &[u8]) -> usize {
    let mut count = 0usize;
    let mut pos = 0usize;
    while let Some(rel) = memchr::memmem::find(&xml[pos..], b"<Relationship") {
        let start = pos + rel;
        let next = start + b"<Relationship".len();
        if next >= xml.len() || matches!(xml[next], b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r') {
            count += 1;
        }
        pos = next;
    }
    count
}

#[cfg(test)]
mod tests {
    use super::super::constants::{
        CENTRAL_FILE_HEADER_SIGNATURE, END_OF_CENTRAL_DIR_SIGNATURE, LOCAL_FILE_HEADER_SIGNATURE,
    };
    use super::*;

    // Simple CRC32 implementation for testing
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFFFFFFu32;
        for &byte in data {
            crc ^= byte as u32;
            for _ in 0..8 {
                if crc & 1 != 0 {
                    crc = (crc >> 1) ^ 0xEDB88320;
                } else {
                    crc >>= 1;
                }
            }
        }
        !crc
    }

    // Helper to create a minimal valid ZIP file with a single stored file
    fn create_test_zip(filename: &str, content: &[u8]) -> Vec<u8> {
        let mut zip = Vec::new();
        let name_bytes = filename.as_bytes();
        let crc = crc32(content);

        // Local file header
        zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes()); // version needed
        zip.extend_from_slice(&0u16.to_le_bytes()); // flags
        zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes()); // compression
        zip.extend_from_slice(&0u16.to_le_bytes()); // mod time
        zip.extend_from_slice(&0u16.to_le_bytes()); // mod date
        zip.extend_from_slice(&crc.to_le_bytes()); // CRC-32
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // compressed size
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncompressed size
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes()); // name length
        zip.extend_from_slice(&0u16.to_le_bytes()); // extra length
        zip.extend_from_slice(name_bytes);
        zip.extend_from_slice(content);

        let local_header_offset = 0usize;
        let cd_offset = zip.len();

        // Central directory file header
        zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes()); // version made by
        zip.extend_from_slice(&20u16.to_le_bytes()); // version needed
        zip.extend_from_slice(&0u16.to_le_bytes()); // flags
        zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes()); // compression
        zip.extend_from_slice(&0u16.to_le_bytes()); // mod time
        zip.extend_from_slice(&0u16.to_le_bytes()); // mod date
        zip.extend_from_slice(&crc.to_le_bytes()); // CRC-32
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // compressed size
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncompressed size
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes()); // name length
        zip.extend_from_slice(&0u16.to_le_bytes()); // extra length
        zip.extend_from_slice(&0u16.to_le_bytes()); // comment length
        zip.extend_from_slice(&0u16.to_le_bytes()); // disk number
        zip.extend_from_slice(&0u16.to_le_bytes()); // internal attributes
        zip.extend_from_slice(&0u32.to_le_bytes()); // external attributes
        zip.extend_from_slice(&(local_header_offset as u32).to_le_bytes()); // local header offset
        zip.extend_from_slice(name_bytes);

        let cd_size = zip.len() - cd_offset;

        // End of central directory
        zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes()); // disk number
        zip.extend_from_slice(&0u16.to_le_bytes()); // disk with CD
        zip.extend_from_slice(&1u16.to_le_bytes()); // entries on disk
        zip.extend_from_slice(&1u16.to_le_bytes()); // total entries
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes()); // CD size
        zip.extend_from_slice(&(cd_offset as u32).to_le_bytes()); // CD offset
        zip.extend_from_slice(&0u16.to_le_bytes()); // comment length

        zip
    }

    // Helper to create ZIP with multiple files
    fn create_multi_file_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = Vec::new();
        let mut entries_info: Vec<(usize, &str, &[u8], u32)> = Vec::new();

        // Write all local file headers and data
        for (filename, content) in files {
            let local_offset = zip.len();
            let name_bytes = filename.as_bytes();
            let crc = crc32(content);

            // Local file header
            zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
            zip.extend_from_slice(&20u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&crc.to_le_bytes());
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(name_bytes);
            zip.extend_from_slice(content);

            entries_info.push((local_offset, filename, content, crc));
        }

        let cd_offset = zip.len();

        // Write central directory entries
        for (local_offset, filename, content, crc) in &entries_info {
            let name_bytes = filename.as_bytes();

            zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
            zip.extend_from_slice(&20u16.to_le_bytes());
            zip.extend_from_slice(&20u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&crc.to_le_bytes());
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u32.to_le_bytes());
            zip.extend_from_slice(&(*local_offset as u32).to_le_bytes());
            zip.extend_from_slice(name_bytes);
        }

        let cd_size = zip.len() - cd_offset;

        // End of central directory
        zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&(entries_info.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(entries_info.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
        zip.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());

        zip
    }

    #[test]
    fn test_create_archive() {
        let content = b"Hello, World!";
        let zip_data = create_test_zip("test.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        assert_eq!(archive.entries().len(), 1);
        assert_eq!(archive.entries()[0].name, "test.txt");
    }

    #[test]
    fn test_read_stored_file() {
        let content = b"Hello, World!";
        let zip_data = create_test_zip("test.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let data = archive.read_file("test.txt").expect("Failed to read file");

        assert_eq!(data, content);
    }

    #[test]
    fn test_read_file_into_buffer() {
        let content = b"Hello, World!";
        let zip_data = create_test_zip("test.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let mut buffer = vec![0u8; 100];
        let bytes_read = archive
            .read_file_into("test.txt", &mut buffer)
            .expect("Failed to read file");

        assert_eq!(bytes_read, content.len());
        assert_eq!(&buffer[..bytes_read], content);
    }

    #[test]
    fn test_file_not_found() {
        let content = b"Hello, World!";
        let zip_data = create_test_zip("test.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let result = archive.read_file("nonexistent.txt");

        assert!(matches!(result, Err(ZipError::FileNotFound(_))));
    }

    #[test]
    fn test_read_file_into_too_small_buffer() {
        let zip_data = create_test_zip("test.txt", b"Hello, World!");
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let mut output = [0u8; 4];

        let result = archive.read_file_into("test.txt", &mut output);

        assert!(matches!(result, Err(ZipError::FileTooLargeDetail { .. })));
    }

    #[test]
    fn test_crc_mismatch_is_data_corruption() {
        let filename = "test.txt";
        let mut zip_data = create_test_zip(filename, b"Hello, World!");
        zip_data[30 + filename.len()] ^= 0xff;
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let result = archive.read_file(filename);

        assert!(matches!(result, Err(ZipError::DataCorruptionDetail(_))));
        assert!(matches!(
            archive.fatal_safety_error(),
            Some(ZipError::DataCorruptionDetail(_))
        ));
    }

    #[test]
    fn test_stored_entry_mismatched_declared_size_rejected() {
        let filename = "test.txt";
        let content = b"Hello, World!";
        let mut zip_data = create_test_zip(filename, content);
        let cd_sig = CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes();
        let cd_offset = zip_data
            .windows(4)
            .position(|window| window == cd_sig)
            .expect("central directory signature");
        let dishonest_uncompressed = (content.len() as u32 + 1).to_le_bytes();
        zip_data[22..26].copy_from_slice(&dishonest_uncompressed);
        zip_data[cd_offset + 24..cd_offset + 28].copy_from_slice(&dishonest_uncompressed);

        let result = XlsxArchive::new(&zip_data);

        assert!(matches!(result, Err(ZipError::DataCorruptionDetail(_))));
    }

    #[test]
    fn test_non_ascii_filename_without_utf8_flag_rejected() {
        let filename = "test.txt";
        let mut zip_data = create_test_zip(filename, b"content");
        let cd_sig = CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes();
        let cd_offset = zip_data
            .windows(4)
            .position(|window| window == cd_sig)
            .expect("central directory signature");
        zip_data[30] = 0xff;
        zip_data[cd_offset + 46] = 0xff;

        let result = XlsxArchive::new(&zip_data);

        assert!(matches!(result, Err(ZipError::InvalidFileName(_))));
    }

    #[test]
    fn test_duplicate_normalized_filename_rejected() {
        let files: &[(&str, &[u8])] = &[("xl\\a.xml", b"one"), ("xl/a.xml", b"two")];
        let zip_data = create_multi_file_zip(files);

        let result = XlsxArchive::new(&zip_data);

        assert!(matches!(result, Err(ZipError::InvalidFileName(_))));
    }

    #[test]
    fn test_unsupported_zip_flags_rejected_before_read() {
        let filename = "test.txt";
        let mut zip_data = create_test_zip(filename, b"content");
        let cd_sig = CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes();
        let cd_offset = zip_data
            .windows(4)
            .position(|window| window == cd_sig)
            .expect("central directory signature");
        zip_data[6..8].copy_from_slice(&1u16.to_le_bytes());
        zip_data[cd_offset + 8..cd_offset + 10].copy_from_slice(&1u16.to_le_bytes());

        let result = XlsxArchive::new(&zip_data);

        assert!(matches!(result, Err(ZipError::UnsupportedFeature(_))));
    }

    #[test]
    fn test_relationship_element_counter_ignores_relationships_root() {
        let xml = br#"<Relationships>
            <Relationship Id="rId1"/>
            <Relationship Id="rId2"></Relationship>
        </Relationships>"#;

        assert_eq!(count_relationship_elements(xml), 2);
    }

    #[test]
    fn test_relationship_records_are_charged_once_per_part() {
        let xml = br#"<Relationships><Relationship Id="rId1"/></Relationships>"#;
        let zip_data = create_test_zip("xl/_rels/workbook.xml.rels", xml);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        assert!(archive.read_file("xl/_rels/workbook.xml.rels").is_ok());
        assert!(archive.read_file("xl/_rels/workbook.xml.rels").is_ok());
        assert_eq!(
            archive
                .relationship_record_counts
                .borrow()
                .get("xl/_rels/workbook.xml.rels"),
            Some(&1)
        );
    }

    #[test]
    fn test_contains() {
        let content = b"Hello, World!";
        let zip_data = create_test_zip("test.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        assert!(archive.contains("test.txt"));
        assert!(!archive.contains("nonexistent.txt"));
    }

    #[test]
    fn test_find_entry() {
        let content = b"Hello, World!";
        let zip_data = create_test_zip("test.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let entry = archive.find_entry("test.txt");
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().name, "test.txt");

        assert!(archive.find_entry("nonexistent.txt").is_none());
    }

    #[test]
    fn test_invalid_archive_too_short() {
        let invalid_data = b"Not a ZIP file";
        let result = XlsxArchive::new(invalid_data);

        // Should return UnexpectedEof since data is shorter than minimum ZIP size (22 bytes)
        assert!(matches!(result, Err(ZipError::UnexpectedEof)));
    }

    #[test]
    fn test_invalid_archive_wrong_signature() {
        // Create data that's long enough but has wrong signature
        let invalid_data = b"Not a ZIP file but long enough to pass size check!";
        let result = XlsxArchive::new(invalid_data);

        // Should return InvalidFormat since it doesn't start with PK signature
        assert!(matches!(result, Err(ZipError::InvalidFormat)));
    }

    #[test]
    fn test_empty_data() {
        let result = XlsxArchive::new(&[]);
        assert!(matches!(result, Err(ZipError::UnexpectedEof)));
    }

    #[test]
    fn test_multi_file_archive() {
        let files: &[(&str, &[u8])] = &[
            ("file1.txt", b"Content 1"),
            ("file2.txt", b"Content 2"),
            ("dir/file3.txt", b"Content 3"),
        ];

        let zip_data = create_multi_file_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        assert_eq!(archive.entries().len(), 3);

        for (name, expected_content) in files {
            let content = archive.read_file(name).expect("Failed to read file");
            assert_eq!(content, *expected_content);
        }
    }

    #[test]
    fn test_xlsx_like_structure() {
        let files: &[(&str, &[u8])] = &[
            ("[Content_Types].xml", b"<Types/>"),
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/sharedStrings.xml", b"<sst/>"),
            ("xl/styles.xml", b"<styleSheet/>"),
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
            ("xl/worksheets/sheet2.xml", b"<worksheet/>"),
            ("xl/_rels/workbook.xml.rels", b"<Relationships/>"),
        ];

        let zip_data = create_multi_file_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        // Test convenience methods
        assert!(archive.get_workbook().is_ok());
        assert!(archive.get_shared_strings().is_ok());
        assert!(archive.get_styles().is_ok());
        assert!(archive.get_worksheet(1).is_ok());
        assert!(archive.get_worksheet(2).is_ok());
        assert!(archive.get_workbook_rels().is_ok());
        assert!(archive.get_content_types().is_ok());

        // Test worksheet count
        assert_eq!(archive.worksheet_count(), 2);
    }

    #[test]
    fn test_worksheet_names() {
        let files: &[(&str, &[u8])] = &[
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
            ("xl/worksheets/sheet2.xml", b"<worksheet/>"),
            ("xl/worksheets/sheet10.xml", b"<worksheet/>"),
        ];

        let zip_data = create_multi_file_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let names = archive.worksheet_names();
        assert_eq!(names.len(), 3);
        assert!(names.contains(&"sheet1.xml"));
        assert!(names.contains(&"sheet2.xml"));
        assert!(names.contains(&"sheet10.xml"));
    }

    #[test]
    fn test_file_paths() {
        assert_eq!(XlsxArchive::shared_strings_path(), "xl/sharedStrings.xml");
        assert_eq!(XlsxArchive::workbook_path(), "xl/workbook.xml");
        assert_eq!(XlsxArchive::worksheet_path(1), "xl/worksheets/sheet1.xml");
        assert_eq!(XlsxArchive::styles_path(), "xl/styles.xml");
    }

    #[test]
    fn test_crc32_implementation() {
        // Test against known CRC32 values
        assert_eq!(crc32(b""), 0x00000000);
        assert_eq!(crc32(b"123456789"), 0xCBF43926);
    }

    #[test]
    fn test_large_file_name() {
        let long_name = "a".repeat(255);
        let content = b"test content";
        let zip_data = create_test_zip(&long_name, content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let data = archive.read_file(&long_name).expect("Failed to read file");

        assert_eq!(data, content);
    }

    #[test]
    fn test_binary_content() {
        let content: Vec<u8> = (0..256).map(|i| i as u8).collect();
        let zip_data = create_test_zip("binary.bin", &content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let data = archive
            .read_file("binary.bin")
            .expect("Failed to read file");

        assert_eq!(data, content);
    }

    #[test]
    fn test_empty_file() {
        let content = b"";
        let zip_data = create_test_zip("empty.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let data = archive.read_file("empty.txt").expect("Failed to read file");

        assert_eq!(data, content.as_slice());
    }

    #[test]
    fn test_data_accessor() {
        let content = b"test";
        let zip_data = create_test_zip("test.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        assert_eq!(archive.data().len(), zip_data.len());
    }
}

#[cfg(test)]
mod deflate_tests {
    use super::super::constants::{
        CENTRAL_FILE_HEADER_SIGNATURE, COMPRESSION_DEFLATE, END_OF_CENTRAL_DIR_SIGNATURE,
        FLAG_DATA_DESCRIPTOR, LOCAL_FILE_HEADER_SIGNATURE,
    };
    use super::*;

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFFFFFFu32;
        for &byte in data {
            crc ^= byte as u32;
            for _ in 0..8 {
                if crc & 1 != 0 {
                    crc = (crc >> 1) ^ 0xEDB88320;
                } else {
                    crc >>= 1;
                }
            }
        }
        !crc
    }

    // Helper to create a ZIP with DEFLATE compression using miniz_oxide
    fn create_deflate_zip(filename: &str, content: &[u8]) -> Vec<u8> {
        use miniz_oxide::deflate::compress_to_vec;

        // Compress the content using raw deflate
        let compressed = compress_to_vec(content, 6);

        let mut zip = Vec::new();
        let name_bytes = filename.as_bytes();

        // Calculate CRC32
        fn crc32(data: &[u8]) -> u32 {
            let mut crc = 0xFFFFFFFFu32;
            for &byte in data {
                crc ^= byte as u32;
                for _ in 0..8 {
                    if crc & 1 != 0 {
                        crc = (crc >> 1) ^ 0xEDB88320;
                    } else {
                        crc >>= 1;
                    }
                }
            }
            !crc
        }

        let crc = crc32(content);

        // Local file header
        zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&COMPRESSION_DEFLATE.to_le_bytes()); // DEFLATE
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&crc.to_le_bytes());
        zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(name_bytes);
        zip.extend_from_slice(&compressed);

        let local_header_offset = 0usize;
        let cd_offset = zip.len();

        // Central directory
        zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&COMPRESSION_DEFLATE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&crc.to_le_bytes());
        zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u32.to_le_bytes());
        zip.extend_from_slice(&(local_header_offset as u32).to_le_bytes());
        zip.extend_from_slice(name_bytes);

        let cd_size = zip.len() - cd_offset;

        // EOCD
        zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&1u16.to_le_bytes());
        zip.extend_from_slice(&1u16.to_le_bytes());
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
        zip.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());

        zip
    }

    fn create_deflate_zip_with_data_descriptor(filename: &str, content: &[u8]) -> Vec<u8> {
        use miniz_oxide::deflate::compress_to_vec;

        let compressed = compress_to_vec(content, 6);
        let mut zip = Vec::new();
        let name_bytes = filename.as_bytes();
        let crc = crc32(content);
        let flags = FLAG_DATA_DESCRIPTOR;

        // Local file header. When bit 3 is set, CRC and sizes are allowed to
        // be zero here; the central directory remains authoritative.
        zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&flags.to_le_bytes());
        zip.extend_from_slice(&COMPRESSION_DEFLATE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u32.to_le_bytes());
        zip.extend_from_slice(&0u32.to_le_bytes());
        zip.extend_from_slice(&0u32.to_le_bytes());
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(name_bytes);
        zip.extend_from_slice(&compressed);
        zip.extend_from_slice(&crc.to_le_bytes());
        zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes());

        let local_header_offset = 0usize;
        let cd_offset = zip.len();

        // Central directory carries the trusted metadata.
        zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&flags.to_le_bytes());
        zip.extend_from_slice(&COMPRESSION_DEFLATE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&crc.to_le_bytes());
        zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u32.to_le_bytes());
        zip.extend_from_slice(&(local_header_offset as u32).to_le_bytes());
        zip.extend_from_slice(name_bytes);

        let cd_size = zip.len() - cd_offset;

        zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&1u16.to_le_bytes());
        zip.extend_from_slice(&1u16.to_le_bytes());
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
        zip.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());

        zip
    }

    #[test]
    fn test_deflate_decompression() {
        let content =
            b"Hello, this is test content that should compress well! AAAAAAAAAAAAAAAAAAAAAA";
        let zip_data = create_deflate_zip("compressed.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let data = archive
            .read_file("compressed.txt")
            .expect("Failed to read file");

        assert_eq!(data, content);
    }

    #[test]
    fn test_deflate_larger_content() {
        // Create content that compresses well
        let content: Vec<u8> = (0..10000).map(|i| ((i % 26) as u8) + b'a').collect();
        let zip_data = create_deflate_zip("large.txt", &content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let data = archive.read_file("large.txt").expect("Failed to read file");

        assert_eq!(data, content);
    }

    #[test]
    fn test_deflate_data_descriptor_entry() {
        let content = b"deflated content whose local header uses a data descriptor";
        let zip_data = create_deflate_zip_with_data_descriptor("xl/worksheets/sheet1.xml", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let data = archive
            .read_file("xl/worksheets/sheet1.xml")
            .expect("Failed to read descriptor-backed entry");

        assert_eq!(data, content);
    }

    #[test]
    fn test_deflate_read_into_buffer() {
        let content = b"Test content for buffer reading with DEFLATE compression!";
        let zip_data = create_deflate_zip("test.txt", content);

        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");
        let mut buffer = vec![0u8; 1024];
        let bytes_read = archive
            .read_file_into("test.txt", &mut buffer)
            .expect("Failed to read file");

        assert_eq!(bytes_read, content.len());
        assert_eq!(&buffer[..bytes_read], content);
    }

    #[test]
    fn test_verbatim_read_allows_non_utf8_xml_passthrough() {
        let mut utf16_xml = vec![0xff, 0xfe];
        for unit in r#"<?xml version="1.0" encoding="UTF-16"?><r/>"#.encode_utf16() {
            utf16_xml.extend_from_slice(&unit.to_le_bytes());
        }
        let zip_data = create_deflate_zip("customXml/item1.xml", &utf16_xml);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let normal = archive.read_file("customXml/item1.xml");
        assert!(matches!(normal, Err(ZipError::DataCorruptionDetail(_))));

        let raw = archive
            .read_file_verbatim("customXml/item1.xml")
            .expect("verbatim passthrough should skip XML UTF-8 validation");
        assert_eq!(raw, utf16_xml);
    }

    #[test]
    fn test_deflate_declared_size_smaller_than_actual_rejected() {
        let filename = "test.txt";
        let content = b"deflate output is larger than dishonest metadata";
        let mut zip_data = create_deflate_zip(filename, content);
        let cd_sig = CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes();
        let cd_offset = zip_data
            .windows(4)
            .position(|window| window == cd_sig)
            .expect("central directory signature");
        let dishonest_uncompressed = (content.len() as u32 - 1).to_le_bytes();
        zip_data[22..26].copy_from_slice(&dishonest_uncompressed);
        zip_data[cd_offset + 24..cd_offset + 28].copy_from_slice(&dishonest_uncompressed);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let result = archive.read_file(filename);

        assert!(matches!(result, Err(ZipError::DataCorruptionDetail(_))));
    }
}

#[cfg(test)]
mod error_recovery_tests {
    use super::super::constants::{
        CENTRAL_FILE_HEADER_SIGNATURE, COMPRESSION_STORE, END_OF_CENTRAL_DIR_SIGNATURE,
        LOCAL_FILE_HEADER_SIGNATURE,
    };
    use super::*;
    use crate::infra::error::ParseMode;

    // Helper to create a minimal valid ZIP file with a single stored file
    fn create_test_zip(filename: &str, content: &[u8]) -> Vec<u8> {
        let mut zip = Vec::new();
        let name_bytes = filename.as_bytes();

        // Calculate CRC32
        fn crc32(data: &[u8]) -> u32 {
            let mut crc = 0xFFFFFFFFu32;
            for &byte in data {
                crc ^= byte as u32;
                for _ in 0..8 {
                    if crc & 1 != 0 {
                        crc = (crc >> 1) ^ 0xEDB88320;
                    } else {
                        crc >>= 1;
                    }
                }
            }
            !crc
        }

        let crc = crc32(content);

        // Local file header
        zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes()); // version needed
        zip.extend_from_slice(&0u16.to_le_bytes()); // flags
        zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes()); // compression
        zip.extend_from_slice(&0u16.to_le_bytes()); // mod time
        zip.extend_from_slice(&0u16.to_le_bytes()); // mod date
        zip.extend_from_slice(&crc.to_le_bytes()); // CRC-32
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // compressed size
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncompressed size
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes()); // name length
        zip.extend_from_slice(&0u16.to_le_bytes()); // extra length
        zip.extend_from_slice(name_bytes);
        zip.extend_from_slice(content);

        let local_header_offset = 0usize;
        let cd_offset = zip.len();

        // Central directory file header
        zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&20u16.to_le_bytes()); // version made by
        zip.extend_from_slice(&20u16.to_le_bytes()); // version needed
        zip.extend_from_slice(&0u16.to_le_bytes()); // flags
        zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes()); // compression
        zip.extend_from_slice(&0u16.to_le_bytes()); // mod time
        zip.extend_from_slice(&0u16.to_le_bytes()); // mod date
        zip.extend_from_slice(&crc.to_le_bytes()); // CRC-32
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // compressed size
        zip.extend_from_slice(&(content.len() as u32).to_le_bytes()); // uncompressed size
        zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes()); // name length
        zip.extend_from_slice(&0u16.to_le_bytes()); // extra length
        zip.extend_from_slice(&0u16.to_le_bytes()); // comment length
        zip.extend_from_slice(&0u16.to_le_bytes()); // disk number
        zip.extend_from_slice(&0u16.to_le_bytes()); // internal attributes
        zip.extend_from_slice(&0u32.to_le_bytes()); // external attributes
        zip.extend_from_slice(&(local_header_offset as u32).to_le_bytes()); // local header offset
        zip.extend_from_slice(name_bytes);

        let cd_size = zip.len() - cd_offset;

        // End of central directory
        zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes()); // disk number
        zip.extend_from_slice(&0u16.to_le_bytes()); // disk with CD
        zip.extend_from_slice(&1u16.to_le_bytes()); // entries on disk
        zip.extend_from_slice(&1u16.to_le_bytes()); // total entries
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes()); // CD size
        zip.extend_from_slice(&(cd_offset as u32).to_le_bytes()); // CD offset
        zip.extend_from_slice(&0u16.to_le_bytes()); // comment length

        zip
    }

    // Helper to create XLSX-like structure
    fn create_xlsx_like_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = Vec::new();
        let mut entries_info: Vec<(usize, &str, &[u8], u32)> = Vec::new();

        fn crc32(data: &[u8]) -> u32 {
            let mut crc = 0xFFFFFFFFu32;
            for &byte in data {
                crc ^= byte as u32;
                for _ in 0..8 {
                    if crc & 1 != 0 {
                        crc = (crc >> 1) ^ 0xEDB88320;
                    } else {
                        crc >>= 1;
                    }
                }
            }
            !crc
        }

        for (filename, content) in files {
            let local_offset = zip.len();
            let name_bytes = filename.as_bytes();
            let crc = crc32(content);

            zip.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
            zip.extend_from_slice(&20u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&crc.to_le_bytes());
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(name_bytes);
            zip.extend_from_slice(content);

            entries_info.push((local_offset, filename, content, crc));
        }

        let cd_offset = zip.len();

        for (local_offset, filename, content, crc) in &entries_info {
            let name_bytes = filename.as_bytes();

            zip.extend_from_slice(&CENTRAL_FILE_HEADER_SIGNATURE.to_le_bytes());
            zip.extend_from_slice(&20u16.to_le_bytes());
            zip.extend_from_slice(&20u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&COMPRESSION_STORE.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&crc.to_le_bytes());
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(content.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&0u32.to_le_bytes());
            zip.extend_from_slice(&(*local_offset as u32).to_le_bytes());
            zip.extend_from_slice(name_bytes);
        }

        let cd_size = zip.len() - cd_offset;

        zip.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&(entries_info.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(entries_info.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(cd_size as u32).to_le_bytes());
        zip.extend_from_slice(&(cd_offset as u32).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());

        zip
    }

    #[test]
    fn test_get_shared_strings_or_empty_missing() {
        let files: &[(&str, &[u8])] = &[
            ("xl/workbook.xml", b"<workbook/>"),
            ("xl/worksheets/sheet1.xml", b"<worksheet/>"),
        ];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::lenient();
        let data = archive.get_shared_strings_or_empty(&mut ctx);

        assert!(data.is_empty());
        assert!(ctx.warning_count() > 0);

        // Check it logged the right warning
        let has_warning = ctx
            .errors()
            .iter()
            .any(|e| e.code == ErrorCode::MissingPart && e.message.contains("sharedStrings"));
        assert!(has_warning);
    }

    #[test]
    fn test_get_shared_strings_or_empty_present() {
        let files: &[(&str, &[u8])] = &[("xl/sharedStrings.xml", b"<sst/>")];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::lenient();
        let data = archive.get_shared_strings_or_empty(&mut ctx);

        assert_eq!(data, b"<sst/>");
        assert_eq!(ctx.warning_count(), 0);
    }

    #[test]
    fn test_get_worksheet_or_empty_missing() {
        let files: &[(&str, &[u8])] = &[("xl/workbook.xml", b"<workbook/>")];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::lenient();
        let data = archive.get_worksheet_or_empty(1, &mut ctx);

        assert!(data.is_empty());
        assert!(ctx.error_count() > 0);
    }

    #[test]
    fn test_get_worksheet_or_empty_present() {
        let files: &[(&str, &[u8])] = &[("xl/worksheets/sheet1.xml", b"<worksheet/>")];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::lenient();
        let data = archive.get_worksheet_or_empty(1, &mut ctx);

        assert_eq!(data, b"<worksheet/>");
        assert_eq!(ctx.error_count(), 0);
    }

    #[test]
    fn test_read_file_with_recovery_missing_file() {
        let files: &[(&str, &[u8])] = &[("existing.txt", b"content")];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::lenient();
        let data = archive.read_file_with_recovery("nonexistent.txt", &mut ctx);

        assert!(data.is_empty());
        assert!(ctx.error_count() > 0);
    }

    #[test]
    fn test_read_file_with_recovery_valid_file() {
        let content = b"test content";
        let zip_data = create_test_zip("test.txt", content);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::lenient();
        let data = archive.read_file_with_recovery("test.txt", &mut ctx);

        assert_eq!(data, content);
        assert_eq!(ctx.error_count(), 0);
    }

    #[test]
    fn test_get_styles_or_empty_missing() {
        let files: &[(&str, &[u8])] = &[("xl/workbook.xml", b"<workbook/>")];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::lenient();
        let data = archive.get_styles_or_empty(&mut ctx);

        assert!(data.is_empty());
        assert!(ctx.warning_count() > 0);
    }

    #[test]
    fn test_get_workbook_or_empty_missing() {
        let files: &[(&str, &[u8])] = &[("xl/worksheets/sheet1.xml", b"<worksheet/>")];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::lenient();
        let data = archive.get_workbook_or_empty(&mut ctx);

        assert!(data.is_empty());
        assert!(ctx.error_count() > 0);
    }

    #[test]
    fn test_strict_mode_fails_on_missing_file() {
        let files: &[(&str, &[u8])] = &[("existing.txt", b"content")];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::strict();
        let data = archive.read_file_with_recovery("nonexistent.txt", &mut ctx);

        assert!(data.is_empty());
        assert!(ctx.should_stop());
    }

    #[test]
    fn test_permissive_mode_recovers() {
        let files: &[(&str, &[u8])] = &[("existing.txt", b"content")];

        let zip_data = create_xlsx_like_zip(files);
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        let mut ctx = ParseContext::permissive();
        let data = archive.read_file_with_recovery("nonexistent.txt", &mut ctx);

        assert!(data.is_empty());
        // Permissive mode should still log the error but not stop
        assert!(!ctx.should_stop());
    }

    #[test]
    fn test_crc_safety_failure_is_fatal_in_all_parse_modes() {
        let mut zip_data = create_test_zip("test.txt", b"content");
        let data_offset = 30 + "test.txt".len();
        zip_data[data_offset] ^= 0xff;
        let archive = XlsxArchive::new(&zip_data).expect("Failed to parse ZIP");

        for mode in [ParseMode::Strict, ParseMode::Lenient, ParseMode::Permissive] {
            let mut ctx = ParseContext::new(mode);
            let data = archive.read_file_with_recovery("test.txt", &mut ctx);
            assert!(data.is_empty());
            assert!(
                ctx.should_stop(),
                "mode {mode:?} must stop on CRC safety failure"
            );
            assert!(
                ctx.errors()
                    .iter()
                    .any(|e| e.code == ErrorCode::DataCorruption)
            );
        }
    }
}
