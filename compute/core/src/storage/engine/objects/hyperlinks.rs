use super::shared;
use crate::snapshot::MutationResult;
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::services;
use crate::storage::sheet::hyperlinks;
use bridge_core as bridge;
use cell_types::SheetId;
use domain_types::domain::hyperlink::Hyperlink;
use value_types::ComputeError;

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "objects_hyperlinks",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    #[bridge::write]
    pub fn set_hyperlink(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        url: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            services::objects::set_hyperlink(
                &mut engine.stores,
                &mut engine.mirror,
                sheet_id,
                row,
                col,
                url,
            )
            .map(shared::with_empty_patches)
        })
    }

    /// Remove the hyperlink from a cell at the given position.
    #[bridge::write]
    pub fn remove_hyperlink(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            services::objects::remove_hyperlink(
                &mut engine.stores,
                &mut engine.mirror,
                sheet_id,
                row,
                col,
            )
            .map(shared::with_empty_patches)
        })
    }

    /// Get the hyperlink URL for a cell at the given position.
    #[bridge::read]
    pub fn get_hyperlink(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<String> {
        services::objects::get_hyperlink(&self.stores, &self.mirror, sheet_id, row, col)
    }

    /// Get full hyperlink metadata for all hyperlinks on a worksheet.
    #[bridge::read]
    pub fn get_hyperlinks(&self, sheet_id: &SheetId) -> Vec<Hyperlink> {
        let Some(grid) = self.stores.grid_indexes.get(sheet_id) else {
            return Vec::new();
        };
        hyperlinks::get_all_hyperlinks(&self.stores.storage, sheet_id, grid)
    }

    /// Remove explicit hyperlinks whose anchors fall inside a rectangular range.
    #[bridge::write]
    pub fn clear_hyperlinks_in_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            if let Some(grid) = engine.stores.grid_indexes.get(sheet_id) {
                hyperlinks::clear_hyperlinks_in_range(
                    &mut engine.stores.storage,
                    sheet_id,
                    grid,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                );
            }
            Ok((shared::empty_patches(), MutationResult::empty()))
        })
    }
}
