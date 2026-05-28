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

#[cfg(test)]
mod tests {
    use super::*;

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
}
