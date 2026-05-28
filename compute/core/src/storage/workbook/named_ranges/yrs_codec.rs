use yrs::{Any, Map, MapRef, Out};

use compute_document::schema::KEY_NAMED_RANGES;
use domain_types::domain::named_range::DefinedName;
use domain_types::yrs_schema;

/// Get the named ranges MapRef from the workbook map.
pub(super) fn get_named_ranges_map<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Option<MapRef> {
    match workbook.get(txn, KEY_NAMED_RANGES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Lazy-create the named-ranges sub-map. Provider Protocol lifecycle replacement for
/// the prior eager bootstrap in `YrsStorage::new` (see that function's
/// doc-comment for the architectural reasoning).
pub(super) fn ensure_named_ranges_map(
    workbook: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
) -> MapRef {
    crate::storage::ensure_workbook_child_map(workbook, txn, KEY_NAMED_RANGES)
}

/// Read a `DefinedName` from a Yrs `Out` value using dual-read:
/// structured Y.Map first, JSON string fallback.
pub(super) fn read_defined_name_from_out<T: yrs::ReadTxn>(
    out: Out,
    txn: &T,
) -> Option<DefinedName> {
    match out {
        Out::YMap(inner) => yrs_schema::named_range::from_yrs_map(&inner, txn),
        Out::Any(Any::String(s)) => serde_json::from_str::<DefinedName>(&s).ok(),
        _ => None,
    }
}

/// Write a `DefinedName` as a structured Y.Map entry.
///
/// When `order` is `Some`, it overrides the DefinedName's own order field.
/// When `None`, the DefinedName's existing order is preserved (important for
/// upsert paths like formula normalization that shouldn't discard XLSX ordering).
pub(super) fn write_named_range_structured(
    nr_map: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    dn: &DefinedName,
    order: Option<u32>,
) {
    use yrs::MapPrelim;
    let mut dn_with_order = dn.clone();
    if order.is_some() {
        dn_with_order.order = order;
    }
    let entries = yrs_schema::named_range::to_yrs_prelim(&dn_with_order);
    let prelim: MapPrelim = entries.into_iter().collect();
    nr_map.insert(txn, key, prelim);
}
