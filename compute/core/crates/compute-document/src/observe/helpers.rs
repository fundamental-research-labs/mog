use std::collections::VecDeque;

use yrs::types::{EntryChange, PathSegment};
use yrs::{Any, Map, Out, ReadTxn};

use cell_types::SheetId;
use value_types::CellValue;

use crate::hex::parse_sheet_id;

use super::changes::CellChangeKind;

/// Convert an `EntryChange` to a `CellChangeKind`.
pub(super) fn entry_change_kind(change: &EntryChange) -> CellChangeKind {
    match change {
        EntryChange::Inserted(_) | EntryChange::Updated(_, _) => CellChangeKind::Modified,
        EntryChange::Removed(_) => CellChangeKind::Removed,
    }
}

/// Convert a raw yrs `Any` to a `CellValue`.
/// Mirrors the logic in `cell_serde::yrs_any_to_cell_value` but operates on
/// bare `Any` values (from `Out::Any` or `EntryChange`) instead of reading
/// from a `MapRef`.
pub(super) fn any_to_cell_value(any: &Any) -> CellValue {
    match any {
        Any::Number(n) => CellValue::number(*n),
        Any::String(s) => {
            if let Some(err) = value_types::CellError::parse_error_str(s) {
                CellValue::Error(err, None)
            } else {
                CellValue::Text(std::sync::Arc::clone(s))
            }
        }
        Any::Bool(b) => CellValue::Boolean(*b),
        Any::Null | Any::Undefined => CellValue::Null,
        _ => CellValue::Null,
    }
}

/// Extract the old cell value from an `EntryChange` at depth 2.
///
/// At depth 2, entries in the cells map are entire cell sub-maps.
/// `Updated(old, _)` / `Removed(old)` contain the old cell entry as `Out`.
///
/// **yrs limitation:** When a cell map is replaced at depth 2, the old `YMap`
/// reference becomes orphaned and its contents cannot be read from the current
/// transaction. In this case we return `None`. Old values ARE reliably captured
/// at depth 3 (in-place field modifications), which covers the common case of
/// user edits to existing cells.
pub(super) fn extract_old_value_from_entry<T: ReadTxn>(
    change: &EntryChange,
    txn: &T,
) -> Option<CellValue> {
    let old_out = match change {
        EntryChange::Updated(old, _) | EntryChange::Removed(old) => old,
        EntryChange::Inserted(_) => return None,
    };
    match old_out {
        Out::YMap(map_ref) => {
            // Try to read the "v" key from the old cell map. This often fails
            // because the old map is orphaned after depth-2 replacement.
            match map_ref.get(txn, crate::schema::KEY_VALUE) {
                Some(Out::Any(any)) => Some(any_to_cell_value(&any)),
                _ => None,
            }
        }
        Out::Any(any) => Some(any_to_cell_value(any)),
        _ => None,
    }
}

/// Extract sheet_id from path position 0.
pub(super) fn extract_sheet_id(path: &VecDeque<PathSegment>) -> Option<SheetId> {
    match path.front() {
        Some(PathSegment::Key(hex)) => parse_sheet_id(hex),
        _ => None,
    }
}
