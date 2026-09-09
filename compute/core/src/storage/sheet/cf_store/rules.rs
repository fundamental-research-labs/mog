use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::conditional_format::{CFRule, canonicalize_conditional_format_defaults};

pub fn add_cf_rule(
    storage: &mut WorkbookStorage,
    format_id: &str,
    sheet_id: &SheetId,
    rule: &CFRule,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        conditional_formats,
        format_id
    );

    let Some(cf) = storage
        .sheet_metadata
        .get_mut(sheet_id)
        .and_then(|metadata| metadata.conditional_formats.get_mut(format_id))
    else {
        return false;
    };
    cf.rules.push(rule.clone());
    cf.rules.sort_by_key(|rule| rule.priority());
    canonicalize_conditional_format_defaults(cf);
    true
}
/// Apply a public rule patch, validating its complete typed variant before mutation.
pub fn update_cf_rule(
    storage: &mut WorkbookStorage,
    format_id: &str,
    sheet_id: &SheetId,
    rule_id: &str,
    updates: &serde_json::Value,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        conditional_formats,
        format_id
    );

    let Some(cf) = storage
        .sheet_metadata
        .get_mut(sheet_id)
        .and_then(|metadata| metadata.conditional_formats.get_mut(format_id))
    else {
        return false;
    };
    let Some(index) = cf.rules.iter().position(|rule| rule.id() == rule_id) else {
        return false;
    };
    let Ok(mut value) = serde_json::to_value(&cf.rules[index]) else {
        return false;
    };
    let (Some(target), Some(updates)) = (value.as_object_mut(), updates.as_object()) else {
        return false;
    };
    for (key, value) in updates {
        target.insert(key.clone(), value.clone());
    }
    let Ok(rule) = serde_json::from_value(value) else {
        return false;
    };
    cf.rules[index] = rule;
    cf.rules.sort_by_key(|rule| rule.priority());
    canonicalize_conditional_format_defaults(cf);
    true
}
pub fn delete_cf_rule(
    storage: &mut WorkbookStorage,
    format_id: &str,
    sheet_id: &SheetId,
    rule_id: &str,
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
    let Some(cf) = metadata.conditional_formats.get_mut(format_id) else {
        return false;
    };
    let original_len = cf.rules.len();
    cf.rules.retain(|rule| rule.id() != rule_id);
    let removed = original_len != cf.rules.len();
    if cf.rules.is_empty() {
        metadata.conditional_formats.remove(format_id);
    }
    removed
}
