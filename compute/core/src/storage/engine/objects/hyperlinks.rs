use super::shared;
use crate::snapshot::MutationResult;
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::cell_semantics::hyperlink_url_for_cell;
use crate::storage::engine::services;
use crate::storage::sheet::hyperlinks;
use bridge_core as bridge;
use cell_types::SheetId;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "objects_hyperlinks",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "cell")]
    pub fn set_hyperlink(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        url: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_hyperlink(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            row,
            col,
            url,
        )
        .map(shared::with_empty_patches)
    }

    /// Remove the hyperlink from a cell at the given position.
    #[bridge::write(scope = "cell")]
    pub fn remove_hyperlink(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::remove_hyperlink(&mut self.stores, &mut self.mirror, sheet_id, row, col)
            .map(shared::with_empty_patches)
    }

    /// Get the effective hyperlink URL for a cell at the given position.
    /// Explicit hyperlink metadata wins; literal HYPERLINK() formulas are derived.
    #[bridge::read(scope = "cell")]
    pub fn get_hyperlink(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<String> {
        let direct = hyperlink_url_for_cell(
            &self.stores,
            &self.mirror,
            sheet_id,
            row,
            col,
            self.mirror
                .resolve_cell_id(sheet_id, cell_types::SheetPos::new(row, col)),
        );
        if direct.is_some() {
            return direct;
        }

        self.query_range(sheet_id, row, col, row, col)
            .cells
            .into_iter()
            .next()
            .and_then(|cell| cell.hyperlink_url)
    }

    /// Remove all hyperlinks in a rectangular range (single bridge call).
    ///
    /// Iterates every cell in the range, checks for a hyperlink, and removes
    /// it if present. This replaces the N-IPC-call pattern in the TS kernel.
    #[bridge::write(scope = "range")]
    pub fn clear_hyperlinks_in_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        for row in start_row..=end_row {
            for col in start_col..=end_col {
                let has = self
                    .stores
                    .grid_indexes
                    .get(sheet_id)
                    .map(|grid| {
                        hyperlinks::get_hyperlink(
                            self.stores.storage.doc(),
                            self.stores.storage.sheets(),
                            sheet_id,
                            grid,
                            row,
                            col,
                        )
                        .is_some()
                    })
                    .unwrap_or(false);
                if has {
                    services::objects::remove_hyperlink(
                        &mut self.stores,
                        &mut self.mirror,
                        sheet_id,
                        row,
                        col,
                    )?;
                }
            }
        }
        Ok((shared::empty_patches(), MutationResult::empty()))
    }
}
