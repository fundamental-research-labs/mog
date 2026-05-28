use crate::mirror::CellMirror;
use crate::snapshot::MutationResult;
use crate::storage::cells::data_ops as cell_ops;
use crate::storage::engine::stores::EngineStores;
use cell_types::{SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

pub(in crate::storage::engine) fn preview_text_to_columns(
    stores: &EngineStores,
    sheet_id: SheetId,
    source_start_row: u32,
    source_end_row: u32,
    source_col: u32,
    options: &cell_ops::TextToColumnsOptions,
    max_preview_rows: u32,
) -> Vec<Vec<String>> {
    let grid = match stores.grid_indexes.get(&sheet_id) {
        Some(g) => g,
        None => return vec![],
    };
    cell_ops::preview_text_to_columns(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        grid,
        source_start_row,
        source_end_row,
        source_col,
        options,
        max_preview_rows,
    )
}

// -------------------------------------------------------------------
// Text to Columns — option parsing + execution

/// Split a single source row's text into one or more output cell inputs.
///
/// Tokens with **significant leading zeros** (e.g. `"00123"`, `"007"`) are
/// emitted as `CellInput::Literal` so the storage layer never coerces them
/// to numbers — matching Excel's General-format behaviour on the destination.
///
/// When `dest_is_numeric_formatted` is true (the destination column carries
/// an explicit Number/Currency/Accounting/Percentage/Scientific/Fraction
/// format), the user has signalled "treat this column as numbers" — so
/// leading-zero tokens *do* coerce, mirroring Excel's behaviour when a
/// Number format is applied to the destination column in the Text Wizard.
fn build_text_to_columns_inputs(
    tokens: &[String],
    dest_is_numeric_formatted: bool,
) -> Vec<crate::storage::engine::mutation::CellInput> {
    use crate::storage::engine::mutation::CellInput;
    tokens
        .iter()
        .map(|tok| {
            let trimmed = tok.trim();
            if trimmed.is_empty() {
                CellInput::Clear
            } else if !dest_is_numeric_formatted && cell_ops::has_significant_leading_zero(trimmed)
            {
                CellInput::Literal {
                    text: trimmed.to_string(),
                }
            } else {
                CellInput::Parse {
                    text: trimmed.to_string(),
                }
            }
        })
        .collect()
}

/// Check whether a column-level number format signals "treat as numbers" —
/// a Number, Currency, Accounting, Percentage, Scientific, or Fraction format.
/// General/Text/Date formats return false (leading zeros must be preserved).
fn col_format_is_numeric(format: Option<&domain_types::CellFormat>) -> bool {
    let Some(code) = format.and_then(|f| f.number_format.as_deref()) else {
        return false;
    };
    matches!(
        compute_formats::detect_format_type(code),
        compute_formats::FormatType::Number
            | compute_formats::FormatType::Currency
            | compute_formats::FormatType::Accounting
            | compute_formats::FormatType::Percentage
            | compute_formats::FormatType::Scientific
            | compute_formats::FormatType::Fraction
    )
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn text_to_columns(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation_coord: &mut crate::storage::engine::mutation_coordinator::MutationCoordinator,
    sheet_id: SheetId,
    start_row: u32,
    end_row: u32,
    source_col: u32,
    dest_row: u32,
    dest_col: u32,
    options: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let split_type = match options["splitType"].as_str() {
        Some("fixedWidth") | Some("FixedWidth") => cell_ops::TextToColumnsSplitType::FixedWidth,
        _ => cell_ops::TextToColumnsSplitType::Delimited,
    };
    let delimiters = cell_ops::Delimiters {
        tab: options["delimiters"]["tab"].as_bool().unwrap_or(false),
        semicolon: options["delimiters"]["semicolon"]
            .as_bool()
            .unwrap_or(false),
        comma: options["delimiters"]["comma"].as_bool().unwrap_or(true),
        space: options["delimiters"]["space"].as_bool().unwrap_or(false),
        other: options["delimiters"]["other"]
            .as_str()
            .map(|s| s.to_string()),
    };
    let treat_consecutive_as_one = options["treatConsecutiveAsOne"].as_bool().unwrap_or(false);
    let text_qualifier = match options["textQualifier"].as_str() {
        Some("singleQuote") | Some("SingleQuote") | Some("'") => {
            cell_ops::TextQualifier::SingleQuote
        }
        Some("none") | Some("None") => cell_ops::TextQualifier::None,
        _ => cell_ops::TextQualifier::DoubleQuote,
    };
    let fixed_width_breaks = options["fixedWidthBreaks"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_u64().map(|n| n as usize))
                .collect()
        })
        .unwrap_or_default();

    let opts = cell_ops::TextToColumnsOptions {
        split_type,
        delimiters,
        treat_consecutive_as_one,
        text_qualifier,
        fixed_width_breaks,
    };

    // 1. Read source values from the mirror as strings — text cells preserve
    //    leading zeros, numeric cells render to canonical strings.
    let source_values: Vec<String> = (start_row..=end_row)
        .map(|row| {
            let pos = SheetPos::new(row, source_col);
            match mirror.get_cell_value_at(&sheet_id, pos) {
                Some(CellValue::Text(s)) => s.to_string(),
                Some(CellValue::Number(n)) => value_types::format_number(n.get()),
                Some(CellValue::Boolean(true)) => "TRUE".to_string(),
                Some(CellValue::Boolean(false)) => "FALSE".to_string(),
                Some(CellValue::Error(e, _)) => e.as_str().to_string(),
                _ => String::new(),
            }
        })
        .collect();

    // 2. Split — preserves leading-zero tokens as strings via build_text_to_columns_inputs.
    let split_rows = cell_ops::split_all_values(&source_values, &opts);
    let max_cols = split_rows.iter().map(|r| r.len()).max().unwrap_or(1).max(1) as u32;

    // 3. For each destination column, look up its column-level number format
    //    once. A pre-applied numeric format ("treat this column as numbers")
    //    overrides the default leading-zero preservation, matching Excel's
    //    Text Wizard.
    let dest_col_is_numeric: Vec<bool> = (0..max_cols)
        .map(|offset| {
            let col = dest_col + offset;
            let col_fmt = crate::storage::properties::get_col_format(
                &stores.storage,
                &sheet_id,
                col,
                stores.grid_indexes.get(&sheet_id),
            );
            col_format_is_numeric(col_fmt.as_ref())
        })
        .collect();

    // 4. Build position-keyed edits. Pads short rows with `Clear` so trailing
    //    cells in the destination block (left over from a previous run) are
    //    cleared rather than orphaned.
    use crate::storage::engine::mutation::CellInput;
    let mut edits: Vec<(SheetId, u32, u32, CellInput)> =
        Vec::with_capacity((source_values.len() * max_cols as usize).max(1));
    for (row_offset, tokens) in split_rows.iter().enumerate() {
        let row = dest_row + row_offset as u32;
        for col_offset in 0..max_cols {
            let col = dest_col + col_offset;
            let dest_numeric = dest_col_is_numeric
                .get(col_offset as usize)
                .copied()
                .unwrap_or(false);
            // Build a single-column input slice to keep the helper stateless.
            let token_slice: Vec<String> = tokens
                .get(col_offset as usize)
                .cloned()
                .map(|t| vec![t])
                .unwrap_or_default();
            let input = build_text_to_columns_inputs(&token_slice, dest_numeric)
                .into_iter()
                .next()
                .unwrap_or(CellInput::Clear);
            edits.push((sheet_id, row, col, input));
        }
    }

    // 5. Route through the standard mutation pipeline so the mirror, viewport
    //    buffer, and undo journal all stay in sync. Skip per-edge cycle
    //    detection — a structural split can't introduce a formula cycle, and
    //    bulk routing keeps the path consistent with other batch writes.
    let should_group_undo = !edits.is_empty();
    if should_group_undo {
        mutation_coord.undo_manager.begin_undo_group();
    }
    let recalc_result = super::super::mutation_handlers::mutation_set_cells_by_position(
        stores,
        mirror,
        mutation_coord,
        edits,
        true,
    );
    if should_group_undo {
        mutation_coord.undo_manager.end_undo_group();
    }
    let recalc = recalc_result?;
    Ok(
        MutationResult::from_recalc(recalc).with_data(&serde_json::json!({
            "rowsProcessed": source_values.len(),
            "columnsCreated": max_cols,
        }))?,
    )
}
