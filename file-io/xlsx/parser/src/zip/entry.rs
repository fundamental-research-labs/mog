//! ZIP entry types for archive file entries

use super::constants::COMPRESSION_DEFLATE;
use super::constants::COMPRESSION_STORE;

/// A single entry in the ZIP archive
#[derive(Debug, Clone)]
pub struct ZipEntry {
    /// File name (path within the archive)
    pub name: String,
    /// Offset to the start of the local file header
    pub offset: usize,
    /// Size of compressed data
    pub compressed_size: usize,
    /// Size after decompression
    pub uncompressed_size: usize,
    /// Compression method (0 = STORE, 8 = DEFLATE)
    pub compression_method: u16,
    /// ZIP general-purpose bit flags validated at archive-open time
    pub flags: u16,
    /// CRC32 checksum of the uncompressed data
    pub crc32: u32,
}

impl ZipEntry {
    /// Create a new ZIP entry
    pub fn new(
        name: String,
        offset: usize,
        compressed_size: usize,
        uncompressed_size: usize,
        compression_method: u16,
        crc32: u32,
    ) -> Self {
        Self {
            name,
            offset,
            compressed_size,
            uncompressed_size,
            compression_method,
            flags: 0,
            crc32,
        }
    }
}

/// Compressed entry data for streaming decompression
///
/// This struct holds a reference to the raw compressed bytes within the archive,
/// along with metadata needed for decompression.
#[derive(Debug)]
pub struct CompressedEntry<'a> {
    /// Trusted ZIP part name after parser filename validation
    pub name: &'a str,
    /// The raw compressed data bytes
    pub data: &'a [u8],
    /// Compression method (0 = STORE, 8 = DEFLATE)
    pub compression_method: u16,
    /// ZIP general-purpose bit flags
    pub flags: u16,
    /// Expected size after decompression
    pub uncompressed_size: usize,
    /// CRC32 checksum of the uncompressed data
    pub crc32: u32,
    /// Per-entry actual-output limit
    pub output_limit: usize,
}

impl<'a> CompressedEntry<'a> {
    /// Check if this entry uses DEFLATE compression
    #[inline]
    pub fn is_deflate(&self) -> bool {
        self.compression_method == COMPRESSION_DEFLATE
    }

    /// Check if this entry is stored without compression
    #[inline]
    pub fn is_stored(&self) -> bool {
        self.compression_method == COMPRESSION_STORE
    }

    /// Get the compressed data length
    #[inline]
    pub fn compressed_len(&self) -> usize {
        self.data.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zip_entry_creation() {
        let entry = ZipEntry::new("test.xml".to_string(), 100, 50, 200, 8, 0x12345678);
        assert_eq!(entry.name, "test.xml");
        assert_eq!(entry.offset, 100);
        assert_eq!(entry.crc32, 0x12345678);
        assert_eq!(entry.compressed_size, 50);
        assert_eq!(entry.uncompressed_size, 200);
        assert_eq!(entry.compression_method, 8);
    }

    #[test]
    fn test_compressed_entry_is_deflate() {
        let data = [0u8; 10];
        let entry = CompressedEntry {
            name: "test.xml",
            data: &data,
            compression_method: COMPRESSION_DEFLATE,
            flags: 0,
            uncompressed_size: 100,
            crc32: 0,
            output_limit: 100,
        };
        assert!(entry.is_deflate());
        assert!(!entry.is_stored());
    }

    #[test]
    fn test_compressed_entry_is_stored() {
        let data = [0u8; 10];
        let entry = CompressedEntry {
            name: "test.xml",
            data: &data,
            compression_method: COMPRESSION_STORE,
            flags: 0,
            uncompressed_size: 10,
            crc32: 0,
            output_limit: 10,
        };
        assert!(!entry.is_deflate());
        assert!(entry.is_stored());
    }

    #[test]
    fn test_compressed_entry_len() {
        let data = [0u8; 42];
        let entry = CompressedEntry {
            name: "test.xml",
            data: &data,
            compression_method: COMPRESSION_STORE,
            flags: 0,
            uncompressed_size: 42,
            crc32: 0,
            output_limit: 42,
        };
        assert_eq!(entry.compressed_len(), 42);
    }
}
