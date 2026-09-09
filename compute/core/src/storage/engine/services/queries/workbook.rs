use super::*;
use crate::storage::engine::history::metadata::capture_workbook_field;

// Workbook Settings
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_workbook_settings(stores: &EngineStores) -> WorkbookSettings {
    workbook_settings::get_settings(&stores.storage.metadata)
}

// -------------------------------------------------------------------
// Document Properties
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_document_properties(
    stores: &EngineStores,
) -> domain_types::DocumentProperties {
    stores
        .storage
        .metadata
        .document_properties
        .clone()
        .unwrap_or_default()
}

pub(in crate::storage::engine) fn set_document_properties(
    stores: &mut EngineStores,
    properties: &domain_types::DocumentProperties,
) {
    capture_workbook_field!(stores.storage, document_properties);
    stores.storage.metadata.document_properties = Some(properties.clone());
}

// -------------------------------------------------------------------
// Workbook Granular Reads
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_calc_mode(stores: &EngineStores) -> String {
    match get_workbook_settings(stores)
        .calculation_settings
        .unwrap_or_default()
        .calc_mode
    {
        CalcMode::Auto => "auto",
        CalcMode::AutoNoTable => "autoNoTable",
        CalcMode::Manual => "manual",
    }
    .to_string()
}

pub(in crate::storage::engine) fn get_default_font() -> DefaultFont {
    DefaultFont {
        name: "Calibri".to_string(),
        size: 11,
        color: "#000000".to_string(),
    }
}

// -------------------------------------------------------------------
// Workbook Granular Settings (read)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_workbook_setting(
    stores: &EngineStores,
    key: &str,
) -> Option<serde_json::Value> {
    workbook_settings::get_setting(&stores.storage.metadata, key)
}

pub(in crate::storage::engine) fn get_calculation_settings(
    stores: &EngineStores,
) -> CalculationSettings {
    workbook_settings::get_calculation_settings(&stores.storage.metadata)
}

pub(in crate::storage::engine) fn is_iterative_calculation_enabled(stores: &EngineStores) -> bool {
    workbook_settings::is_iterative_calculation_enabled(&stores.storage.metadata)
}

// -------------------------------------------------------------------
// Workbook Protection (read)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_workbook_protection_options(
    stores: &EngineStores,
) -> WorkbookProtectionOptions {
    workbook_settings::get_protection_options(&stores.storage.metadata)
}

pub(in crate::storage::engine) fn has_workbook_protection_password(stores: &EngineStores) -> bool {
    workbook_settings::has_protection_password(&stores.storage.metadata)
}

pub(in crate::storage::engine) fn is_workbook_protected(stores: &EngineStores) -> bool {
    workbook_settings::is_protected(&stores.storage.metadata)
}

pub(in crate::storage::engine) fn is_workbook_operation_allowed(
    stores: &EngineStores,
    operation: ProtectedWorkbookOperation,
) -> Result<bool, ComputeError> {
    Ok(workbook_settings::is_operation_allowed(
        &stores.storage.metadata,
        operation,
    ))
}

pub(in crate::storage::engine) fn get_default_table_style_id(
    stores: &EngineStores,
) -> Option<String> {
    workbook_settings::get_default_table_style_id(&stores.storage.metadata)
}

pub(in crate::storage::engine) fn get_default_slicer_style(
    stores: &EngineStores,
) -> Option<String> {
    workbook_settings::get_default_slicer_style(&stores.storage.metadata)
}

// -------------------------------------------------------------------
// Named Slicer Style Registry (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_named_slicer_style_count(stores: &EngineStores) -> u32 {
    workbook_settings::get_named_slicer_style_count(&stores.storage.metadata)
}

pub(in crate::storage::engine) fn get_named_slicer_style(
    stores: &EngineStores,
    name: &str,
) -> Option<NamedSlicerStyle> {
    workbook_settings::get_named_slicer_style(&stores.storage.metadata, name)
}

pub(in crate::storage::engine) fn list_named_slicer_styles(
    stores: &EngineStores,
) -> Vec<NamedSlicerStyle> {
    workbook_settings::list_named_slicer_styles(&stores.storage.metadata)
}

pub(in crate::storage::engine) fn get_default_pivot_table_style(
    stores: &EngineStores,
) -> Option<String> {
    workbook_settings::get_default_pivot_table_style(&stores.storage.metadata)
}

// -------------------------------------------------------------------
// Custom Settings (arbitrary KV store)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_custom_setting(
    stores: &EngineStores,
    key: &str,
) -> Option<String> {
    workbook_settings::get_custom_setting(&stores.storage.metadata, key)
}

pub(in crate::storage::engine) fn list_custom_settings(
    stores: &EngineStores,
) -> Vec<(String, String)> {
    workbook_settings::list_custom_settings(&stores.storage.metadata)
}

// -------------------------------------------------------------------
