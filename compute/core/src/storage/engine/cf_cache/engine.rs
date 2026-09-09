use super::super::ComputeEngine;
use crate::snapshot::RecalcResult;

impl ComputeEngine {
    /// After a recalculation pass, refresh the CF cache for every sheet that
    /// both (a) has conditional formatting rules and (b) had at least one cell
    /// change in the recalc result.
    pub(crate) fn refresh_cf_caches_after_recalc(&mut self, recalc: &RecalcResult) {
        super::super::services::cf_cache::refresh_cf_caches_after_recalc(
            &mut self.stores,
            &self.cell_store,
            &self.settings.theme_palette,
            recalc,
        )
    }

    /// Re-evaluate all conditional formatting rules for a sheet and update the cache.
    pub(crate) fn refresh_cf_cache(&mut self, sheet_id: &cell_types::SheetId) {
        super::super::services::cf_cache::refresh_cf_cache(
            &mut self.stores,
            &self.cell_store,
            &self.settings.theme_palette,
            sheet_id,
        );
    }
}
