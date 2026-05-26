//! Sheet-level Conditional Formatting CRUD operations.
//!
//! Port of spreadsheet-model/src/conditional-format/ (1,965 LOC across 6 files)
//! into a single Rust module for the spreadsheet-model elimination effort.
//!
//! Provides:
//! - All CF types (rules, styles, color scales, data bars, icon sets)
//! - CRUD for conditional formats and rules
//! - Range geometry operations (overlap, contains, subtract, intersect)
//! - Static preset data (data bars, color scales, icon sets)
//!
//! ## Yrs Storage Layout
//!
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- conditionalFormat: Y.Map
//!           +-- {formatId}: Y.Map (structured ConditionalFormat)
//!               +-- id: String
//!               +-- sheetId: String
//!               +-- ranges: String (JSON-serialized Vec<CFCellRange>)
//!               +-- rangeIdentities: String (JSON-serialized, optional)
//!               +-- rules: Y.Array<Y.Map> (one Y.Map per CFRule)
//! ```
//!
//! ## Skipped
//! - Formula adjuster (depends on formula parser)
//! - Observer/subscription patterns
//! - CellId migration (migrateAndPersist)

use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Array, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::sheet_id_to_hex;
use cell_types::SheetId;
use compute_document::schema::{KEY_CF_RULES, KEY_CONDITIONAL_FORMAT};

// Unified yrs_schema read/write functions and key constants.
use domain_types::yrs_schema::conditional_format as cf_yrs;

pub use crate::engine_types::cf::*;

use domain_types::domain::conditional_format::{
    CFColorPoint, CFColorScale, CFDataBar, CFIconSet, CFRule, ConditionalFormat,
};
use ooxml_types::cond_format::CfvoType;

/// Key for the rules Y.Array within a CF Y.Map entry.
const KEY_CF_ENTRY_RULES: &str = "rules";

// =============================================================================
// Internal Helpers
// =============================================================================

fn get_cf_map<T: yrs::ReadTxn>(txn: &T, sheets_root: &MapRef, sheet_hex: &str) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_CONDITIONAL_FORMAT) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

fn cell_in_range(range: &CFCellRange, row: u32, col: u32) -> bool {
    range.contains(row, col)
}

// =============================================================================
// Structured Y.Map Read: ConditionalFormat (delegates to unified yrs_schema)
// =============================================================================

/// Read a ConditionalFormat from a Y.Map entry in the CF map.
fn read_cf_from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<ConditionalFormat> {
    let mut cf = cf_yrs::cf_from_yrs_map(map, txn)?;

    // Read rules from Y.Array
    if let Some(Out::YArray(rules_arr)) = map.get(txn, KEY_CF_ENTRY_RULES) {
        for out in rules_arr.iter(txn) {
            if let Out::YMap(rule_map) = out
                && let Some(rule) = cf_yrs::rule_from_yrs_map(&rule_map, txn)
            {
                cf.rules.push(rule);
            }
        }
    }

    Some(cf)
}

// =============================================================================
// Structured Y.Map Write (delegates to unified yrs_schema)
// =============================================================================

/// Write a ConditionalFormat as a structured Y.Map into the CF map.
fn write_cf_to_yrs(txn: &mut yrs::TransactionMut, cf_map: &MapRef, format: &ConditionalFormat) {
    let entries = cf_yrs::cf_to_yrs_prelim(format);
    let cf_prelim: MapPrelim = entries.into_iter().collect();
    let cf_entry: MapRef = cf_map.insert(txn, &*format.id, cf_prelim);

    // Write rules as a Y.Array of Y.Maps
    let rules_arr = cf_entry.insert(txn, KEY_CF_ENTRY_RULES, yrs::ArrayPrelim::default());
    for rule in &format.rules {
        let rule_entries = cf_yrs::rule_to_yrs_prelim(rule);
        let rule_prelim: MapPrelim = rule_entries.into_iter().collect();
        rules_arr.push_back(txn, rule_prelim);
    }
}

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

    let existing_ids: std::collections::HashSet<&str> =
        existing.iter().map(|(_, cf)| cf.id.as_str()).collect();
    let requested_ids: std::collections::HashSet<&str> =
        ordered_format_ids.iter().map(String::as_str).collect();
    if existing.len() != ordered_format_ids.len() || existing_ids != requested_ids {
        return Err(value_types::ComputeError::Eval {
            message: "CF reorder must include exactly the existing format IDs".to_string(),
        });
    }

    let priority_by_id: std::collections::HashMap<&str, i32> = ordered_format_ids
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

// =============================================================================
// Range Operations
// =============================================================================

/// Replace a format's ranges atomically. Empty ranges deletes the format.
pub fn update_cf_ranges(
    doc: &Doc,
    sheets: &MapRef,
    format_id: &str,
    sheet_id: &SheetId,
    new_ranges: &[CFCellRange],
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
    if new_ranges.is_empty() {
        cf_map.remove(&mut txn, format_id);
    } else {
        cf.ranges = new_ranges.to_vec();
        cf_map.remove(&mut txn, format_id);
        write_cf_to_yrs(&mut txn, &cf_map, &cf);
    }
    true
}

// =============================================================================
// Range Geometry (standalone functions)
// =============================================================================

/// Check if two ranges overlap (share any cells).
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_ranges_overlap(a: &CFCellRange, b: &CFCellRange) -> bool {
    a.intersects(b)
}

/// Check if outer completely contains inner.
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_range_contains(outer: &CFCellRange, inner: &CFCellRange) -> bool {
    outer.contains_range(inner)
}

/// Subtract one range from another, returning up to 4 non-overlapping strips.
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_subtract_range(
    original: &CFCellRange,
    subtract: &CFCellRange,
) -> Vec<CFCellRange> {
    if !original.intersects(subtract) {
        return vec![*original];
    }
    if subtract.contains_range(original) {
        return vec![];
    }
    let mut results = Vec::new();
    if subtract.start_row() > original.start_row() {
        results.push(CFCellRange::new(
            original.start_row(),
            original.start_col(),
            subtract.start_row() - 1,
            original.end_col(),
        ));
    }
    if subtract.end_row() < original.end_row() {
        results.push(CFCellRange::new(
            subtract.end_row() + 1,
            original.start_col(),
            original.end_row(),
            original.end_col(),
        ));
    }
    let middle_start_row = original.start_row().max(subtract.start_row());
    let middle_end_row = original.end_row().min(subtract.end_row());
    if subtract.start_col() > original.start_col() {
        results.push(CFCellRange::new(
            middle_start_row,
            original.start_col(),
            middle_end_row,
            subtract.start_col() - 1,
        ));
    }
    if subtract.end_col() < original.end_col() {
        results.push(CFCellRange::new(
            middle_start_row,
            subtract.end_col() + 1,
            middle_end_row,
            original.end_col(),
        ));
    }
    results
}

/// Calculate the intersection of two ranges.
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_intersect_ranges(a: &CFCellRange, b: &CFCellRange) -> Option<CFCellRange> {
    a.intersection(b)
}

/// Check if a range is valid (end >= start).
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_is_valid_range(range: &CFCellRange) -> bool {
    range.start_row() <= range.end_row() && range.start_col() <= range.end_col()
}

// =============================================================================
// Range-backed CF: cfRules shared rule body store
// =============================================================================

/// Get the cfRules Y.Map for a sheet (shared rule body store).
fn get_cf_rules_map<T: yrs::ReadTxn>(
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
    let bindings_map = match sheet_map.get(&txn, compute_document::schema::KEY_RANGE_BINDINGS) {
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

// =============================================================================
// Presets
// =============================================================================

fn cp(value_type: ooxml_types::cond_format::CfvoType, color: &str) -> CFColorPoint {
    use ooxml_types::cond_format::CfvoType;
    // The preset helpers only pass boundary kinds that carry no payload
    // (Min / Max / AutoMin / AutoMax). Numeric-carrying kinds route
    // through `cp_val` below.
    let value = match value_type {
        CfvoType::Min => domain_types::CFValueRef::Min,
        CfvoType::Max => domain_types::CFValueRef::Max,
        CfvoType::AutoMin => domain_types::CFValueRef::AutoMin,
        CfvoType::AutoMax => domain_types::CFValueRef::AutoMax,
        // Caller misuse: a payload-carrying kind was passed without a value.
        // Fall back to a zeroed numeric point so presets render something.
        CfvoType::Num => domain_types::CFValueRef::Number { value: 0.0 },
        CfvoType::Percent => domain_types::CFValueRef::Percent { value: 0.0 },
        CfvoType::Percentile => domain_types::CFValueRef::Percentile { value: 0.0 },
        CfvoType::Formula => domain_types::CFValueRef::Formula {
            source: String::new(),
        },
    };
    CFColorPoint {
        value,
        ooxml_value: None,
        color: color.to_string(),
        color_theme: None,
        color_tint: None,
        color_indexed: None,
        color_auto: None,
    }
}

fn cp_val(value_type: ooxml_types::cond_format::CfvoType, value: f64, color: &str) -> CFColorPoint {
    use ooxml_types::cond_format::CfvoType;
    // `cp_val` is the numeric-carrying helper; formula / min / max kinds
    // go through `cp` above.
    let value = match value_type {
        CfvoType::Num => domain_types::CFValueRef::Number { value },
        CfvoType::Percent => domain_types::CFValueRef::Percent { value },
        CfvoType::Percentile => domain_types::CFValueRef::Percentile { value },
        CfvoType::Formula => domain_types::CFValueRef::Formula {
            source: value.to_string(),
        },
        CfvoType::Min => domain_types::CFValueRef::Min,
        CfvoType::Max => domain_types::CFValueRef::Max,
        CfvoType::AutoMin => domain_types::CFValueRef::AutoMin,
        CfvoType::AutoMax => domain_types::CFValueRef::AutoMax,
    };
    CFColorPoint {
        value,
        ooxml_value: None,
        color: color.to_string(),
        color_theme: None,
        color_tint: None,
        color_indexed: None,
        color_auto: None,
    }
}

fn db_preset(id: &str, name: &str, color: &str, neg: &str, gradient: bool) -> CFDataBarPreset {
    use ooxml_types::cond_format::{CfvoType, DataBarAxisPosition};
    CFDataBarPreset {
        id: id.to_string(),
        name: name.to_string(),
        data_bar: CFDataBar {
            min_point: cp(CfvoType::Min, color),
            max_point: cp(CfvoType::Max, color),
            min_length: None,
            max_length: None,
            positive_color: color.to_string(),
            negative_color: Some(neg.to_string()),
            border_color: None,
            show_border: None,
            gradient: Some(gradient),
            direction: None,
            axis_position: Some(DataBarAxisPosition::Automatic),
            axis_color: None,
            show_value: Some(true),
            match_positive_fill_color: None,
            match_positive_border_color: None,
            ext_id: None,
        },
    }
}

/// Get all data bar presets.
pub fn data_bar_presets() -> Vec<CFDataBarPreset> {
    vec![
        db_preset(
            "databar-blue-gradient",
            "Blue Gradient",
            "#638EC6",
            "#FF555A",
            true,
        ),
        db_preset(
            "databar-blue-solid",
            "Blue Solid",
            "#638EC6",
            "#FF555A",
            false,
        ),
        db_preset(
            "databar-green-gradient",
            "Green Gradient",
            "#63BE7B",
            "#FF555A",
            true,
        ),
        db_preset(
            "databar-green-solid",
            "Green Solid",
            "#63BE7B",
            "#FF555A",
            false,
        ),
        db_preset(
            "databar-red-gradient",
            "Red Gradient",
            "#F8696B",
            "#638EC6",
            true,
        ),
        db_preset(
            "databar-red-solid",
            "Red Solid",
            "#F8696B",
            "#638EC6",
            false,
        ),
        db_preset(
            "databar-orange-gradient",
            "Orange Gradient",
            "#FFAB46",
            "#FF555A",
            true,
        ),
        db_preset(
            "databar-orange-solid",
            "Orange Solid",
            "#FFAB46",
            "#FF555A",
            false,
        ),
    ]
}

/// Get all color scale presets.
pub fn color_scale_presets() -> Vec<CFColorScalePreset> {
    vec![
        CFColorScalePreset {
            id: "colorscale-green-yellow-red".into(),
            name: "Green - Yellow - Red".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#63BE7B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFEB84")),
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-red-yellow-green".into(),
            name: "Red - Yellow - Green".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#F8696B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFEB84")),
                max_point: cp(CfvoType::Max, "#63BE7B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-green-white-red".into(),
            name: "Green - White - Red".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#63BE7B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFFFFF")),
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-red-white-green".into(),
            name: "Red - White - Green".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#F8696B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFFFFF")),
                max_point: cp(CfvoType::Max, "#63BE7B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-blue-white-red".into(),
            name: "Blue - White - Red".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#5A8AC6"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFFFFF")),
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-red-white-blue".into(),
            name: "Red - White - Blue".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#F8696B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFFFFF")),
                max_point: cp(CfvoType::Max, "#5A8AC6"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-white-blue".into(),
            name: "White - Blue".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#FFFFFF"),
                mid_point: None,
                max_point: cp(CfvoType::Max, "#5A8AC6"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-white-red".into(),
            name: "White - Red".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#FFFFFF"),
                mid_point: None,
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-white-green".into(),
            name: "White - Green".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#FFFFFF"),
                mid_point: None,
                max_point: cp(CfvoType::Max, "#63BE7B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-yellow-green".into(),
            name: "Yellow - Green".into(),
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#FFEB84"),
                mid_point: None,
                max_point: cp(CfvoType::Max, "#63BE7B"),
            },
        },
    ]
}

fn icon_preset(kind: ooxml_types::cond_format::IconSetType, display_name: &str) -> CFIconSetPreset {
    CFIconSetPreset {
        id: format!("iconset-{}", kind.to_ooxml().to_lowercase()),
        name: display_name.to_string(),
        icon_set: CFIconSet {
            icon_set_name: kind,
            reverse_order: Some(false),
            show_icon_only: Some(false),
            thresholds: vec![],
            custom_icons: vec![],
        },
    }
}

/// Get all icon set presets.
pub fn icon_set_presets() -> Vec<CFIconSetPreset> {
    use ooxml_types::cond_format::IconSetType::*;
    vec![
        icon_preset(ThreeArrows, "3 Arrows (Colored)"),
        icon_preset(ThreeArrowsGray, "3 Arrows (Gray)"),
        icon_preset(ThreeTrafficLights1, "3 Traffic Lights"),
        icon_preset(ThreeTrafficLights2, "3 Traffic Lights (Rimmed)"),
        icon_preset(ThreeSigns, "3 Signs"),
        icon_preset(ThreeSymbols, "3 Symbols (Circled)"),
        icon_preset(ThreeSymbols2, "3 Symbols (Uncircled)"),
        icon_preset(ThreeFlags, "3 Flags"),
        icon_preset(ThreeStars, "3 Stars"),
        icon_preset(ThreeTriangles, "3 Triangles"),
        icon_preset(FourArrows, "4 Arrows (Colored)"),
        icon_preset(FourArrowsGray, "4 Arrows (Gray)"),
        icon_preset(FourRating, "4 Rating"),
        icon_preset(FourRedToBlack, "4 Red to Black"),
        icon_preset(FourTrafficLights, "4 Traffic Lights"),
        icon_preset(FiveArrows, "5 Arrows (Colored)"),
        icon_preset(FiveArrowsGray, "5 Arrows (Gray)"),
        icon_preset(FiveRating, "5 Rating"),
        icon_preset(FiveQuarters, "5 Quarters"),
        icon_preset(FiveBoxes, "5 Boxes"),
    ]
}

/// Get a preset by ID (searches all categories).
pub fn get_preset_by_id(id: &str) -> Option<CFPresetCategory> {
    if data_bar_presets().iter().any(|p| p.id == id) {
        return Some(CFPresetCategory::DataBar);
    }
    if color_scale_presets().iter().any(|p| p.id == id) {
        return Some(CFPresetCategory::ColorScale);
    }
    if icon_set_presets().iter().any(|p| p.id == id) {
        return Some(CFPresetCategory::IconSet);
    }
    None
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use domain_types::CFStyle;

    /// Ensure the `rangeBindings` sub-map exists on the sheet for tests.
    fn ensure_range_bindings_map(storage: &YrsStorage, sheet_id: &SheetId) {
        let sheet_hex = sheet_id_to_hex(sheet_id);
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let sheet_map = match storage.sheets_ref().get(&txn, &*sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => return,
        };
        if sheet_map
            .get(&txn, compute_document::schema::KEY_RANGE_BINDINGS)
            .is_none()
        {
            let empty = MapPrelim::from([] as [(&str, yrs::Any); 0]);
            sheet_map.insert(
                &mut txn,
                compute_document::schema::KEY_RANGE_BINDINGS,
                empty,
            );
        }
    }

    /// Get the `rangeBindings` Y.Map for a sheet.
    fn get_range_bindings_map(
        storage: &YrsStorage,
        sheet_id: &SheetId,
        txn: &impl yrs::ReadTxn,
    ) -> MapRef {
        let sheet_hex = sheet_id_to_hex(sheet_id);
        let sheet_map = match storage.sheets_ref().get(txn, &*sheet_hex) {
            Some(Out::YMap(m)) => m,
            _ => panic!("no sheet map"),
        };
        match sheet_map.get(txn, compute_document::schema::KEY_RANGE_BINDINGS) {
            Some(Out::YMap(m)) => m,
            _ => panic!("no bindings map — call ensure_range_bindings_map() first"),
        }
    }

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn storage_with_sheet() -> (YrsStorage, SheetId) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");
        (storage, sheet_id)
    }

    fn default_style() -> CFStyle {
        CFStyle {
            background_color: Some("#FF0000".into()),
            bold: Some(true),
            ..Default::default()
        }
    }

    fn make_rule(id: &str, priority: i32) -> CFRule {
        CFRule::CellValue {
            id: id.to_string(),
            priority,
            stop_if_true: None,
            operator: ooxml_types::cond_format::CfOperator::GreaterThan,
            value1: serde_json::json!(10),
            value2: None,
            style: default_style(),
            text: None,
        }
    }

    fn make_format(
        id: &str,
        sheet_id: &SheetId,
        ranges: Vec<CFCellRange>,
        rules: Vec<CFRule>,
    ) -> ConditionalFormat {
        ConditionalFormat {
            id: id.to_string(),
            sheet_id: sheet_id.to_uuid_string(),
            pivot: None,
            range_identities: None,
            ranges,
            rules,
        }
    }

    fn rng(sr: u32, sc: u32, er: u32, ec: u32) -> CFCellRange {
        CFCellRange::new(sr, sc, er, ec)
    }

    #[test]
    fn test_add_and_get_format() {
        let (storage, sheet_id) = storage_with_sheet();
        let fmt = make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 9, 3)],
            vec![make_rule("r1", 1)],
        );
        add_conditional_format(storage.doc(), &storage.sheets_ref(), &fmt);
        let result = get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.id, "cf1");
        assert_eq!(result.rules.len(), 1);
        assert_eq!(result.rules[0].id(), "r1");
    }

    #[test]
    fn test_get_nonexistent_format() {
        let (storage, sheet_id) = storage_with_sheet();
        assert!(
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "nope", &sheet_id)
                .is_none()
        );
    }

    #[test]
    fn test_update_format() {
        let (storage, sheet_id) = storage_with_sheet();
        let fmt = make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 9, 3)],
            vec![make_rule("r1", 1)],
        );
        add_conditional_format(storage.doc(), &storage.sheets_ref(), &fmt);
        let updates = serde_json::json!({"ranges": [{"startRow": 5, "startCol": 0, "endRow": 15, "endCol": 5}]});
        assert!(update_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            &updates
        ));
        let result =
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).unwrap();
        assert_eq!(result.ranges[0].start_row(), 5);
        assert_eq!(result.ranges[0].end_row(), 15);
    }

    #[test]
    fn test_update_nonexistent_format() {
        let (storage, sheet_id) = storage_with_sheet();
        assert!(!update_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            "nope",
            &sheet_id,
            &serde_json::json!({})
        ));
    }

    #[test]
    fn test_delete_format() {
        let (storage, sheet_id) = storage_with_sheet();
        let fmt = make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 9, 3)],
            vec![make_rule("r1", 1)],
        );
        add_conditional_format(storage.doc(), &storage.sheets_ref(), &fmt);
        assert!(delete_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id
        ));
        assert!(
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id)
                .is_none()
        );
    }

    #[test]
    fn test_delete_nonexistent_format() {
        let (storage, sheet_id) = storage_with_sheet();
        assert!(!delete_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            "nope",
            &sheet_id
        ));
    }

    #[test]
    fn test_get_formats_for_sheet_sorted_by_priority() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 10)],
            ),
        );
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf2",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r2", 1)],
            ),
        );
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf3",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r3", 5)],
            ),
        );
        let formats = get_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id);
        assert_eq!(formats.len(), 3);
        assert_eq!(formats[0].id, "cf2");
        assert_eq!(formats[1].id, "cf3");
        assert_eq!(formats[2].id, "cf1");
    }

    #[test]
    fn test_get_formats_for_sheet_empty() {
        let (storage, sheet_id) = storage_with_sheet();
        assert!(get_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id).is_empty());
    }

    #[test]
    fn test_get_formats_for_cell() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf2",
                &sheet_id,
                vec![rng(10, 10, 20, 20)],
                vec![make_rule("r2", 2)],
            ),
        );
        assert_eq!(
            get_formats_for_cell(storage.doc(), &storage.sheets_ref(), &sheet_id, 3, 3).len(),
            1
        );
        assert_eq!(
            get_formats_for_cell(storage.doc(), &storage.sheets_ref(), &sheet_id, 3, 3)[0].id,
            "cf1"
        );
        assert_eq!(
            get_formats_for_cell(storage.doc(), &storage.sheets_ref(), &sheet_id, 15, 15)[0].id,
            "cf2"
        );
        assert!(
            get_formats_for_cell(storage.doc(), &storage.sheets_ref(), &sheet_id, 50, 50)
                .is_empty()
        );
    }

    #[test]
    fn test_has_cf_for_cell() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        assert!(has_cf_for_cell(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            0,
            0
        ));
        assert!(has_cf_for_cell(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            5,
            5
        ));
        assert!(!has_cf_for_cell(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            6,
            6
        ));
    }

    #[test]
    fn test_clear_formats_for_sheet() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf2",
                &sheet_id,
                vec![rng(10, 10, 20, 20)],
                vec![make_rule("r2", 2)],
            ),
        );
        assert_eq!(
            get_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id).len(),
            2
        );
        clear_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id);
        assert_eq!(
            get_formats_for_sheet(storage.doc(), &storage.sheets_ref(), &sheet_id).len(),
            0
        );
    }

    #[test]
    fn test_add_rule() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 5)],
            ),
        );
        assert!(add_cf_rule(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            &make_rule("r2", 1)
        ));
        let result =
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).unwrap();
        assert_eq!(result.rules.len(), 2);
        assert_eq!(result.rules[0].id(), "r2");
        assert_eq!(result.rules[1].id(), "r1");
    }

    #[test]
    fn test_add_rule_to_nonexistent_format() {
        let (storage, sheet_id) = storage_with_sheet();
        assert!(!add_cf_rule(
            storage.doc(),
            &storage.sheets_ref(),
            "nope",
            &sheet_id,
            &make_rule("r1", 1)
        ));
    }

    #[test]
    fn test_update_rule() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        assert!(update_cf_rule(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            "r1",
            &serde_json::json!({"priority": 99})
        ));
        assert_eq!(
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id)
                .unwrap()
                .rules[0]
                .priority(),
            99
        );
    }

    #[test]
    fn test_update_nonexistent_rule() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        assert!(!update_cf_rule(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            "nope",
            &serde_json::json!({})
        ));
    }

    #[test]
    fn test_delete_rule() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1), make_rule("r2", 2)],
            ),
        );
        assert!(delete_cf_rule(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            "r1"
        ));
        let result =
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).unwrap();
        assert_eq!(result.rules.len(), 1);
        assert_eq!(result.rules[0].id(), "r2");
    }

    #[test]
    fn test_delete_last_rule_deletes_format() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        assert!(delete_cf_rule(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            "r1"
        ));
        assert!(
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id)
                .is_none()
        );
    }

    #[test]
    fn test_delete_nonexistent_rule() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        assert!(!delete_cf_rule(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            "nope"
        ));
    }

    #[test]
    fn test_update_ranges() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        let new_ranges = vec![rng(10, 10, 20, 20), rng(30, 30, 40, 40)];
        assert!(update_cf_ranges(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            &new_ranges
        ));
        let result =
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id).unwrap();
        assert_eq!(result.ranges.len(), 2);
        assert_eq!(result.ranges[0].start_row(), 10);
        assert_eq!(result.ranges[1].start_row(), 30);
    }

    #[test]
    fn test_update_ranges_empty_deletes_format() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5)],
                vec![make_rule("r1", 1)],
            ),
        );
        assert!(update_cf_ranges(
            storage.doc(),
            &storage.sheets_ref(),
            "cf1",
            &sheet_id,
            &[]
        ));
        assert!(
            get_conditional_format(storage.doc(), &storage.sheets_ref(), "cf1", &sheet_id)
                .is_none()
        );
    }

    #[test]
    fn test_ranges_overlap() {
        assert!(cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(3, 3, 8, 8)));
        assert!(!cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(6, 0, 10, 5)));
        assert!(cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(0, 0, 5, 5)));
        assert!(cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(5, 5, 10, 10)));
        assert!(!cf_ranges_overlap(&rng(0, 0, 5, 5), &rng(0, 6, 5, 10)));
    }

    #[test]
    fn test_range_contains() {
        assert!(cf_range_contains(&rng(0, 0, 10, 10), &rng(2, 2, 8, 8)));
        assert!(cf_range_contains(&rng(0, 0, 5, 5), &rng(0, 0, 5, 5)));
        assert!(!cf_range_contains(&rng(2, 2, 8, 8), &rng(0, 0, 10, 10)));
        assert!(!cf_range_contains(&rng(0, 0, 5, 5), &rng(3, 3, 8, 8)));
    }

    #[test]
    fn test_subtract_no_overlap() {
        let result = cf_subtract_range(&rng(0, 0, 5, 5), &rng(10, 10, 15, 15));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], rng(0, 0, 5, 5));
    }

    #[test]
    fn test_subtract_full_contain() {
        let result = cf_subtract_range(&rng(2, 2, 8, 8), &rng(0, 0, 10, 10));
        assert!(result.is_empty());
    }

    #[test]
    fn test_subtract_top_strip() {
        let result = cf_subtract_range(&rng(0, 0, 9, 3), &rng(5, 0, 9, 3));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], rng(0, 0, 4, 3));
    }

    #[test]
    fn test_subtract_bottom_strip() {
        let result = cf_subtract_range(&rng(0, 0, 9, 3), &rng(0, 0, 4, 3));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], rng(5, 0, 9, 3));
    }

    #[test]
    fn test_subtract_left_strip() {
        let result = cf_subtract_range(&rng(0, 0, 5, 5), &rng(0, 3, 5, 5));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], rng(0, 0, 5, 2));
    }

    #[test]
    fn test_subtract_right_strip() {
        let result = cf_subtract_range(&rng(0, 0, 5, 5), &rng(0, 0, 5, 2));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], rng(0, 3, 5, 5));
    }

    #[test]
    fn test_subtract_center_produces_4_strips() {
        let result = cf_subtract_range(&rng(0, 0, 9, 3), &rng(4, 1, 7, 2));
        assert_eq!(result.len(), 4);
        assert!(result.contains(&rng(0, 0, 3, 3)));
        assert!(result.contains(&rng(8, 0, 9, 3)));
        assert!(result.contains(&rng(4, 0, 7, 0)));
        assert!(result.contains(&rng(4, 3, 7, 3)));
    }

    #[test]
    fn test_intersect_ranges() {
        assert_eq!(
            cf_intersect_ranges(&rng(0, 0, 5, 5), &rng(3, 3, 8, 8)),
            Some(rng(3, 3, 5, 5))
        );
    }

    #[test]
    fn test_intersect_no_overlap() {
        assert!(cf_intersect_ranges(&rng(0, 0, 5, 5), &rng(10, 10, 15, 15)).is_none());
    }

    #[test]
    fn test_is_valid_range() {
        assert!(cf_is_valid_range(&rng(0, 0, 5, 5)));
        assert!(cf_is_valid_range(&rng(3, 3, 3, 3)));
        // SheetRange::new normalizes inverted coords, so all ranges are valid
        assert!(cf_is_valid_range(&rng(5, 0, 3, 5)));
        assert!(cf_is_valid_range(&rng(0, 5, 5, 3)));
    }

    #[test]
    fn test_data_bar_presets_count() {
        let presets = data_bar_presets();
        assert_eq!(presets.len(), 8);
        let mut ids: Vec<&str> = presets.iter().map(|p| p.id.as_str()).collect();
        let original_len = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(original_len, ids.len());
    }

    #[test]
    fn test_color_scale_presets_count() {
        let presets = color_scale_presets();
        assert_eq!(presets.len(), 10);
        assert_eq!(
            presets
                .iter()
                .filter(|p| p.color_scale.mid_point.is_some())
                .count(),
            6
        );
        assert_eq!(
            presets
                .iter()
                .filter(|p| p.color_scale.mid_point.is_none())
                .count(),
            4
        );
    }

    #[test]
    fn test_icon_set_presets_count() {
        // 20 = every `IconSetType` variant except `NoIcons`.
        assert_eq!(icon_set_presets().len(), 20);
    }

    #[test]
    fn test_icon_set_registry_count() {
        assert_eq!(ICON_SET_REGISTRY.len(), 20);
        let three_icons: Vec<_> = ICON_SET_REGISTRY
            .iter()
            .filter(|m| m.icon_count == 3)
            .collect();
        assert_eq!(three_icons.len(), 10);
        for m in &three_icons {
            assert_eq!(m.default_thresholds.len(), 3);
        }
    }

    #[test]
    fn test_preset_lookup() {
        assert_eq!(
            get_preset_by_id("databar-blue-gradient"),
            Some(CFPresetCategory::DataBar)
        );
        assert_eq!(
            get_preset_by_id("colorscale-green-yellow-red"),
            Some(CFPresetCategory::ColorScale)
        );
        assert_eq!(
            get_preset_by_id("iconset-3arrows"),
            Some(CFPresetCategory::IconSet)
        );
        assert_eq!(get_preset_by_id("nonexistent"), None);
    }

    #[test]
    fn test_cf_rule_serde_roundtrip() {
        let rule = make_rule("r1", 1);
        let json = serde_json::to_string(&rule).unwrap();
        let deserialized: CFRule = serde_json::from_str(&json).unwrap();
        assert_eq!(rule, deserialized);
    }

    #[test]
    fn test_conditional_format_serde_roundtrip() {
        let sheet_id = make_sheet_id(42);
        let fmt = make_format(
            "cf1",
            &sheet_id,
            vec![rng(0, 0, 9, 3)],
            vec![make_rule("r1", 1)],
        );
        let json = serde_json::to_string(&fmt).unwrap();
        let deserialized: ConditionalFormat = serde_json::from_str(&json).unwrap();
        assert_eq!(fmt, deserialized);
    }

    #[test]
    fn test_color_scale_rule_serde() {
        let rule = CFRule::ColorScale {
            id: "cs1".into(),
            priority: 1,
            stop_if_true: None,
            color_scale: CFColorScale {
                min_point: cp(CfvoType::Min, "#63BE7B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFEB84")),
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        };
        let json = serde_json::to_string(&rule).unwrap();
        assert!(json.contains("\"type\":\"colorScale\""));
        let deserialized: CFRule = serde_json::from_str(&json).unwrap();
        assert_eq!(rule, deserialized);
    }

    #[test]
    fn test_cell_in_multiple_ranges() {
        let (storage, sheet_id) = storage_with_sheet();
        add_conditional_format(
            storage.doc(),
            &storage.sheets_ref(),
            &make_format(
                "cf1",
                &sheet_id,
                vec![rng(0, 0, 5, 5), rng(10, 10, 15, 15)],
                vec![make_rule("r1", 1)],
            ),
        );
        assert!(has_cf_for_cell(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            3,
            3
        ));
        assert!(has_cf_for_cell(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            12,
            12
        ));
        assert!(!has_cf_for_cell(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            7,
            7
        ));
    }

    // =====================================================================
    // Range-backed CF: cfRules shared rule body store tests
    // =====================================================================

    #[test]
    fn test_store_and_read_cf_rule_body() {
        let (storage, sheet_id) = storage_with_sheet();
        let fmt = make_format(
            "cf-body-1",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        );
        assert!(store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "rule-key-1",
            &fmt
        ));
        let result = read_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "rule-key-1",
        );
        assert!(result.is_some());
        let read_fmt = result.unwrap();
        assert_eq!(read_fmt.id, "cf-body-1");
        assert_eq!(read_fmt.rules.len(), 1);
        assert_eq!(read_fmt.rules[0].id(), "r1");
    }

    #[test]
    fn test_read_cf_rule_body_nonexistent() {
        let (storage, sheet_id) = storage_with_sheet();
        assert!(
            read_cf_rule_body(
                storage.doc(),
                &storage.sheets_ref(),
                &sheet_id,
                "nonexistent"
            )
            .is_none()
        );
    }

    #[test]
    fn test_remove_cf_rule_body() {
        let (storage, sheet_id) = storage_with_sheet();
        let fmt = make_format(
            "cf-rm",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        );
        store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "rule-rm",
            &fmt,
        );
        assert!(remove_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "rule-rm"
        ));
        assert!(
            read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "rule-rm").is_none()
        );
    }

    #[test]
    fn test_list_cf_rule_body_keys() {
        let (storage, sheet_id) = storage_with_sheet();
        let fmt_a = make_format(
            "cf-a",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        );
        let fmt_b = make_format(
            "cf-b",
            &sheet_id,
            vec![rng(10, 10, 15, 15)],
            vec![make_rule("r2", 2)],
        );
        store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "key-a",
            &fmt_a,
        );
        store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "key-b",
            &fmt_b,
        );
        let mut keys = list_cf_rule_body_keys(storage.doc(), &storage.sheets_ref(), &sheet_id);
        keys.sort();
        assert_eq!(keys, vec!["key-a".to_string(), "key-b".to_string()]);
    }

    #[test]
    fn test_multi_region_shared_rule_body() {
        let (storage, sheet_id) = storage_with_sheet();
        let fmt = make_format(
            "shared-cf",
            &sheet_id,
            vec![rng(0, 0, 5, 5), rng(10, 10, 15, 15)],
            vec![make_rule("r1", 1), make_rule("r2", 2)],
        );
        store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "shared-rule",
            &fmt,
        );
        let result = read_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "shared-rule",
        )
        .unwrap();
        assert_eq!(result.rules.len(), 2);
        assert_eq!(result.rules[0].priority(), 1);
        assert_eq!(result.rules[1].priority(), 2);
    }

    #[test]
    fn test_cf_priority_ordering_preserved() {
        let (storage, sheet_id) = storage_with_sheet();
        let fmt = make_format(
            "pri-cf",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![
                make_rule("r3", 30),
                make_rule("r1", 10),
                make_rule("r2", 20),
            ],
        );
        store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "pri-rule",
            &fmt,
        );
        let result =
            read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "pri-rule").unwrap();
        assert_eq!(result.rules[0].priority(), 30);
        assert_eq!(result.rules[1].priority(), 10);
        assert_eq!(result.rules[2].priority(), 20);
    }

    #[test]
    fn test_orphan_gc_deletes_unreferenced_rule() {
        let (storage, sheet_id) = storage_with_sheet();
        ensure_range_bindings_map(&storage, &sheet_id);
        let fmt = make_format(
            "orphan-cf",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        );
        store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "orphan-rule",
            &fmt,
        );
        assert!(gc_orphan_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "orphan-rule"
        ));
        assert!(
            read_cf_rule_body(
                storage.doc(),
                &storage.sheets_ref(),
                &sheet_id,
                "orphan-rule"
            )
            .is_none()
        );
    }

    #[test]
    fn test_orphan_gc_retains_referenced_rule() {
        let (storage, sheet_id) = storage_with_sheet();
        ensure_range_bindings_map(&storage, &sheet_id);
        let fmt = make_format(
            "ref-cf",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        );
        store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "ref-rule",
            &fmt,
        );
        {
            let mut txn = storage
                .doc()
                .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            let bindings_map = get_range_bindings_map(&storage, &sheet_id, &txn);
            let binding = compute_document::range::CfBinding {
                rule_ref: "ref-rule".to_string(),
            };
            compute_document::range::write_cf_binding(
                &mut txn,
                &bindings_map,
                &cell_types::RangeId::from_raw(0x42),
                &binding,
            );
        }
        assert!(!gc_orphan_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "ref-rule"
        ));
        assert!(
            read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "ref-rule")
                .is_some()
        );
    }

    #[test]
    fn test_deletion_lifecycle() {
        let (storage, sheet_id) = storage_with_sheet();
        ensure_range_bindings_map(&storage, &sheet_id);
        let fmt = make_format(
            "lc-cf",
            &sheet_id,
            vec![rng(0, 0, 5, 5)],
            vec![make_rule("r1", 1)],
        );
        store_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "lc-rule",
            &fmt,
        );
        // Two bindings reference the same rule
        {
            let mut txn = storage
                .doc()
                .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            let bm = get_range_bindings_map(&storage, &sheet_id, &txn);
            let b = compute_document::range::CfBinding {
                rule_ref: "lc-rule".to_string(),
            };
            compute_document::range::write_cf_binding(
                &mut txn,
                &bm,
                &cell_types::RangeId::from_raw(0xA),
                &b,
            );
            compute_document::range::write_cf_binding(
                &mut txn,
                &bm,
                &cell_types::RangeId::from_raw(0xB),
                &b,
            );
        }
        // Delete one region — rule persists
        {
            let mut txn = storage
                .doc()
                .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            let bm = get_range_bindings_map(&storage, &sheet_id, &txn);
            compute_document::range::remove_range_binding(
                &mut txn,
                &bm,
                &cell_types::RangeId::from_raw(0xA),
            );
        }
        assert!(!gc_orphan_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "lc-rule"
        ));
        assert!(
            read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "lc-rule").is_some()
        );
        // Delete last region — GC removes rule
        {
            let mut txn = storage
                .doc()
                .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            let bm = get_range_bindings_map(&storage, &sheet_id, &txn);
            compute_document::range::remove_range_binding(
                &mut txn,
                &bm,
                &cell_types::RangeId::from_raw(0xB),
            );
        }
        assert!(gc_orphan_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "lc-rule"
        ));
        assert!(
            read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "lc-rule").is_none()
        );
    }

    #[test]
    fn test_geometry_helpers_with_range_extent() {
        let region_a = rng(0, 0, 5, 3);
        let region_b = rng(3, 2, 8, 6);
        assert!(cf_ranges_overlap(&region_a, &region_b));
        assert_eq!(
            cf_intersect_ranges(&region_a, &region_b),
            Some(rng(3, 2, 5, 3))
        );
        let strips = cf_subtract_range(&region_a, &region_b);
        assert!(!strips.is_empty());
        for strip in &strips {
            assert!(cf_is_valid_range(strip));
        }
        assert!(cf_range_contains(&rng(0, 0, 10, 10), &region_a));
        assert!(!cf_range_contains(&region_a, &rng(0, 0, 10, 10)));
    }
}
