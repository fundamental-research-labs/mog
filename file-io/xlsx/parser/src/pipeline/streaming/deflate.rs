use miniz_oxide::inflate::TINFLStatus;
use miniz_oxide::inflate::core::{DecompressorOxide, decompress, inflate_flags};

use super::utf8::StreamingUtf8Validator;
use crate::zip::ZipError;

/// Default buffer size for streaming decompression (64KB).
pub const DEFAULT_BUFFER_SIZE: usize = 64 * 1024;

/// A streaming DEFLATE decompressor that yields chunks of decompressed data.
///
/// This struct wraps miniz_oxide's low-level decompressor to provide
/// incremental decompression, allowing processing of data as it becomes
/// available rather than waiting for full decompression.
///
/// # Example
///
/// ```ignore
/// use xlsx_parser::streaming::StreamingDeflate;
///
/// let entry = archive.get_worksheet_compressed(1)?;
/// let mut decompressor = StreamingDeflate::new(
///     entry.data,
///     64 * 1024,
///     entry.uncompressed_size,
///     entry.output_limit,
///     entry.crc32,
/// )?;
///
/// while let Some(chunk) = decompressor.next_chunk()? {
///     // Process decompressed chunk
///     process_xml(chunk);
/// }
/// ```
pub struct StreamingDeflate<'a> {
    /// Reference to the compressed input data
    compressed: &'a [u8],
    /// The miniz_oxide decompressor state
    decompressor: DecompressorOxide,
    /// Output buffer for decompressed data
    buffer: Vec<u8>,
    /// Current position in the compressed input
    input_pos: usize,
    /// Whether decompression is complete
    finished: bool,
    /// Total bytes decompressed so far
    bytes_decompressed: usize,
    /// Declared uncompressed size from validated ZIP metadata
    declared_size: usize,
    /// Actual output limit for this stream
    output_limit: usize,
    /// Declared CRC32 from validated ZIP metadata
    crc32: u32,
    /// Running CRC32 over emitted bytes
    crc_hasher: Option<crc32fast::Hasher>,
    /// Final validation is pending because the final chunk was returned first
    final_validation_pending: bool,
    /// Incremental XML UTF-8 validator for emitted chunks
    utf8_validator: StreamingUtf8Validator,
    /// Holds validated output when a UTF-8 code point spans chunks.
    validated_buffer: Vec<u8>,
}

impl<'a> StreamingDeflate<'a> {
    /// Create a new streaming decompressor with validated ZIP metadata.
    ///
    /// # Arguments
    ///
    /// * `compressed` - The raw DEFLATE compressed data (no zlib/gzip headers)
    /// * `buffer_size` - Size of the output buffer for each chunk
    /// * `declared_size` - Central-directory uncompressed size
    /// * `output_limit` - Maximum allowed actual output bytes
    /// * `crc32` - Central-directory CRC32
    ///
    /// # Returns
    ///
    /// A new `StreamingDeflate` instance ready to decompress.
    pub fn new(
        compressed: &'a [u8],
        buffer_size: usize,
        declared_size: usize,
        output_limit: usize,
        crc32: u32,
    ) -> Result<Self, ZipError> {
        if declared_size > output_limit {
            return Err(ZipError::FileTooLargeDetail {
                limit: output_limit,
                actual: declared_size,
            });
        }
        let buffer_size = if buffer_size == 0 {
            DEFAULT_BUFFER_SIZE
        } else {
            buffer_size
        };

        Ok(Self {
            compressed,
            decompressor: DecompressorOxide::new(),
            buffer: vec![0u8; buffer_size],
            input_pos: 0,
            finished: false,
            bytes_decompressed: 0,
            declared_size,
            output_limit,
            crc32,
            crc_hasher: Some(crc32fast::Hasher::new()),
            final_validation_pending: false,
            utf8_validator: StreamingUtf8Validator::new(),
            validated_buffer: Vec::with_capacity(buffer_size + 4),
        })
    }

    /// Get the next chunk of decompressed data.
    ///
    /// Returns `Ok(Some(&[u8]))` with the next decompressed chunk, `Ok(None)`
    /// after final size/CRC/UTF-8 validation succeeds, or a typed `ZipError`
    /// for malformed input, unexpected EOF, over-limit output, or data
    /// corruption.
    ///
    /// # Note
    ///
    /// The returned slice is valid until the next call to `next_chunk()`.
    pub fn next_chunk(&mut self) -> Result<Option<&[u8]>, ZipError> {
        if self.final_validation_pending {
            self.final_validation_pending = false;
            self.validate_finished()?;
            return Ok(None);
        }

        if self.finished {
            return Ok(None);
        }

        if self.input_pos >= self.compressed.len() {
            self.finished = true;
            return Err(ZipError::UnexpectedEof);
        }

        // Get remaining input
        let input = &self.compressed[self.input_pos..];

        // Set up flags for raw DEFLATE (no zlib header)
        // We use HAS_MORE_INPUT only since we have raw deflate data, not zlib-wrapped
        let flags = inflate_flags::TINFL_FLAG_HAS_MORE_INPUT;

        // Decompress into buffer
        let (status, bytes_read, bytes_written) =
            decompress(&mut self.decompressor, input, &mut self.buffer, 0, flags);

        self.input_pos += bytes_read;
        let new_total = self
            .bytes_decompressed
            .checked_add(bytes_written)
            .ok_or(ZipError::FileTooLarge)?;
        if new_total > self.output_limit {
            self.finished = true;
            return Err(ZipError::FileTooLargeDetail {
                limit: self.output_limit,
                actual: new_total,
            });
        }
        if new_total > self.declared_size {
            self.finished = true;
            return Err(ZipError::DataCorruptionDetail(format!(
                "streaming DEFLATE output exceeded declared size: actual {}, declared {}",
                new_total, self.declared_size
            )));
        }
        self.bytes_decompressed = new_total;

        let mut emit_direct_len = 0usize;
        let mut emit_buffered = false;
        if bytes_written > 0 {
            let raw_chunk = &self.buffer[..bytes_written];
            if let Some(hasher) = self.crc_hasher.as_mut() {
                hasher.update(raw_chunk);
            }
            let validated = self
                .utf8_validator
                .validate_chunk(raw_chunk, &mut self.validated_buffer)?;
            emit_direct_len = validated.direct_len;
            emit_buffered = validated.buffered;
        }

        match status {
            TINFLStatus::Done => {
                self.finished = true;
                if emit_buffered {
                    self.final_validation_pending = true;
                    Ok(Some(&self.validated_buffer))
                } else if emit_direct_len > 0 {
                    self.final_validation_pending = true;
                    Ok(Some(&self.buffer[..emit_direct_len]))
                } else {
                    self.validate_finished()?;
                    Ok(None)
                }
            }
            TINFLStatus::NeedsMoreInput => {
                if emit_buffered {
                    Ok(Some(&self.validated_buffer))
                } else if emit_direct_len > 0 {
                    Ok(Some(&self.buffer[..emit_direct_len]))
                } else if bytes_written > 0 {
                    Ok(Some(&self.buffer[..0]))
                } else {
                    self.finished = true;
                    Err(ZipError::UnexpectedEof)
                }
            }
            TINFLStatus::HasMoreOutput => {
                // Buffer is full, return what we have
                if emit_buffered {
                    Ok(Some(&self.validated_buffer))
                } else if emit_direct_len > 0 {
                    Ok(Some(&self.buffer[..emit_direct_len]))
                } else if bytes_written > 0 {
                    Ok(Some(&self.buffer[..0]))
                } else {
                    // No progress made, something is wrong
                    self.finished = true;
                    Err(ZipError::DecompressionFailed)
                }
            }
            TINFLStatus::Failed
            | TINFLStatus::BadParam
            | TINFLStatus::Adler32Mismatch
            | TINFLStatus::FailedCannotMakeProgress => {
                // Decompression error
                self.finished = true;
                Err(ZipError::DecompressionFailed)
            }
        }
    }

    /// Check if decompression is finished.
    ///
    /// Returns `true` if all data has been decompressed or an error occurred.
    #[inline]
    pub fn is_finished(&self) -> bool {
        self.finished
    }

    /// Get the total number of bytes decompressed so far.
    #[inline]
    pub fn bytes_decompressed(&self) -> usize {
        self.bytes_decompressed
    }

    /// Get the number of compressed bytes consumed so far.
    #[inline]
    pub fn bytes_consumed(&self) -> usize {
        self.input_pos
    }

    /// Get the remaining compressed bytes to process.
    #[inline]
    pub fn remaining_input(&self) -> usize {
        self.compressed.len().saturating_sub(self.input_pos)
    }

    fn validate_finished(&mut self) -> Result<(), ZipError> {
        self.utf8_validator.finish()?;
        if self.bytes_decompressed != self.declared_size {
            return Err(ZipError::DataCorruptionDetail(format!(
                "streaming DEFLATE output size mismatch: actual {}, declared {}",
                self.bytes_decompressed, self.declared_size
            )));
        }
        let actual_crc = self
            .crc_hasher
            .take()
            .ok_or(ZipError::DataCorruption)?
            .finalize();
        if actual_crc != self.crc32 {
            return Err(ZipError::DataCorruptionDetail(format!(
                "streaming DEFLATE CRC mismatch: expected {:08x}, got {:08x}",
                self.crc32, actual_crc
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use miniz_oxide::deflate::compress_to_vec;

    #[test]
    fn test_streaming_deflate_new() {
        let data = b"test data";
        let compressed = compress_to_vec(data, 6);
        let decompressor = StreamingDeflate::new(
            &compressed,
            DEFAULT_BUFFER_SIZE,
            data.len(),
            data.len(),
            crc32fast::hash(data),
        )
        .unwrap();

        assert!(!decompressor.is_finished());
        assert_eq!(decompressor.bytes_decompressed(), 0);
        assert_eq!(decompressor.bytes_consumed(), 0);
    }

    #[test]
    fn test_streaming_deflate_default_buffer_size() {
        let data = b"test";
        let compressed = compress_to_vec(data, 6);
        let decompressor = StreamingDeflate::new(
            &compressed,
            0,
            data.len(),
            data.len(),
            crc32fast::hash(data),
        )
        .unwrap();

        // Buffer should be DEFAULT_BUFFER_SIZE when 0 is passed
        assert!(!decompressor.is_finished());
    }

    #[test]
    fn test_streaming_deflate_small_data() {
        let data = b"Hello, World!";
        let compressed = compress_to_vec(data, 6);
        let mut decompressor = StreamingDeflate::new(
            &compressed,
            DEFAULT_BUFFER_SIZE,
            data.len(),
            data.len(),
            crc32fast::hash(data),
        )
        .unwrap();

        let mut result = Vec::new();
        while let Some(chunk) = decompressor.next_chunk().unwrap() {
            result.extend_from_slice(chunk);
        }

        assert!(decompressor.is_finished());
        assert_eq!(result, data);
    }

    #[test]
    fn test_streaming_deflate_large_data() {
        // Create data larger than the buffer
        let data: Vec<u8> = (0..100_000).map(|i| b'a' + (i % 26) as u8).collect();
        let compressed = compress_to_vec(&data, 6);
        let mut decompressor = StreamingDeflate::new(
            &compressed,
            1024,
            data.len(),
            data.len(),
            crc32fast::hash(&data),
        )
        .unwrap(); // Small buffer

        let mut result = Vec::new();
        while let Some(chunk) = decompressor.next_chunk().unwrap() {
            result.extend_from_slice(chunk);
        }

        assert!(decompressor.is_finished());
        assert_eq!(result, data);
    }

    #[test]
    fn test_streaming_deflate_empty_input() {
        let decompressor =
            StreamingDeflate::new(&[], DEFAULT_BUFFER_SIZE, 0, 0, crc32fast::hash(b"")).unwrap();
        assert!(!decompressor.is_finished());
    }

    #[test]
    fn test_streaming_deflate_bytes_decompressed() {
        let data = b"Test data for decompression";
        let compressed = compress_to_vec(data, 6);
        let mut decompressor = StreamingDeflate::new(
            &compressed,
            DEFAULT_BUFFER_SIZE,
            data.len(),
            data.len(),
            crc32fast::hash(data),
        )
        .unwrap();

        while decompressor.next_chunk().unwrap().is_some() {}

        assert_eq!(decompressor.bytes_decompressed(), data.len());
    }

    #[test]
    fn test_streaming_deflate_malformed_input_returns_typed_error() {
        let mut decompressor =
            StreamingDeflate::new(b"not deflate", DEFAULT_BUFFER_SIZE, 10, 10, 0).unwrap();

        let result = decompressor.next_chunk();

        assert!(matches!(result, Err(ZipError::DecompressionFailed)));
    }

    #[test]
    fn test_streaming_deflate_declared_size_over_limit() {
        let data = b"abcdef";
        let compressed = compress_to_vec(data, 6);

        let result = StreamingDeflate::new(&compressed, DEFAULT_BUFFER_SIZE, data.len(), 3, 0);

        assert!(matches!(result, Err(ZipError::FileTooLargeDetail { .. })));
    }

    #[test]
    fn test_streaming_deflate_valid_split_multibyte_utf8() {
        let data = "a€b".as_bytes();
        let compressed = compress_to_vec(data, 6);
        let mut decompressor = StreamingDeflate::new(
            &compressed,
            2,
            data.len(),
            data.len(),
            crc32fast::hash(data),
        )
        .unwrap();

        let mut result = Vec::new();
        while let Some(chunk) = decompressor.next_chunk().unwrap() {
            result.extend_from_slice(chunk);
        }

        assert_eq!(result, data);
    }

    #[test]
    fn test_streaming_deflate_incomplete_final_utf8_sequence() {
        let data = [b'a', 0xe2, 0x82];
        let compressed = compress_to_vec(&data, 6);
        let mut decompressor = StreamingDeflate::new(
            &compressed,
            2,
            data.len(),
            data.len(),
            crc32fast::hash(&data),
        )
        .unwrap();

        let final_result = loop {
            match decompressor.next_chunk() {
                Ok(Some(_)) => continue,
                other => break other,
            }
        };

        assert!(matches!(
            final_result,
            Err(ZipError::DataCorruptionDetail(_))
        ));
    }
}
