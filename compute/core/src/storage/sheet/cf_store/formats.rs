use std::collections::{HashMap, HashSet};

use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::conditional_format::ConditionalFormat;
use yrs::{Doc, Map, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::sheet_id_to_hex;

use super::ranges::cell_in_range;
use super::yrs_io::{get_cf_map, read_cf_from_yrs_map, write_cf_to_yrs};

// =============================================================================
// CF CRUD Operations
// =============================================================================

/// Add a new conditional format to the sheet's conditionalFormat map.
pub fn add_conditional_format(doc: &Doc, sheets: &MapRef, format: &ConditionalFormat) {
    let sheet_id = match SheetId::from_uuid_str(&format.sheet_id) {
        Ok(id) => id,
        Err(_) => return,
    };
    let sheet_hex = sheet_id_to_hex(&sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };
    write_cf_to_yrs(&mut txn, &cf_map, format);
}

/// Update an existing conditional format by merging JSON updates.
///
/// Reads the existing CF from the structured Y.Map, deserializes it to a
/// serde_json::Value, applies the JSON merge, then writes back as a structured
/// Y.Map (removing the old entry first so the new Y.Map replaces it).
pub fn update_conditional_format(
    doc: &Doc,
    sheets: &MapRef,
    format_id: &str,
    sheet_id: &SheetId,
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
    // Serialize existing CF to JSON for merge.
    let existing_cf_value = match serde_json::to_value(&cf) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let mut cf_value = existing_cf_value.clone();
    // Apply JSON merge-update: overlay incoming fields on top of existing.
    if let (Some(existing_obj), Some(updates_obj)) = (cf_value.as_object_mut(), updates.as_object())
    {
        for (k, v) in updates_obj {
            existing_obj.insert(k.clone(), v.clone());
        }
        existing_obj.insert(
            "id".to_string(),
            serde_json::Value::String(format_id.to_string()),
        );
    } else {
        return false;
    }
    // When the update replaces the `rules` array, the caller may omit required
    // fields like `id` and `priority`.  Fill them in from the original rules
    // (by index) or generate sensible defaults so deserialization succeeds.
    if updates.get("rules").is_some()
        && let Some(new_rules) = cf_value.get_mut("rules").and_then(|r| r.as_array_mut())
    {
        let orig_rules = existing_cf_value
            .get("rules")
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        for (i, rule) in new_rules.iter_mut().enumerate() {
            if let Some(obj) = rule.as_object_mut() {
                if !obj.contains_key("id") {
                    let default = orig_rules
                        .get(i)
                        .and_then(|r| r.get("id"))
                        .cloned()
                        .unwrap_or_else(|| {
                            serde_json::Value::String(format!("cf-rule-{}-{}", format_id, i))
                        });
                    obj.insert("id".to_string(), default);
                }
                if !obj.contains_key("priority") {
                    let default = orig_rules
                        .get(i)
                        .and_then(|r| r.get("priority"))
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!(i as i32));
                    obj.insert("priority".to_string(), default);
                }
            }
        }
    }
    cf = match serde_json::from_value(cf_value) {
        Ok(c) => c,
        Err(_) => return false,
    };
    cf.id = format_id.to_string();
    // Remove old entry and write new structured Y.Map
    cf_map.remove(&mut txn, format_id);
    write_cf_to_yrs(&mut txn, &cf_map, &cf);
    true
}

/// Delete a conditional format by ID.
pub fn delete_conditional_format(
    doc: &Doc,
    sheets: &MapRef,
    format_id: &str,
    sheet_id: &SheetId,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    if cf_map.get(&txn, format_id).is_none() {
        return false;
    }
    cf_map.remove(&mut txn, format_id);
    true
}

/// Get a single conditional format by ID.
pub fn get_conditional_format(
    doc: &Doc,
    sheets: &MapRef,
    format_id: &str,
    sheet_id: &SheetId,
) -> Option<ConditionalFormat> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let cf_map = get_cf_map(&txn, sheets, &sheet_hex)?;
    match cf_map.get(&txn, format_id)? {
        Out::YMap(m) => read_cf_from_yrs_map(&m, &txn),
        _ => None,
    }
}

/// Get all conditional formats for a sheet, sorted by document order then priority.
pub fn get_formats_for_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<ConditionalFormat> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };
    // Collect (key, cf) pairs so we can sort them deterministically.
    // Y.Map iteration order is not guaranteed, so we sort explicitly.
    let mut keyed: Vec<(String, ConditionalFormat)> = Vec::new();
    for (key, out) in cf_map.iter(&txn) {
        if let Out::YMap(m) = out
            && let Some(cf) = read_cf_from_yrs_map(&m, &txn)
        {
            keyed.push((key.to_string(), cf));
        }
    }
    // Primary sort: hydration key parse index (cf-parse-0, cf-parse-1, …)
    // to preserve original XLSX document order for imported formats.
    // Secondary: first rule's priority for UI-created formats.
    // Final tiebreaker: key string.
    keyed.sort_by(|(a, cf_a), (b, cf_b)| {
        // Primary: hydration key index (cf-parse-0, cf-parse-1, …) to
        // preserve original XLSX document order for imported formats.
        // UI-created formats (cf-<uuid>) get u32::MAX and fall to the end.
        let idx_a = a
            .strip_prefix("cf-parse-")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(u32::MAX);
        let idx_b = b
            .strip_prefix("cf-parse-")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(u32::MAX);
        idx_a
            .cmp(&idx_b)
            .then_with(|| {
                // Secondary: first rule's priority for user-created formats.
                let pri_a = cf_a.rules.first().map(|r| r.priority()).unwrap_or(i32::MAX);
                let pri_b = cf_b.rules.first().map(|r| r.priority()).unwrap_or(i32::MAX);
                pri_a.cmp(&pri_b)
            })
            .then_with(|| {
                // Tertiary: extract embedded timestamp from UI-created format IDs
                // (format: cf-<timestamp>-<random>) to preserve insertion order.
                fn extract_ts(id: &str) -> u64 {
                    id.strip_prefix("cf-")
                        .and_then(|rest| rest.split('-').next())
                        .and_then(|ts| ts.parse::<u64>().ok())
                        .unwrap_or(0)
                }
                let ts_a = extract_ts(a);
                let ts_b = extract_ts(b);
                ts_a.cmp(&ts_b)
            })
            .then_with(|| a.cmp(b))
    });
    keyed.into_iter().map(|(_, cf)| cf).collect()
}

/// Get all formats that apply to a specific cell (position-based check).
///
/// TODO(perf): This performs a linear scan of all CF formats × ranges per call.
/// For render paths that query many cells, consider a batched API that precomputes
/// a cell→formats mapping (similar to the approach in cf_eval.rs) to avoid
/// repeated O(formats × ranges) scans.
pub fn get_formats_for_cell(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<ConditionalFormat> {
    let sheet_formats = get_formats_for_sheet(doc, sheets, sheet_id);
    sheet_formats
        .into_iter()
        .filter(|format| format.ranges.iter().any(|r| cell_in_range(r, row, col)))
        .collect()
}

/// Check if a cell is within any CF range on the sheet.
pub fn has_cf_for_cell(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, row: u32, col: u32) -> bool {
    !get_formats_for_cell(doc, sheets, sheet_id, row, col).is_empty()
}

/// Clear all conditional formats for a sheet.
pub fn clear_formats_for_sheet(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };
    let keys: Vec<String> = cf_map.keys(&txn).map(|k| k.to_string()).collect();
    for key in &keys {
        cf_map.remove(&mut txn, key.as_str());
    }
}

/// Bump every CF rule's priority on a sheet by `delta` in place.
///
/// Reads each conditional format on the sheet through the typed CFRule
/// schema, mutates priority via [`CFRule::set_priority`], and writes the
/// format back as a structured Y.Map. Returns the number of formats whose
/// priorities were rewritten.
///
/// This is the typed replacement for the JSON-round-trip priority bumping
/// in `formatting::add_cf_rule` (filter viewport finding 13 — N+1 serde
/// round-trips that silently discarded errors via `let _ =`). The new
/// path fails loudly: any format that fails to read or write returns
/// `Err(ComputeError::Eval)`.
pub fn bump_priorities_for_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    delta: i32,
) -> Result<usize, value_types::ComputeError> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return Ok(0),
    };
    // Snapshot keys + existing CFs first; we cannot iterate the Y.Map while
    // mutating it.
    let mut to_rewrite: Vec<(String, ConditionalFormat)> = Vec::new();
    for (key, out) in cf_map.iter(&txn) {
        if let Out::YMap(m) = out
            && let Some(cf) = read_cf_from_yrs_map(&m, &txn)
        {
            to_rewrite.push((key.to_string(), cf));
        }
    }
    let mut rewritten = 0usize;
    for (key, mut cf) in to_rewrite {
        for r in cf.rules.iter_mut() {
            let p = r.priority();
            r.set_priority(p + delta);
        }
        // Replace the existing entry with the typed-rewritten CF.
        cf_map.remove(&mut txn, key.as_str());
        write_cf_to_yrs(&mut txn, &cf_map, &cf);
        rewritten += 1;
    }
    Ok(rewritten)
}

/// Rewrite conditional-format priority order in a single Yrs transaction.
///
/// Undo groups at the Yrs transaction boundary. Reordering by calling
/// `update_conditional_format` once per format creates one undo item per
/// priority rewrite, so a single user undo only partially restores the order.
/// This function snapshots every format, applies the requested ordering, and
/// writes the changed priorities back under one `ORIGIN_USER_EDIT` transaction.
pub fn reorder_conditional_formats(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    ordered_format_ids: &[String],
) -> Result<usize, value_types::ComputeError> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return Ok(0),
    };

    let mut existing: Vec<(String, ConditionalFormat)> = Vec::new();
    for (key, out) in cf_map.iter(&txn) {
        if let Out::YMap(m) = out
            && let Some(cf) = read_cf_from_yrs_map(&m, &txn)
        {
            existing.push((key.to_string(), cf));
        }
    }

    let existing_ids: HashSet<&str> = existing.iter().map(|(_, cf)| cf.id.as_str()).collect();
    let requested_ids: HashSet<&str> = ordered_format_ids.iter().map(String::as_str).collect();
    if existing.len() != ordered_format_ids.len() || existing_ids != requested_ids {
        return Err(value_types::ComputeError::Eval {
            message: "CF reorder must include exactly the existing format IDs".to_string(),
        });
    }

    let priority_by_id: HashMap<&str, i32> = ordered_format_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i as i32 + 1))
        .collect();

    let mut rewritten = 0usize;
    for (key, mut cf) in existing {
        let priority = priority_by_id[cf.id.as_str()];
        let changed = cf.rules.iter().any(|r| r.priority() != priority);
        for rule in cf.rules.iter_mut() {
            rule.set_priority(priority);
        }
        if changed {
            cf_map.remove(&mut txn, key.as_str());
            write_cf_to_yrs(&mut txn, &cf_map, &cf);
            rewritten += 1;
        }
    }

    Ok(rewritten)
}
