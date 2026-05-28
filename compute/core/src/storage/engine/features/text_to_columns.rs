use super::super::YrsComputeEngine;
use super::super::services::features as svc;
use crate::snapshot::MutationResult;
use crate::storage::cells::data_ops as cell_ops;
use cell_types::SheetId;
use value_types::ComputeError;

pub(super) fn text_to_columns(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
    source_col: u32,
    dest_row: u32,
    dest_col: u32,
    options: serde_json::Value,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let mut result = svc::text_to_columns(
        &mut engine.stores,
        &mut engine.mirror,
        &mut engine.mutation,
        *sheet_id,
        start_row,
        end_row,
        source_col,
        dest_row,
        dest_col,
        options,
    )?;
    // R5: seed `pending_recalc` so `flush_viewport_patches` has changes to
    // serialize. The kernel-side `forceRefreshAllViewports` band-aid that
    // used to mask this gap was removed in recalc idempotency.
    engine.prepare_recalc_for_flush(&mut result.recalc);
    Ok((engine.flush_viewport_patches(), result))
}

pub(super) fn text_to_columns_simple(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
    source_col: u32,
    dest_row: u32,
    dest_col: u32,
    delimiter: &str,
    custom_delimiter: Option<String>,
    treat_consecutive_as_one: bool,
    text_qualifier: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    // Build the nested JSON options that the existing service function expects
    let mut delimiters = serde_json::json!({
        "tab": delimiter == "tab",
        "comma": delimiter == "comma",
        "semicolon": delimiter == "semicolon",
        "space": delimiter == "space",
    });
    if delimiter == "custom"
        && let Some(ref cd) = custom_delimiter
    {
        delimiters["other"] = serde_json::Value::String(cd.clone());
    }

    let tq = match text_qualifier {
        "'" | "singleQuote" => "singleQuote",
        "none" => "none",
        _ => "doubleQuote",
    };

    let options = serde_json::json!({
        "splitType": "Delimited",
        "delimiters": delimiters,
        "treatConsecutiveAsOne": treat_consecutive_as_one,
        "textQualifier": tq,
    });

    let mut result = svc::text_to_columns(
        &mut engine.stores,
        &mut engine.mirror,
        &mut engine.mutation,
        *sheet_id,
        start_row,
        end_row,
        source_col,
        dest_row,
        dest_col,
        options,
    )?;
    // R5: seed `pending_recalc` so `flush_viewport_patches` has changes to
    // serialize. Same fix as `text_to_columns`.
    engine.prepare_recalc_for_flush(&mut result.recalc);
    Ok((engine.flush_viewport_patches(), result))
}

pub(super) fn preview_text_to_columns(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    source_start_row: u32,
    source_end_row: u32,
    source_col: u32,
    options: cell_ops::TextToColumnsOptions,
    max_preview_rows: u32,
) -> Vec<Vec<String>> {
    svc::preview_text_to_columns(
        &engine.stores,
        *sheet_id,
        source_start_row,
        source_end_row,
        source_col,
        &options,
        max_preview_rows,
    )
}
