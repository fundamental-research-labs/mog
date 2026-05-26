//! Streaming ZIP decompression module for XLSX parsing.
//!
//! This module provides streaming decompression capabilities that allow
//! emitting cells as chunks decompress, reducing memory usage and latency.
//!
//! # Architecture
//!
//! The streaming parser works in two stages:
//! 1. `StreamingDeflate` - Incrementally decompresses DEFLATE data in chunks
//! 2. `StreamingCellParser` - Parses XML cell data from decompressed chunks
//!
//! XML elements may span chunk boundaries, so the parser maintains pending
//! data between chunks.

use miniz_oxide::inflate::TINFLStatus;
use miniz_oxide::inflate::core::{DecompressorOxide, decompress, inflate_flags};

use crate::domain::cells::{
    CELL_TYPE_BOOL, CELL_TYPE_ERROR, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING,
};
use crate::domain::cells::{
    CellData, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE, VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};
use crate::infra::scanner::{find_gt_simd, find_lt_simd, find_tag_simd};
use crate::zip::ZipError;

/// Default buffer size for streaming decompression (64KB).
pub const DEFAULT_BUFFER_SIZE: usize = 64 * 1024;

// ============================================================================
// StreamingDeflate - Incremental Decompressor
// ============================================================================

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

#[derive(Debug, Default)]
struct StreamingUtf8Validator {
    pending: Vec<u8>,
}

#[derive(Debug, Clone, Copy)]
struct ValidatedChunk {
    direct_len: usize,
    buffered: bool,
}

impl StreamingUtf8Validator {
    fn new() -> Self {
        Self {
            pending: Vec::with_capacity(4),
        }
    }

    fn validate_chunk(
        &mut self,
        chunk: &[u8],
        emit_buffer: &mut Vec<u8>,
    ) -> Result<ValidatedChunk, ZipError> {
        emit_buffer.clear();
        if self.pending.is_empty() {
            return match std::str::from_utf8(chunk) {
                Ok(_) => Ok(ValidatedChunk {
                    direct_len: chunk.len(),
                    buffered: false,
                }),
                Err(err) if err.error_len().is_none() => {
                    self.pending.extend_from_slice(&chunk[err.valid_up_to()..]);
                    if self.pending.len() > 3 {
                        Err(ZipError::DataCorruptionDetail(
                            "streaming XML UTF-8 validator retained more than one code point"
                                .to_string(),
                        ))
                    } else {
                        Ok(ValidatedChunk {
                            direct_len: err.valid_up_to(),
                            buffered: false,
                        })
                    }
                }
                Err(err) => Err(ZipError::DataCorruptionDetail(format!(
                    "streaming XML chunk is not valid UTF-8 at byte {}",
                    err.valid_up_to()
                ))),
            };
        }

        emit_buffer.extend_from_slice(&self.pending);
        emit_buffer.extend_from_slice(chunk);
        self.pending.clear();
        match std::str::from_utf8(emit_buffer) {
            Ok(_) => Ok(ValidatedChunk {
                direct_len: 0,
                buffered: true,
            }),
            Err(err) if err.error_len().is_none() => {
                self.pending
                    .extend_from_slice(&emit_buffer[err.valid_up_to()..]);
                emit_buffer.truncate(err.valid_up_to());
                if self.pending.len() > 3 {
                    Err(ZipError::DataCorruptionDetail(
                        "streaming XML UTF-8 validator retained more than one code point"
                            .to_string(),
                    ))
                } else {
                    Ok(ValidatedChunk {
                        direct_len: 0,
                        buffered: true,
                    })
                }
            }
            Err(err) => Err(ZipError::DataCorruptionDetail(format!(
                "streaming XML chunk is not valid UTF-8 at byte {}",
                err.valid_up_to()
            ))),
        }
    }

    fn finish(&mut self) -> Result<(), ZipError> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err(ZipError::DataCorruptionDetail(
                "streaming XML ended with an incomplete UTF-8 sequence".to_string(),
            ))
        }
    }
}

// ============================================================================
// ParseState - Incremental Parsing State Machine
// ============================================================================

/// State machine for incremental XML parsing.
///
/// This enum tracks the parser's current position within the worksheet XML
/// structure, allowing parsing to resume correctly after receiving new chunks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseState {
    /// Looking for the `<sheetData>` element to begin cell parsing.
    SeekingSheetData,
    /// Inside `<sheetData>`, looking for `<row>` or `<c>` elements.
    InSheetData,
    /// Inside a `<row>` element, parsing cells.
    InRow {
        /// Current row number (0-indexed).
        row_num: u32,
    },
    /// Parsing is complete (found `</sheetData>` or end of data).
    Finished,
}

impl Default for ParseState {
    fn default() -> Self {
        ParseState::SeekingSheetData
    }
}

// ============================================================================
// StreamingCellParser - Incremental Cell Parser
// ============================================================================

/// A streaming cell parser that processes XML chunks incrementally.
///
/// This parser handles the case where XML elements span chunk boundaries
/// by buffering incomplete elements in `pending_xml`.
///
/// # Example
///
/// ```ignore
/// use xlsx_parser::streaming::{StreamingCellParser, StreamingDeflate};
/// use xlsx_parser::CellData;
///
/// let shared_strings: Vec<&str> = vec!["Hello", "World"];
/// let mut parser = StreamingCellParser::new(&shared_strings);
/// let entry = archive.get_worksheet_compressed(1)?;
/// let mut decompressor = StreamingDeflate::new(
///     entry.data,
///     64 * 1024,
///     entry.uncompressed_size,
///     entry.output_limit,
///     entry.crc32,
/// )?;
///
/// let mut cells: Vec<CellData> = Vec::new();
/// let mut strings: Vec<u8> = Vec::new();
///
/// while let Some(chunk) = decompressor.next_chunk()? {
///     parser.process_chunk(chunk, &mut cells, &mut strings);
/// }
///
/// // Process any remaining data
/// parser.finish(&mut cells, &mut strings);
/// ```
pub struct StreamingCellParser<'a> {
    /// Reference to the shared strings table
    shared_strings: &'a [&'a str],
    /// Buffer for incomplete XML elements that span chunks
    pending_xml: Vec<u8>,
    /// Current parsing state
    state: ParseState,
    /// Current row number when parsing cells without explicit row reference
    current_row: u32,
}

impl<'a> StreamingCellParser<'a> {
    /// Create a new streaming cell parser.
    ///
    /// # Arguments
    ///
    /// * `shared_strings` - Reference to the shared strings table for resolving
    ///   string cell values.
    ///
    /// # Returns
    ///
    /// A new `StreamingCellParser` ready to process XML chunks.
    pub fn new(shared_strings: &'a [&'a str]) -> Self {
        Self {
            shared_strings,
            pending_xml: Vec::with_capacity(4096), // Pre-allocate for typical element sizes
            state: ParseState::SeekingSheetData,
            current_row: 0,
        }
    }

    /// Process a chunk of decompressed XML data.
    ///
    /// # Arguments
    ///
    /// * `chunk` - The decompressed XML bytes to process
    /// * `output` - Vector to append parsed `CellData` to
    /// * `strings` - Vector to append string values to
    ///
    /// # Returns
    ///
    /// The number of cells parsed from this chunk.
    pub fn process_chunk(
        &mut self,
        chunk: &[u8],
        output: &mut Vec<CellData>,
        strings: &mut Vec<u8>,
    ) -> usize {
        if self.state == ParseState::Finished {
            return 0;
        }

        // Combine pending data with new chunk
        let data = if self.pending_xml.is_empty() {
            chunk.to_vec()
        } else {
            let mut combined = std::mem::take(&mut self.pending_xml);
            combined.extend_from_slice(chunk);
            combined
        };

        let cells_before = output.len();
        let mut pos = 0;

        // Process based on current state
        match self.state {
            ParseState::SeekingSheetData => {
                if let Some(sheet_data_pos) = find_tag_simd(&data, b"sheetData", pos) {
                    // Found <sheetData>, skip to after the opening tag
                    if let Some(gt_pos) = find_gt_simd(&data, sheet_data_pos) {
                        pos = gt_pos + 1;
                        self.state = ParseState::InSheetData;
                    }
                } else {
                    // Keep searching - save last part of data in case tag spans chunks
                    let keep_from = data.len().saturating_sub(20); // "sheetData" + some buffer
                    self.pending_xml = data[keep_from..].to_vec();
                    return 0;
                }
            }
            ParseState::InSheetData | ParseState::InRow { .. } => {
                // Continue processing
            }
            ParseState::Finished => {
                return 0;
            }
        }

        // Main parsing loop
        while pos < data.len() {
            // Look for the next '<' character
            let lt_pos = match find_lt_simd(&data, pos) {
                Some(p) => p,
                None => break,
            };

            // Check what element we found
            let tag_start = lt_pos + 1;
            if tag_start >= data.len() {
                // Incomplete tag, save for next chunk
                self.pending_xml = data[lt_pos..].to_vec();
                break;
            }

            let tag_byte = data[tag_start];

            if tag_byte == b'/' {
                // Closing tag
                if matches_tag(&data, tag_start + 1, b"sheetData") {
                    self.state = ParseState::Finished;
                    break;
                } else if matches_tag(&data, tag_start + 1, b"row") {
                    self.state = ParseState::InSheetData;
                }
                // Skip to end of closing tag
                if let Some(gt_pos) = find_gt_simd(&data, lt_pos) {
                    pos = gt_pos + 1;
                } else {
                    self.pending_xml = data[lt_pos..].to_vec();
                    break;
                }
            } else if tag_byte == b'r' && matches_tag(&data, tag_start, b"row") {
                // <row> element - extract row number
                if let Some(gt_pos) = find_gt_simd(&data, lt_pos) {
                    let row_element = &data[lt_pos..=gt_pos];
                    if let Some(row_num) = parse_row_number(row_element) {
                        self.current_row = row_num.saturating_sub(1); // Convert to 0-indexed
                    }
                    self.state = ParseState::InRow {
                        row_num: self.current_row,
                    };
                    pos = gt_pos + 1;
                } else {
                    self.pending_xml = data[lt_pos..].to_vec();
                    break;
                }
            } else if tag_byte == b'c'
                && (tag_start + 1 >= data.len()
                    || matches!(data.get(tag_start + 1), Some(b' ' | b'>' | b'/')))
            {
                // <c> element - parse cell
                // Find the end of this cell element
                if let Some(cell_end) = find_cell_end(&data, lt_pos) {
                    if cell_end <= data.len() {
                        let cell_xml = &data[lt_pos..cell_end];
                        if let Some(cell_data) = parse_cell_element(
                            cell_xml,
                            self.current_row,
                            self.shared_strings,
                            strings,
                        ) {
                            output.push(cell_data);
                        }
                        pos = cell_end;
                    } else {
                        // Cell spans chunk boundary
                        self.pending_xml = data[lt_pos..].to_vec();
                        break;
                    }
                } else {
                    // Incomplete cell, save for next chunk
                    self.pending_xml = data[lt_pos..].to_vec();
                    break;
                }
            } else {
                // Other element, skip it
                if let Some(gt_pos) = find_gt_simd(&data, lt_pos) {
                    pos = gt_pos + 1;
                } else {
                    self.pending_xml = data[lt_pos..].to_vec();
                    break;
                }
            }
        }

        output.len() - cells_before
    }

    /// Process any remaining pending data.
    ///
    /// Call this after all chunks have been processed to handle any
    /// remaining buffered data.
    ///
    /// # Arguments
    ///
    /// * `output` - Vector to append parsed `CellData` to
    /// * `strings` - Vector to append string values to
    ///
    /// # Returns
    ///
    /// The number of cells parsed from remaining data.
    pub fn finish(&mut self, output: &mut Vec<CellData>, strings: &mut Vec<u8>) -> usize {
        if self.pending_xml.is_empty() {
            return 0;
        }

        // Process any remaining data
        let pending = std::mem::take(&mut self.pending_xml);
        self.process_chunk(&pending, output, strings)
    }

    /// Get the current parsing state.
    #[inline]
    pub fn state(&self) -> ParseState {
        self.state
    }

    /// Check if parsing is complete.
    #[inline]
    pub fn is_finished(&self) -> bool {
        self.state == ParseState::Finished
    }

    /// Get the current row number being parsed.
    #[inline]
    pub fn current_row(&self) -> u32 {
        self.current_row
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Check if the tag at the given position matches the expected tag name.
#[inline]
fn matches_tag(data: &[u8], pos: usize, tag: &[u8]) -> bool {
    if pos + tag.len() > data.len() {
        return false;
    }
    let slice = &data[pos..pos + tag.len()];
    if slice != tag {
        return false;
    }
    // Verify tag ends with delimiter
    if pos + tag.len() < data.len() {
        let next = data[pos + tag.len()];
        matches!(next, b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r')
    } else {
        true
    }
}

/// Parse row number from a row element.
fn parse_row_number(row_xml: &[u8]) -> Option<u32> {
    // Look for r="N" pattern
    let r_attr = b"r=\"";
    let mut pos = 0;
    while pos + r_attr.len() + 1 < row_xml.len() {
        if &row_xml[pos..pos + r_attr.len()] == r_attr {
            pos += r_attr.len();
            let mut num: u32 = 0;
            while pos < row_xml.len() && row_xml[pos].is_ascii_digit() {
                num = num
                    .saturating_mul(10)
                    .saturating_add((row_xml[pos] - b'0') as u32);
                pos += 1;
            }
            if num > 0 {
                return Some(num);
            }
        }
        pos += 1;
    }
    None
}

/// Find the end of a cell element (handles both self-closing and paired tags).
///
/// For `<c r="A1"/>` returns position after `/>`.
/// For `<c r="A1"><v>42</v></c>` returns position after `</c>`.
fn find_cell_end(data: &[u8], start: usize) -> Option<usize> {
    // First, find the end of the opening tag
    let gt_pos = find_gt_simd(data, start)?;

    // Check if it's self-closing
    if gt_pos > 0 && data[gt_pos - 1] == b'/' {
        return Some(gt_pos + 1);
    }

    // Not self-closing - look for </c>
    let mut pos = gt_pos + 1;
    let mut depth = 1; // We're inside the <c> element

    while pos < data.len() {
        if let Some(lt_pos) = find_lt_simd(data, pos) {
            let tag_start = lt_pos + 1;
            if tag_start >= data.len() {
                return None; // Incomplete
            }

            // Find end of this tag
            let inner_gt = find_gt_simd(data, lt_pos)?;

            if data[tag_start] == b'/' {
                // Closing tag
                depth -= 1;
                if depth == 0 {
                    // Check if this is </c>
                    if tag_start + 1 < data.len() && data[tag_start + 1] == b'c' {
                        let after_c = tag_start + 2;
                        if after_c >= data.len() || matches!(data[after_c], b'>' | b' ') {
                            return Some(inner_gt + 1);
                        }
                    }
                    // Even if not </c>, we're done at depth 0
                    return Some(inner_gt + 1);
                }
            } else if data[tag_start] != b'?' && data[tag_start] != b'!' {
                // Opening tag (not processing instruction or comment)
                // Check if it's self-closing
                if inner_gt > 0 && data[inner_gt - 1] == b'/' {
                    // Self-closing, don't increase depth
                } else {
                    depth += 1;
                }
            }

            pos = inner_gt + 1;
        } else {
            return None;
        }
    }

    None
}

/// Parse a single cell element and return CellData.
fn parse_cell_element(
    xml: &[u8],
    fallback_row: u32,
    shared_strings: &[&str],
    strings: &mut Vec<u8>,
) -> Option<CellData> {
    // Parse cell reference
    let (row, col) = parse_cell_ref(xml).unwrap_or((fallback_row, 0));

    // Parse cell type
    let cell_type = parse_cell_type(xml);

    // Parse style index
    let style_idx = parse_style_idx(xml);

    // Extract value
    let (value_type, value_bytes) = extract_cell_value(xml, shared_strings);

    // Skip empty cells
    if value_type == VALUE_TYPE_NONE {
        return None;
    }

    let value_offset = strings.len() as u32;
    let value_len = value_bytes.len() as u32;
    strings.extend_from_slice(value_bytes);

    Some(CellData {
        row,
        col,
        cell_type,
        style_idx,
        value_type,
        value_offset,
        value_len,
    })
}

/// Parse cell reference from r attribute.
fn parse_cell_ref(xml: &[u8]) -> Option<(u32, u32)> {
    // Find r="..." attribute
    let r_attr = b"r=\"";
    let mut pos = 0;
    while pos + r_attr.len() < xml.len() {
        if &xml[pos..pos + r_attr.len()] == r_attr {
            let start = pos + r_attr.len();
            let mut end = start;
            while end < xml.len() && xml[end] != b'"' {
                end += 1;
            }
            if end > start {
                return parse_a1_reference(&xml[start..end]);
            }
        }
        pos += 1;
    }
    None
}

/// Parse A1 reference to (row, col) tuple.
fn parse_a1_reference(reference: &[u8]) -> Option<(u32, u32)> {
    if reference.is_empty() {
        return None;
    }

    let mut pos = 0;
    let mut col: u32 = 0;

    // Parse column letters
    while pos < reference.len() && reference[pos].is_ascii_uppercase() {
        col = col
            .saturating_mul(26)
            .saturating_add((reference[pos] - b'A' + 1) as u32);
        pos += 1;
    }

    if col == 0 || pos == 0 {
        return None;
    }
    col -= 1; // Convert to 0-indexed

    // Parse row number
    let mut row: u32 = 0;
    while pos < reference.len() && reference[pos].is_ascii_digit() {
        row = row
            .saturating_mul(10)
            .saturating_add((reference[pos] - b'0') as u32);
        pos += 1;
    }

    if row == 0 {
        return None;
    }
    row -= 1; // Convert to 0-indexed

    // Validate ranges
    if col > 16383 || row > 1048575 {
        return None;
    }

    Some((row, col))
}

/// Parse cell type from t attribute.
fn parse_cell_type(xml: &[u8]) -> u8 {
    let t_attr = b"t=\"";
    let mut pos = 0;
    while pos + t_attr.len() + 1 < xml.len() {
        if &xml[pos..pos + t_attr.len()] == t_attr {
            let type_char = xml[pos + t_attr.len()];
            return match type_char {
                b'n' => CELL_TYPE_NUMBER,
                b's' => {
                    // Distinguish t="s" (shared string) from t="str" (formula string result)
                    if pos + t_attr.len() + 2 < xml.len() && xml[pos + t_attr.len() + 1] == b't' {
                        CELL_TYPE_FORMULA_STRING
                    } else {
                        CELL_TYPE_STRING
                    }
                }
                b'i' => CELL_TYPE_STRING, // inlineStr
                b'b' => CELL_TYPE_BOOL,
                b'e' => CELL_TYPE_ERROR,
                _ => CELL_TYPE_NUMBER,
            };
        }
        pos += 1;
    }
    CELL_TYPE_NUMBER
}

/// Parse style index from s attribute.
fn parse_style_idx(xml: &[u8]) -> u16 {
    // Look for s="N" pattern with space before
    let s_attr = b" s=\"";
    let mut pos = 0;
    while pos + s_attr.len() + 1 < xml.len() {
        if &xml[pos..pos + s_attr.len()] == s_attr {
            pos += s_attr.len();
            let mut idx: u16 = 0;
            while pos < xml.len() && xml[pos].is_ascii_digit() {
                idx = idx
                    .saturating_mul(10)
                    .saturating_add((xml[pos] - b'0') as u16);
                pos += 1;
            }
            return idx;
        }
        pos += 1;
    }
    0
}

/// Extract cell value from XML.
fn extract_cell_value<'a>(xml: &'a [u8], shared_strings: &'a [&'a str]) -> (u8, &'a [u8]) {
    // Check for formula <f>
    if let Some(f_start) = find_sequence(xml, b"<f>") {
        let content_start = f_start + 3;
        if let Some(f_end) = find_sequence(&xml[content_start..], b"</f>") {
            return (
                VALUE_TYPE_FORMULA,
                &xml[content_start..content_start + f_end],
            );
        }
    }

    // Check for value <v>
    if let Some(v_start) = find_sequence(xml, b"<v>") {
        let content_start = v_start + 3;
        if let Some(v_end) = find_sequence(&xml[content_start..], b"</v>") {
            let value_bytes = &xml[content_start..content_start + v_end];

            // Check if this is a shared string reference
            let cell_type = parse_cell_type(xml);
            if cell_type == CELL_TYPE_STRING {
                // Parse the shared string index
                if let Some(idx) = parse_u32(value_bytes) {
                    if let Some(shared_str) = shared_strings.get(idx as usize) {
                        return (VALUE_TYPE_SHARED_STRING, shared_str.as_bytes());
                    }
                }
            }

            return (VALUE_TYPE_INLINE, value_bytes);
        }
    }

    // Check for inline string <is><t>
    if let Some(is_start) = find_sequence(xml, b"<is>") {
        if let Some(t_start) = find_sequence(&xml[is_start..], b"<t>") {
            let content_start = is_start + t_start + 3;
            if let Some(t_end) = find_sequence(&xml[content_start..], b"</t>") {
                return (
                    VALUE_TYPE_INLINE,
                    &xml[content_start..content_start + t_end],
                );
            }
        }
    }

    // Check for self-closing value <v/>
    if find_sequence(xml, b"<v/>").is_some() {
        return (VALUE_TYPE_INLINE, b"");
    }

    (VALUE_TYPE_NONE, b"")
}

/// Find a byte sequence in the slice.
#[inline]
fn find_sequence(data: &[u8], seq: &[u8]) -> Option<usize> {
    if seq.is_empty() || data.len() < seq.len() {
        return None;
    }
    data.windows(seq.len()).position(|w| w == seq)
}

/// Parse a u32 from ASCII digits.
#[inline]
fn parse_u32(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() {
        return None;
    }
    let mut result: u32 = 0;
    for &b in bytes {
        if b.is_ascii_digit() {
            result = result.saturating_mul(10).saturating_add((b - b'0') as u32);
        } else {
            break;
        }
    }
    Some(result)
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use miniz_oxide::deflate::compress_to_vec;

    // -------------------------------------------------------------------------
    // StreamingDeflate Tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // ParseState Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_state_default() {
        let state = ParseState::default();
        assert_eq!(state, ParseState::SeekingSheetData);
    }

    #[test]
    fn test_parse_state_in_row() {
        let state = ParseState::InRow { row_num: 5 };
        if let ParseState::InRow { row_num } = state {
            assert_eq!(row_num, 5);
        } else {
            panic!("Expected InRow state");
        }
    }

    // -------------------------------------------------------------------------
    // StreamingCellParser Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_streaming_cell_parser_new() {
        let strings: Vec<&str> = vec!["Hello", "World"];
        let parser = StreamingCellParser::new(&strings);

        assert_eq!(parser.state(), ParseState::SeekingSheetData);
        assert!(!parser.is_finished());
        assert_eq!(parser.current_row(), 0);
    }

    #[test]
    fn test_streaming_cell_parser_find_sheet_data() {
        let strings: Vec<&str> = vec![];
        let mut parser = StreamingCellParser::new(&strings);
        let mut output = Vec::new();
        let mut string_buf = Vec::new();

        let xml = b"<?xml version=\"1.0\"?><worksheet><sheetData></sheetData></worksheet>";
        parser.process_chunk(xml, &mut output, &mut string_buf);

        // Should have found sheetData and then finished
        assert!(parser.is_finished() || parser.state() == ParseState::InSheetData);
    }

    #[test]
    fn test_streaming_cell_parser_parse_cells() {
        let strings: Vec<&str> = vec!["Hello"];
        let mut parser = StreamingCellParser::new(&strings);
        let mut output = Vec::new();
        let mut string_buf = Vec::new();

        let xml = br#"<worksheet><sheetData>
            <row r="1">
                <c r="A1"><v>42</v></c>
                <c r="B1" t="s"><v>0</v></c>
            </row>
        </sheetData></worksheet>"#;

        let count = parser.process_chunk(xml, &mut output, &mut string_buf);

        assert!(count >= 1); // At least one cell parsed
        assert!(!output.is_empty());
    }

    #[test]
    fn test_streaming_cell_parser_chunk_boundary() {
        let strings: Vec<&str> = vec![];
        let mut parser = StreamingCellParser::new(&strings);
        let mut output = Vec::new();
        let mut string_buf = Vec::new();

        // Split XML across chunks at various boundaries
        let chunk1 = b"<worksheet><sheet";
        let chunk2 = b"Data><row r=\"1\"><c r=\"A1\"><v>42</";
        let chunk3 = b"v></c></row></sheetData></worksheet>";

        parser.process_chunk(chunk1, &mut output, &mut string_buf);
        parser.process_chunk(chunk2, &mut output, &mut string_buf);
        parser.process_chunk(chunk3, &mut output, &mut string_buf);
        parser.finish(&mut output, &mut string_buf);

        // Should have parsed the cell
        assert!(!output.is_empty());
    }

    #[test]
    fn test_streaming_cell_parser_self_closing_cell() {
        let strings: Vec<&str> = vec![];
        let mut parser = StreamingCellParser::new(&strings);
        let mut output = Vec::new();
        let mut string_buf = Vec::new();

        let xml = b"<worksheet><sheetData><row r=\"1\"><c r=\"A1\"/></row></sheetData></worksheet>";
        parser.process_chunk(xml, &mut output, &mut string_buf);

        // Self-closing cells with no value should be skipped
        assert!(output.is_empty());
    }

    #[test]
    fn test_streaming_cell_parser_with_formula() {
        let strings: Vec<&str> = vec![];
        let mut parser = StreamingCellParser::new(&strings);
        let mut output = Vec::new();
        let mut string_buf = Vec::new();

        let xml = br#"<worksheet><sheetData>
            <row r="1">
                <c r="A1"><f>SUM(B1:B10)</f><v>100</v></c>
            </row>
        </sheetData></worksheet>"#;

        parser.process_chunk(xml, &mut output, &mut string_buf);

        assert!(!output.is_empty());
        // Formula should be extracted
        let cell = &output[0];
        assert_eq!(cell.value_type, VALUE_TYPE_FORMULA);
    }

    // -------------------------------------------------------------------------
    // Helper Function Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_matches_tag() {
        assert!(matches_tag(b"<row r=\"1\">", 1, b"row"));
        assert!(matches_tag(b"<sheetData>", 1, b"sheetData"));
        assert!(!matches_tag(b"<row>", 1, b"rows"));
        assert!(!matches_tag(b"<row>", 1, b"ro"));
    }

    #[test]
    fn test_parse_row_number() {
        assert_eq!(parse_row_number(b"<row r=\"1\">"), Some(1));
        assert_eq!(parse_row_number(b"<row r=\"100\">"), Some(100));
        assert_eq!(parse_row_number(b"<row>"), None);
        assert_eq!(parse_row_number(b"<row r=\"\">"), None);
    }

    #[test]
    fn test_parse_a1_reference() {
        assert_eq!(parse_a1_reference(b"A1"), Some((0, 0)));
        assert_eq!(parse_a1_reference(b"B2"), Some((1, 1)));
        assert_eq!(parse_a1_reference(b"AA10"), Some((9, 26)));
        assert_eq!(parse_a1_reference(b"XFD1"), Some((0, 16383)));
        assert_eq!(parse_a1_reference(b""), None);
        assert_eq!(parse_a1_reference(b"A0"), None);
    }

    #[test]
    fn test_parse_cell_type() {
        assert_eq!(parse_cell_type(b"<c r=\"A1\">"), CELL_TYPE_NUMBER);
        assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"n\">"), CELL_TYPE_NUMBER);
        assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"s\">"), CELL_TYPE_STRING);
        assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"b\">"), CELL_TYPE_BOOL);
        assert_eq!(parse_cell_type(b"<c r=\"A1\" t=\"e\">"), CELL_TYPE_ERROR);
    }

    #[test]
    fn test_parse_style_idx() {
        assert_eq!(parse_style_idx(b"<c r=\"A1\">"), 0);
        assert_eq!(parse_style_idx(b"<c r=\"A1\" s=\"1\">"), 1);
        assert_eq!(parse_style_idx(b"<c r=\"A1\" s=\"42\">"), 42);
    }

    #[test]
    fn test_extract_cell_value_number() {
        let strings: Vec<&str> = vec![];
        let (vtype, value) = extract_cell_value(b"<c r=\"A1\"><v>42.5</v></c>", &strings);
        assert_eq!(vtype, VALUE_TYPE_INLINE);
        assert_eq!(value, b"42.5");
    }

    #[test]
    fn test_extract_cell_value_shared_string() {
        let strings: Vec<&str> = vec!["Hello, World!"];
        let (vtype, value) = extract_cell_value(b"<c r=\"A1\" t=\"s\"><v>0</v></c>", &strings);
        assert_eq!(vtype, VALUE_TYPE_SHARED_STRING);
        assert_eq!(value, b"Hello, World!");
    }

    #[test]
    fn test_extract_cell_value_formula() {
        let strings: Vec<&str> = vec![];
        let (vtype, value) =
            extract_cell_value(b"<c r=\"A1\"><f>A1+B1</f><v>100</v></c>", &strings);
        assert_eq!(vtype, VALUE_TYPE_FORMULA);
        assert_eq!(value, b"A1+B1");
    }

    #[test]
    fn test_extract_cell_value_inline_string() {
        let strings: Vec<&str> = vec![];
        let (vtype, value) = extract_cell_value(
            b"<c r=\"A1\" t=\"inlineStr\"><is><t>Test</t></is></c>",
            &strings,
        );
        assert_eq!(vtype, VALUE_TYPE_INLINE);
        assert_eq!(value, b"Test");
    }

    #[test]
    fn test_extract_cell_value_empty() {
        let strings: Vec<&str> = vec![];
        let (vtype, _) = extract_cell_value(b"<c r=\"A1\"/>", &strings);
        assert_eq!(vtype, VALUE_TYPE_NONE);
    }

    #[test]
    fn test_find_sequence() {
        assert_eq!(find_sequence(b"hello world", b"world"), Some(6));
        assert_eq!(find_sequence(b"hello", b"world"), None);
        assert_eq!(find_sequence(b"hello", b""), None);
        assert_eq!(find_sequence(b"", b"hello"), None);
    }

    #[test]
    fn test_parse_u32() {
        assert_eq!(parse_u32(b"123"), Some(123));
        assert_eq!(parse_u32(b"0"), Some(0));
        assert_eq!(parse_u32(b"42abc"), Some(42));
        assert_eq!(parse_u32(b""), None);
    }

    #[test]
    fn test_find_cell_end_self_closing() {
        let xml = b"<c r=\"A1\"/>";
        let end = find_cell_end(xml, 0);
        assert_eq!(end, Some(11));
    }

    #[test]
    fn test_find_cell_end_with_value() {
        let xml = b"<c r=\"A1\"><v>42</v></c>";
        let end = find_cell_end(xml, 0);
        assert_eq!(end, Some(23));
    }

    #[test]
    fn test_find_cell_end_nested() {
        let xml = b"<c r=\"A1\"><f>SUM(A1:A10)</f><v>100</v></c>";
        let end = find_cell_end(xml, 0);
        assert_eq!(end, Some(42));
    }
}
