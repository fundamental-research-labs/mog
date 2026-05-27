use super::*;

// Workbook Settings
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_workbook_settings(stores: &EngineStores) -> WorkbookSettings {
    workbook_settings::get_settings(stores.storage.doc(), stores.storage.workbook_map())
}

// -------------------------------------------------------------------
// Document Properties
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_document_properties(
    stores: &EngineStores,
) -> domain_types::DocumentProperties {
    use compute_document::schema::KEY_DOCUMENT_PROPERTIES;
    use yrs::{Map, Out};

    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    match workbook.get(&txn, KEY_DOCUMENT_PROPERTIES) {
        Some(Out::YMap(m)) => domain_types::yrs_schema::doc_properties::from_yrs_map(&m, &txn),
        _ => domain_types::DocumentProperties::default(),
    }
}

pub(in crate::storage::engine) fn set_document_properties(
    stores: &EngineStores,
    props: &domain_types::DocumentProperties,
) {
    use compute_document::schema::KEY_DOCUMENT_PROPERTIES;
    use yrs::{Any, Map, MapPrelim, Out};

    let doc = stores.storage.doc();
    let mut txn = doc.transact_mut();
    let workbook = stores.storage.workbook_map();

    let props_map = match workbook.get(&txn, KEY_DOCUMENT_PROPERTIES) {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            workbook.insert(&mut txn, KEY_DOCUMENT_PROPERTIES, empty);
            match workbook.get(&txn, KEY_DOCUMENT_PROPERTIES) {
                Some(Out::YMap(m)) => m,
                _ => return,
            }
        }
    };

    for (key, value) in domain_types::yrs_schema::doc_properties::to_yrs_prelim(props) {
        props_map.insert(&mut txn, key, value);
    }
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
    workbook_settings::get_setting(stores.storage.doc(), stores.storage.workbook_map(), key)
}

pub(in crate::storage::engine) fn get_calculation_settings(
    stores: &EngineStores,
) -> CalculationSettings {
    workbook_settings::get_calculation_settings(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn is_iterative_calculation_enabled(stores: &EngineStores) -> bool {
    workbook_settings::is_iterative_calculation_enabled(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    )
}

// -------------------------------------------------------------------
// Workbook Protection (read)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_workbook_protection_options(
    stores: &EngineStores,
) -> WorkbookProtectionOptions {
    workbook_settings::get_protection_options(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn has_workbook_protection_password(stores: &EngineStores) -> bool {
    workbook_settings::has_protection_password(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn is_workbook_protected(stores: &EngineStores) -> bool {
    workbook_settings::is_protected(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn is_workbook_operation_allowed(
    stores: &EngineStores,
    operation: ProtectedWorkbookOperation,
) -> Result<bool, ComputeError> {
    Ok(workbook_settings::is_operation_allowed(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        operation,
    ))
}

pub(in crate::storage::engine) fn get_default_table_style_id(
    stores: &EngineStores,
) -> Option<String> {
    workbook_settings::get_default_table_style_id(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    )
}

pub(in crate::storage::engine) fn get_default_slicer_style(
    stores: &EngineStores,
) -> Option<String> {
    workbook_settings::get_default_slicer_style(stores.storage.doc(), stores.storage.workbook_map())
}

// -------------------------------------------------------------------
// Named Slicer Style Registry (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_named_slicer_style_count(stores: &EngineStores) -> u32 {
    workbook_settings::get_named_slicer_style_count(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    )
}

pub(in crate::storage::engine) fn get_named_slicer_style(
    stores: &EngineStores,
    name: &str,
) -> Option<NamedSlicerStyle> {
    workbook_settings::get_named_slicer_style(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
    )
    .ok()
    .flatten()
}

pub(in crate::storage::engine) fn list_named_slicer_styles(
    stores: &EngineStores,
) -> Vec<NamedSlicerStyle> {
    workbook_settings::list_named_slicer_styles(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn get_default_pivot_table_style(
    stores: &EngineStores,
) -> Option<String> {
    workbook_settings::get_default_pivot_table_style(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    )
}

// -------------------------------------------------------------------
// Custom Settings (arbitrary KV store)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_custom_setting(
    stores: &EngineStores,
    key: &str,
) -> Option<String> {
    workbook_settings::get_custom_setting(stores.storage.doc(), stores.storage.workbook_map(), key)
}

pub(in crate::storage::engine) fn list_custom_settings(
    stores: &EngineStores,
) -> Vec<(String, String)> {
    workbook_settings::list_custom_settings(stores.storage.doc(), stores.storage.workbook_map())
}

// -------------------------------------------------------------------
