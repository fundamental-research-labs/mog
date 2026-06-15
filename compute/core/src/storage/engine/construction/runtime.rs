use super::*;

pub(in crate::storage::engine) fn create_observer_and_undo(
    storage: &YrsStorage,
) -> (DocumentObserver, UndoRedoManager) {
    let sheets_map = storage.doc().get_or_insert_map("sheets");
    let workbook_map = storage.doc().get_or_insert_map("workbook");
    let observer = DocumentObserver::new(&sheets_map, &workbook_map);
    let mut undo_manager = UndoRedoManager::new(storage.doc(), &sheets_map);
    // Also track the workbook map so that named ranges, tables, and other
    // workbook-level structures participate in undo/redo.
    undo_manager.expand_scope(&workbook_map);
    let _ = observer.drain_changes();
    (observer, undo_manager)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Derive locale + theme palette from workbook settings.
pub(in crate::storage::engine) fn derive_settings(storage: &YrsStorage) -> EngineSettings {
    let culture =
        crate::storage::workbook::settings::get_settings(storage.doc(), storage.workbook_map())
            .culture;
    let locale = compute_formats::get_culture(&culture);
    let theme_palette = load_theme_palette(storage);
    EngineSettings {
        locale,
        theme_palette,
    }
}

/// Load the theme palette from the workbook map in Yrs storage.
///
/// Reads the `"theme"` sub-map from the workbook map, extracts the
/// `"data"` key as a JSON string, deserializes it as `ThemeData`, and
/// builds a slot-name -> hex-color map from the color palette entries.
///
/// Returns an empty map if any step fails (missing key, bad JSON, etc.).
pub(in crate::storage::engine) fn load_theme_palette(
    storage: &YrsStorage,
) -> HashMap<String, String> {
    let doc = storage.doc();
    let txn = doc.transact();
    let workbook = storage.workbook_map();

    let theme_map = match workbook.get(&txn, "theme") {
        Some(Out::YMap(m)) => m,
        _ => return HashMap::new(),
    };

    let json_str = match theme_map.get(&txn, "data") {
        Some(Out::Any(Any::String(s))) => s,
        _ => return HashMap::new(),
    };

    use domain_types::domain::theme::ThemeData;

    let theme_data: ThemeData = match serde_json::from_str(&json_str) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };

    let mut palette = HashMap::new();
    for tc in &theme_data.colors {
        palette.insert(tc.name.clone(), tc.color.clone());
    }
    palette
}

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

pub(in crate::storage::engine) fn hydrate_mirror_format_ranges(
    storage: &YrsStorage,
    mirror: &mut CellMirror,
) {
    let sheet_ids: Vec<_> = mirror.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        if let Some(sheet_mirror) = mirror.get_sheet_mut(&sheet_id) {
            crate::storage::properties::hydrate_col_format_ranges(storage, &sheet_id, sheet_mirror);
            crate::storage::properties::hydrate_format_ranges(storage, &sheet_id, sheet_mirror);
        }
    }
}

pub(in crate::storage::engine) fn sync_enable_calculation_flags(engine: &mut YrsComputeEngine) {
    use crate::storage::sheet::visibility;
    let sheet_ids = engine.stores.storage.sheet_order();
    for sheet_id in &sheet_ids {
        let enabled = visibility::is_sheet_calculation_enabled(
            engine.stores.storage.doc(),
            engine.stores.storage.sheets(),
            sheet_id,
        );
        engine.mirror.set_enable_calculation(sheet_id, enabled);
    }
}

// ---------------------------------------------------------------------------
// Custom cell style loading
// ---------------------------------------------------------------------------

/// Load custom cell styles from the Yrs `KEY_CUSTOM_CELL_STYLES` workbook map
/// into the in-memory `EngineStores::custom_cell_styles` FxHashMap.
///
/// Each entry in the Y.Map is a JSON-serialized `CellStyleDef`. Entries that
/// fail to deserialize are silently skipped (defensive — forward-compat).
pub(in crate::storage::engine) fn load_custom_cell_styles(stores: &mut EngineStores) {
    use compute_document::schema::KEY_CUSTOM_CELL_STYLES;
    use domain_types::domain::cell_style::CellStyleDef;

    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let styles_map = match workbook.get(&txn, KEY_CUSTOM_CELL_STYLES) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    for (key, value) in styles_map.iter(&txn) {
        let json_str = match value {
            Out::Any(Any::String(s)) => s,
            _ => continue,
        };
        match serde_json::from_str::<CellStyleDef>(&json_str) {
            Ok(style) => {
                stores.custom_cell_styles.insert(key.to_string(), style);
            }
            Err(_) => continue,
        }
    }
}

pub(in crate::storage::engine) fn load_custom_table_styles(stores: &mut EngineStores) {
    use compute_document::schema::KEY_CUSTOM_TABLE_STYLES;
    use compute_table::custom_styles::CustomTableStyleConfig;

    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let styles_map = match workbook.get(&txn, KEY_CUSTOM_TABLE_STYLES) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    for (key, value) in styles_map.iter(&txn) {
        let json_str = match value {
            Out::Any(Any::String(s)) => s,
            _ => continue,
        };
        if let Ok(style) = serde_json::from_str::<CustomTableStyleConfig>(&json_str) {
            stores.custom_table_styles.insert(key.to_string(), style);
        }
    }
}
