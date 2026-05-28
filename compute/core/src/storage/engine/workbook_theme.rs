use std::collections::HashMap;

use bridge_core as bridge;

use super::{YrsComputeEngine, construction};
use crate::snapshot::MutationResult;
use crate::storage::YrsStorage;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "core_theme",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Locale
    // -------------------------------------------------------------------

    /// Get the cached locale for this workbook.
    pub fn locale(&self) -> &compute_formats::CultureInfo {
        &self.settings.locale
    }

    /// Update the cached locale when the workbook culture changes.
    #[bridge::write(scope = "workbook")]
    pub fn set_culture(
        &mut self,
        culture: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.settings.locale = compute_formats::get_culture(culture);
        // Locale affects date/number parsing — safest to require a fresh recalc.
        self.stores.compute.mark_dirty();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    // -------------------------------------------------------------------
    // Theme palette
    // -------------------------------------------------------------------

    /// Get the cached theme palette (slot name → hex color).
    pub fn theme_palette(&self) -> &HashMap<String, String> {
        &self.settings.theme_palette
    }

    /// Load the theme palette from the workbook map in Yrs storage.
    fn load_theme_palette(storage: &YrsStorage) -> HashMap<String, String> {
        construction::load_theme_palette(storage)
    }

    /// Set the workbook theme at runtime.
    ///
    /// Writes the theme data to the Yrs CRDT document, rebuilds the
    /// cached theme palette, and invalidates all viewport format palettes
    /// so that subsequent renders pick up the new theme colors.
    #[bridge::write(scope = "workbook")]
    pub fn set_workbook_theme(
        &mut self,
        theme: domain_types::domain::theme::ThemeData,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // 1. Write to Yrs
        {
            use yrs::Transact;
            let doc = self.stores.storage.doc();
            let mut txn = doc.transact_mut();
            let workbook = self.stores.storage.workbook_map();
            crate::storage::infra::hydration::write_theme_data_to_yrs(workbook, &theme, &mut txn);
            // txn commits on drop
        }

        // 2. Rebuild cached palette from Yrs
        self.settings.theme_palette = Self::load_theme_palette(&self.stores.storage);

        // 3. Invalidate viewport format palettes (stale theme-resolved colors)
        self.viewport.clear_all_palettes();

        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    /// Read the current workbook theme from the Yrs document.
    #[bridge::read(scope = "workbook")]
    pub fn get_workbook_theme(
        &self,
    ) -> Result<domain_types::domain::theme::ThemeData, ComputeError> {
        use domain_types::domain::theme::ThemeData;
        use yrs::{Any, Map, Out, Transact};

        let doc = self.stores.storage.doc();
        let txn = doc.transact();
        let workbook = self.stores.storage.workbook_map();

        let theme_map = match workbook.get(&txn, "theme") {
            Some(Out::YMap(m)) => m,
            _ => return Ok(ThemeData::default()),
        };

        let json_str = match theme_map.get(&txn, "data") {
            Some(Out::Any(Any::String(s))) => s,
            _ => return Ok(ThemeData::default()),
        };

        serde_json::from_str::<ThemeData>(&json_str).map_err(|e| ComputeError::Eval {
            message: format!("failed to deserialize theme data: {}", e),
        })
    }
}
