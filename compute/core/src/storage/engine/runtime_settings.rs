use crate::snapshot::{CalculationSettings, WorkbookSettings};
use crate::storage::engine::ComputeEngine;

impl ComputeEngine {
    pub(crate) fn sync_runtime_workbook_settings(
        &mut self,
        pre: &WorkbookSettings,
        post: &WorkbookSettings,
    ) {
        if pre.culture != post.culture {
            self.settings.locale = compute_formats::get_culture(&post.culture);
            self.viewport.clear_all_palettes();
            self.stores.compute.mark_dirty();
        }
        self.sync_runtime_calculation_settings(
            &pre.calculation_settings.clone().unwrap_or_default(),
            &post.calculation_settings.clone().unwrap_or_default(),
        );
    }

    pub(crate) fn sync_runtime_calculation_settings(
        &mut self,
        pre: &CalculationSettings,
        post: &CalculationSettings,
    ) {
        self.sync_runtime_date_system_from_storage();
        self.apply_runtime_calculation_settings(post);

        if pre != post {
            self.stores.compute.mark_dirty();
        }
    }

    pub(crate) fn sync_runtime_date_system_from_storage(&mut self) {
        let date1904 =
            crate::storage::workbook::settings::get_settings(&self.stores.storage.metadata)
                .date1904;
        if self.mirror.date1904 != date1904 {
            self.mirror.date1904 = date1904;
            self.stores.compute.mark_dirty();
            // Calendar rules depend on the workbook epoch even when literal
            // date values stay unchanged, including during undo and redo.
            self.init_cf_caches();
        }
    }

    fn apply_runtime_calculation_settings(&mut self, settings: &CalculationSettings) {
        self.stores.compute.set_calc_mode(settings.calc_mode);
        self.stores
            .compute
            .set_iterative_calc(settings.enable_iterative_calculation);
        self.stores
            .compute
            .set_max_iterations(settings.max_iterations);
        self.stores
            .compute
            .set_max_change(settings.max_change.get());
    }
}
