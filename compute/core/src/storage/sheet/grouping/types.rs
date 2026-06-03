pub use crate::engine_types::{
    GroupBoundary, OutlineLevelButton, OutlineRenderData, OutlineSymbol, Viewport,
};
pub use domain_types::domain::grouping::{
    GroupAxis, GroupDefinition, OutlineLevel, OutlineSettingsUpdate, SheetGroupingConfig,
    SubtotalFunction, SubtotalOptions, SubtotalResult,
};

/// Maximum outline level (Excel compatibility: 8 levels).
pub const MAX_OUTLINE_LEVEL: u32 = 8;

pub type CellRange = crate::PositionRange;

pub(crate) fn adjacent_summary_index(start: u32, end: u32, summary_after: bool) -> Option<u32> {
    if summary_after {
        end.checked_add(1)
    } else {
        start.checked_sub(1)
    }
}

pub(crate) fn row_summary_index(group: &GroupDefinition, summary_rows_below: bool) -> Option<u32> {
    adjacent_summary_index(group.start, group.end, summary_rows_below)
}

pub(crate) fn column_summary_index(
    group: &GroupDefinition,
    summary_columns_right: bool,
) -> Option<u32> {
    adjacent_summary_index(group.start, group.end, summary_columns_right)
}

/// Trait for subtotal operations that require cell access.
pub trait SubtotalsCellAccessor {
    fn get_cell_value(&self, sheet_id: &cell_types::SheetId, row: u32, col: u32) -> String;
    fn set_cell_value(&mut self, sheet_id: &cell_types::SheetId, row: u32, col: u32, value: &str);
    fn insert_rows(&mut self, sheet_id: &cell_types::SheetId, start_row: u32, count: u32);
    fn delete_rows(&mut self, sheet_id: &cell_types::SheetId, start_row: u32, count: u32);
    fn get_cell_raw_value(&self, sheet_id: &cell_types::SheetId, row: u32, col: u32) -> String;
}
