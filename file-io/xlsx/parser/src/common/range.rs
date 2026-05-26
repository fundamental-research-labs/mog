//! Common range types shared between read and write modules.
//!
//! All types are re-exported from `ooxml_types::worksheet` to maintain a
//! single source of truth across the ooxml ecosystem.  The parser used to
//! define its own copies — they have been unified here.

pub use ooxml_types::worksheet::{ColWidth, MergeRange, Pane, PaneState, RowHeight, SheetPane};

// =============================================================================
// Tests — validate that the ooxml-types versions behave identically to the
// old local definitions.
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_range_from_ref() {
        let merge = MergeRange::from_ref("A1:B3");
        assert_eq!(merge.to_ref(), "A1:B3");
    }

    #[test]
    fn test_merge_range_from_coords() {
        let merge = MergeRange::from_coords(0, 0, 2, 1);
        assert_eq!(merge.to_ref(), "A1:B3");
        assert_eq!(merge.start_row, 0);
        assert_eq!(merge.start_col, 0);
        assert_eq!(merge.end_row, 2);
        assert_eq!(merge.end_col, 1);
    }

    #[test]
    fn test_sheet_pane_frozen() {
        let pane = SheetPane::frozen(1, 2);
        assert_eq!(pane.rows(), 1);
        assert_eq!(pane.cols(), 2);
        assert_eq!(pane.top_left_cell.as_deref(), Some("C2"));
        assert!(pane.is_frozen());
    }

    #[test]
    fn test_sheet_pane_json_field_names() {
        // Verify that JSON uses the actual Rust field names (no renames).
        let pane =
            SheetPane::from_parsed(1.0, 2.0, Some("B3"), Pane::BottomRight, PaneState::Frozen);
        let json = serde_json::to_string(&pane).unwrap();
        assert!(
            json.contains("\"x_split\":1.0"),
            "expected 'x_split' field name, got: {json}"
        );
        assert!(
            json.contains("\"y_split\":2.0"),
            "expected 'y_split' field name, got: {json}"
        );
    }

    #[test]
    fn test_col_width_simple() {
        let cw = ColWidth::simple(5, 15.0);
        assert_eq!(cw.col, 5);
        assert_eq!(cw.width, Some(15.0));
        assert_eq!(cw.min, 6);
        assert_eq!(cw.max, 6);
    }

    #[test]
    fn test_col_width_range() {
        let cw = ColWidth::range(1, 5, 12.0);
        assert_eq!(cw.min, 1);
        assert_eq!(cw.max, 5);
        assert_eq!(cw.width, Some(12.0));
    }

    #[test]
    fn test_col_width_json_field_names() {
        let cw = ColWidth::range(1, 5, 12.0).with_hidden(true);
        let json = serde_json::to_string(&cw).unwrap();
        assert!(
            json.contains("\"hidden\":true"),
            "expected 'hidden' field, got: {json}"
        );
    }

    #[test]
    fn test_row_height() {
        let rh = RowHeight::custom(10, 25.0);
        assert_eq!(rh.row, 10);
        assert_eq!(rh.height, 25.0);
        assert!(rh.custom_height);
    }

    #[test]
    fn test_row_height_json_field_names() {
        let rh = RowHeight::custom(10, 25.0).with_hidden(true);
        let json = serde_json::to_string(&rh).unwrap();
        assert!(
            json.contains("\"custom_height\":true"),
            "expected 'custom_height' field, got: {json}"
        );
        assert!(
            json.contains("\"hidden\":true"),
            "expected 'hidden':true field, got: {json}"
        );
    }
}
