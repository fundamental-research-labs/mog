use cell_types::SheetId;
use domain_types::NamedRange;
use domain_types::domain::sheet::{PrintRange, PrintTitles};
use yrs::MapRef;

use crate::storage::sheet::print;

const PRINT_AREA_DEFINED_NAME: &str = "_xlnm.Print_Area";
const PRINT_TITLES_DEFINED_NAME: &str = "_xlnm.Print_Titles";

/// Promote representable Excel print defined names into worksheet print metadata.
///
/// `_xlnm.Print_Area` and `_xlnm.Print_Titles` are OOXML's workbook-level
/// serialization for per-sheet print metadata. Runtime storage must use the
/// worksheet print domain (`PrintRange`/`PrintTitles`) so imported workbooks and
/// SDK-authored workbooks share the same mutation/export path.
pub(super) fn hydrate_workbook_print_defined_names(
    sheets: &MapRef,
    named_ranges: &[NamedRange],
    sheet_ids: &[SheetId],
    txn: &mut yrs::TransactionMut,
) {
    for nr in named_ranges {
        let Some((sheet_idx, parsed)) = parse_representable_print_defined_name(nr, sheet_ids.len())
        else {
            continue;
        };
        let Some(sheet_id) = sheet_ids.get(sheet_idx).copied() else {
            continue;
        };

        match parsed {
            ParsedPrintDefinedName::Area(area) => {
                print::set_print_area_in_txn(txn, sheets, &sheet_id, Some(&area));
            }
            ParsedPrintDefinedName::Titles(titles) => {
                print::set_print_titles_in_txn(txn, sheets, &sheet_id, &titles);
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum ParsedPrintDefinedName {
    Area(PrintRange),
    Titles(PrintTitles),
}

fn parse_representable_print_defined_name(
    nr: &NamedRange,
    sheet_count: usize,
) -> Option<(usize, ParsedPrintDefinedName)> {
    let sheet_idx = nr.local_sheet_id? as usize;
    if sheet_idx >= sheet_count {
        return None;
    }

    if nr.name.eq_ignore_ascii_case(PRINT_AREA_DEFINED_NAME) {
        return parse_print_area_defined_name_ref(&nr.refers_to)
            .map(|area| (sheet_idx, ParsedPrintDefinedName::Area(area)));
    }

    if nr.name.eq_ignore_ascii_case(PRINT_TITLES_DEFINED_NAME) {
        return parse_print_titles_defined_name_ref(&nr.refers_to)
            .map(|titles| (sheet_idx, ParsedPrintDefinedName::Titles(titles)));
    }

    None
}

fn parse_print_area_defined_name_ref(refers_to: &str) -> Option<PrintRange> {
    let parts = split_defined_name_union(strip_formula_prefix(refers_to));
    if parts.len() != 1 {
        return None;
    }
    parse_cell_range_ref(strip_sheet_qualifier(parts[0]))
}

fn parse_print_titles_defined_name_ref(refers_to: &str) -> Option<PrintTitles> {
    let parts = split_defined_name_union(strip_formula_prefix(refers_to));
    if parts.is_empty() {
        return None;
    }

    let mut repeat_rows = None;
    let mut repeat_cols = None;
    for part in parts {
        let local_ref = strip_sheet_qualifier(part);
        if let Some(rows) = parse_row_range_ref(local_ref) {
            if repeat_rows.replace(rows).is_some() {
                return None;
            }
            continue;
        }
        if let Some(cols) = parse_col_range_ref(local_ref) {
            if repeat_cols.replace(cols).is_some() {
                return None;
            }
            continue;
        }
        return None;
    }

    if repeat_rows.is_none() && repeat_cols.is_none() {
        return None;
    }

    Some(PrintTitles {
        repeat_rows,
        repeat_cols,
    })
}

fn strip_formula_prefix(value: &str) -> &str {
    value
        .trim()
        .strip_prefix('=')
        .unwrap_or(value.trim())
        .trim()
}

fn split_defined_name_union(value: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut in_sheet_quote = false;
    let mut iter = value.char_indices().peekable();
    while let Some((idx, ch)) = iter.next() {
        if ch == '\'' {
            if in_sheet_quote && iter.peek().is_some_and(|(_, next)| *next == '\'') {
                iter.next();
            } else {
                in_sheet_quote = !in_sheet_quote;
            }
        } else if ch == ',' && !in_sheet_quote {
            let part = value.get(start..idx).unwrap_or("").trim();
            if !part.is_empty() {
                parts.push(part);
            }
            start = idx + ch.len_utf8();
        }
    }

    let part = value.get(start..).unwrap_or("").trim();
    if !part.is_empty() {
        parts.push(part);
    }
    parts
}

fn strip_sheet_qualifier(value: &str) -> &str {
    let value = value.trim();
    let mut last_bang = None;
    let mut in_sheet_quote = false;
    let mut iter = value.char_indices().peekable();
    while let Some((idx, ch)) = iter.next() {
        if ch == '\'' {
            if in_sheet_quote && iter.peek().is_some_and(|(_, next)| *next == '\'') {
                iter.next();
            } else {
                in_sheet_quote = !in_sheet_quote;
            }
        } else if ch == '!' && !in_sheet_quote {
            last_bang = Some(idx);
        }
    }

    last_bang
        .and_then(|idx| value.get(idx + 1..))
        .map(str::trim)
        .unwrap_or(value)
}

fn parse_cell_range_ref(value: &str) -> Option<PrintRange> {
    let mut parts = value.split(':');
    let first = parts.next()?.trim();
    let second = parts.next().unwrap_or(first).trim();
    if parts.next().is_some() {
        return None;
    }

    let (start_row, start_col) = parse_cell_ref(first)?;
    let (end_row, end_col) = parse_cell_ref(second)?;
    Some(PrintRange {
        start_row: start_row.min(end_row),
        start_col: start_col.min(end_col),
        end_row: start_row.max(end_row),
        end_col: start_col.max(end_col),
    })
}

fn parse_cell_ref(value: &str) -> Option<(u32, u32)> {
    let compact = value.replace('$', "");
    let split = compact.find(|ch: char| ch.is_ascii_digit())?;
    let (col, row) = compact.split_at(split);
    if col.is_empty()
        || row.is_empty()
        || !col.chars().all(|ch| ch.is_ascii_alphabetic())
        || !row.chars().all(|ch| ch.is_ascii_digit())
    {
        return None;
    }

    let row = row.parse::<u32>().ok()?;
    if row == 0 {
        return None;
    }
    Some((row - 1, col_label_to_index(col)?))
}

fn parse_row_range_ref(value: &str) -> Option<(u32, u32)> {
    let mut parts = value.split(':');
    let first = parts.next()?.trim();
    let second = parts.next().unwrap_or(first).trim();
    if parts.next().is_some() {
        return None;
    }

    let start = parse_row_ref(first)?;
    let end = parse_row_ref(second)?;
    Some((start.min(end), start.max(end)))
}

fn parse_row_ref(value: &str) -> Option<u32> {
    let compact = value.replace('$', "");
    if compact.is_empty() || !compact.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let row = compact.parse::<u32>().ok()?;
    if row == 0 {
        return None;
    }
    Some(row - 1)
}

fn parse_col_range_ref(value: &str) -> Option<(u32, u32)> {
    let mut parts = value.split(':');
    let first = parts.next()?.trim();
    let second = parts.next().unwrap_or(first).trim();
    if parts.next().is_some() {
        return None;
    }

    let start = parse_col_ref(first)?;
    let end = parse_col_ref(second)?;
    Some((start.min(end), start.max(end)))
}

fn parse_col_ref(value: &str) -> Option<u32> {
    col_label_to_index(&value.replace('$', ""))
}

fn col_label_to_index(value: &str) -> Option<u32> {
    if value.is_empty() || !value.chars().all(|ch| ch.is_ascii_alphabetic()) {
        return None;
    }

    let mut index = 0u32;
    for ch in value.bytes() {
        let upper = ch.to_ascii_uppercase();
        index = index.checked_mul(26)?;
        index = index.checked_add((upper - b'A' + 1) as u32)?;
    }
    index.checked_sub(1)
}
