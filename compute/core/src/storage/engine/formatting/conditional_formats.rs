use super::*;

pub(super) fn add_cf_rule(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    rule: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    // 1. Normalize wire input to canonical schema.
    let mut rule_json = rule;
    domain_types::domain::conditional_format::normalize_conditional_format_input(&mut rule_json);
    let mut rule: ConditionalFormat =
        serde_json::from_value(rule_json).map_err(|e| ComputeError::Eval {
            message: format!("invalid conditional format payload: {e}"),
        })?;

    rule.sheet_id = sheet_id.to_uuid_string();

    // Excel semantics: newly-added formats get the highest priority
    //    (priority value 1; lower number = higher precedence). All
    //    existing formats are renumbered upward so the new format sits
    //    at the front of the sort order produced by
    //    `get_formats_for_sheet`. Rules within the new format are
    //    numbered sequentially starting at 1; existing formats keep
    //    their relative order (sorted by current first-rule priority).
    for (offset, r) in rule.rules.iter_mut().enumerate() {
        r.set_priority(1 + offset as i32);
    }
    let new_rule_count = rule.rules.len() as i32;

    // Bump existing formats' priorities BEFORE inserting the new one.
    // The typed in-place rewrite (filter viewport finding 13) replaces an N+1
    // JSON round-trip + `update_cf_rule` loop that silently dropped
    // errors via `let _ =`. Failures here propagate to the caller.
    if new_rule_count > 0 {
        services::formatting::bump_cf_priorities(&mut engine.stores, sheet_id, new_rule_count)?;
    }

    let result = services::formatting::add_cf_rule(&mut engine.stores, sheet_id, &rule);

    let sid = *sheet_id;
    engine.refresh_cf_cache(&sid);

    Ok(result)
}

pub(super) fn update_cf_rule(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    rule_id: &str,
    updates: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let result =
        services::formatting::update_cf_rule(&mut engine.stores, sheet_id, rule_id, &updates)?;
    let sid = *sheet_id;
    engine.refresh_cf_cache(&sid);

    Ok(result)
}

pub(super) fn delete_cf_rule(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    rule_id: &str,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::delete_cf_rule(&mut engine.stores, sheet_id, rule_id)?;
    let sid = *sheet_id;
    engine.refresh_cf_cache(&sid);

    Ok(result)
}

pub(super) fn reorder_cf_rules(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    rule_ids: Vec<String>,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::reorder_cf_rules(&mut engine.stores, sheet_id, &rule_ids)?;
    let sid = *sheet_id;
    engine.refresh_cf_cache(&sid);

    Ok(result)
}

pub(super) fn get_all_cf_rules(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<ConditionalFormat> {
    services::formatting::get_all_cf_rules(&engine.stores, sheet_id)
}

pub(super) fn get_cf_rules_for_cell(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<ConditionalFormat> {
    services::formatting::get_cf_rules_for_cell(&engine.stores, sheet_id, row, col)
}

pub(super) fn get_conditional_format(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    format_id: &str,
) -> Option<ConditionalFormat> {
    services::formatting::get_conditional_format(&engine.stores, sheet_id, format_id)
}

pub(super) fn has_cf_for_cell(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    services::formatting::has_cf_for_cell(&engine.stores, sheet_id, row, col)
}

pub(super) fn update_cf_ranges(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    format_id: &str,
    new_ranges: &[CFCellRange],
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::update_cf_ranges(
        &mut engine.stores,
        sheet_id,
        format_id,
        new_ranges,
    )?;
    let sid = *sheet_id;
    engine.refresh_cf_cache(&sid);

    Ok(result)
}

pub(super) fn clear_cf_formats_for_sheet(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::clear_cf_formats_for_sheet(&mut engine.stores, sheet_id)?;
    Ok(result)
}

pub(super) fn add_rule_to_cf(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    format_id: &str,
    rule: &CFRule,
) -> Result<MutationResult, ComputeError> {
    let result =
        services::formatting::add_rule_to_cf(&mut engine.stores, sheet_id, format_id, rule)?;
    let sid = *sheet_id;
    engine.refresh_cf_cache(&sid);

    Ok(result)
}

pub(super) fn update_rule_in_cf(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    format_id: &str,
    rule_id: &str,
    updates: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::update_rule_in_cf(
        &mut engine.stores,
        sheet_id,
        format_id,
        rule_id,
        &updates,
    )?;
    let sid = *sheet_id;
    engine.refresh_cf_cache(&sid);

    Ok(result)
}

pub(super) fn delete_rule_from_cf(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    format_id: &str,
    rule_id: &str,
) -> Result<MutationResult, ComputeError> {
    let result = services::formatting::delete_rule_from_cf(
        &mut engine.stores,
        sheet_id,
        format_id,
        rule_id,
    )?;
    let sid = *sheet_id;
    engine.refresh_cf_cache(&sid);

    Ok(result)
}
