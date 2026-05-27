use super::*;

// -------------------------------------------------------------------
// Sheet Metadata Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_all_sheet_ids(stores: &EngineStores) -> Vec<String> {
    let yrs_sheets: Vec<String> = stores
        .storage
        .sheet_order()
        .iter()
        .map(|sid| id_to_hex(sid.as_u128()).into())
        .collect();
    // Deferred hydration: Yrs is empty but ComputeCore has sheet order from snapshot
    if yrs_sheets.is_empty() {
        return stores
            .compute
            .ordered_sheets()
            .iter()
            .map(|sid| id_to_hex(sid.as_u128()).into())
            .collect();
    }
    yrs_sheets
}

pub(in crate::storage::engine) fn get_sheet_name(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<String> {
    properties::get_sheet_name(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_hidden(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    visibility::is_sheet_hidden(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn is_sheet_protected(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    protection::is_sheet_protected(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

// -------------------------------------------------------------------
// Sheet Metadata (extended)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_sheet_index(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<usize> {
    stores
        .storage
        .sheet_order()
        .iter()
        .position(|sid| sid == sheet_id)
}

pub(in crate::storage::engine) fn get_frozen_panes_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> FrozenPanes {
    view::get_frozen_panes(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_view_options_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> SheetViewOptions {
    view::get_view_options(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_scroll_position_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> SheetScrollPosition {
    view::get_scroll_position(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_tab_color_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<String> {
    properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)?.tab_color
}

pub(in crate::storage::engine) fn get_sheet_protection_config(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> SheetProtectionConfig {
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    SheetProtectionConfig {
        is_protected: settings.is_protected,
        protection_password_hash: settings.protection_password_hash,
    }
}

// -------------------------------------------------------------------
// Sheet Extended Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_visible_sheet_ids(stores: &EngineStores) -> Vec<String> {
    visibility::get_visible_sheets(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
    )
    .iter()
    .map(|sid| id_to_hex(sid.as_u128()).into())
    .collect()
}

pub(in crate::storage::engine) fn get_hidden_sheet_ids(stores: &EngineStores) -> Vec<String> {
    visibility::get_hidden_sheets(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
    )
    .iter()
    .map(|sid| id_to_hex(sid.as_u128()).into())
    .collect()
}

pub(in crate::storage::engine) fn count_visible_sheets(stores: &EngineStores) -> u32 {
    visibility::count_visible_sheets(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
    )
}

pub(in crate::storage::engine) fn get_sheet_order(stores: &EngineStores) -> Vec<String> {
    order::get_sheet_order(stores.storage.doc(), stores.storage.workbook_map())
        .iter()
        .map(|sid| id_to_hex(sid.as_u128()).into())
        .collect()
}

pub(in crate::storage::engine) fn get_first_sheet_id(stores: &EngineStores) -> Option<String> {
    properties::get_first_sheet_id(stores.storage.doc(), stores.storage.workbook_map())
        .map(|sid| String::from(id_to_hex(sid.as_u128())))
}

pub(in crate::storage::engine) fn get_print_settings(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> domain_types::domain::print::PrintSettings {
    print::get_print_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_hf_images(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
    print::get_hf_images(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_sheet_meta(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<SheetMeta> {
    properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn has_sheet_protection_password(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    settings
        .protection_password_hash
        .map(|h| !h.is_empty())
        .unwrap_or(false)
}
