//! DEFLATE compression wrappers for PDF streams.
//!
//! Uses `flate2` with the pure-Rust `miniz_oxide` backend for WASM compatibility.
//! Compression levels: 6 for content streams (default), 9 for fonts/ICC profiles.

use flate2::Compression;
use flate2::read::{DeflateDecoder, DeflateEncoder};
use std::io::Read;

/// Default compression level for content streams.
pub const COMPRESSION_LEVEL_DEFAULT: u32 = 6;

/// Maximum compression level for fonts and ICC profiles.
pub const COMPRESSION_LEVEL_MAX: u32 = 9;

/// Compress data using DEFLATE (raw deflate, matching PDF's FlateDecode filter).
///
/// # Arguments
/// * `data` - The uncompressed data
/// * `level` - Compression level (0-9). Use `COMPRESSION_LEVEL_DEFAULT` (6) for content streams,
///   `COMPRESSION_LEVEL_MAX` (9) for fonts/ICC profiles.
///
/// # Returns
/// The compressed bytes (zlib format, which is what PDF's FlateDecode expects).
pub fn compress(data: &[u8], level: u32) -> Result<Vec<u8>, std::io::Error> {
    let mut encoder = flate2::read::ZlibEncoder::new(data, Compression::new(level));
    let mut compressed = Vec::new();
    encoder.read_to_end(&mut compressed)?;
    Ok(compressed)
}

/// Decompress data using DEFLATE (zlib format, matching PDF's FlateDecode filter).
///
/// # Arguments
/// * `data` - The compressed data (zlib format)
///
/// # Returns
/// `Ok(decompressed)` on success, `Err` on invalid compressed data.
pub fn decompress(data: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut decoder = flate2::read::ZlibDecoder::new(data);
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)?;
    Ok(decompressed)
}

/// Compress data using raw DEFLATE (no zlib header/trailer).
/// Some PDF producers use this variant.
pub fn compress_raw(data: &[u8], level: u32) -> Result<Vec<u8>, std::io::Error> {
    let mut encoder = DeflateEncoder::new(data, Compression::new(level));
    let mut compressed = Vec::new();
    encoder.read_to_end(&mut compressed)?;
    Ok(compressed)
}

/// Decompress raw DEFLATE data (no zlib header/trailer).
pub fn decompress_raw(data: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut decoder = DeflateDecoder::new(data);
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)?;
    Ok(decompressed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compress_decompress_roundtrip() {
        let original = b"Hello, PDF compression! This is a test of the DEFLATE algorithm.";
        let compressed = compress(original, COMPRESSION_LEVEL_DEFAULT).unwrap();
        let decompressed = decompress(&compressed).unwrap();
        assert_eq!(&decompressed, original);
    }

    #[test]
    fn test_compress_decompress_empty() {
        let original = b"";
        let compressed = compress(original, COMPRESSION_LEVEL_DEFAULT).unwrap();
        let decompressed = decompress(&compressed).unwrap();
        assert_eq!(&decompressed, original);
    }

    #[test]
    fn test_compress_decompress_large() {
        // Generate a large repetitive string (simulates content stream).
        let mut data = Vec::new();
        for i in 0..10000 {
            data.extend_from_slice(
                format!("BT /F1 12 Tf {} {} Td (Line {}) Tj ET\n", 72, 792 - i, i).as_bytes(),
            );
        }

        let compressed = compress(&data, COMPRESSION_LEVEL_DEFAULT).unwrap();
        assert!(
            compressed.len() < data.len(),
            "Compressed size ({}) should be less than original ({})",
            compressed.len(),
            data.len()
        );

        let decompressed = decompress(&compressed).unwrap();
        assert_eq!(decompressed, data);
    }

    #[test]
    fn test_compression_level_max() {
        let data = b"This data is compressed at maximum level for font embedding.";
        let compressed = compress(data, COMPRESSION_LEVEL_MAX).unwrap();
        let decompressed = decompress(&compressed).unwrap();
        assert_eq!(&decompressed, data);
    }

    #[test]
    fn test_compression_reduces_size() {
        // Highly compressible data.
        let data: Vec<u8> = vec![b'A'; 10000];
        let compressed = compress(&data, COMPRESSION_LEVEL_DEFAULT).unwrap();
        // 10000 bytes of 'A' should compress to much less.
        assert!(
            compressed.len() < 100,
            "Compressed size: {}",
            compressed.len()
        );
    }

    #[test]
    fn test_raw_compress_decompress_roundtrip() {
        let original = b"Raw DEFLATE without zlib header.";
        let compressed = compress_raw(original, COMPRESSION_LEVEL_DEFAULT).unwrap();
        let decompressed = decompress_raw(&compressed).unwrap();
        assert_eq!(&decompressed, original);
    }

    #[test]
    fn test_decompress_invalid_data() {
        let invalid = b"this is not compressed data!";
        let result = decompress(invalid);
        assert!(result.is_err());
    }

    #[test]
    fn test_different_compression_levels() {
        let data = b"Test data for different compression levels.".repeat(100);
        let c0 = compress(&data, 0).unwrap();
        let c6 = compress(&data, 6).unwrap();
        let c9 = compress(&data, 9).unwrap();

        // All should decompress correctly.
        assert_eq!(decompress(&c0).unwrap(), data);
        assert_eq!(decompress(&c6).unwrap(), data);
        assert_eq!(decompress(&c9).unwrap(), data);

        // Higher levels should generally produce smaller output (for compressible data).
        assert!(
            c9.len() <= c0.len(),
            "Level 9 ({}) should be <= level 0 ({})",
            c9.len(),
            c0.len()
        );
    }
}
