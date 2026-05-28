use super::cell_xml::{find_cell_end, matches_tag, parse_cell_element, parse_row_number};
use super::state::ParseState;
use crate::domain::cells::CellData;
use crate::infra::scanner::{find_gt_simd, find_lt_simd, find_tag_simd};

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::cells::VALUE_TYPE_FORMULA;

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
}
