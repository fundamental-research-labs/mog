use yrs::{Any, Doc, Map, MapRef, Out, Transact};

use domain_types::domain::named_range::DefinedName;
use domain_types::yrs_schema;

use super::keys::get_defined_name_key;
use super::yrs_codec::{get_named_ranges_map, read_defined_name_from_out};

/// Get all defined names.
///
/// Uses dual-read: structured Y.Map entries first, JSON string fallback
/// for backward compatibility with legacy data.
pub fn get_all_named_ranges(doc: &Doc, workbook: &MapRef) -> Vec<DefinedName> {
    let txn = doc.transact();
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return Vec::new(),
    };

    // Collect (order, DefinedName) pairs so we can restore original XLSX ordering.
    let mut result: Vec<(Option<u32>, DefinedName)> = Vec::new();
    for (_key, value) in nr_map.iter(&txn) {
        // Read order from the structured Y.Map entry if available.
        let order = match &value {
            Out::YMap(inner) => {
                use yrs::Map;
                match inner.get(&txn, yrs_schema::named_range::KEY_ORDER) {
                    Some(Out::Any(Any::BigInt(n))) => Some(n as u32),
                    Some(Out::Any(Any::Number(n))) => Some(n as u32),
                    _ => None,
                }
            }
            _ => None,
        };
        if let Some(dn) = read_defined_name_from_out(value, &txn) {
            result.push((order, dn));
        }
    }
    // Sort by order (entries with order come first, then by name for stability).
    result.sort_by(|a, b| match (a.0, b.0) {
        (Some(oa), Some(ob)) => oa.cmp(&ob),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.1.name.cmp(&b.1.name),
    });
    result.into_iter().map(|(_, dn)| dn).collect()
}

/// Get a defined name by its name and scope.
///
/// Uses dual-read: structured Y.Map first, JSON string fallback.
pub fn get_named_range_by_name(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
    scope: Option<&str>,
) -> Option<DefinedName> {
    let key = get_defined_name_key(name, scope);
    let txn = doc.transact();
    let nr_map = get_named_ranges_map(workbook, &txn)?;
    let out = nr_map.get(&txn, &key)?;
    read_defined_name_from_out(out, &txn)
}

/// Get a defined name by its unique ID.
pub fn get_named_range_by_id(doc: &Doc, workbook: &MapRef, id: &str) -> Option<DefinedName> {
    let all = get_all_named_ranges(doc, workbook);
    all.into_iter().find(|dn| dn.id == id)
}

/// Resolve a name reference, respecting scope precedence.
///
/// Sheet-scoped names have higher precedence than workbook-scoped names.
pub fn resolve_named_range(
    doc: &Doc,
    workbook: &MapRef,
    name: &str,
    current_sheet: Option<&str>,
) -> Option<DefinedName> {
    // First try sheet-scoped name (higher precedence)
    if let Some(sheet_id) = current_sheet
        && let Some(dn) = get_named_range_by_name(doc, workbook, name, Some(sheet_id))
    {
        return Some(dn);
    }

    // Fall back to workbook-scoped
    get_named_range_by_name(doc, workbook, name, None)
}

/// Get all defined names in a specific scope.
///
/// `scope` = None filters for workbook-scoped names only.
/// `scope` = Some(sheet_id) filters for names scoped to that sheet.
pub fn get_named_ranges_by_scope(
    doc: &Doc,
    workbook: &MapRef,
    scope: Option<&str>,
) -> Vec<DefinedName> {
    let all = get_all_named_ranges(doc, workbook);
    all.into_iter()
        .filter(|dn| dn.scope.as_deref() == scope)
        .collect()
}

/// Get all visible defined names (for Name Manager).
pub fn get_visible_named_ranges(doc: &Doc, workbook: &MapRef) -> Vec<DefinedName> {
    let all = get_all_named_ranges(doc, workbook);
    all.into_iter().filter(|dn| dn.visible).collect()
}

/// Check if a name exists in the given scope.
pub fn named_range_exists(doc: &Doc, workbook: &MapRef, name: &str, scope: Option<&str>) -> bool {
    get_named_range_by_name(doc, workbook, name, scope).is_some()
}

/// Get the total number of defined names.
pub fn named_range_count(doc: &Doc, workbook: &MapRef) -> usize {
    let txn = doc.transact();
    let nr_map = match get_named_ranges_map(workbook, &txn) {
        Some(m) => m,
        None => return 0,
    };
    nr_map.len(&txn) as usize
}
