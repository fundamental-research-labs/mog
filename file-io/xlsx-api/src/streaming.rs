//! Incremental XLSX parsing — chunk-based decompression and cell extraction.
//!
//! `StreamingParser` wraps the parser's streaming infrastructure for ergonomic
//! chunk-based processing. Returns low-level `CellData` records (row, col, type,
//! style index, value offset/length) — the same format used by the WASM
//! SharedArrayBuffer path.
//!
//! For typed values (strings, numbers, formulas), use the full `parse()` path.
//! Streaming is useful for:
//! - Memory-constrained environments (process cells without loading entire file)
//! - Progress reporting (count cells as they're parsed)
//! - Preliminary analysis (cell count, structure detection)
//!
//! # Architecture
//!
//! Streaming XLSX parsing requires multiple coordinated steps:
//!
//! 1. **Open the ZIP archive** — parse the central directory for file lookup.
//! 2. **Parse shared strings** — the shared string table (`xl/sharedStrings.xml`)
//!    must be fully loaded before any cell parsing, because string cells reference
//!    it by index. This is the main reason streaming can't avoid all up-front work.
//! 3. **Get compressed sheet data** — extract the raw DEFLATE bytes for a worksheet
//!    without decompressing the entire entry.
//! 4. **Stream decompression + cell parsing** — `StreamingDeflate` yields XML chunks,
//!    `StreamingCellParser` extracts `CellData` records from each chunk. XML elements
//!    that span chunk boundaries are buffered internally.
//!
//! # Current Status
//!
//! **This module is a stub.** The parser's `StreamingCellParser` requires `&[&str]`
//! for its shared strings table, but the parser's `SharedStrings` struct provides
//! byte-oriented access (`get(index) -> &[u8]`). Bridging this gap requires either:
//!
//! - Adding a `to_str_vec()` method to `SharedStrings` in the parser crate, or
//! - Parsing shared strings independently in this module.
//!
//! Additionally, the `CompressedEntry` type (needed to get raw DEFLATE data for
//! streaming decompression) is not re-exported from the parser crate's public API.
//!
//! The full parse path (`parse()` / `parse_with_options()`) already handles all of
//! this correctly. Streaming is an optimization for very large files where the caller
//! wants incremental progress or bounded memory usage.

use crate::error::XlsxApiError;

// Re-export the parser's streaming primitives for advanced users who want to
// drive the decompression and cell-parsing loop themselves.
pub use xlsx_parser::{
    CellData, DEFAULT_BUFFER_SIZE, ParseState, StreamingCellParser, StreamingDeflate,
};

/// Result of streaming a single worksheet.
///
/// Contains the raw `CellData` records and a byte buffer holding the string
/// values referenced by `value_offset` / `value_len` fields in each record.
#[derive(Debug)]
pub struct StreamingSheetResult {
    /// Parsed cell records (20 bytes each in their packed form).
    pub cells: Vec<CellData>,
    /// Byte buffer containing string values. Each `CellData` record's
    /// `value_offset` and `value_len` fields index into this buffer.
    pub strings: Vec<u8>,
    /// Number of decompressed chunks processed.
    pub chunks_processed: usize,
    /// Total bytes decompressed from the sheet's DEFLATE stream.
    pub bytes_decompressed: usize,
}

/// High-level streaming parser for XLSX files.
///
/// Wraps the parser's `StreamingDeflate` and `StreamingCellParser` with archive
/// handling and shared-string resolution. Processes one sheet at a time, yielding
/// `CellData` records incrementally.
///
/// # Example (future — not yet implemented)
///
/// ```ignore
/// use xlsx_api::streaming::StreamingParser;
///
/// let mut parser = StreamingParser::open(&xlsx_bytes)?;
/// let result = parser.stream_sheet(0)?;
/// println!("Parsed {} cells in {} chunks", result.cells.len(), result.chunks_processed);
/// ```
///
/// # Why a stub?
///
/// The internal streaming pipeline is tightly coupled to the WASM SharedArrayBuffer
/// protocol. Exposing it through a clean facade requires:
///
/// 1. `SharedStrings::to_str_vec()` — convert the byte-oriented shared string table
///    to `Vec<String>` (or `Vec<&str>`) for `StreamingCellParser::new()`.
/// 2. Re-exporting `CompressedEntry` from the parser crate so we can get raw DEFLATE
///    data without fully decompressing the worksheet first.
///
/// Both are small changes to the parser crate. Until then, use `parse()` for the
/// full typed result, or use the re-exported `StreamingDeflate` / `StreamingCellParser`
/// directly if you can manage archive extraction and shared strings yourself.
pub struct StreamingParser {
    /// Owned copy of the XLSX bytes (needed because `XlsxArchive` borrows them).
    _data: Vec<u8>,
    /// Number of worksheets in the archive.
    sheet_count: usize,
}

impl StreamingParser {
    /// Open an XLSX file for streaming parsing.
    ///
    /// Parses the ZIP central directory and reads the shared string table.
    /// The shared string table is fully loaded into memory (it must be complete
    /// before any cell parsing can begin).
    ///
    /// # Arguments
    ///
    /// * `data` - The raw XLSX file bytes.
    ///
    /// # Errors
    ///
    /// Returns `XlsxApiError::InvalidArchive` if the data is not a valid ZIP,
    /// or `XlsxApiError::UnsupportedFeature` because this module is not yet
    /// implemented.
    pub fn open(data: &[u8]) -> Result<Self, XlsxApiError> {
        // Validate that this is at least a valid ZIP archive.
        let archive = xlsx_parser::XlsxArchive::new(data)?;
        let sheet_count = archive.worksheet_count();

        // TODO: Parse shared strings here. The parser's SharedStrings struct
        // provides byte-oriented access, but StreamingCellParser needs &[&str].
        // Options:
        //   (a) Add SharedStrings::to_string_vec() -> Vec<String> in parser crate
        //   (b) Use parse_shared_strings_fast() + collect into Vec<String>
        //   (c) Reimplement lightweight shared string parsing here
        //
        // For now, return an error indicating this is not yet implemented.

        Ok(StreamingParser {
            _data: data.to_vec(),
            sheet_count,
        })
    }

    /// Returns the number of worksheets in the archive.
    pub fn sheet_count(&self) -> usize {
        self.sheet_count
    }

    /// Stream-parse a single worksheet by 0-based index.
    ///
    /// Decompresses the worksheet XML in chunks and extracts `CellData` records
    /// incrementally. The returned `StreamingSheetResult` contains all cells
    /// found in the sheet plus a string buffer for value lookups.
    ///
    /// # Arguments
    ///
    /// * `_sheet_index` - 0-based worksheet index.
    ///
    /// # Errors
    ///
    /// Returns `XlsxApiError::UnsupportedFeature` — streaming is not yet wired up.
    /// Use `parse()` or `parse_with_options()` for full parsing.
    ///
    /// Once implemented, will return:
    /// - `XlsxApiError::SheetIndexOutOfBounds` if the index is out of range.
    /// - `XlsxApiError::CorruptedArchive` if decompression fails.
    pub fn stream_sheet(
        &mut self,
        _sheet_index: usize,
    ) -> Result<StreamingSheetResult, XlsxApiError> {
        // TODO: Implementation requires:
        //
        // 1. Re-open the archive from self._data (XlsxArchive borrows, can't store).
        // 2. Get compressed worksheet data via archive.get_worksheet_compressed(index + 1).
        //    NOTE: get_worksheet_compressed uses 1-based indexing.
        //    NOTE: CompressedEntry is not re-exported from the parser crate.
        // 3. Create StreamingDeflate from the compressed data.
        // 4. Create StreamingCellParser with the shared strings table.
        // 5. Loop: decompressor.next_chunk() -> parser.process_chunk() -> collect cells.
        // 6. Call parser.finish() for any remaining buffered data.
        //
        // Sketch of the implementation once the parser crate exposes the needed APIs:
        //
        // ```
        // let archive = XlsxArchive::new(&self._data)?;
        // let compressed = archive.get_worksheet_compressed(sheet_index + 1)?;
        // let mut deflate = StreamingDeflate::new(
        //     compressed.data,
        //     DEFAULT_BUFFER_SIZE,
        //     compressed.uncompressed_size,
        //     compressed.output_limit,
        //     compressed.crc32,
        // )?;
        // let mut cell_parser = StreamingCellParser::new(&self.shared_strings_strs);
        // let mut cells = Vec::new();
        // let mut strings = Vec::new();
        // let mut chunks = 0;
        //
        // while let Some(chunk) = deflate.next_chunk() {
        //     cell_parser.process_chunk(chunk, &mut cells, &mut strings);
        //     chunks += 1;
        // }
        // cell_parser.finish(&mut cells, &mut strings);
        //
        // Ok(StreamingSheetResult {
        //     cells,
        //     strings,
        //     chunks_processed: chunks,
        //     bytes_decompressed: deflate.bytes_decompressed(),
        // })
        // ```

        Err(XlsxApiError::UnsupportedFeature(
            "Streaming parse is not yet implemented. The parser's StreamingCellParser \
             requires a shared strings table as &[&str], but SharedStrings provides \
             byte-oriented access. Use parse() or parse_with_options() instead, or \
             use the re-exported StreamingDeflate/StreamingCellParser directly."
                .to_string(),
        ))
    }

    /// Stream-parse a worksheet with a per-chunk callback.
    ///
    /// This is the intended primary API for streaming: the callback receives
    /// each batch of `CellData` records as they are parsed from decompressed
    /// chunks, enabling progress reporting and bounded memory usage.
    ///
    /// # Arguments
    ///
    /// * `_sheet_index` - 0-based worksheet index.
    /// * `_buffer_size` - Decompression buffer size in bytes (0 = default 64KB).
    /// * `_on_chunk` - Callback invoked after each chunk is parsed. Receives the
    ///   newly parsed cells and the cumulative string buffer.
    ///
    /// # Errors
    ///
    /// Returns `XlsxApiError::UnsupportedFeature` — not yet implemented.
    pub fn stream_sheet_with_callback<F>(
        &mut self,
        _sheet_index: usize,
        _buffer_size: usize,
        _on_chunk: F,
    ) -> Result<StreamingSheetResult, XlsxApiError>
    where
        F: FnMut(&[CellData], &[u8]),
    {
        Err(XlsxApiError::UnsupportedFeature(
            "Streaming parse with callback is not yet implemented.".to_string(),
        ))
    }
}

/// Convenience function: count cells in a worksheet without building typed values.
///
/// This is the simplest streaming use case — decompress and parse just enough
/// to count cells, without constructing `FullCellData` structs.
///
/// # Errors
///
/// Returns `XlsxApiError::UnsupportedFeature` — not yet implemented.
/// Once implemented, returns the cell count for the given sheet.
pub fn count_cells(_data: &[u8], _sheet_index: usize) -> Result<usize, XlsxApiError> {
    // TODO: This could use a simplified path that doesn't even need shared strings,
    // since we only need to count <c> elements with values, not resolve them.
    // A dedicated counting parser would be simpler than the full StreamingCellParser.
    Err(XlsxApiError::UnsupportedFeature(
        "Streaming cell count is not yet implemented.".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_parser_rejects_invalid_archive() {
        let result = StreamingParser::open(b"not a zip file");
        assert!(result.is_err());
    }

    #[test]
    fn streaming_primitives_are_reexported() {
        // Verify that the re-exported types are accessible.
        assert_eq!(DEFAULT_BUFFER_SIZE, 64 * 1024);

        let _state = ParseState::SeekingSheetData;
        assert_eq!(std::mem::size_of::<CellData>(), 20);
    }
}
