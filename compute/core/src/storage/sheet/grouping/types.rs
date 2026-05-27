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

/// Trait for subtotal operations that require cell access.
pub trait SubtotalsCellAccessor {
    fn get_cell_value(&self, sheet_id: &cell_types::SheetId, row: u32, col: u32) -> String;
    fn set_cell_value(&mut self, sheet_id: &cell_types::SheetId, row: u32, col: u32, value: &str);
    fn insert_rows(&mut self, sheet_id: &cell_types::SheetId, start_row: u32, count: u32);
    fn delete_rows(&mut self, sheet_id: &cell_types::SheetId, start_row: u32, count: u32);
    fn get_cell_raw_value(&self, sheet_id: &cell_types::SheetId, row: u32, col: u32) -> String;
}
