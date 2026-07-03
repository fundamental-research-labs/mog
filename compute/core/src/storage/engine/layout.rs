//! Layout index bridge methods for YrsComputeEngine.
//!
//! Exposes per-sheet cell-to-pixel position queries via the bridge API,
//! and autofit operations that compute optimal column widths / row heights
//! from cell content using Rust text measurement.

use super::{YrsComputeEngine, services};
use crate::snapshot::MutationResult;
use bridge_core as bridge;
use cell_types::SheetId;
use compute_wire::mutation::serialize_multi_viewport_patches;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "layout",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    /// Get the pixel position (top edge) of a row.
    #[bridge::read(scope = "sheet")]
    pub fn get_row_position(&self, sheet_id: &SheetId, row: u32) -> f64 {
        self.stores.layout_indexes.get(sheet_id).map_or(
            row as f64 * compute_layout_index::DEFAULT_ROW_HEIGHT.0,
            |li| li.get_row_position(row as usize).0,
        )
    }

    /// Get the pixel position (left edge) of a column.
    #[bridge::read(scope = "sheet")]
    pub fn get_col_position(&self, sheet_id: &SheetId, col: u32) -> f64 {
        self.stores.layout_indexes.get(sheet_id).map_or(
            col as f64 * self.stores.layout_metrics.default_column_width_px,
            |li| li.get_col_position(col as usize).0,
        )
    }

    /// Find the row index at a pixel Y position.
    #[bridge::read(scope = "sheet")]
    pub fn get_row_at_pixel(&self, sheet_id: &SheetId, y: f64) -> u32 {
        self.stores.layout_indexes.get(sheet_id).map_or(
            (y / compute_layout_index::DEFAULT_ROW_HEIGHT.0).max(0.0) as u32,
            |li| li.get_row_at_pixel(domain_types::units::Pixels(y)) as u32,
        )
    }

    /// Find the column index at a pixel X position.
    #[bridge::read(scope = "sheet")]
    pub fn get_col_at_pixel(&self, sheet_id: &SheetId, x: f64) -> u32 {
        self.stores.layout_indexes.get(sheet_id).map_or(
            (x / self.stores.layout_metrics.default_column_width_px).max(0.0) as u32,
            |li| li.get_col_at_pixel(domain_types::units::Pixels(x)) as u32,
        )
    }

    /// Get the height of a row (0 if hidden).
    #[bridge::read(scope = "sheet")]
    pub fn get_row_height_from_index(&self, sheet_id: &SheetId, row: u32) -> f64 {
        self.stores
            .layout_indexes
            .get(sheet_id)
            .map_or(compute_layout_index::DEFAULT_ROW_HEIGHT.0, |li| {
                li.get_row_height(row as usize).0
            })
    }

    /// Get the width of a column (0 if hidden).
    #[bridge::read(scope = "sheet")]
    pub fn get_col_width_from_index(&self, sheet_id: &SheetId, col: u32) -> f64 {
        self.stores
            .layout_indexes
            .get(sheet_id)
            .map_or(self.stores.layout_metrics.default_column_width_px, |li| {
                li.get_col_width(col as usize).0
            })
    }

    // -------------------------------------------------------------------
    // Autofit — compute + set optimal dimensions from cell content
    // -------------------------------------------------------------------

    /// Compute and set optimal width for a single column.
    #[bridge::write(scope = "sheet")]
    pub fn auto_fit_column_and_set(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::autofit::auto_fit_column_and_set(
            &mut self.stores,
            &self.mirror,
            &self.settings,
            sheet_id,
            col,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Compute and set optimal widths for multiple columns in one call.
    #[bridge::write(scope = "sheet")]
    pub fn auto_fit_columns_and_set(
        &mut self,
        sheet_id: &SheetId,
        cols: Vec<u32>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::autofit::auto_fit_columns_and_set(
            &mut self.stores,
            &self.mirror,
            &self.settings,
            sheet_id,
            &cols,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Compute and set optimal heights for multiple rows in one call.
    #[bridge::write(scope = "sheet")]
    pub fn auto_fit_rows_and_set(
        &mut self,
        sheet_id: &SheetId,
        rows: Vec<u32>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::autofit::auto_fit_rows_and_set(
            &mut self.stores,
            &self.mirror,
            &self.settings,
            sheet_id,
            &rows,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }
}
