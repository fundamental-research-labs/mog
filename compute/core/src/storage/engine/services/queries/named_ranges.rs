use super::*;

// -------------------------------------------------------------------
// Named Range Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_all_named_ranges_wire(
    stores: &EngineStores,
) -> Vec<DefinedName> {
    workbook_named_ranges::get_all_named_ranges(stores.storage.doc(), stores.storage.workbook_map())
        .into_iter()
        .filter(|dn| dn.visible)
        .collect()
}

// Named Ranges (Read Queries)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_named_range_by_id(
    stores: &EngineStores,
    id: &str,
) -> Option<DefinedName> {
    workbook_named_ranges::get_named_range_by_id(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        id,
    )
}

pub(in crate::storage::engine) fn get_named_range_by_name(
    stores: &EngineStores,
    name: &str,
    scope: Option<&str>,
) -> Option<DefinedName> {
    workbook_named_ranges::get_named_range_by_name(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
        scope,
    )
}

pub(in crate::storage::engine) fn get_named_ranges_by_scope(
    stores: &EngineStores,
    scope: Option<&str>,
) -> Vec<DefinedName> {
    workbook_named_ranges::get_named_ranges_by_scope(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        scope,
    )
}

pub(in crate::storage::engine) fn get_visible_named_ranges(
    stores: &EngineStores,
) -> Vec<DefinedName> {
    workbook_named_ranges::get_visible_named_ranges(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    )
}

pub(in crate::storage::engine) fn named_range_exists(
    stores: &EngineStores,
    name: &str,
    scope: Option<&str>,
) -> bool {
    workbook_named_ranges::named_range_exists(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
        scope,
    )
}

pub(in crate::storage::engine) fn named_range_count(stores: &EngineStores) -> usize {
    workbook_named_ranges::named_range_count(stores.storage.doc(), stores.storage.workbook_map())
}

pub(in crate::storage::engine) fn validate_named_range_name(
    stores: &EngineStores,
    name: &str,
    scope: Option<&str>,
    exclude_id: Option<&str>,
) -> NameValidationResult {
    workbook_named_ranges::validate_name(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
        scope,
        exclude_id,
    )
}

pub(in crate::storage::engine) fn resolve_named_range(
    stores: &EngineStores,
    name: &str,
    current_sheet: Option<&str>,
) -> Option<DefinedName> {
    workbook_named_ranges::resolve_named_range(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        name,
        current_sheet,
    )
}
