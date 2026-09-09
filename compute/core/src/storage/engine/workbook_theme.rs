use std::collections::HashMap;

use crate::storage::engine::history::metadata::capture_workbook_field;
use bridge_core as bridge;

use super::{ComputeEngine, construction};
use crate::snapshot::MutationResult;
use crate::storage::WorkbookStorage;
use value_types::ComputeError;

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "core_theme",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
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
        self.with_history(|engine| {
            capture_workbook_field!(engine.stores.storage, settings.culture);
            engine.stores.storage.metadata.settings.culture = culture.to_owned();
            engine.settings.locale = compute_formats::get_culture(culture);
            // Locale affects date/number parsing — safest to require a fresh recalc.
            engine.stores.compute.mark_dirty();
            Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ))
        })
    }

    // -------------------------------------------------------------------
    // Theme palette
    // -------------------------------------------------------------------

    /// Get the cached theme palette (slot name → hex color).
    pub fn theme_palette(&self) -> &HashMap<String, String> {
        &self.settings.theme_palette
    }

    /// Build the cached palette from native metadata.
    fn load_theme_palette(storage: &WorkbookStorage) -> HashMap<String, String> {
        construction::load_theme_palette(storage)
    }

    /// Set the workbook theme at runtime.
    ///
    /// Updates native theme metadata, rebuilds the
    /// cached theme palette, and invalidates all viewport format palettes
    /// so that subsequent renders pick up the new theme colors.
    #[bridge::write(scope = "workbook")]
    pub fn set_workbook_theme(
        &mut self,
        theme: domain_types::domain::theme::ThemeData,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            capture_workbook_field!(engine.stores.storage, theme);
            engine.stores.storage.metadata.theme = Some(theme);

            engine.settings.theme_palette = Self::load_theme_palette(&engine.stores.storage);

            // 3. CF color scales are materialized to concrete colors in the cache,
            // so a theme change must rebuild them before the next render.
            let sheet_ids = engine.stores.storage.sheet_order();
            for sheet_id in &sheet_ids {
                engine.refresh_cf_cache(sheet_id);
            }

            // 4. Invalidate viewport format palettes (stale theme-resolved colors)
            engine.viewport.clear_all_palettes();

            Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ))
        })
    }

    /// Read the current workbook theme.
    #[bridge::read(scope = "workbook")]
    pub fn get_workbook_theme(
        &self,
    ) -> Result<domain_types::domain::theme::ThemeData, ComputeError> {
        Ok(self
            .stores
            .storage
            .metadata
            .theme
            .clone()
            .unwrap_or_default())
    }
}
