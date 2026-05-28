use super::super::YrsComputeEngine;
use crate::snapshot::RecalcResult;

impl YrsComputeEngine {
    /// After a recalculation pass, refresh the CF cache for every sheet that
    /// both (a) has conditional formatting rules and (b) had at least one cell
    /// change in the recalc result.
    ///
    /// Returns, per sheet, the `(row, col)` pairs of cells whose CF result
    /// changed but were NOT already in `recalc.changed_cells`. The caller
    /// (`produce_viewport_patches_for_recalc`) uses this to synthesize
    /// additional `CellChange` entries so sibling cells receive viewport patches.
    pub(crate) fn refresh_cf_caches_after_recalc(
        &mut self,
        recalc: &RecalcResult,
    ) -> rustc_hash::FxHashMap<cell_types::SheetId, Vec<(u32, u32)>> {
        super::super::services::cf_cache::refresh_cf_caches_after_recalc(
            &mut self.stores,
            &self.mirror,
            recalc,
        )
    }

    /// Re-evaluate all conditional formatting rules for a sheet and update the cache.
    pub(crate) fn refresh_cf_cache(&mut self, sheet_id: &cell_types::SheetId) {
        super::super::services::cf_cache::refresh_cf_cache(
            &mut self.stores,
            &self.mirror,
            sheet_id,
        );
    }
}
