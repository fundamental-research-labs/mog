use super::StoredDefinedName;
use super::keys::{get_defined_name_key, normalize_scope};
use crate::storage::workbook::WorkbookMetadata;

/// Return all names in original package order, followed by newly authored names.
pub(crate) fn get_all_named_ranges(metadata: &WorkbookMetadata) -> Vec<StoredDefinedName> {
    let mut names: Vec<_> = metadata.named_ranges.values().cloned().collect();
    names.sort_by(|a, b| match (a.order, b.order) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.name.cmp(&b.name),
    });
    names
}

pub(crate) fn get_named_range_by_name(
    metadata: &WorkbookMetadata,
    name: &str,
    scope: Option<&str>,
) -> Option<StoredDefinedName> {
    metadata
        .named_ranges
        .get(&get_defined_name_key(name, scope))
        .cloned()
}

pub(crate) fn get_named_range_by_id(
    metadata: &WorkbookMetadata,
    id: &str,
) -> Option<StoredDefinedName> {
    metadata
        .named_ranges
        .values()
        .find(|dn| dn.id == id)
        .cloned()
}

/// Sheet-local names take precedence over workbook names.
pub(crate) fn resolve_named_range(
    metadata: &WorkbookMetadata,
    name: &str,
    current_sheet: Option<&str>,
) -> Option<StoredDefinedName> {
    current_sheet
        .and_then(|sheet| get_named_range_by_name(metadata, name, Some(sheet)))
        .or_else(|| get_named_range_by_name(metadata, name, None))
}

pub(crate) fn get_named_ranges_by_scope(
    metadata: &WorkbookMetadata,
    scope: Option<&str>,
) -> Vec<StoredDefinedName> {
    let scope = scope.map(normalize_scope);
    get_all_named_ranges(metadata)
        .into_iter()
        .filter(|dn| dn.scope == scope)
        .collect()
}

pub(crate) fn get_visible_named_ranges(metadata: &WorkbookMetadata) -> Vec<StoredDefinedName> {
    get_all_named_ranges(metadata)
        .into_iter()
        .filter(|dn| dn.visible)
        .collect()
}

pub(crate) fn named_range_exists(
    metadata: &WorkbookMetadata,
    name: &str,
    scope: Option<&str>,
) -> bool {
    metadata
        .named_ranges
        .contains_key(&get_defined_name_key(name, scope))
}

pub(crate) fn named_range_count(metadata: &WorkbookMetadata) -> usize {
    metadata.named_ranges.len()
}
