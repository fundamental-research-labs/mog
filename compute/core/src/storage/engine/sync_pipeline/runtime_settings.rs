use crate::snapshot::CalculationSettings;
use crate::storage::engine::YrsComputeEngine;

impl YrsComputeEngine {
    pub(crate) fn sync_runtime_calculation_settings(
        &mut self,
        pre: &CalculationSettings,
        post: &CalculationSettings,
    ) {
        self.apply_runtime_calculation_settings(post);

        if pre != post {
            self.stores.compute.mark_dirty();
        }
    }

    pub(super) fn sync_runtime_calculation_settings_from_storage(&mut self) {
        let settings = crate::storage::workbook::settings::get_calculation_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let runtime_changed = self.runtime_calculation_settings_changed(&settings);
        self.apply_runtime_calculation_settings(&settings);

        if runtime_changed {
            self.stores.compute.mark_dirty();
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

    fn runtime_calculation_settings_changed(&self, settings: &CalculationSettings) -> bool {
        self.stores.compute.calc_mode() != settings.calc_mode
            || self.stores.compute.iterative_calc() != settings.enable_iterative_calculation
            || self.stores.compute.max_iterations() != settings.max_iterations
            || self.stores.compute.max_change() != settings.max_change.get()
    }
}
