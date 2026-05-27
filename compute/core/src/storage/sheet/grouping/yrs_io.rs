use std::sync::Arc;

use cell_types::SheetId;
use compute_document::schema::KEY_GROUPING;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use super::ids::sheet_id_to_hex;
use super::types::{GroupAxis, GroupDefinition, SheetGroupingConfig};

pub(crate) fn get_grouping_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_GROUPING) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// =============================================================================

mod grp_keys {
    // Top-level config keys
    pub const ROW_GROUPS: &str = "rowGroups";
    pub const COLUMN_GROUPS: &str = "columnGroups";
    pub const SUMMARY_ROWS_BELOW: &str = "summaryRowsBelow";
    pub const SUMMARY_COLUMNS_RIGHT: &str = "summaryColumnsRight";
    pub const SHOW_OUTLINE_SYMBOLS: &str = "showOutlineSymbols";
    pub const SHOW_OUTLINE_LEVEL_BUTTONS: &str = "showOutlineLevelButtons";

    // GroupDefinition keys
    pub const ID: &str = "id";
    pub const SHEET_ID: &str = "sheetId";
    pub const AXIS: &str = "axis";
    pub const START: &str = "start";
    pub const END: &str = "end";
    pub const LEVEL: &str = "level";
    pub const COLLAPSED: &str = "collapsed";
    pub const PARENT_ID: &str = "parentId";
    // Round-trip fidelity fields
    pub const HIDDEN: &str = "hidden";
    pub const COLLAPSED_ON_MEMBER: &str = "collapsedOnMember";
}

// =============================================================================
// Structured Y.Map read/write helpers
// =============================================================================

/// Y.Map read helpers.
fn read_str<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    match map.get(txn, key)? {
        Out::Any(Any::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

fn read_bool_val<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<bool> {
    match map.get(txn, key)? {
        Out::Any(Any::Bool(b)) => Some(b),
        _ => None,
    }
}

fn read_num<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<f64> {
    match map.get(txn, key)? {
        Out::Any(Any::Number(n)) => Some(n),
        _ => None,
    }
}

/// Read a GroupDefinition from a structured Y.Map.
fn group_def_from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<GroupDefinition> {
    use grp_keys::*;
    Some(GroupDefinition {
        id: read_str(map, txn, ID)?,
        sheet_id: read_str(map, txn, SHEET_ID).unwrap_or_default(),
        axis: match read_str(map, txn, AXIS).as_deref() {
            Some("column") => GroupAxis::Column,
            _ => GroupAxis::Row,
        },
        start: read_num(map, txn, START).unwrap_or(0.0) as u32,
        end: read_num(map, txn, END).unwrap_or(0.0) as u32,
        level: read_num(map, txn, LEVEL).unwrap_or(0.0) as u32,
        collapsed: read_bool_val(map, txn, COLLAPSED).unwrap_or(false),
        parent_id: read_str(map, txn, PARENT_ID),
        hidden: read_bool_val(map, txn, HIDDEN).unwrap_or(false),
        collapsed_on_member: read_bool_val(map, txn, COLLAPSED_ON_MEMBER).unwrap_or(false),
    })
}

/// Write a GroupDefinition into a parent Y.Map at the given key.
fn write_group_def(parent: &MapRef, txn: &mut yrs::TransactionMut, key: &str, g: &GroupDefinition) {
    use grp_keys::*;
    parent.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0]));
    let map = match parent.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    map.insert(txn, ID, Any::String(Arc::from(g.id.as_str())));
    map.insert(txn, SHEET_ID, Any::String(Arc::from(g.sheet_id.as_str())));
    map.insert(
        txn,
        AXIS,
        Any::String(Arc::from(match g.axis {
            GroupAxis::Row => "row",
            GroupAxis::Column => "column",
        })),
    );
    map.insert(txn, START, Any::Number(g.start as f64));
    map.insert(txn, END, Any::Number(g.end as f64));
    map.insert(txn, LEVEL, Any::Number(g.level as f64));
    map.insert(txn, COLLAPSED, Any::Bool(g.collapsed));
    if let Some(ref pid) = g.parent_id {
        map.insert(txn, PARENT_ID, Any::String(Arc::from(pid.as_str())));
    }
    if g.hidden {
        map.insert(txn, HIDDEN, Any::Bool(true));
    }
    if g.collapsed_on_member {
        map.insert(txn, COLLAPSED_ON_MEMBER, Any::Bool(true));
    }
}

/// Read a list of GroupDefinitions from a Y.Map that stores them as sub-maps keyed by index.
fn read_group_array<T: yrs::ReadTxn>(parent: &MapRef, txn: &T, key: &str) -> Vec<GroupDefinition> {
    match parent.get(txn, key) {
        Some(Out::YMap(arr_map)) => {
            let mut items: Vec<(usize, GroupDefinition)> = Vec::new();
            for (k, out) in arr_map.iter(txn) {
                if let Out::YMap(sub) = out
                    && let Some(g) = group_def_from_yrs_map(&sub, txn)
                {
                    let idx = k.parse::<usize>().unwrap_or(items.len());
                    items.push((idx, g));
                }
            }
            items.sort_by_key(|(idx, _)| *idx);
            items.into_iter().map(|(_, g)| g).collect()
        }
        _ => Vec::new(),
    }
}

/// Write a list of GroupDefinitions to a Y.Map as indexed sub-maps.
fn write_group_array(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    key: &str,
    groups: &[GroupDefinition],
) {
    parent.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0]));
    let arr_map = match parent.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    for (i, g) in groups.iter().enumerate() {
        write_group_def(&arr_map, txn, &i.to_string(), g);
    }
}

/// Read a SheetGroupingConfig from structured Y.Map keys.
/// Returns None if the map does not look structured (no recognized top-level keys).
fn config_from_yrs_map<T: yrs::ReadTxn>(grp_map: &MapRef, txn: &T) -> Option<SheetGroupingConfig> {
    use grp_keys::*;
    // Detect structured format: must have at least one of our structured keys
    let has_structured_keys = grp_map.get(txn, ROW_GROUPS).is_some()
        || grp_map.get(txn, COLUMN_GROUPS).is_some()
        || grp_map.get(txn, SUMMARY_ROWS_BELOW).is_some();
    if !has_structured_keys {
        return None;
    }
    Some(SheetGroupingConfig {
        row_groups: read_group_array(grp_map, txn, ROW_GROUPS),
        column_groups: read_group_array(grp_map, txn, COLUMN_GROUPS),
        summary_rows_below: read_bool_val(grp_map, txn, SUMMARY_ROWS_BELOW).unwrap_or(true),
        summary_columns_right: read_bool_val(grp_map, txn, SUMMARY_COLUMNS_RIGHT).unwrap_or(true),
        show_outline_symbols: read_bool_val(grp_map, txn, SHOW_OUTLINE_SYMBOLS).unwrap_or(true),
        show_outline_level_buttons: read_bool_val(grp_map, txn, SHOW_OUTLINE_LEVEL_BUTTONS)
            .unwrap_or(true),
    })
}

/// Write a SheetGroupingConfig to structured Y.Map keys.
pub(crate) fn config_to_yrs_map(
    grp_map: &MapRef,
    txn: &mut yrs::TransactionMut,
    config: &SheetGroupingConfig,
) {
    use grp_keys::*;
    write_group_array(grp_map, txn, ROW_GROUPS, &config.row_groups);
    write_group_array(grp_map, txn, COLUMN_GROUPS, &config.column_groups);
    grp_map.insert(
        txn,
        SUMMARY_ROWS_BELOW,
        Any::Bool(config.summary_rows_below),
    );
    grp_map.insert(
        txn,
        SUMMARY_COLUMNS_RIGHT,
        Any::Bool(config.summary_columns_right),
    );
    grp_map.insert(
        txn,
        SHOW_OUTLINE_SYMBOLS,
        Any::Bool(config.show_outline_symbols),
    );
    grp_map.insert(
        txn,
        SHOW_OUTLINE_LEVEL_BUTTONS,
        Any::Bool(config.show_outline_level_buttons),
    );
    // Legacy JSON config key cleanup removed — no more legacy format.
}

pub fn get_sheet_grouping_config(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> SheetGroupingConfig {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let grp_map = match get_grouping_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return SheetGroupingConfig::default(),
    };
    config_from_yrs_map(&grp_map, &txn).unwrap_or_default()
}

pub(crate) fn set_sheet_grouping_config(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    config: &SheetGroupingConfig,
) {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let grp_map = match get_grouping_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };
    config_to_yrs_map(&grp_map, &mut txn, config);
}
