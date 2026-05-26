//! Yrs schema for [`PageBreaks`] — Y.Map with JSON-serialized break arrays.
//!
//! Canonical format uses `rowBreaks`/`colBreaks` keys, each containing a
//! JSON array of `PageBreakEntry`.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use super::helpers::*;
use crate::domain::print::{PageBreakEntry, PageBreaks};

pub const KEY_ROW_BREAKS: &str = "rowBreaks";
pub const KEY_COL_BREAKS: &str = "colBreaks";

/// Convert a [`PageBreaks`] to Yrs prelim entries for initial hydration.
/// Serializes break arrays as JSON strings.
pub fn to_yrs_prelim(pb: &PageBreaks) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = Vec::new();
    if !pb.row_breaks.is_empty()
        && let Ok(json) = serde_json::to_string(&pb.row_breaks)
    {
        entries.push((KEY_ROW_BREAKS, Any::String(Arc::from(json))));
    }
    if !pb.col_breaks.is_empty()
        && let Ok(json) = serde_json::to_string(&pb.col_breaks)
    {
        entries.push((KEY_COL_BREAKS, Any::String(Arc::from(json))));
    }
    entries
}

/// Read [`PageBreaks`] from a Y.Map using only the canonical keys.
/// Returns empty vecs if absent.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> PageBreaks {
    PageBreaks {
        row_breaks: read_break_entries(map, txn, KEY_ROW_BREAKS).unwrap_or_default(),
        col_breaks: read_break_entries(map, txn, KEY_COL_BREAKS).unwrap_or_default(),
    }
}

/// Try to read a JSON array of `PageBreakEntry` from the given key.
/// Returns `None` if the key is absent so fallback can proceed;
/// returns `Some(vec![])` if the key is present but unparseable.
fn read_break_entries<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<Vec<PageBreakEntry>> {
    let s = read_string(map, txn, key)?;
    Some(serde_json::from_str::<Vec<PageBreakEntry>>(&s).unwrap_or_default())
}
