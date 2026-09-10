use std::collections::HashMap;

use crate::storage::engine::history::metadata::capture_workbook_field;
use bridge_core as bridge;
use compute_functions::CharCodePage;

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
    #[bridge::write]
    pub fn set_culture(&mut self, culture: &str) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            capture_workbook_field!(engine.stores.storage, settings.culture);
            engine.stores.storage.metadata.settings.culture = culture.to_owned();
            engine.settings.locale = compute_formats::get_culture(culture);
            // Locale affects date/number parsing — safest to require a fresh recalc.
            engine.stores.compute.mark_dirty();
            Ok(MutationResult::empty())
        })
    }

    /// Get the runtime code page used by the legacy CHAR/CODE functions.
    ///
    /// This option is session-scoped. It is intentionally independent from
    /// workbook culture and is not stored in native metadata or exported as
    /// workbook metadata.
    pub fn char_code_page(&self) -> u16 {
        self.cell_store.char_code_page.code_page_id()
    }

    /// Select the runtime code page used by the legacy CHAR/CODE functions.
    ///
    /// The wire API uses Microsoft's numeric code-page identifiers because the
    /// bridge does not expose the internal enum. Supported values are 1252
    /// (Windows ANSI) and 10000 (Macintosh Roman). Changing the selection
    /// invalidates calculation results and is applied by the next recalc.
    #[bridge::write]
    pub fn set_char_code_page(
        &mut self,
        code_page_id: u16,
    ) -> Result<MutationResult, ComputeError> {
        let page =
            CharCodePage::from_code_page_id(code_page_id).ok_or_else(|| ComputeError::Eval {
                message: format!("unsupported CHAR/CODE code page {code_page_id}"),
            })?;

        if self.cell_store.char_code_page != page {
            self.cell_store.char_code_page = page;
            self.stores.compute.mark_dirty();
        }

        Ok(MutationResult::empty())
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
    #[bridge::write]
    pub fn set_workbook_theme(
        &mut self,
        theme: domain_types::domain::theme::ThemeData,
    ) -> Result<MutationResult, ComputeError> {
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

            Ok(MutationResult::empty())
        })
    }

    /// Read the current workbook theme.
    #[bridge::read]
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
