use super::ranges::cell_in_range;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::conditional_format::{
    ConditionalFormat, canonicalize_conditional_format_defaults,
};
use std::collections::{HashMap, HashSet};

pub(crate) fn imported_formats(
    formats: &[ConditionalFormat],
    sheet_id: SheetId,
) -> std::collections::BTreeMap<String, ConditionalFormat> {
    formats
        .iter()
        .cloned()
        .map(|mut format| {
            format.sheet_id = sheet_id.to_uuid_string();
            canonicalize_conditional_format_defaults(&mut format);
            (format.id.clone(), format)
        })
        .collect()
}
pub fn add_conditional_format(storage: &mut WorkbookStorage, format: &ConditionalFormat) {
    let Ok(sheet_id) = SheetId::from_uuid_str(&format.sheet_id) else {
        return;
    };
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        sheet_id,
        conditional_formats,
        format.id
    );
    let Some(metadata) = storage.sheet_metadata.get_mut(&sheet_id) else {
        return;
    };
    let mut format = format.clone();
    canonicalize_conditional_format_defaults(&mut format);
    metadata
        .conditional_formats
        .insert(format.id.clone(), format);
}
/// Apply a public JSON patch, then keep only the validated typed format.
pub fn update_conditional_format(
    storage: &mut WorkbookStorage,
    format_id: &str,
    sheet_id: &SheetId,
    updates: &serde_json::Value,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        conditional_formats,
        format_id
    );

    let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) else {
        return false;
    };
    let Some(mut cf) = metadata.conditional_formats.get(format_id).cloned() else {
        return false;
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
    cf.sheet_id = sheet_id.to_uuid_string();
    canonicalize_conditional_format_defaults(&mut cf);
    metadata
        .conditional_formats
        .insert(format_id.to_owned(), cf);
    true
}
pub fn delete_conditional_format(
    storage: &mut WorkbookStorage,
    format_id: &str,
    sheet_id: &SheetId,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        conditional_formats,
        format_id
    );

    storage
        .sheet_metadata
        .get_mut(sheet_id)
        .is_some_and(|metadata| metadata.conditional_formats.remove(format_id).is_some())
}
pub fn get_conditional_format(
    storage: &WorkbookStorage,
    format_id: &str,
    sheet_id: &SheetId,
) -> Option<ConditionalFormat> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .conditional_formats
        .get(format_id)
        .cloned()
}
pub fn get_formats_for_sheet(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<ConditionalFormat> {
    let Some(metadata) = storage.sheet_metadata.get(sheet_id) else {
        return Vec::new();
    };
    let mut keyed: Vec<_> = metadata
        .conditional_formats
        .iter()
        .map(|(id, cf)| (id.clone(), cf.clone()))
        .collect();
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
pub fn get_formats_for_cell(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<ConditionalFormat> {
    get_formats_for_sheet(storage, sheet_id)
        .into_iter()
        .filter(|format| {
            format
                .ranges
                .iter()
                .any(|range| cell_in_range(range, row, col))
        })
        .collect()
}
pub fn has_cf_for_cell(storage: &WorkbookStorage, sheet_id: &SheetId, row: u32, col: u32) -> bool {
    storage
        .sheet_metadata
        .get(sheet_id)
        .is_some_and(|metadata| {
            metadata.conditional_formats.values().any(|format| {
                format
                    .ranges
                    .iter()
                    .any(|range| cell_in_range(range, row, col))
            })
        })
}
pub fn clear_formats_for_sheet(storage: &mut WorkbookStorage, sheet_id: &SheetId) {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet_id) {
            for (id, _value) in &meta.conditional_formats {
                if true {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sheet_id,
                        conditional_formats,
                        id
                    );
                }
            }
        }
    }

    if let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) {
        metadata.conditional_formats.clear();
    }
}
pub fn bump_priorities_for_sheet(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    delta: i32,
) -> Result<usize, value_types::ComputeError> {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet_id) {
            for (id, _value) in &meta.conditional_formats {
                if true {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sheet_id,
                        conditional_formats,
                        id
                    );
                }
            }
        }
    }

    let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) else {
        return Ok(0);
    };
    if metadata
        .conditional_formats
        .values()
        .flat_map(|cf| &cf.rules)
        .any(|rule| rule.priority().checked_add(delta).is_none())
    {
        return Err(value_types::ComputeError::Eval {
            message: "Conditional-format priority overflow".into(),
        });
    }
    for cf in metadata.conditional_formats.values_mut() {
        for rule in &mut cf.rules {
            rule.set_priority(rule.priority() + delta);
        }
    }
    Ok(metadata.conditional_formats.len())
}
pub fn reorder_conditional_formats(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    ordered_format_ids: &[String],
) -> Result<usize, value_types::ComputeError> {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet_id) {
            for (id, _value) in &meta.conditional_formats {
                if true {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sheet_id,
                        conditional_formats,
                        id
                    );
                }
            }
        }
    }

    let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) else {
        return Ok(0);
    };
    let existing_ids: HashSet<&str> = metadata
        .conditional_formats
        .keys()
        .map(String::as_str)
        .collect();
    let requested_ids: HashSet<&str> = ordered_format_ids.iter().map(String::as_str).collect();
    if metadata.conditional_formats.len() != ordered_format_ids.len()
        || existing_ids != requested_ids
    {
        return Err(value_types::ComputeError::Eval {
            message: "CF reorder must include exactly the existing format IDs".into(),
        });
    }
    let priorities: HashMap<&str, i32> = ordered_format_ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i as i32 + 1))
        .collect();
    let mut rewritten = 0;
    for cf in metadata.conditional_formats.values_mut() {
        let priority = priorities[cf.id.as_str()];
        if cf.rules.iter().any(|rule| rule.priority() != priority) {
            rewritten += 1;
        }
        for rule in &mut cf.rules {
            rule.set_priority(priority);
        }
    }
    Ok(rewritten)
}
