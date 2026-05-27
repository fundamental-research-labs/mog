use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::conditional_format::CFRule;
use yrs::{Doc, Map, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::sheet_id_to_hex;

use super::yrs_io::{get_cf_map, read_cf_from_yrs_map, write_cf_to_yrs};

// =============================================================================
// Rule Management
// =============================================================================

/// Add a rule to an existing format. Rules are kept sorted by priority.
pub fn add_cf_rule(
    doc: &Doc,
    sheets: &MapRef,
    format_id: &str,
    sheet_id: &SheetId,
    rule: &CFRule,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    let existing_map = match cf_map.get(&txn, format_id) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    let mut cf = match read_cf_from_yrs_map(&existing_map, &txn) {
        Some(c) => c,
        None => return false,
    };
    cf.rules.push(rule.clone());
    cf.rules.sort_by_key(|r| r.priority());
    cf_map.remove(&mut txn, format_id);
    write_cf_to_yrs(&mut txn, &cf_map, &cf);
    true
}

/// Update a rule within a format by merging JSON updates.
///
/// Reads the CF from structured Y.Map, applies JSON merge to the target rule,
/// then writes the entire CF back as a structured Y.Map.
pub fn update_cf_rule(
    doc: &Doc,
    sheets: &MapRef,
    format_id: &str,
    sheet_id: &SheetId,
    rule_id: &str,
    updates: &serde_json::Value,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    let existing_map = match cf_map.get(&txn, format_id) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    let mut cf = match read_cf_from_yrs_map(&existing_map, &txn) {
        Some(c) => c,
        None => return false,
    };
    // Serialize to JSON Value to apply merge-update on the target rule
    let mut cf_value = match serde_json::to_value(&cf) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let rules = match cf_value.get_mut("rules").and_then(|r| r.as_array_mut()) {
        Some(r) => r,
        None => return false,
    };
    let rule_idx = rules
        .iter()
        .position(|r| r.get("id").and_then(|v| v.as_str()) == Some(rule_id));
    let rule_idx = match rule_idx {
        Some(i) => i,
        None => return false,
    };
    if let (Some(rule_obj), Some(updates_obj)) =
        (rules[rule_idx].as_object_mut(), updates.as_object())
    {
        for (k, v) in updates_obj {
            rule_obj.insert(k.clone(), v.clone());
        }
    } else {
        return false;
    }
    rules.sort_by(|a, b| {
        let pa = a
            .get("priority")
            .and_then(|v| v.as_i64())
            .unwrap_or(i64::MAX);
        let pb = b
            .get("priority")
            .and_then(|v| v.as_i64())
            .unwrap_or(i64::MAX);
        pa.cmp(&pb)
    });
    // Deserialize back and write as structured Y.Map
    cf = match serde_json::from_value(cf_value) {
        Ok(c) => c,
        Err(_) => return false,
    };
    cf_map.remove(&mut txn, format_id);
    write_cf_to_yrs(&mut txn, &cf_map, &cf);
    true
}

/// Delete a rule from a format. If no rules remain, deletes the format.
pub fn delete_cf_rule(
    doc: &Doc,
    sheets: &MapRef,
    format_id: &str,
    sheet_id: &SheetId,
    rule_id: &str,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    let existing_map = match cf_map.get(&txn, format_id) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    let mut cf = match read_cf_from_yrs_map(&existing_map, &txn) {
        Some(c) => c,
        None => return false,
    };
    let original_len = cf.rules.len();
    cf.rules.retain(|r| r.id() != rule_id);
    if cf.rules.len() == original_len {
        return false;
    }
    if cf.rules.is_empty() {
        cf_map.remove(&mut txn, format_id);
    } else {
        cf_map.remove(&mut txn, format_id);
        write_cf_to_yrs(&mut txn, &cf_map, &cf);
    }
    true
}
