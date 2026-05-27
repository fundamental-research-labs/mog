use cell_types::SheetId;
use compute_document::schema::{KEY_CF_RULES, KEY_RANGE_BINDINGS};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::conditional_format::ConditionalFormat;
use yrs::{Doc, Map, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::sheet_id_to_hex;

// =============================================================================
// Range-backed CF: cfRules shared rule body store
// =============================================================================

/// Get the cfRules Y.Map for a sheet (shared rule body store).
pub(super) fn get_cf_rules_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_CF_RULES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Store a CF rule body in the per-sheet `cfRules` map.
pub fn store_cf_rule_body(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    rule_key: &str,
    format: &ConditionalFormat,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_rules_map = match get_cf_rules_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    let body = match serde_json::to_string(format) {
        Ok(b) => b,
        Err(_) => return false,
    };
    compute_document::range::write_cf_rule_body(&mut txn, &cf_rules_map, rule_key, &body);
    true
}

/// Read a CF rule body from the per-sheet `cfRules` map.
pub fn read_cf_rule_body(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    rule_key: &str,
) -> Option<ConditionalFormat> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let cf_rules_map = get_cf_rules_map(&txn, sheets, &sheet_hex)?;
    let body_str = compute_document::range::read_cf_rule_body(&txn, &cf_rules_map, rule_key)?;
    serde_json::from_str(&body_str).ok()
}

/// Remove a CF rule body from the per-sheet `cfRules` map.
pub fn remove_cf_rule_body(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, rule_key: &str) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_rules_map = match get_cf_rules_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    compute_document::range::remove_cf_rule_body(&mut txn, &cf_rules_map, rule_key);
    true
}

/// List all CF rule body keys in the per-sheet `cfRules` map.
pub fn list_cf_rule_body_keys(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<String> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    match get_cf_rules_map(&txn, sheets, &sheet_hex) {
        Some(m) => compute_document::range::list_cf_rule_keys(&txn, &m),
        None => vec![],
    }
}

/// Run orphan GC for a CF rule body: check if any rangeBindings still
/// reference the given `rule_ref`, and if not, delete the `cfRules` entry.
pub fn gc_orphan_cf_rule_body(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    rule_ref: &str,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    let bindings_map = match sheet_map.get(&txn, KEY_RANGE_BINDINGS) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    if compute_document::range::any_binding_references_rule(&txn, &bindings_map, rule_ref) {
        return false;
    }
    let cf_rules_map = match sheet_map.get(&txn, KEY_CF_RULES) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    compute_document::range::remove_cf_rule_body(&mut txn, &cf_rules_map, rule_ref);
    true
}
