//! Decompression logic for ZIP archives

use super::constants::MAX_UNCOMPRESSED_SIZE;
use super::error::ZipError;

/// Decompress raw DEFLATE data using the production per-part limit.
///
/// `expected_size` comes from ZIP metadata. It is only an allocation hint; the
/// decompressor enforces `MAX_UNCOMPRESSED_SIZE` against actual emitted bytes.
#[inline]
pub fn decompress_deflate(compressed: &[u8], expected_size: usize) -> Result<Vec<u8>, ZipError> {
    decompress_deflate_with_limit(compressed, expected_size, MAX_UNCOMPRESSED_SIZE)
}

/// Testable decompression core with an injected actual-output limit.
///
/// Successful output is exactly the decompressed byte stream. Malformed raw
/// DEFLATE returns `DecompressionFailed`; output beyond `limit` returns
/// `FileTooLarge`.
#[cfg(all(not(target_arch = "wasm32"), feature = "native"))]
pub(crate) fn decompress_deflate_with_limit(
    compressed: &[u8],
    expected_size: usize,
    limit: usize,
) -> Result<Vec<u8>, ZipError> {
    if expected_size > limit {
        return Err(ZipError::FileTooLargeDetail {
            limit,
            actual: expected_size,
        });
    }

    match miniz_oxide::inflate::decompress_to_vec_with_limit(compressed, limit) {
        Ok(decompressed) if decompressed.len() <= limit => Ok(decompressed),
        Ok(decompressed) => Err(ZipError::FileTooLargeDetail {
            limit,
            actual: decompressed.len(),
        }),
        Err(_) => decompress_zlib_with_limit(compressed, limit),
    }
}

/// Decompress DEFLATE data using pure-Rust miniz_oxide (WASM / non-native path).
#[cfg(not(all(not(target_arch = "wasm32"), feature = "native")))]
pub(crate) fn decompress_deflate_with_limit(
    compressed: &[u8],
    expected_size: usize,
    limit: usize,
) -> Result<Vec<u8>, ZipError> {
    if expected_size > limit {
        return Err(ZipError::FileTooLargeDetail {
            limit,
            actual: expected_size,
        });
    }

    match decompress_raw_miniz_with_limit(compressed, limit) {
        Err(ZipError::DecompressionFailed) => decompress_zlib_with_limit(compressed, limit),
        other => other,
    }
}

#[cfg(not(all(not(target_arch = "wasm32"), feature = "native")))]
fn decompress_raw_miniz_with_limit(compressed: &[u8], limit: usize) -> Result<Vec<u8>, ZipError> {
    use miniz_oxide::inflate::TINFLStatus;
    use miniz_oxide::inflate::core::{DecompressorOxide, decompress, inflate_flags};

    let mut decompressor = DecompressorOxide::new();
    let mut input_pos = 0usize;
    let mut output = Vec::new();
    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        if input_pos >= compressed.len() {
            return Err(ZipError::DecompressionFailed);
        }

        let input = &compressed[input_pos..];
        let (status, bytes_read, bytes_written) = decompress(
            &mut decompressor,
            input,
            &mut buffer,
            0,
            inflate_flags::TINFL_FLAG_HAS_MORE_INPUT,
        );

        input_pos = input_pos
            .checked_add(bytes_read)
            .ok_or(ZipError::DecompressionFailed)?;
        let new_total = output
            .len()
            .checked_add(bytes_written)
            .ok_or(ZipError::FileTooLarge)?;
        if new_total > limit {
            return Err(ZipError::FileTooLargeDetail {
                limit,
                actual: new_total,
            });
        }
        output.extend_from_slice(&buffer[..bytes_written]);

        match status {
            TINFLStatus::Done => return Ok(output),
            TINFLStatus::HasMoreOutput => {
                if bytes_written == 0 {
                    return Err(ZipError::DecompressionFailed);
                }
            }
            TINFLStatus::NeedsMoreInput => {
                if bytes_written == 0 {
                    return Err(ZipError::DecompressionFailed);
                }
            }
            TINFLStatus::Failed
            | TINFLStatus::BadParam
            | TINFLStatus::Adler32Mismatch
            | TINFLStatus::FailedCannotMakeProgress => {
                return Err(ZipError::DecompressionFailed);
            }
        }
    }
}

fn decompress_zlib_with_limit(compressed: &[u8], limit: usize) -> Result<Vec<u8>, ZipError> {
    match miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(compressed, limit) {
        Ok(decompressed) if decompressed.len() <= limit => Ok(decompressed),
        Ok(decompressed) => Err(ZipError::FileTooLargeDetail {
            limit,
            actual: decompressed.len(),
        }),
        Err(_) => Err(ZipError::DecompressionFailed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use miniz_oxide::deflate::compress_to_vec;

    #[test]
    fn test_decompress_deflate() {
        let original =
            b"Hello, this is test content that should compress well! AAAAAAAAAAAAAAAAAAAAAA";
        let compressed = compress_to_vec(original, 6);

        let decompressed =
            decompress_deflate(&compressed, original.len()).expect("Failed to decompress");
        assert_eq!(decompressed, original);
    }

    #[test]
    fn test_decompress_larger_content() {
        // Create content that compresses well
        let original: Vec<u8> = (0..10000).map(|i| ((i % 26) as u8) + b'a').collect();
        let compressed = compress_to_vec(&original, 6);

        let decompressed =
            decompress_deflate(&compressed, original.len()).expect("Failed to decompress");
        assert_eq!(decompressed, original);
    }

    #[test]
    fn test_decompress_expected_size_smaller_than_actual_output() {
        let original = b"actual output is larger than the ZIP metadata hint";
        let compressed = compress_to_vec(original, 6);

        let decompressed =
            decompress_deflate_with_limit(&compressed, 1, 1024).expect("decompress failed");

        assert_eq!(decompressed, original);
    }

    #[test]
    fn test_decompress_exact_injected_limit() {
        let original = b"exact-limit";
        let compressed = compress_to_vec(original, 6);

        let decompressed =
            decompress_deflate_with_limit(&compressed, original.len(), original.len())
                .expect("decompress failed");

        assert_eq!(decompressed, original);
    }

    #[test]
    fn test_decompress_over_injected_limit() {
        let original = b"over-limit";
        let compressed = compress_to_vec(original, 6);

        let result = decompress_deflate_with_limit(&compressed, original.len(), original.len() - 1);

        assert!(matches!(result, Err(ZipError::FileTooLargeDetail { .. })));
    }

    #[test]
    fn test_decompress_invalid_data() {
        let invalid = b"not valid deflate data";
        let result = decompress_deflate(invalid, 100);
        assert!(matches!(result, Err(ZipError::DecompressionFailed)));
    }
}
