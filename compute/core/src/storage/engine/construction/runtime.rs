use super::*;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Derive locale + theme palette from workbook settings.
pub(in crate::storage::engine) fn derive_settings(storage: &WorkbookStorage) -> EngineSettings {
    let culture = crate::storage::workbook::settings::get_settings(&storage.metadata).culture;
    let locale = compute_formats::get_culture(&culture);
    let theme_palette = load_theme_palette(storage);
    EngineSettings {
        locale,
        theme_palette,
    }
}

/// Build the theme color lookup from native workbook metadata.
pub(in crate::storage::engine) fn load_theme_palette(
    storage: &WorkbookStorage,
) -> HashMap<String, String> {
    storage
        .metadata
        .theme
        .iter()
        .flat_map(|theme| theme.colors.iter())
        .map(|color| (color.name.clone(), color.color.clone()))
        .collect()
}

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

pub(in crate::storage::engine) fn collect_imported_formats(
    output: &domain_types::ParseOutput,
    sheet_ids: &[SheetId],
    promoted: &[Vec<crate::storage::infra::hydration::ImportedRangeStyle>],
) -> Vec<(SheetId, crate::storage::properties::ImportedFormats)> {
    output
        .sheets
        .iter()
        .zip(sheet_ids)
        .enumerate()
        .map(|(index, (sheet, id))| {
            (
                *id,
                crate::storage::properties::ImportedFormats::from_sheet(
                    sheet,
                    promoted.get(index).map(Vec::as_slice).unwrap_or_default(),
                    &crate::storage::STORAGE_ID_ALLOC,
                ),
            )
        })
        .collect()
}

pub(in crate::storage::engine) fn install_imported_formats(
    mirror: &mut CellMirror,
    palette: &[domain_types::CellFormat],
    formats: &[(SheetId, crate::storage::properties::ImportedFormats)],
) {
    for (id, formats) in formats {
        if let Some(sheet) = mirror.get_sheet_mut(id) {
            formats.install(sheet, palette);
        }
    }
}

pub(in crate::storage::engine) fn sync_enable_calculation_flags(engine: &mut ComputeEngine) {
    use crate::storage::sheet::visibility;
    let sheet_ids = engine.stores.storage.sheet_order();
    for sheet_id in &sheet_ids {
        let enabled = visibility::is_sheet_calculation_enabled(&engine.stores.storage, sheet_id);
        engine.mirror.set_enable_calculation(sheet_id, enabled);
    }
}
