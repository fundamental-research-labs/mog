use crate::snapshot::CalculationSettings;
use crate::storage::engine::YrsComputeEngine;

impl YrsComputeEngine {
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

    pub(super) fn sync_runtime_calculation_settings_from_storage(&mut self) {
        self.sync_runtime_date_system_from_storage();
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

    pub(crate) fn sync_runtime_date_system_from_storage(&mut self) {
        let date1904 = crate::storage::workbook::settings::get_settings(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        )
        .date1904;
        if self.mirror.date1904 != date1904 {
            self.mirror.date1904 = date1904;
            self.stores.compute.mark_dirty();
            // Literal date cells do not change numerically when their epoch
            // changes, but calendar CF rules do. Refresh here so cache-backed
            // reads after any local or synchronized settings update see the
            // new date system even before formula recalculation.
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

    fn runtime_calculation_settings_changed(&self, settings: &CalculationSettings) -> bool {
        self.stores.compute.calc_mode() != settings.calc_mode
            || self.stores.compute.iterative_calc() != settings.enable_iterative_calculation
            || self.stores.compute.max_iterations() != settings.max_iterations
            || self.stores.compute.max_change() != settings.max_change.get()
    }
}
