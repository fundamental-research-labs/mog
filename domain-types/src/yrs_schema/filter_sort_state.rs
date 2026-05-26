//! Yrs schema for [`FilterSortState`] — flat Y.Map with three string keys.

use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use super::helpers::*;
use crate::domain::filter::{FilterSortState, SortBy, SortOrder};

const KEY_COLUMN_CELL_ID: &str = "cc";
const KEY_ORDER: &str = "so";
const KEY_SORT_BY: &str = "sb";

/// Convert a [`FilterSortState`] to Yrs prelim entries for initial hydration.
pub fn to_yrs_prelim(state: &FilterSortState) -> Vec<(&str, Any)> {
    vec![
        (
            KEY_COLUMN_CELL_ID,
            Any::String(Arc::from(state.column_cell_id.as_str())),
        ),
        (
            KEY_ORDER,
            Any::String(Arc::from(sort_order_to_str(state.order))),
        ),
        (
            KEY_SORT_BY,
            Any::String(Arc::from(sort_by_to_str(state.sort_by))),
        ),
    ]
}

/// Read a [`FilterSortState`] from a Y.Map.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<FilterSortState> {
    let column_cell_id = read_string(map, txn, KEY_COLUMN_CELL_ID)?;
    let order = read_string(map, txn, KEY_ORDER)
        .and_then(|s| str_to_sort_order(&s))
        .unwrap_or(SortOrder::Asc);
    let sort_by = read_string(map, txn, KEY_SORT_BY)
        .and_then(|s| str_to_sort_by(&s))
        .unwrap_or(SortBy::Value);
    Some(FilterSortState {
        column_cell_id,
        order,
        sort_by,
    })
}

fn sort_order_to_str(order: SortOrder) -> &'static str {
    match order {
        SortOrder::Asc => "asc",
        SortOrder::Desc => "desc",
    }
}

fn str_to_sort_order(s: &str) -> Option<SortOrder> {
    match s {
        "asc" => Some(SortOrder::Asc),
        "desc" => Some(SortOrder::Desc),
        _ => None,
    }
}

fn sort_by_to_str(sort_by: SortBy) -> &'static str {
    match sort_by {
        SortBy::Value => "value",
        SortBy::Color => "color",
        SortBy::Icon => "icon",
    }
}

fn str_to_sort_by(s: &str) -> Option<SortBy> {
    match s {
        "value" => Some(SortBy::Value),
        "color" => Some(SortBy::Color),
        "icon" => Some(SortBy::Icon),
        _ => None,
    }
}
