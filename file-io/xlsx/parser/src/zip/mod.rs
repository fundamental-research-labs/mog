//! ZIP archive handling for XLSX files
//!
//! XLSX files are ZIP archives containing XML files. This module provides
//! a lightweight, WASM-compatible ZIP parser using miniz_oxide for decompression.
//!
//! Key features:
//! - Parses ZIP central directory for fast file lookup
//! - Handles both DEFLATE (method 8) and STORE (method 0) compression
//! - Pre-allocates buffers for decompression efficiency
//! - XLSX-specific convenience methods
//! - Error recovery support via `ParseContext`
//!
//! Key files in an XLSX archive:
//! - `xl/workbook.xml` - Workbook structure and sheet names
//! - `xl/sharedStrings.xml` - Shared string table
//! - `xl/worksheets/sheet1.xml` - Worksheet data (one per sheet)
//! - `xl/styles.xml` - Cell formatting styles

mod archive;
mod central_dir;
mod decompress;
mod entry;
mod error;

/// ZIP file format constants (internal)
pub(crate) mod constants {
    pub const END_OF_CENTRAL_DIR_SIGNATURE: u32 = 0x06054b50;
    pub const ZIP64_END_OF_CENTRAL_DIR_LOCATOR_SIGNATURE: u32 = 0x07064b50;
    pub const CENTRAL_FILE_HEADER_SIGNATURE: u32 = 0x02014b50;
    pub const LOCAL_FILE_HEADER_SIGNATURE: u32 = 0x04034b50;

    // Compression methods
    pub const COMPRESSION_STORE: u16 = 0;
    pub const COMPRESSION_DEFLATE: u16 = 8;

    // General-purpose bit flags accepted by this parser.
    pub const FLAG_ENCRYPTED: u16 = 1 << 0;
    pub const FLAG_DEFLATE_OPTION_1: u16 = 1 << 1;
    pub const FLAG_DEFLATE_OPTION_2: u16 = 1 << 2;
    pub const FLAG_DATA_DESCRIPTOR: u16 = 1 << 3;
    pub const FLAG_PATCHED_DATA: u16 = 1 << 5;
    pub const FLAG_UTF8_NAME: u16 = 1 << 11;

    // Maximum sizes for safety
    pub const MAX_UNCOMPRESSED_SIZE: usize = 256 * 1024 * 1024; // 256 MB limit per file
    pub const MAX_ZIP_ENTRIES: usize = 100_000;
    pub const MAX_CENTRAL_DIRECTORY_SIZE: usize = 64 * 1024 * 1024;
    pub const MAX_TOTAL_DECLARED_UNCOMPRESSED_SIZE: usize = 1024 * 1024 * 1024;
    pub const MAX_TOTAL_MATERIALIZED_UNCOMPRESSED_SIZE: usize = 1024 * 1024 * 1024;
    pub const MAX_COMMENT_LENGTH: usize = 65535;
    pub const MIN_EOCD_SIZE: usize = 22; // Minimum End of Central Directory size

    // Semantic XML/output allocation limits.
    pub const MAX_RELATIONSHIP_PARTS: usize = 100_000;
    pub const MAX_RELATIONSHIPS_PER_PART: usize = 100_000;
    pub const MAX_TOTAL_RELATIONSHIP_RECORDS: usize = 100_000;
    pub const MAX_SHARED_STRINGS: usize = 5_000_000;
    pub const MAX_RICH_TEXT_RUNS_PER_STRING: usize = 10_000;
    pub const MAX_WORKSHEET_CELLS: usize = 20_000_000;
    pub const MAX_MERGES: usize = 1_000_000;
    pub const MAX_TABLES: usize = 100_000;
    pub const MAX_VALIDATIONS: usize = 1_000_000;
    pub const MAX_PIVOTS: usize = 100_000;
    pub const MAX_CHARTS: usize = 100_000;
    pub const MAX_STYLES: usize = 1_000_000;
}

// Re-export public types
pub use archive::{XlsxArchive, is_encrypted_office_package};
pub use decompress::decompress_deflate;
pub use entry::{CompressedEntry, ZipEntry};
pub use error::ZipError;
