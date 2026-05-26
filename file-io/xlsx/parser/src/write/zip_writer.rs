//! ZIP archive writer for XLSX files
//!
//! This module provides a ZIP archive writer with configurable compression,
//! designed for creating XLSX files. It supports both STORE (no compression)
//! and DEFLATE compression with configurable levels.
//!
//! # ZIP Format
//!
//! Per PKWARE APPNOTE, a ZIP archive has this structure:
//! ```text
//! [Local File Header 1]
//! [File Data 1]
//! [Local File Header 2]
//! [File Data 2]
//! ...
//! [Central Directory Header 1]
//! [Central Directory Header 2]
//! ...
//! [End of Central Directory Record]
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! use xlsx_parser::write::{ZipWriter, CompressionMethod};
//!
//! let xlsx_bytes = ZipWriter::with_compression(CompressionMethod::Deflate(6))
//!     .add_file("[Content_Types].xml", content_types_xml)
//!     .add_file("_rels/.rels", rels_xml)
//!     .add_file("xl/workbook.xml", workbook_xml)
//!     .finish()?;
//! ```

use crc32fast::Hasher;
use miniz_oxide::deflate::compress_to_vec;

#[cfg(feature = "parallel")]
use rayon::prelude::*;

// ZIP file format constants
const LOCAL_FILE_HEADER_SIGNATURE: u32 = 0x04034b50;
const CENTRAL_DIR_HEADER_SIGNATURE: u32 = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE: u32 = 0x06054b50;

// Compression method constants
const COMPRESSION_STORE: u16 = 0;
const COMPRESSION_DEFLATE: u16 = 8;

// Version constants
const VERSION_NEEDED_STORE: u16 = 10; // Version 1.0 for stored files
const VERSION_NEEDED_DEFLATE: u16 = 20; // Version 2.0 for deflate
const VERSION_MADE_BY: u16 = 0x031E; // Unix, version 3.0

// Size limits
const MAX_FILE_SIZE: usize = 0xFFFFFFFF; // 4GB limit for standard ZIP
const MAX_FILENAME_LENGTH: usize = 65535;

/// Compression method for ZIP entries
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompressionMethod {
    /// No compression - fastest, largest files
    Store,
    /// DEFLATE compression with level 0-9 (0=fastest, 9=best compression)
    Deflate(u8),
}

impl Default for CompressionMethod {
    fn default() -> Self {
        CompressionMethod::Deflate(6)
    }
}

impl CompressionMethod {
    /// Get the ZIP compression method code
    fn method_code(&self) -> u16 {
        match self {
            CompressionMethod::Store => COMPRESSION_STORE,
            CompressionMethod::Deflate(_) => COMPRESSION_DEFLATE,
        }
    }

    /// Get the minimum version needed to extract
    fn version_needed(&self) -> u16 {
        match self {
            CompressionMethod::Store => VERSION_NEEDED_STORE,
            CompressionMethod::Deflate(_) => VERSION_NEEDED_DEFLATE,
        }
    }
}

/// Error types for ZIP write operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZipWriteError {
    /// Compression operation failed
    CompressionFailed,
    /// File exceeds the 4GB limit for standard ZIP
    FileTooLarge,
    /// Filename is invalid (empty, too long, or contains invalid characters)
    InvalidFilename,
    /// Archive would exceed 4GB
    ArchiveTooLarge,
    /// Too many entries (exceeds 65535 for standard ZIP)
    TooManyEntries,
}

impl std::fmt::Display for ZipWriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ZipWriteError::CompressionFailed => write!(f, "Compression failed"),
            ZipWriteError::FileTooLarge => write!(f, "File exceeds 4GB limit"),
            ZipWriteError::InvalidFilename => write!(f, "Invalid filename"),
            ZipWriteError::ArchiveTooLarge => write!(f, "Archive would exceed 4GB"),
            ZipWriteError::TooManyEntries => write!(f, "Too many entries (max 65535)"),
        }
    }
}

impl std::error::Error for ZipWriteError {}

/// A single entry to be written to the ZIP archive
#[derive(Debug, Clone)]
pub struct ZipWriteEntry {
    /// File name (path within the archive)
    pub name: String,
    /// File data (uncompressed)
    pub data: Vec<u8>,
    /// Compression method for this entry
    pub method: CompressionMethod,
}

impl ZipWriteEntry {
    /// Create a new ZIP entry
    pub fn new(name: impl Into<String>, data: Vec<u8>, method: CompressionMethod) -> Self {
        Self {
            name: name.into(),
            data,
            method,
        }
    }
}

/// Internal structure for tracking written entries
#[derive(Debug)]
struct WrittenEntry {
    /// Original filename
    name: String,
    /// Offset to local file header in the archive
    local_header_offset: u32,
    /// CRC32 of uncompressed data
    crc32: u32,
    /// Size of compressed data
    compressed_size: u32,
    /// Size of uncompressed data
    uncompressed_size: u32,
    /// Compression method used
    method: CompressionMethod,
}

/// ZIP archive writer with configurable compression
///
/// Builds a ZIP archive in memory with support for STORE and DEFLATE compression.
/// Files are written in the order they are added, which is important for XLSX
/// files where `[Content_Types].xml` should typically come first.
#[derive(Debug)]
pub struct ZipWriter {
    /// Entries to be written
    entries: Vec<ZipWriteEntry>,
    /// Default compression method for new entries
    default_method: CompressionMethod,
}

impl Default for ZipWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl ZipWriter {
    /// Create a new ZIP writer with default compression (DEFLATE level 6)
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            default_method: CompressionMethod::default(),
        }
    }

    /// Create a new ZIP writer with the specified compression method
    pub fn with_compression(method: CompressionMethod) -> Self {
        Self {
            entries: Vec::new(),
            default_method: method,
        }
    }

    /// Add a file to the archive using the default compression method
    ///
    /// # Arguments
    /// * `name` - Path within the archive (e.g., "xl/workbook.xml")
    /// * `data` - File contents (uncompressed)
    ///
    /// # Returns
    /// Self for method chaining
    pub fn add_file(&mut self, name: &str, data: Vec<u8>) -> &mut Self {
        self.entries.push(ZipWriteEntry::new(
            name.to_string(),
            data,
            self.default_method,
        ));
        self
    }

    /// Add a file with a specific compression method
    ///
    /// # Arguments
    /// * `name` - Path within the archive
    /// * `data` - File contents (uncompressed)
    /// * `method` - Compression method to use for this file
    ///
    /// # Returns
    /// Self for method chaining
    pub fn add_file_with(
        &mut self,
        name: &str,
        data: Vec<u8>,
        method: CompressionMethod,
    ) -> &mut Self {
        self.entries
            .push(ZipWriteEntry::new(name.to_string(), data, method));
        self
    }

    /// Add multiple files at once using the default compression method
    ///
    /// # Arguments
    /// * `files` - Iterator of (name, data) pairs
    ///
    /// # Returns
    /// Self for method chaining
    pub fn add_files(&mut self, files: impl IntoIterator<Item = (String, Vec<u8>)>) -> &mut Self {
        for (name, data) in files {
            self.entries
                .push(ZipWriteEntry::new(name, data, self.default_method));
        }
        self
    }

    /// Get the number of entries in the archive
    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    /// Finalize the archive and return the ZIP bytes
    ///
    /// This writes:
    /// 1. Local file headers and compressed data for each entry
    /// 2. Central directory headers for each entry
    /// 3. End of central directory record
    ///
    /// # Returns
    /// * `Ok(Vec<u8>)` - The complete ZIP archive bytes
    /// * `Err(ZipWriteError)` - If any error occurs during writing
    pub fn finish(self) -> Result<Vec<u8>, ZipWriteError> {
        // Deduplicate entries: if the same path appears multiple times (e.g., from both
        // structured writes and binary passthrough), keep only the FIRST occurrence.
        // The structured pipeline writes first, then binary passthrough — so first wins
        // means structured output takes priority over passthrough.
        let entries = {
            let mut seen = std::collections::HashSet::with_capacity(self.entries.len());
            let mut deduped = Vec::with_capacity(self.entries.len());
            for entry in self.entries {
                if seen.insert(entry.name.clone()) {
                    deduped.push(entry);
                }
            }
            deduped
        };

        // Validate entry count
        if entries.len() > u16::MAX as usize {
            return Err(ZipWriteError::TooManyEntries);
        }

        #[cfg(feature = "parallel")]
        {
            finish_parallel(entries)
        }
        #[cfg(not(feature = "parallel"))]
        {
            finish_sequential(entries)
        }
    }
}

/// Sequential finish — compresses and writes entries one at a time.
fn finish_sequential(entries: Vec<ZipWriteEntry>) -> Result<Vec<u8>, ZipWriteError> {
    let estimated_size: usize = entries
        .iter()
        .map(|e| e.data.len() + e.name.len() + 76)
        .sum();
    let mut output = Vec::with_capacity(estimated_size);
    let mut written_entries: Vec<WrittenEntry> = Vec::with_capacity(entries.len());

    for entry in entries {
        let written = write_entry(&mut output, entry)?;
        written_entries.push(written);
    }

    assemble_central_directory(&mut output, &written_entries)
}

/// Parallel finish — compresses all entries concurrently using rayon,
/// then assembles the archive sequentially.
#[cfg(feature = "parallel")]
fn finish_parallel(entries: Vec<ZipWriteEntry>) -> Result<Vec<u8>, ZipWriteError> {
    // Step 1: compress all entries in parallel (CRC32 + deflate).
    let compressed: Vec<CompressedEntry> = entries
        .into_par_iter()
        .map(|entry| compress_entry(entry))
        .collect::<Result<Vec<_>, _>>()?;

    // Step 2: assemble the ZIP archive sequentially (headers need offsets).
    let estimated_size: usize = compressed
        .iter()
        .map(|e| e.compressed_data.len() + e.name.len() + 76)
        .sum();
    let mut output = Vec::with_capacity(estimated_size);
    let mut written_entries: Vec<WrittenEntry> = Vec::with_capacity(compressed.len());

    let dos_time: u16 = 0;
    let dos_date: u16 = (2024 - 1980) << 9 | 1 << 5 | 1;

    for entry in compressed {
        let local_header_offset = output.len();
        #[allow(clippy::absurd_extreme_comparisons)]
        if local_header_offset > MAX_FILE_SIZE {
            return Err(ZipWriteError::ArchiveTooLarge);
        }

        let name_bytes = entry.name.as_bytes();

        // Write local file header
        output.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        output.extend_from_slice(&entry.actual_method.version_needed().to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(&entry.actual_method.method_code().to_le_bytes());
        output.extend_from_slice(&dos_time.to_le_bytes());
        output.extend_from_slice(&dos_date.to_le_bytes());
        output.extend_from_slice(&entry.crc32.to_le_bytes());
        output.extend_from_slice(&entry.compressed_size.to_le_bytes());
        output.extend_from_slice(&entry.uncompressed_size.to_le_bytes());
        output.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        output.extend_from_slice(&0u16.to_le_bytes());
        output.extend_from_slice(name_bytes);
        output.extend_from_slice(&entry.compressed_data);

        written_entries.push(WrittenEntry {
            name: entry.name,
            local_header_offset: local_header_offset as u32,
            crc32: entry.crc32,
            compressed_size: entry.compressed_size,
            uncompressed_size: entry.uncompressed_size,
            method: entry.actual_method,
        });
    }

    assemble_central_directory(&mut output, &written_entries)
}

/// Assemble the central directory and EOCD record at the end of the archive.
fn assemble_central_directory(
    output: &mut Vec<u8>,
    written_entries: &[WrittenEntry],
) -> Result<Vec<u8>, ZipWriteError> {
    let central_dir_offset = output.len();
    #[allow(clippy::absurd_extreme_comparisons)]
    if central_dir_offset > MAX_FILE_SIZE {
        return Err(ZipWriteError::ArchiveTooLarge);
    }

    for entry in written_entries {
        write_central_dir_header(output, entry)?;
    }

    let central_dir_size = output.len() - central_dir_offset;
    #[allow(clippy::absurd_extreme_comparisons)]
    if central_dir_size > MAX_FILE_SIZE {
        return Err(ZipWriteError::ArchiveTooLarge);
    }

    write_eocd(
        output,
        written_entries.len() as u16,
        central_dir_size as u32,
        central_dir_offset as u32,
    );

    Ok(std::mem::take(output))
}

/// Pre-compressed entry — result of parallel compression, ready for sequential assembly.
#[cfg(feature = "parallel")]
struct CompressedEntry {
    name: String,
    crc32: u32,
    compressed_size: u32,
    uncompressed_size: u32,
    compressed_data: Vec<u8>,
    actual_method: CompressionMethod,
}

/// Compress a single ZIP entry (CRC32 + deflate). Pure function, no shared state.
#[cfg(feature = "parallel")]
fn compress_entry(entry: ZipWriteEntry) -> Result<CompressedEntry, ZipWriteError> {
    if entry.name.is_empty() || entry.name.len() > MAX_FILENAME_LENGTH {
        return Err(ZipWriteError::InvalidFilename);
    }
    #[allow(clippy::absurd_extreme_comparisons)]
    if entry.data.len() > MAX_FILE_SIZE {
        return Err(ZipWriteError::FileTooLarge);
    }

    let crc32 = calculate_crc32(&entry.data);
    let uncompressed_size = entry.data.len() as u32;

    let (compressed_data, compressed_size, actual_method) = match entry.method {
        CompressionMethod::Store => (entry.data, uncompressed_size, CompressionMethod::Store),
        CompressionMethod::Deflate(level) => {
            let compressed = compress_to_vec(&entry.data, level.min(10));
            if compressed.len() < entry.data.len() {
                let size = compressed.len() as u32;
                (compressed, size, entry.method)
            } else {
                (entry.data, uncompressed_size, CompressionMethod::Store)
            }
        }
    };

    Ok(CompressedEntry {
        name: entry.name,
        crc32,
        compressed_size,
        uncompressed_size,
        compressed_data,
        actual_method,
    })
}

/// Write a single entry (local file header + data) to the output
fn write_entry(output: &mut Vec<u8>, entry: ZipWriteEntry) -> Result<WrittenEntry, ZipWriteError> {
    // Validate filename
    if entry.name.is_empty() || entry.name.len() > MAX_FILENAME_LENGTH {
        return Err(ZipWriteError::InvalidFilename);
    }

    // Validate file size (4GB limit for standard ZIP format)
    // Note: On 64-bit platforms where usize > 32 bits, we need this check
    // even though it may always be false on 32-bit platforms
    #[allow(clippy::absurd_extreme_comparisons)]
    if entry.data.len() > MAX_FILE_SIZE {
        return Err(ZipWriteError::FileTooLarge);
    }

    // Calculate CRC32 of uncompressed data
    let crc32 = calculate_crc32(&entry.data);
    let uncompressed_size = entry.data.len() as u32;

    // Compress data if using DEFLATE
    let (compressed_data, actual_method) = match entry.method {
        CompressionMethod::Store => (entry.data, CompressionMethod::Store),
        CompressionMethod::Deflate(level) => {
            let compressed = compress_to_vec(&entry.data, level.min(10));
            // Only use compression if it actually saves space
            if compressed.len() < entry.data.len() {
                (compressed, entry.method)
            } else {
                // Fall back to store if compression doesn't help
                (entry.data, CompressionMethod::Store)
            }
        }
    };
    let compressed_size = compressed_data.len() as u32;

    // Record local header offset (4GB limit for standard ZIP format)
    let local_header_offset = output.len();
    #[allow(clippy::absurd_extreme_comparisons)]
    if local_header_offset > MAX_FILE_SIZE {
        return Err(ZipWriteError::ArchiveTooLarge);
    }

    // Get DOS date/time (use a fixed value for reproducibility)
    // This represents 2024-01-01 00:00:00
    let dos_time: u16 = 0; // 00:00:00
    let dos_date: u16 = (2024 - 1980) << 9 | 1 << 5 | 1; // 2024-01-01

    let name_bytes = entry.name.as_bytes();

    // Write local file header (30 bytes + filename)
    output.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
    output.extend_from_slice(&actual_method.version_needed().to_le_bytes());
    output.extend_from_slice(&0u16.to_le_bytes()); // General purpose bit flag
    output.extend_from_slice(&actual_method.method_code().to_le_bytes());
    output.extend_from_slice(&dos_time.to_le_bytes());
    output.extend_from_slice(&dos_date.to_le_bytes());
    output.extend_from_slice(&crc32.to_le_bytes());
    output.extend_from_slice(&compressed_size.to_le_bytes());
    output.extend_from_slice(&uncompressed_size.to_le_bytes());
    output.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    output.extend_from_slice(&0u16.to_le_bytes()); // Extra field length
    output.extend_from_slice(name_bytes);

    // Write file data
    output.extend_from_slice(&compressed_data);

    Ok(WrittenEntry {
        name: entry.name,
        local_header_offset: local_header_offset as u32,
        crc32,
        compressed_size,
        uncompressed_size,
        method: actual_method,
    })
}

/// Write a central directory header for an entry
fn write_central_dir_header(
    output: &mut Vec<u8>,
    entry: &WrittenEntry,
) -> Result<(), ZipWriteError> {
    let name_bytes = entry.name.as_bytes();

    // Get DOS date/time (same as local header)
    let dos_time: u16 = 0;
    let dos_date: u16 = (2024 - 1980) << 9 | 1 << 5 | 1;

    // External file attributes (Unix permissions: 0644 regular file)
    let external_attrs: u32 = 0o100644_u32 << 16;

    // Write central directory file header (46 bytes + filename)
    output.extend_from_slice(&CENTRAL_DIR_HEADER_SIGNATURE.to_le_bytes());
    output.extend_from_slice(&VERSION_MADE_BY.to_le_bytes());
    output.extend_from_slice(&entry.method.version_needed().to_le_bytes());
    output.extend_from_slice(&0u16.to_le_bytes()); // General purpose bit flag
    output.extend_from_slice(&entry.method.method_code().to_le_bytes());
    output.extend_from_slice(&dos_time.to_le_bytes());
    output.extend_from_slice(&dos_date.to_le_bytes());
    output.extend_from_slice(&entry.crc32.to_le_bytes());
    output.extend_from_slice(&entry.compressed_size.to_le_bytes());
    output.extend_from_slice(&entry.uncompressed_size.to_le_bytes());
    output.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
    output.extend_from_slice(&0u16.to_le_bytes()); // Extra field length
    output.extend_from_slice(&0u16.to_le_bytes()); // File comment length
    output.extend_from_slice(&0u16.to_le_bytes()); // Disk number start
    output.extend_from_slice(&0u16.to_le_bytes()); // Internal file attributes
    output.extend_from_slice(&external_attrs.to_le_bytes());
    output.extend_from_slice(&entry.local_header_offset.to_le_bytes());
    output.extend_from_slice(name_bytes);

    Ok(())
}

/// Write the end of central directory record
fn write_eocd(output: &mut Vec<u8>, entry_count: u16, cd_size: u32, cd_offset: u32) {
    // End of central directory record (22 bytes)
    output.extend_from_slice(&END_OF_CENTRAL_DIR_SIGNATURE.to_le_bytes());
    output.extend_from_slice(&0u16.to_le_bytes()); // Disk number
    output.extend_from_slice(&0u16.to_le_bytes()); // Disk with central directory
    output.extend_from_slice(&entry_count.to_le_bytes()); // Entries on this disk
    output.extend_from_slice(&entry_count.to_le_bytes()); // Total entries
    output.extend_from_slice(&cd_size.to_le_bytes()); // Central directory size
    output.extend_from_slice(&cd_offset.to_le_bytes()); // Central directory offset
    output.extend_from_slice(&0u16.to_le_bytes()); // ZIP comment length
}

/// Calculate CRC32 checksum using crc32fast
fn calculate_crc32(data: &[u8]) -> u32 {
    let mut hasher = Hasher::new();
    hasher.update(data);
    hasher.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip::XlsxArchive;

    #[test]
    fn test_single_file_store() {
        let content = b"Hello, World!";
        let mut writer = ZipWriter::with_compression(CompressionMethod::Store);
        writer.add_file("test.txt", content.to_vec());
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        // Verify we can read it back
        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        assert_eq!(archive.entries().len(), 1);
        assert_eq!(archive.entries()[0].name, "test.txt");

        let data = archive.read_file("test.txt").expect("Failed to read file");
        assert_eq!(data, content);
    }

    #[test]
    fn test_single_file_deflate() {
        let content = b"Hello, World! This is some test content that should compress well. AAAAAAAAAAAAAAAAAAAAAA";
        let mut writer = ZipWriter::with_compression(CompressionMethod::Deflate(6));
        writer.add_file("test.txt", content.to_vec());
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        // Verify we can read it back
        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        let data = archive.read_file("test.txt").expect("Failed to read file");
        assert_eq!(data, content);

        // Verify compression actually reduced size
        assert!(zip_bytes.len() < content.len() + 100);
    }

    #[test]
    fn test_multiple_files() {
        let files = vec![
            ("file1.txt", b"Content 1".to_vec()),
            ("file2.txt", b"Content 2".to_vec()),
            ("dir/file3.txt", b"Content 3 in a directory".to_vec()),
        ];

        let mut writer = ZipWriter::new();
        for (name, data) in &files {
            writer.add_file(name, data.clone());
        }
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        assert_eq!(archive.entries().len(), 3);

        for (name, expected_content) in &files {
            let data = archive.read_file(name).expect("Failed to read file");
            assert_eq!(data, *expected_content);
        }
    }

    #[test]
    fn test_mixed_compression() {
        // Some files compressed, some stored
        let mut writer = ZipWriter::new();
        writer.add_file_with(
            "stored.txt",
            b"Small file".to_vec(),
            CompressionMethod::Store,
        );
        writer.add_file_with(
            "compressed.txt",
            b"This is a larger file with more content that benefits from compression. AAAAAAAAAAAAAAAA".to_vec(),
            CompressionMethod::Deflate(9),
        );

        let zip_bytes = writer.finish().expect("Failed to create ZIP");
        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");

        // Check compression methods
        let stored_entry = archive.find_entry("stored.txt").expect("Entry not found");
        assert_eq!(stored_entry.compression_method, 0); // STORE

        // Read both files
        let stored_data = archive
            .read_file("stored.txt")
            .expect("Failed to read stored file");
        let compressed_data = archive
            .read_file("compressed.txt")
            .expect("Failed to read compressed file");

        assert_eq!(stored_data, b"Small file");
        // Verify the compressed data matches original content
        assert_eq!(
            compressed_data,
            b"This is a larger file with more content that benefits from compression. AAAAAAAAAAAAAAAA"
        );
    }

    #[test]
    fn test_add_files_batch() {
        let files: Vec<(String, Vec<u8>)> = vec![
            ("a.txt".to_string(), b"A".to_vec()),
            ("b.txt".to_string(), b"B".to_vec()),
            ("c.txt".to_string(), b"C".to_vec()),
        ];

        let mut writer = ZipWriter::new();
        writer.add_files(files);
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        assert_eq!(archive.entries().len(), 3);
    }

    #[test]
    fn test_crc32_verification() {
        // Create a file and verify CRC32 is correct
        let content = b"Test data for CRC32 verification";
        let mut writer = ZipWriter::with_compression(CompressionMethod::Store);
        writer.add_file("test.txt", content.to_vec());
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        let entry = archive.find_entry("test.txt").expect("Entry not found");

        // Calculate expected CRC32
        let expected_crc = calculate_crc32(content);
        assert_eq!(entry.crc32, expected_crc);
    }

    #[test]
    fn test_empty_file() {
        let mut writer = ZipWriter::new();
        writer.add_file("empty.txt", vec![]);
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        let data = archive.read_file("empty.txt").expect("Failed to read file");
        assert!(data.is_empty());
    }

    #[test]
    fn test_large_file() {
        // Create a 1MB file with repetitive data (compresses well)
        let large_content: Vec<u8> = (0..1_000_000).map(|i| (i % 256) as u8).collect();

        let mut writer = ZipWriter::with_compression(CompressionMethod::Deflate(6));
        writer.add_file("large.bin", large_content.clone());
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        // Verify we can read it back
        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        let data = archive.read_file("large.bin").expect("Failed to read file");
        assert_eq!(data.len(), large_content.len());
        assert_eq!(data, large_content);

        // Verify compression was effective
        assert!(zip_bytes.len() < large_content.len() / 2);
    }

    #[test]
    fn test_invalid_filename_empty() {
        let mut writer = ZipWriter::new();
        writer.add_file("", vec![1, 2, 3]);
        let result = writer.finish();
        assert!(matches!(result, Err(ZipWriteError::InvalidFilename)));
    }

    #[test]
    fn test_xlsx_structure() {
        // Create a minimal XLSX-like structure
        let content_types = br#"<?xml version="1.0" encoding="UTF-8"?><Types/>"#;
        let rels = br#"<?xml version="1.0" encoding="UTF-8"?><Relationships/>"#;
        let workbook = br#"<?xml version="1.0" encoding="UTF-8"?><workbook/>"#;
        let sheet1 = br#"<?xml version="1.0" encoding="UTF-8"?><worksheet/>"#;
        let styles = br#"<?xml version="1.0" encoding="UTF-8"?><styleSheet/>"#;

        let mut writer = ZipWriter::with_compression(CompressionMethod::Deflate(6));
        writer.add_file("[Content_Types].xml", content_types.to_vec());
        writer.add_file("_rels/.rels", rels.to_vec());
        writer.add_file("xl/workbook.xml", workbook.to_vec());
        writer.add_file("xl/worksheets/sheet1.xml", sheet1.to_vec());
        writer.add_file("xl/styles.xml", styles.to_vec());
        let zip_bytes = writer.finish().expect("Failed to create XLSX");

        // Verify structure using XlsxArchive
        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse XLSX");

        assert!(archive.contains("[Content_Types].xml"));
        assert!(archive.contains("_rels/.rels"));
        assert!(archive.contains("xl/workbook.xml"));
        assert!(archive.contains("xl/worksheets/sheet1.xml"));
        assert!(archive.contains("xl/styles.xml"));

        // Test XLSX convenience methods
        assert!(archive.get_content_types().is_ok());
        assert!(archive.get_workbook().is_ok());
        assert!(archive.get_worksheet(1).is_ok());
        assert!(archive.get_styles().is_ok());
    }

    #[test]
    fn test_compression_levels() {
        let content: Vec<u8> = (0..10000).map(|i| b"Hello, World! "[i % 14]).collect();

        // Test different compression levels
        let sizes: Vec<usize> = (0..=9)
            .map(|level| {
                let mut writer = ZipWriter::with_compression(CompressionMethod::Deflate(level));
                writer.add_file("test.txt", content.clone());
                writer.finish().expect("Failed to create ZIP").len()
            })
            .collect();

        // Higher levels should generally produce smaller or equal sizes
        // (with some variance due to compression algorithm characteristics)
        for i in 1..sizes.len() {
            // Allow some tolerance - higher levels shouldn't be much larger
            assert!(
                sizes[i] <= sizes[0] + 100,
                "Level {} produced larger output than level 0",
                i
            );
        }
    }

    #[test]
    fn test_binary_content() {
        // Test with random binary data
        let binary_data: Vec<u8> = (0..256).map(|i| i as u8).collect();

        let mut writer = ZipWriter::new();
        writer.add_file("binary.bin", binary_data.clone());
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        let data = archive
            .read_file("binary.bin")
            .expect("Failed to read file");
        assert_eq!(data, binary_data);
    }

    #[test]
    fn test_special_characters_in_filename() {
        let filenames = vec![
            "file with spaces.txt",
            "file-with-dashes.txt",
            "file_with_underscores.txt",
            "dir/subdir/nested.txt",
        ];

        let mut writer = ZipWriter::new();
        for name in &filenames {
            writer.add_file(name, b"content".to_vec());
        }
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        for name in &filenames {
            assert!(archive.contains(name), "File not found: {}", name);
        }
    }

    #[test]
    fn test_entry_count() {
        let mut writer = ZipWriter::new();
        assert_eq!(writer.entry_count(), 0);

        writer.add_file("a.txt", vec![]);
        assert_eq!(writer.entry_count(), 1);

        writer.add_file("b.txt", vec![]);
        assert_eq!(writer.entry_count(), 2);
    }

    #[test]
    fn test_default_writer() {
        let writer = ZipWriter::default();
        let zip_bytes = writer.finish().expect("Failed to create empty ZIP");

        // Empty ZIP has just the End of Central Directory record (22 bytes)
        // Note: XlsxArchive expects at least one local file header (PK\x03\x04),
        // so empty ZIP won't be parseable as XLSX. That's fine - XLSX files
        // always have content.
        assert_eq!(zip_bytes.len(), 22); // EOCD is 22 bytes

        // Verify it has EOCD signature
        assert_eq!(&zip_bytes[0..4], &[0x50, 0x4b, 0x05, 0x06]); // PK\x05\x06 = EOCD
    }

    #[test]
    fn test_compression_method_default() {
        assert_eq!(CompressionMethod::default(), CompressionMethod::Deflate(6));
    }

    #[test]
    fn test_compression_fallback_when_not_beneficial() {
        // Random data that doesn't compress well
        let random_data: Vec<u8> = (0..100).map(|i| ((i * 17 + 31) % 256) as u8).collect();

        // Even with deflate, should fall back to store if compression doesn't help
        let mut writer = ZipWriter::with_compression(CompressionMethod::Deflate(9));
        writer.add_file("random.bin", random_data.clone());
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");
        let data = archive
            .read_file("random.bin")
            .expect("Failed to read file");
        assert_eq!(data, random_data);
    }

    #[test]
    fn test_zip_write_error_display() {
        assert_eq!(
            format!("{}", ZipWriteError::CompressionFailed),
            "Compression failed"
        );
        assert_eq!(
            format!("{}", ZipWriteError::FileTooLarge),
            "File exceeds 4GB limit"
        );
        assert_eq!(
            format!("{}", ZipWriteError::InvalidFilename),
            "Invalid filename"
        );
        assert_eq!(
            format!("{}", ZipWriteError::ArchiveTooLarge),
            "Archive would exceed 4GB"
        );
        assert_eq!(
            format!("{}", ZipWriteError::TooManyEntries),
            "Too many entries (max 65535)"
        );
    }

    #[test]
    fn test_roundtrip_with_reader() {
        // Comprehensive test: create ZIP with writer, read with existing reader
        let files = vec![
            ("[Content_Types].xml", "XML content types data here"),
            ("_rels/.rels", "Relationships data"),
            ("xl/workbook.xml", "Workbook XML content"),
            ("xl/styles.xml", "Styles definition"),
            ("xl/sharedStrings.xml", "Shared strings table"),
            ("xl/worksheets/sheet1.xml", "Sheet 1 data"),
            ("xl/worksheets/sheet2.xml", "Sheet 2 data"),
        ];

        let mut writer = ZipWriter::with_compression(CompressionMethod::Deflate(6));
        for (name, content) in &files {
            writer.add_file(name, content.as_bytes().to_vec());
        }
        let zip_bytes = writer.finish().expect("Failed to create ZIP");

        // Read back with XlsxArchive
        let archive = XlsxArchive::new(&zip_bytes).expect("Failed to parse ZIP");

        // Verify all files
        for (name, expected_content) in &files {
            let data = archive
                .read_file(name)
                .expect(&format!("Failed to read {}", name));
            assert_eq!(
                String::from_utf8_lossy(&data),
                *expected_content,
                "Content mismatch for {}",
                name
            );
        }

        // Verify XLSX convenience methods work
        assert_eq!(archive.worksheet_count(), 2);
        let worksheet_names = archive.worksheet_names();
        assert!(worksheet_names.contains(&"sheet1.xml"));
        assert!(worksheet_names.contains(&"sheet2.xml"));
    }

    #[test]
    fn test_zip_write_entry_new() {
        let entry = ZipWriteEntry::new("test.txt", b"content".to_vec(), CompressionMethod::Store);
        assert_eq!(entry.name, "test.txt");
        assert_eq!(entry.data, b"content");
        assert_eq!(entry.method, CompressionMethod::Store);
    }
}
