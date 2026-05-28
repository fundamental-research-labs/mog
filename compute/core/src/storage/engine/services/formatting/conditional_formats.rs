use crate::snapshot::{CfChange, ChangeKind, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::cf_store;
use crate::storage::sheet::cf_store::CFCellRange;
use cell_types::SheetId;
use domain_types::domain::conditional_format::{CFRule, ConditionalFormat};
use value_types::ComputeError;

pub(in crate::storage::engine) fn add_cf_rule(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rule: &ConditionalFormat,
) -> MutationResult {
    cf_store::add_conditional_format(stores.storage.doc(), &stores.storage.sheets_ref(), rule);
    let mut result = MutationResult::empty();
    result.cf_changes.push(CfChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        rule_id: Some(rule.id.clone()),
    });
    result
}

pub(in crate::storage::engine) fn bump_cf_priorities(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    delta: i32,
) -> Result<usize, ComputeError> {
    cf_store::bump_priorities_for_sheet(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        delta,
    )
}

pub(in crate::storage::engine) fn update_cf_rule(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rule_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::update_conditional_format(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        rule_id,
        sheet_id,
        updates,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF rule not found: {}", rule_id),
        });
    }
    let mut result = MutationResult::empty();
    result.cf_changes.push(CfChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        rule_id: Some(rule_id.to_string()),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn delete_cf_rule(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rule_id: &str,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::delete_conditional_format(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        rule_id,
        sheet_id,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF rule not found: {}", rule_id),
        });
    }
    let mut result = MutationResult::empty();
    result.cf_changes.push(CfChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Removed,
        rule_id: Some(rule_id.to_string()),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn reorder_cf_rules(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rule_ids: &[String],
) -> Result<MutationResult, ComputeError> {
    cf_store::reorder_conditional_formats(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        rule_ids,
    )?;
    let mut result = MutationResult::empty();
    result.cf_changes.push(CfChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        rule_id: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn update_cf_ranges(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
    new_ranges: &[CFCellRange],
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::update_cf_ranges(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
        new_ranges,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF format not found: {}", format_id),
        });
    }
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn add_rule_to_cf(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
    rule: &CFRule,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::add_cf_rule(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
        rule,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF format not found: {}", format_id),
        });
    }
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn update_rule_in_cf(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
    rule_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::update_cf_rule(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
        rule_id,
        updates,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF rule '{}' not found in format '{}'", rule_id, format_id),
        });
    }
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn delete_rule_from_cf(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
    rule_id: &str,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::delete_cf_rule(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
        rule_id,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF rule '{}' not found in format '{}'", rule_id, format_id),
        });
    }
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_all_cf_rules(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ConditionalFormat> {
    cf_store::get_formats_for_sheet(stores.storage.doc(), &stores.storage.sheets_ref(), sheet_id)
}

pub(in crate::storage::engine) fn get_cf_rules_for_cell(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<ConditionalFormat> {
    cf_store::get_formats_for_cell(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        row,
        col,
    )
}

pub(in crate::storage::engine) fn get_conditional_format(
    stores: &EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
) -> Option<ConditionalFormat> {
    cf_store::get_conditional_format(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
    )
}

pub(in crate::storage::engine) fn has_cf_for_cell(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    cf_store::has_cf_for_cell(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        row,
        col,
    )
}

pub(in crate::storage::engine) fn clear_cf_formats_for_sheet(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    cf_store::clear_formats_for_sheet(stores.storage.doc(), &stores.storage.sheets_ref(), sheet_id);
    stores.cf_cache.remove(sheet_id);
    Ok(MutationResult::empty())
}
