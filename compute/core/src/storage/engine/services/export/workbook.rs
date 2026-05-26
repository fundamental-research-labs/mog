//! Workbook-level export functions.
//!
//! Extracted from `export.rs` — theme, protection, document properties,
//! workbook properties, file version, file sharing, slicer caches, and
//! parsed pivot tables.

use compute_document::schema::*;
use domain_types::{domain::theme::ThemeData, domain::workbook::WorkbookProtection, yrs_schema};
use yrs::{Any, Map, Out, Transact};

use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::pivots;

// -------------------------------------------------------------------
// Workbook-level exports
// -------------------------------------------------------------------

/// Export theme data from the workbook-level theme map.
pub(in crate::storage::engine) fn export_workbook_theme(
    stores: &EngineStores,
) -> Option<ThemeData> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let theme_map = match workbook.get(&txn, KEY_THEME) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let json_str = match theme_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return None,
    };

    if let Ok(theme) = serde_json::from_str::<ThemeData>(&json_str)
        && (!theme.colors.is_empty() || theme.major_font.is_some() || theme.minor_font.is_some())
    {
        return Some(theme);
    }

    // Fallback: internal format uses "color_palette" instead of "colors"
    #[derive(serde::Deserialize)]
    struct InternalTheme {
        #[serde(default)]
        color_palette: Vec<domain_types::domain::theme::ThemeColor>,
        major_font: Option<String>,
        minor_font: Option<String>,
    }

    if let Ok(internal) = serde_json::from_str::<InternalTheme>(&json_str)
        && (!internal.color_palette.is_empty()
            || internal.major_font.is_some()
            || internal.minor_font.is_some())
    {
        return Some(ThemeData {
            colors: internal.color_palette,
            major_font: internal.major_font,
            minor_font: internal.minor_font,
            name: None,
        });
    }

    None
}

/// Export workbook protection from the workbook settings map.
pub(in crate::storage::engine) fn export_workbook_protection(
    stores: &EngineStores,
) -> Option<WorkbookProtection> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let settings_map = match workbook.get(&txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let prot_map = match settings_map.get(&txn, "protection") {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    yrs_schema::protection::workbook_from_yrs_map(&prot_map, &txn)
}

/// Export document properties from the workbook-level `documentProperties` Y.Map.
pub(super) fn export_document_properties(
    stores: &EngineStores,
) -> Option<domain_types::DocumentProperties> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let props_map = match workbook.get(&txn, KEY_DOCUMENT_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let props = yrs_schema::doc_properties::from_yrs_map(&props_map, &txn);
    // Return None if completely empty (no fields set) to match pre-hydration behavior
    if props == domain_types::DocumentProperties::default() {
        None
    } else {
        Some(props)
    }
}

/// Export workbook properties from the `workbookSettings` Y.Map.
pub(super) fn export_workbook_properties(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::WorkbookProperties> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let settings_map = match workbook.get(&txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    // Only return Some if at least one workbook property key is present
    // (check for the date1904 key as a sentinel — it's always written during hydration)
    settings_map.get(&txn, "date1904")?;

    Some(yrs_schema::workbook_properties::from_yrs_map(
        &settings_map,
        &txn,
    ))
}

/// Export file version from the workbook-level `fileVersion` Y.Map.
pub(super) fn export_file_version(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::FileVersion> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let fv_map = match workbook.get(&txn, KEY_FILE_VERSION) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let fv = yrs_schema::file_version::from_yrs_map(&fv_map, &txn);
    if fv == domain_types::domain::workbook::FileVersion::default() {
        None
    } else {
        Some(fv)
    }
}

/// Export file sharing from the workbook-level `fileSharing` Y.Map.
pub(super) fn export_file_sharing(
    stores: &EngineStores,
) -> Option<domain_types::domain::workbook::FileSharing> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let fs_map = match workbook.get(&txn, KEY_FILE_SHARING) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    let fs = yrs_schema::file_sharing::from_yrs_map(&fs_map, &txn);
    if fs == domain_types::domain::workbook::FileSharing::default() {
        None
    } else {
        Some(fs)
    }
}

/// Export slicer caches from the workbook-level slicers map.
pub(in crate::storage::engine) fn export_workbook_slicer_caches(
    stores: &EngineStores,
) -> Vec<ooxml_types::slicers::SlicerCacheDef> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let slicers_map = match workbook.get(&txn, KEY_SLICERS) {
        Some(Out::YMap(m)) => m,
        _ => return vec![],
    };

    let mut caches = Vec::new();
    for (_, value) in slicers_map.iter(&txn) {
        if let Out::Any(Any::String(json_str)) = value {
            if let Ok(stored) =
                serde_json::from_str::<domain_types::domain::slicer::StoredSlicer>(&json_str)
            {
                caches.push(domain_types::domain::slicer::stored_slicer_to_cache_def(
                    &stored,
                ));
                continue;
            }
            match serde_json::from_str::<ooxml_types::slicers::SlicerCacheDef>(&json_str) {
                Ok(cache_def) => caches.push(cache_def),
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "Failed to deserialize slicer entry during export, skipping"
                    );
                }
            }
        }
    }
    caches
}

/// Export parsed pivot tables from workbook-level pivotSpecs map AND sheet-level
/// pivotTables maps.
///
/// Workbook-level specs (from XLSX import) take priority: if a pivot name already
/// exists in the workbook-level set, the sheet-level entry is skipped. This
/// preserves OOXML-specific metadata (styles, custom sorts, number formats) for
/// imported pivots that would be lost in a round-trip through `PivotTableConfig`.
pub(in crate::storage::engine) fn export_workbook_parsed_pivot_tables(
    stores: &EngineStores,
) -> Vec<domain_types::domain::pivot::ParsedPivotTable> {
    use domain_types::domain::pivot::ParsedPivotTable;

    let doc = stores.storage.doc();
    let sheets_ref = stores.storage.sheets();

    // 1. Collect workbook-level parsed pivot tables (from XLSX import hydration).
    let mut result: Vec<ParsedPivotTable> = Vec::new();
    {
        let txn = doc.transact();
        let workbook = stores.storage.workbook_map();
        if let Some(Out::YMap(pivot_map)) = workbook.get(&txn, KEY_PIVOT_SPECS) {
            for (_, value) in pivot_map.iter(&txn) {
                if let Out::Any(Any::String(json_str)) = value {
                    match serde_json::from_str::<ParsedPivotTable>(&json_str) {
                        Ok(pt) => result.push(pt),
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                "Failed to deserialize ParsedPivotTable during export, skipping entry"
                            );
                        }
                    }
                }
            }
        }
    }

    // 2. Collect sheet-level pivots (API-created) and merge with dedup.
    let existing_names: std::collections::HashSet<String> =
        result.iter().map(|pt| pt.config.name.clone()).collect();

    let sheet_ids = stores.storage.sheet_order();
    for sheet_id in &sheet_ids {
        let sheet_pivots = pivots::get_all_pivots(doc, sheets_ref, sheet_id);
        for config in sheet_pivots {
            if existing_names.contains(&config.name) {
                continue; // Imported pivot — keep original workbook-level spec
            }
            result.push(ParsedPivotTable {
                config,
                initial_expansion_state: None,
            });
        }
    }

    result
}
