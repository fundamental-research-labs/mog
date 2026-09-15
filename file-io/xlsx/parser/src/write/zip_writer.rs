//! Incremental ZIP writer for XLSX files.
//!
//! Entries are deflated directly into a `Write` sink. Only central-directory
//! metadata is retained; ZIP data descriptors carry sizes and CRCs once each
//! entry finishes. The default sink collects the final compressed archive.

use crc32fast::Hasher;
use flate2::{Compression, write::DeflateEncoder};
use std::collections::HashSet;
use std::io::{self, Write};

const LOCAL_FILE_HEADER_SIGNATURE: u32 = 0x04034b50;
const CENTRAL_DIR_HEADER_SIGNATURE: u32 = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE: u32 = 0x06054b50;
const DATA_DESCRIPTOR_SIGNATURE: u32 = 0x08074b50;
const COMPRESSION_STORE: u16 = 0;
const COMPRESSION_DEFLATE: u16 = 8;
const VERSION_NEEDED_DEFLATE: u16 = 20;
const VERSION_MADE_BY: u16 = 0x031E;
const MAX_FILENAME_LENGTH: usize = 65535;
const STREAM_FLAGS: u16 = (1 << 3) | (1 << 11);

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
}

/// Error types for ZIP write operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZipWriteError {
    /// Compression operation failed
    CompressionFailed,
    /// The output sink failed.
    Io(String),
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
            ZipWriteError::Io(message) => write!(f, "I/O error: {message}"),
            ZipWriteError::CompressionFailed => write!(f, "Compression failed"),
            ZipWriteError::FileTooLarge => write!(f, "File exceeds 4GB limit"),
            ZipWriteError::InvalidFilename => write!(f, "Invalid filename"),
            ZipWriteError::ArchiveTooLarge => write!(f, "Archive would exceed 4GB"),
            ZipWriteError::TooManyEntries => write!(f, "Too many entries (max 65535)"),
        }
    }
}

impl std::error::Error for ZipWriteError {}

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

/// ZIP archive writer that emits each entry immediately.
#[derive(Debug)]
pub struct ZipWriter<W: Write = Vec<u8>> {
    output: PositionWriter<W>,
    entries: Vec<WrittenEntry>,
    names: HashSet<String>,
    default_method: CompressionMethod,
    error: Option<ZipWriteError>,
}

impl Default for ZipWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl ZipWriter {
    pub fn new() -> Self {
        Self::with_compression(CompressionMethod::default())
    }

    pub fn with_compression(method: CompressionMethod) -> Self {
        Self::with_sink(Vec::new(), method)
    }
}

impl<W: Write> ZipWriter<W> {
    /// Create an archive backed by any sequential output sink; seeking is unnecessary.
    pub fn with_sink(sink: W, method: CompressionMethod) -> Self {
        Self {
            output: PositionWriter {
                inner: sink,
                position: 0,
            },
            entries: Vec::new(),
            names: HashSet::new(),
            default_method: method,
            error: None,
        }
    }

    /// Write an existing part immediately. Errors are retained and returned by `finish`.
    pub fn add_file(&mut self, name: &str, data: impl AsRef<[u8]>) -> &mut Self {
        self.add_file_with(name, data, self.default_method)
    }

    pub fn add_file_with(
        &mut self,
        name: &str,
        data: impl AsRef<[u8]>,
        method: CompressionMethod,
    ) -> &mut Self {
        let _ = self.write_file(name, method, |sink| sink.write_all(data.as_ref()));
        self
    }

    pub fn add_files(&mut self, files: impl IntoIterator<Item = (String, Vec<u8>)>) -> &mut Self {
        for (name, data) in files {
            self.add_file(&name, data);
        }
        self
    }

    /// Serialize a part directly into the compressor, without collecting its XML.
    /// Duplicate paths keep the first entry, matching structured/opaque precedence.
    pub fn add_file_stream(
        &mut self,
        name: &str,
        write: impl FnOnce(&mut dyn Write) -> io::Result<()>,
    ) -> Result<(), ZipWriteError> {
        self.write_file(name, self.default_method, write)
    }

    fn write_file(
        &mut self,
        name: &str,
        method: CompressionMethod,
        write: impl FnOnce(&mut dyn Write) -> io::Result<()>,
    ) -> Result<(), ZipWriteError> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        if self.names.contains(name) {
            return Ok(());
        }
        let result = self.write_entry(name, method, write);
        if let Err(error) = &result {
            self.error = Some(error.clone());
        }
        result
    }

    fn write_entry(
        &mut self,
        name: &str,
        method: CompressionMethod,
        write: impl FnOnce(&mut dyn Write) -> io::Result<()>,
    ) -> Result<(), ZipWriteError> {
        if name.is_empty() || name.len() > MAX_FILENAME_LENGTH {
            return Err(ZipWriteError::InvalidFilename);
        }
        if self.entries.len() == u16::MAX as usize {
            return Err(ZipWriteError::TooManyEntries);
        }
        let local_header_offset = self.output.position;
        let mut header = Vec::with_capacity(30 + name.len());
        header.extend_from_slice(&LOCAL_FILE_HEADER_SIGNATURE.to_le_bytes());
        header.extend_from_slice(&VERSION_NEEDED_DEFLATE.to_le_bytes());
        header.extend_from_slice(&STREAM_FLAGS.to_le_bytes());
        header.extend_from_slice(&method.method_code().to_le_bytes());
        header.extend_from_slice(&0u16.to_le_bytes());
        header.extend_from_slice(&(((2024 - 1980) << 9 | 1 << 5 | 1) as u16).to_le_bytes());
        header.extend_from_slice(&[0; 12]); // CRC and sizes follow the entry data.
        header.extend_from_slice(&(name.len() as u16).to_le_bytes());
        header.extend_from_slice(&0u16.to_le_bytes());
        header.extend_from_slice(name.as_bytes());
        self.output.write_all(&header)?;
        let data_start = self.output.position;
        let (crc32, uncompressed_size) = match method {
            CompressionMethod::Store => {
                let mut entry = CheckedEntryWriter::new(&mut self.output);
                write(&mut entry)?;
                (entry.crc.finalize(), entry.size)
            }
            CompressionMethod::Deflate(level) => {
                let encoder = DeflateEncoder::new(
                    &mut self.output,
                    Compression::new(u32::from(level.min(9))),
                );
                let mut entry = CheckedEntryWriter::new(encoder);
                write(&mut entry)?;
                entry.inner.finish()?;
                (entry.crc.finalize(), entry.size)
            }
        };
        let compressed_size = self.output.position - data_start;
        let mut descriptor = Vec::with_capacity(16);
        descriptor.extend_from_slice(&DATA_DESCRIPTOR_SIGNATURE.to_le_bytes());
        descriptor.extend_from_slice(&crc32.to_le_bytes());
        descriptor.extend_from_slice(&compressed_size.to_le_bytes());
        descriptor.extend_from_slice(&uncompressed_size.to_le_bytes());
        self.output.write_all(&descriptor)?;
        self.names.insert(name.to_owned());
        self.entries.push(WrittenEntry {
            name: name.to_owned(),
            local_header_offset,
            crc32,
            compressed_size,
            uncompressed_size,
            method,
        });
        Ok(())
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    /// Append the central directory, flush the sink, and return it.
    pub fn finish(mut self) -> Result<W, ZipWriteError> {
        if let Some(error) = self.error {
            return Err(error);
        }
        let offset = self.output.position;
        let mut header = Vec::new();
        for entry in &self.entries {
            header.clear();
            write_central_dir_header(&mut header, entry)?;
            self.output.write_all(&header)?;
        }
        let size = self.output.position - offset;
        header.clear();
        write_eocd(&mut header, self.entries.len() as u16, size, offset);
        self.output.write_all(&header)?;
        self.output.flush()?;
        Ok(self.output.inner)
    }
}

impl From<io::Error> for ZipWriteError {
    fn from(error: io::Error) -> Self {
        if let Some(error) = error
            .get_ref()
            .and_then(|inner| inner.downcast_ref::<ZipWriteError>())
        {
            return error.clone();
        }
        Self::Io(error.to_string())
    }
}

#[derive(Debug)]
struct PositionWriter<W> {
    inner: W,
    position: u32,
}

impl<W: Write> Write for PositionWriter<W> {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        if data.len() as u64 + u64::from(self.position) > u64::from(u32::MAX) {
            return Err(io::Error::other(ZipWriteError::ArchiveTooLarge));
        }
        let written = self.inner.write(data)?;
        self.position += written as u32;
        Ok(written)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

struct CheckedEntryWriter<W> {
    inner: W,
    crc: Hasher,
    size: u32,
}

impl<W> CheckedEntryWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            crc: Hasher::new(),
            size: 0,
        }
    }
}

impl<W: Write> Write for CheckedEntryWriter<W> {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        if data.len() as u64 + u64::from(self.size) > u64::from(u32::MAX) {
            return Err(io::Error::other(ZipWriteError::FileTooLarge));
        }
        let written = self.inner.write(data)?;
        self.crc.update(&data[..written]);
        self.size += written as u32;
        Ok(written)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
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
    output.extend_from_slice(&VERSION_NEEDED_DEFLATE.to_le_bytes());
    output.extend_from_slice(&STREAM_FLAGS.to_le_bytes()); // Data descriptor and UTF-8 names
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
#[cfg(test)]
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
    fn deflate_reaches_sink_before_producer_finishes() {
        use std::{cell::Cell, rc::Rc};
        struct ObservedSink {
            data: Vec<u8>,
            written: Rc<Cell<usize>>,
        }
        impl Write for ObservedSink {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                // Exercise short writes as well as incremental compression.
                let length = bytes.len().min(257);
                self.data.extend_from_slice(&bytes[..length]);
                self.written.set(self.data.len());
                Ok(length)
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let written = Rc::new(Cell::new(0));
        let sink = ObservedSink {
            data: Vec::new(),
            written: written.clone(),
        };
        let mut zip = ZipWriter::with_sink(sink, CompressionMethod::Deflate(6));
        let mut expected = Vec::new();
        zip.add_file_stream("large.bin", |entry| {
            let mut state = 0x12345678u32;
            let mut block = [0; 4096];
            for _ in 0..128 {
                for byte in &mut block {
                    state ^= state << 13;
                    state ^= state >> 17;
                    state ^= state << 5;
                    *byte = state as u8;
                }
                expected.extend_from_slice(&block);
                entry.write_all(&block)?;
            }
            // Far beyond the local header: compressed data was written before
            // the producer returned and before the archive was finalized.
            assert!(written.get() > 100_000);
            Ok(())
        })
        .unwrap();
        let result = zip.finish().unwrap();
        let archive = XlsxArchive::new(&result.data).unwrap();
        let entry = archive.find_entry("large.bin").unwrap();
        assert_eq!(entry.compression_method, 8);
        assert_eq!(entry.crc32, calculate_crc32(&expected));
        assert_eq!(archive.read_file("large.bin").unwrap(), expected);
    }

    #[test]
    fn failed_stream_cannot_be_finished_as_a_valid_archive() {
        let mut zip = ZipWriter::new();
        assert!(
            zip.add_file_stream("broken.xml", |entry| {
                entry.write_all(b"partial")?;
                Err(io::Error::other("producer failed"))
            })
            .is_err()
        );
        zip.add_file("later.xml", b"must not mask failure");
        assert!(
            matches!(zip.finish(), Err(ZipWriteError::Io(message)) if message.contains("producer failed"))
        );
    }

    #[test]
    fn sink_failure_is_returned_even_by_infallible_add_file_api() {
        struct BrokenSink;
        impl Write for BrokenSink {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::other("disk full"))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut zip = ZipWriter::with_sink(BrokenSink, CompressionMethod::Store);
        zip.add_file("file.xml", b"data");
        assert!(
            matches!(zip.finish(), Err(ZipWriteError::Io(message)) if message.contains("disk full"))
        );
    }

    #[test]
    fn finishing_propagates_flush_failure() {
        struct FlushFailure(Vec<u8>);
        impl Write for FlushFailure {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                self.0.write(bytes)
            }
            fn flush(&mut self) -> io::Result<()> {
                Err(io::Error::other("flush failed"))
            }
        }
        let mut zip = ZipWriter::with_sink(FlushFailure(Vec::new()), CompressionMethod::Store);
        zip.add_file("part.xml", b"data");
        assert!(
            matches!(zip.finish(), Err(ZipWriteError::Io(message)) if message.contains("flush failed"))
        );
    }

    #[test]
    fn duplicate_parts_keep_first_without_running_second_producer() {
        let mut zip = ZipWriter::new();
        zip.add_file("part.xml", b"first");
        zip.add_file_stream("part.xml", |_| panic!("duplicate producer ran"))
            .unwrap();
        let bytes = zip.finish().unwrap();
        let archive = XlsxArchive::new(&bytes).unwrap();
        assert_eq!(archive.entries().len(), 1);
        assert_eq!(archive.read_file("part.xml").unwrap(), b"first");
    }

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
        let entry = archive.find_entry("test.txt").unwrap();
        assert!(entry.compressed_size < entry.uncompressed_size);
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
    fn test_incompressible_deflate_roundtrip() {
        // Random data that doesn't compress well
        let random_data: Vec<u8> = (0..100).map(|i| ((i * 17 + 31) % 256) as u8).collect();

        // Streaming deflate retains the requested method for incompressible data.
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
}
