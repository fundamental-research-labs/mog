//! Cell Data Operations — user-facing data transformation operations.
//!
//! Port of `spreadsheet-model/src/cells/cell-data-operations.ts` (646 LOC).
//!
//! ## Responsibilities
//! - **Remove Duplicates**: Remove duplicate rows based on column comparison
//! - **Text to Columns**: Split text values into multiple columns
//! - **Column Headers**: Get column header labels for a range
//! - **Detect Headers**: Heuristic to determine if first row contains headers
//!
//! ## Design
//! - Pure helper functions (`split_by_delimiter`, `split_by_fixed_width`,
//!   `build_delimiter_regex`) are testable in isolation.
//! - Free functions take `doc: &Doc` and `sheets: &MapRef` params, operating on the Yrs doc via transactions.
//! - Event bus / undo descriptions are TS-specific concerns handled by callers.

use std::sync::Arc;

use compute_document::undo::ORIGIN_USER_EDIT;
use regex::Regex;
use yrs::{Any, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::{get_cells_map, get_properties_map};
use cell_types::{CellId, SheetId, col_to_letter};
use compute_document::cell_serde::yrs_any_to_cell_value;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_VALUE;
use value_types::CellValue;
use yrs::Doc;

pub use crate::engine_types::cell_ops::*;

/// Read a cell's raw value as a string from the Yrs cells map.
///
/// Returns an empty string for missing/null cells. Converts numbers and
/// booleans to their string representation.
fn read_cell_value_as_string<T: yrs::ReadTxn>(
    txn: &T,
    cells_map: &MapRef,
    cell_hex: &str,
) -> String {
    let cell_map = match cells_map.get(txn, cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return String::new(),
    };
    let value = yrs_any_to_cell_value(&cell_map, txn);
    match value {
        CellValue::Null => String::new(),
        CellValue::Number(n) => {
            // Format without unnecessary trailing zeros
            value_types::format_number(n.get())
        }
        CellValue::Text(s) => s.to_string(),
        CellValue::Boolean(b) => {
            if b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        CellValue::Error(e, _) => e.as_str().to_string(),
        _ => String::new(),
    }
}

// ===========================================================================
// Pure splitting helpers (no Yrs access)
// ===========================================================================

/// Build a regex for delimiter-based splitting.
///
/// Constructs a character class `[chars]` from the enabled delimiter flags.
/// If `treat_consecutive_as_one` is true, appends `+` to match runs.
fn build_delimiter_regex(delimiters: &Delimiters, treat_consecutive_as_one: bool) -> Regex {
    let mut chars = Vec::new();

    if delimiters.tab {
        chars.push("\\t".to_string());
    }
    if delimiters.semicolon {
        chars.push(";".to_string());
    }
    if delimiters.comma {
        chars.push(",".to_string());
    }
    if delimiters.space {
        chars.push(" ".to_string());
    }
    if let Some(ref other) = delimiters.other {
        // Escape regex metacharacters
        chars.push(regex::escape(other));
    }

    if chars.is_empty() {
        chars.push(",".to_string());
    }

    let quantifier = if treat_consecutive_as_one { "+" } else { "" };
    let pattern = format!("[{}]{}", chars.join(""), quantifier);
    Regex::new(&pattern).expect("delimiter regex should be valid")
}

/// Split a value by delimiter regex, respecting text qualifiers.
///
/// When `qualifier` is `None`, uses simple regex splitting.
/// When a qualifier is set (e.g. `"` or `'`), handles quoted fields
/// including escaped quotes (doubled qualifier character).
fn split_by_delimiter(
    value: &str,
    delimiter_regex: &Regex,
    qualifier: &TextQualifier,
) -> Vec<String> {
    if value.is_empty() {
        return vec![String::new()];
    }

    if *qualifier == TextQualifier::None {
        return delimiter_regex
            .split(value)
            .map(|s| s.to_string())
            .collect();
    }

    let qual_char = match qualifier {
        TextQualifier::DoubleQuote => '"',
        TextQualifier::SingleQuote => '\'',
        TextQualifier::None => unreachable!(),
    };

    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = value.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];

        if ch == qual_char {
            if in_quotes {
                // Check for escaped qualifier (doubled)
                if i + 1 < chars.len() && chars[i + 1] == qual_char {
                    current.push(qual_char);
                    i += 2;
                    continue;
                }
                in_quotes = false;
            } else {
                in_quotes = true;
            }
            i += 1;
        } else if !in_quotes {
            // Check if current char is a delimiter
            // char_indices().nth(i).0 is always at a char boundary by construction.
            #[allow(clippy::string_slice)]
            let remaining = &value[value.char_indices().nth(i).unwrap().0..];
            if let Some(m) = delimiter_regex.find(remaining)
                && m.start() == 0
            {
                result.push(current.clone());
                current.clear();
                // Advance by the match length in chars
                let matched_str = m.as_str();
                i += matched_str.chars().count();
                continue;
            }
            current.push(ch);
            i += 1;
        } else {
            current.push(ch);
            i += 1;
        }
    }

    result.push(current);
    result
}

/// Split a string at fixed-width column positions.
///
/// `breaks` are character positions where the string should be split.
/// Resulting parts are trimmed. Breaks are sorted before processing.
fn split_by_fixed_width(value: &str, breaks: &[usize]) -> Vec<String> {
    if value.is_empty() || breaks.is_empty() {
        return vec![if value.is_empty() {
            String::new()
        } else {
            value.to_string()
        }];
    }

    let mut sorted_breaks: Vec<usize> = breaks.to_vec();
    sorted_breaks.sort_unstable();

    let mut result = Vec::new();
    let mut last_pos = 0;

    for &break_pos in &sorted_breaks {
        if break_pos > last_pos && break_pos <= value.len() {
            // `breaks` is documented as char positions but used as byte
            // positions — ASCII-only contract on the fixed-width splitter
            // path. Non-ASCII input at these byte offsets is a separate
            // known latent bug (see data_ops.rs text-to-columns TODO).
            #[allow(clippy::string_slice)]
            let part = value[last_pos..break_pos].trim().to_string();
            result.push(part);
            last_pos = break_pos;
        }
    }

    if last_pos < value.len() {
        // last_pos is a previous `break_pos` (ASCII-only contract, see above).
        #[allow(clippy::string_slice)]
        let tail = value[last_pos..].trim().to_string();
        result.push(tail);
    } else if result.is_empty() {
        result.push(value.to_string());
    }

    result
}

/// Split all source values according to options. Returns a Vec of split rows.
pub fn split_all_values(
    source_values: &[String],
    options: &TextToColumnsOptions,
) -> Vec<Vec<String>> {
    if options.split_type == TextToColumnsSplitType::FixedWidth {
        source_values
            .iter()
            .map(|v| split_by_fixed_width(v, &options.fixed_width_breaks))
            .collect()
    } else {
        let delimiter_regex =
            build_delimiter_regex(&options.delimiters, options.treat_consecutive_as_one);
        source_values
            .iter()
            .map(|v| split_by_delimiter(v, &delimiter_regex, &options.text_qualifier))
            .collect()
    }
}

// ===========================================================================
// Grid index mutation helpers (write txn)
// ===========================================================================

/// Copy all cell data from one row to another within a column range.
///
/// Used by remove_duplicates during compaction. If the source cell exists,
/// its value is copied to the target. If the source is empty and the target
/// exists, the target is deleted. Cell identities are managed through the
/// supplied `GridIndex` — the SOLE authority for (row, col) ↔ CellId.
#[allow(clippy::too_many_arguments)]
fn copy_row_cells(
    txn: &mut yrs::TransactionMut<'_>,
    grid: &mut GridIndex,
    cells_map: &MapRef,
    props_map: Option<&MapRef>,
    start_col: u32,
    end_col: u32,
    from_row: u32,
    to_row: u32,
) {
    for col in start_col..=end_col {
        let from_cell = grid.cell_id_at(from_row, col);
        let to_cell = grid.cell_id_at(to_row, col);

        if let Some(src_id) = from_cell {
            // Source cell exists — read its value and write to target
            let src_hex = id_to_hex(src_id.as_u128());
            let src_value = match cells_map.get(txn, src_hex.as_str()) {
                Some(Out::YMap(m)) => match m.get(txn, KEY_VALUE) {
                    Some(Out::Any(a)) => a.clone(),
                    _ => Any::Null,
                },
                _ => Any::Null,
            };

            if let Some(tgt_id) = to_cell {
                // Target cell exists — update KEY_VALUE in-place within the
                // existing YMap. Inserting a MapPrelim at an existing YMap key
                // does not replace the nested map in Yrs; only in-place update works.
                let tgt_hex = id_to_hex(tgt_id.as_u128());
                match cells_map.get(txn, tgt_hex.as_str()) {
                    Some(Out::YMap(cell_map)) => {
                        cell_map.insert(txn, KEY_VALUE, src_value);
                    }
                    _ => {
                        let cell_prelim = MapPrelim::from([(KEY_VALUE, src_value)]);
                        cells_map.insert(txn, tgt_hex.as_str(), cell_prelim);
                    }
                }
            } else {
                // No target cell — allocate a new CellId via the GridIndex
                // (the sole identity authority) and persist the value.
                let new_id = grid.ensure_cell_id(to_row, col);
                let new_hex = id_to_hex(new_id.as_u128());
                let cell_prelim = MapPrelim::from([(KEY_VALUE, src_value)]);
                cells_map.insert(txn, new_hex.as_str(), cell_prelim);
            }
        } else if let Some(tgt_id) = to_cell {
            // Source is empty but target exists — delete target
            let tgt_hex = id_to_hex(tgt_id.as_u128());
            cells_map.remove(txn, tgt_hex.as_str());
            if let Some(pm) = props_map {
                pm.remove(txn, tgt_hex.as_str());
            }
            grid.remove_cell(&tgt_id);
        }
    }
}

/// Delete all cells in a row within a column range.
fn delete_row_cells(
    txn: &mut yrs::TransactionMut<'_>,
    grid: &mut GridIndex,
    cells_map: &MapRef,
    props_map: Option<&MapRef>,
    start_col: u32,
    end_col: u32,
    row: u32,
) {
    // Snapshot the CellIds first to avoid iterator invalidation as we
    // deregister entries from the GridIndex.
    let to_remove: Vec<(CellId, u32)> = (start_col..=end_col)
        .filter_map(|col| grid.cell_id_at(row, col).map(|id| (id, col)))
        .collect();
    for (cell_id, _col) in to_remove {
        let hex = id_to_hex(cell_id.as_u128());
        cells_map.remove(txn, hex.as_str());
        if let Some(pm) = props_map {
            pm.remove(txn, hex.as_str());
        }
        grid.remove_cell(&cell_id);
    }
}

// ===========================================================================

/// Remove duplicate rows from a range based on selected columns.
///
/// Two-phase approach:
/// 1. Read transaction: identify duplicate rows by building row-key fingerprints
/// 2. Write transaction: compact non-duplicate rows upward, delete leftovers
///
/// Returns statistics about duplicates found/removed. Cell identities are managed
/// through the supplied `GridIndex`, the sole authority for (row, col) ↔ CellId.
#[allow(clippy::too_many_arguments)]
pub fn remove_duplicates(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: &RemoveDuplicatesOptions,
) -> RemoveDuplicatesResult {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let empty_result = RemoveDuplicatesResult {
        duplicates_found: 0,
        duplicates_removed: 0,
        unique_values_remaining: 0,
    };

    // Determine which columns to compare
    let columns_to_check: Vec<u32> = if options.columns_to_compare.is_empty() {
        (start_col..=end_col).collect()
    } else {
        options
            .columns_to_compare
            .iter()
            .copied()
            .filter(|&c| c >= start_col && c <= end_col)
            .collect()
    };

    if columns_to_check.is_empty() {
        return RemoveDuplicatesResult {
            duplicates_found: 0,
            duplicates_removed: 0,
            unique_values_remaining: end_row - start_row + 1,
        };
    }

    // --- Pass 1: Read — identify duplicate rows ---
    let duplicate_rows: Vec<u32>;
    {
        let txn = doc.transact();
        let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
            Some(m) => m,
            None => return empty_result,
        };

        // Helper: create a row key for comparison
        let create_row_key = |row: u32| -> String {
            columns_to_check
                .iter()
                .map(|&col| {
                    let val = match grid.cell_id_at(row, col) {
                        Some(cell_id) => {
                            let cell_hex = id_to_hex(cell_id.as_u128());
                            read_cell_value_as_string(&txn, &cells_map, &cell_hex)
                        }
                        None => String::new(),
                    };
                    if options.case_sensitive {
                        val
                    } else {
                        val.to_lowercase()
                    }
                })
                .collect::<Vec<_>>()
                .join("\0")
        };

        let first_data_row = if options.has_headers {
            start_row + 1
        } else {
            start_row
        };

        let mut seen_keys = std::collections::HashSet::new();
        let mut dups = Vec::new();

        // If headers, add the header row key so it's never a "duplicate"
        if options.has_headers {
            let header_key = create_row_key(start_row);
            seen_keys.insert(header_key);
        }

        for row in first_data_row..=end_row {
            let key = create_row_key(row);
            if seen_keys.contains(&key) {
                dups.push(row);
            } else {
                seen_keys.insert(key);
            }
        }

        duplicate_rows = dups;
    }

    if duplicate_rows.is_empty() {
        let total_data = end_row - start_row + 1 - if options.has_headers { 1 } else { 0 };
        return RemoveDuplicatesResult {
            duplicates_found: 0,
            duplicates_removed: 0,
            unique_values_remaining: total_data,
        };
    }

    // --- Pass 2: Write — compact non-duplicate rows upward ---
    let dup_set: std::collections::HashSet<u32> = duplicate_rows.iter().copied().collect();
    let first_data_row = if options.has_headers {
        start_row + 1
    } else {
        start_row
    };

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
            Some(m) => m,
            None => return empty_result,
        };
        let props_map = get_properties_map(&txn, sheets, &sheet_hex);

        let mut write_row = first_data_row;

        for read_row in first_data_row..=end_row {
            if !dup_set.contains(&read_row) {
                if write_row != read_row {
                    copy_row_cells(
                        &mut txn,
                        grid,
                        &cells_map,
                        props_map.as_ref(),
                        start_col,
                        end_col,
                        read_row,
                        write_row,
                    );
                }
                write_row += 1;
            }
        }

        // Clear remaining rows (the ones freed by compaction)
        for row in write_row..=end_row {
            delete_row_cells(
                &mut txn,
                grid,
                &cells_map,
                props_map.as_ref(),
                start_col,
                end_col,
                row,
            );
        }
    }

    let total_data = end_row - start_row + 1 - if options.has_headers { 1 } else { 0 };
    let unique_remaining = total_data - duplicate_rows.len() as u32;

    RemoveDuplicatesResult {
        duplicates_found: duplicate_rows.len() as u32,
        duplicates_removed: duplicate_rows.len() as u32,
        unique_values_remaining: unique_remaining,
    }
}

/// Returns true if `s` is a numeric-looking token (matches /^-?\d*\.?\d+$/)
/// that has at least one **significant** leading zero — i.e. starts with `0`
/// followed by another digit. Used by `text_to_columns` to preserve identifiers
/// like `"00123"`, `"007"`, or `"0123.45"` as strings instead of coercing them
/// to numeric values, which would silently drop the leading zeros.
///
/// Excel-compatible behaviour: text-to-columns output preserves leading zeros
/// on the General format unless the user explicitly applies a Number format
/// to the destination column.
pub fn has_significant_leading_zero(s: &str) -> bool {
    let bytes = s.trim().as_bytes();
    // Need at least two chars: `0` followed by another digit.
    if bytes.len() < 2 {
        return false;
    }
    let rest = if bytes[0] == b'-' {
        if bytes.len() < 3 {
            return false;
        }
        &bytes[1..]
    } else {
        bytes
    };
    // First character of the unsigned portion must be `0` and the next must
    // also be a digit (so `0`, `0.5`, `-0.5` are NOT flagged — they're
    // ordinary numeric values).
    rest.first() == Some(&b'0') && rest.get(1).is_some_and(|c| c.is_ascii_digit())
}

/// Split text in a column into multiple columns.
///
/// Reads source values, splits them, and writes the results to the
/// destination position. Empty split results clear existing cells.
///
/// Numeric-looking split values are coerced to numbers — **except** tokens
/// that have a significant leading zero (e.g. `"00123"`, `"007"`), which are
/// preserved as strings to match Excel's General-format behaviour. A user who
/// wants those tokens treated as numbers must explicitly apply a Number format
/// to the destination column.
///
/// Cell identities are allocated through the supplied `GridIndex`, the sole
/// authority for (row, col) ↔ CellId.
#[allow(clippy::too_many_arguments)]
pub fn text_to_columns(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    source_start_row: u32,
    source_end_row: u32,
    source_col: u32,
    options: &TextToColumnsOptions,
    destination: &Destination,
) -> TextToColumnsResult {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let empty_result = TextToColumnsResult {
        rows_processed: 0,
        columns_created: 0,
    };

    // --- Pass 1: Read source values ---
    let source_values: Vec<String>;
    {
        let txn = doc.transact();
        let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
            Some(m) => m,
            None => return empty_result,
        };

        let mut vals = Vec::new();
        for row in source_start_row..=source_end_row {
            let value = match grid.cell_id_at(row, source_col) {
                Some(cell_id) => {
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    read_cell_value_as_string(&txn, &cells_map, &cell_hex)
                }
                None => String::new(),
            };
            vals.push(value);
        }
        source_values = vals;
    }

    // --- Split values ---
    let split_values = split_all_values(&source_values, options);
    let max_cols = split_values
        .iter()
        .map(|arr| arr.len())
        .max()
        .unwrap_or(1)
        .max(1) as u32;

    // --- Pass 2: Write split values to destination ---
    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
            Some(m) => m,
            None => return empty_result,
        };

        for (row_offset, row_values) in split_values.iter().enumerate() {
            let row = destination.row + row_offset as u32;

            for col_offset in 0..max_cols {
                let col = destination.col + col_offset;
                let value = row_values
                    .get(col_offset as usize)
                    .map(|s| s.as_str())
                    .unwrap_or("");

                if !value.is_empty() {
                    // Determine the Any value — coerce to number if possible,
                    // EXCEPT when the token has a significant leading zero
                    // (e.g. "00123"). Excel's General format preserves those
                    // as strings; coercing would drop the leading zeros.
                    let trimmed = value.trim();
                    let any_val = if has_significant_leading_zero(trimmed) {
                        Any::String(Arc::from(value))
                    } else {
                        match trimmed.parse::<f64>() {
                            Ok(n) if n.is_finite() && !trimmed.is_empty() => Any::Number(n),
                            _ => Any::String(Arc::from(value)),
                        }
                    };

                    // Allocate a CellId at this position via the GridIndex
                    // (the sole identity authority).
                    let cell_id = grid.ensure_cell_id(row, col);
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    let cell_prelim = MapPrelim::from([(KEY_VALUE, any_val)]);
                    cells_map.insert(&mut txn, cell_hex.as_str(), cell_prelim);
                } else if let Some(existing_id) = grid.cell_id_at(row, col) {
                    // Empty value — remove existing cell if present.
                    let existing_hex = id_to_hex(existing_id.as_u128());
                    cells_map.remove(&mut txn, existing_hex.as_str());
                    grid.remove_cell(&existing_id);
                }
            }
        }
    }

    TextToColumnsResult {
        rows_processed: source_values.len() as u32,
        columns_created: max_cols,
    }
}

/// Preview text to columns split without applying changes.
///
/// Returns a Vec of split value rows, limited by `max_preview_rows`.
/// Does not modify the Yrs document.
#[allow(clippy::too_many_arguments)]
pub fn preview_text_to_columns(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    source_start_row: u32,
    source_end_row: u32,
    source_col: u32,
    options: &TextToColumnsOptions,
    max_preview_rows: u32,
) -> Vec<Vec<String>> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };

    let row_count = (source_end_row - source_start_row + 1).min(max_preview_rows);
    let mut source_values = Vec::new();

    for i in 0..row_count {
        let row = source_start_row + i;
        let value = match grid.cell_id_at(row, source_col) {
            Some(cell_id) => {
                let cell_hex = id_to_hex(cell_id.as_u128());
                read_cell_value_as_string(&txn, &cells_map, &cell_hex)
            }
            None => String::new(),
        };
        source_values.push(value);
    }

    split_all_values(&source_values, options)
}

// ===========================================================================
// Column Headers & Header Detection
// ===========================================================================

/// Get column header labels for a range.
///
/// Reads cell values at `header_row` for columns `start_col..=end_col`.
/// Falls back to "Column A", "Column B", etc. for empty cells.
pub fn get_column_headers(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    header_row: u32,
    start_col: u32,
    end_col: u32,
) -> Vec<ColumnHeader> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cells_map = get_cells_map(&txn, sheets, &sheet_hex);

    (start_col..=end_col)
        .map(|col| {
            let header = (|| {
                let cm = cells_map.as_ref()?;
                let cell_id = grid.cell_id_at(header_row, col)?;
                let cell_hex = id_to_hex(cell_id.as_u128());
                let val = read_cell_value_as_string(&txn, cm, &cell_hex);
                if val.is_empty() { None } else { Some(val) }
            })();
            ColumnHeader {
                col,
                header: header.unwrap_or_else(|| format!("Column {}", col_to_letter(col))),
            }
        })
        .collect()
}

/// Heuristic to determine if the first row of a range contains headers.
///
/// Returns `true` if the first row is all text and the second row contains
/// at least one numeric value. Returns `false` for single-row ranges or
/// when the pattern doesn't match.
pub fn detect_headers(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> bool {
    // Single row can't have a header + data
    if start_row >= end_row {
        return false;
    }

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };

    // Check: first row must be all text (non-empty)
    let mut first_row_all_text = true;
    for col in start_col..=end_col {
        let val = match grid.cell_id_at(start_row, col) {
            Some(cell_id) => {
                let cell_hex = id_to_hex(cell_id.as_u128());
                let cell_map = match cells_map.get(&txn, cell_hex.as_str()) {
                    Some(Out::YMap(m)) => m,
                    _ => {
                        first_row_all_text = false;
                        continue;
                    }
                };
                yrs_any_to_cell_value(&cell_map, &txn)
            }
            None => {
                // Empty cell — treat as non-text
                first_row_all_text = false;
                continue;
            }
        };
        match val {
            CellValue::Text(_) => {}
            _ => {
                first_row_all_text = false;
            }
        }
    }

    if !first_row_all_text {
        return false;
    }

    // Check: second row must have at least one numeric value
    for col in start_col..=end_col {
        if let Some(cell_id) = grid.cell_id_at(start_row + 1, col) {
            let cell_hex = id_to_hex(cell_id.as_u128());
            if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, cell_hex.as_str()) {
                let val = yrs_any_to_cell_value(&cell_map, &txn);
                if matches!(val, CellValue::Number(_)) {
                    return true;
                }
            }
        }
    }

    false
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests;
