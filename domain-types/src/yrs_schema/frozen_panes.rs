//! Yrs schema for [`FrozenPanes`] — flat Y.Map with two numeric keys.

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use super::helpers::*;
use crate::domain::sheet::FrozenPanes;

pub const KEY_FROZEN_ROWS: &str = "frozenRows";
pub const KEY_FROZEN_COLS: &str = "frozenCols";

/// Convert a [`FrozenPanes`] to Yrs prelim entries for initial hydration.
/// Only emits non-zero values.
pub fn to_yrs_prelim(fp: &FrozenPanes) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = Vec::new();
    if fp.rows != 0 {
        entries.push((KEY_FROZEN_ROWS, Any::Number(fp.rows as f64)));
    }
    if fp.cols != 0 {
        entries.push((KEY_FROZEN_COLS, Any::Number(fp.cols as f64)));
    }
    entries
}

/// Read a [`FrozenPanes`] from a Y.Map. Defaults to 0 for absent keys.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> FrozenPanes {
    FrozenPanes {
        rows: read_u32(map, txn, KEY_FROZEN_ROWS).unwrap_or(0),
        cols: read_u32(map, txn, KEY_FROZEN_COLS).unwrap_or(0),
    }
}
