//! XLSX archive reader
//!
//! XLSX files are ZIP archives containing XML files. This module provides
//! the main `XlsxArchive` struct for reading files from the archive.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use super::central_dir::{find_eocd, parse_central_directory, parse_eocd};
use super::constants::{MAX_RELATIONSHIP_PARTS, MIN_EOCD_SIZE};
use super::entry::ZipEntry;
use super::error::ZipError;

const OLE_CFB_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

mod paths;
mod read;
mod recovery;
mod streaming;
mod validation;

#[cfg(test)]
mod deflate_tests;
#[cfg(test)]
mod recovery_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
use self::validation::count_relationship_elements;

pub fn is_encrypted_office_package(data: &[u8]) -> bool {
    data.starts_with(&OLE_CFB_MAGIC)
}

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
        if is_encrypted_office_package(data) {
            return Err(ZipError::UnsupportedFeature(
                "Encrypted XLSX files are not supported".to_string(),
            ));
        }

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
}
