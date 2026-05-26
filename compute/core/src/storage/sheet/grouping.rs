//! Sheet-level Row/Column Grouping (Outline) CRUD operations.
//!
//! Port of `spreadsheet-model/src/grouping/` (13 TS sub-modules, ~3,214 LOC)
//! into a single Rust module.
//!
//! Provides:
//! - Row/column group CRUD (group, ungroup, clear)
//! - Expand/collapse (individual, level-based, bulk)
//! - Outline level queries (row/column visibility)
//! - Rendering data structures (symbols, level buttons, gutter dimensions)
//! - Auto-outline (formula-pattern detection)
//! - Subtotal integration (SUBTOTAL formula creation/removal)
//! - Settings (summaryRowsBelow, summaryColumnsRight, showOutlineSymbols, etc.)
//!
//! All data is stored per-sheet in the Yrs CRDT document under each sheet's
//! `grouping` map as structured Y.Map keys.
//!
//! ## Yrs Storage Layout
//!
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- grouping: Y.Map
//!           +-- rowGroups: Y.Map<index, Y.Map>       (GroupDefinition sub-maps)
//!           +-- columnGroups: Y.Map<index, Y.Map>    (GroupDefinition sub-maps)
//!           +-- summaryRowsBelow: Bool
//!           +-- summaryColumnsRight: Bool
//!           +-- showOutlineSymbols: Bool
//!           +-- showOutlineLevelButtons: Bool
//! ```

use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use compute_document::undo::ORIGIN_USER_EDIT;
use regex::Regex;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use cell_types::{SheetId, col_to_letter};

use compute_document::schema::KEY_GROUPING;
// Shared domain types (from domain-types crate) + render types (from grouping_render)
// are re-exported through crate::engine_types via glob re-exports in mod.rs.
pub use crate::engine_types::{
    GroupBoundary, OutlineLevelButton, OutlineRenderData, OutlineSymbol, Viewport,
};
pub use domain_types::domain::grouping::{
    GroupAxis, GroupDefinition, OutlineLevel, OutlineSettingsUpdate, SheetGroupingConfig,
    SubtotalFunction, SubtotalOptions, SubtotalResult,
};

// =============================================================================
// Constants
// =============================================================================

/// Maximum outline level (Excel compatibility: 8 levels).
pub const MAX_OUTLINE_LEVEL: u32 = 8;

// Legacy KEY_CONFIG ("config" JSON blob) removed — only structured Y.Map format used.

/// Atomic counter for deterministic group ID generation.
static GROUP_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub type CellRange = crate::PositionRange;

/// Trait for subtotal operations that require cell access.
pub trait SubtotalsCellAccessor {
    fn get_cell_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String;
    fn set_cell_value(&mut self, sheet_id: &SheetId, row: u32, col: u32, value: &str);
    fn insert_rows(&mut self, sheet_id: &SheetId, start_row: u32, count: u32);
    fn delete_rows(&mut self, sheet_id: &SheetId, start_row: u32, count: u32);
    fn get_cell_raw_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String;
}

// =============================================================================
// Internal Helpers
// =============================================================================

fn sheet_id_to_hex(sheet_id: &SheetId) -> String {
    format!("{:032x}", sheet_id.as_u128())
}

#[cfg(test)]
fn hex_to_sheet_id(hex: &str) -> Option<SheetId> {
    u128::from_str_radix(hex, 16).ok().map(SheetId::from_raw)
}

fn get_grouping_map<T: yrs::ReadTxn>(
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
// Structured Y.Map keys
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

fn generate_group_id() -> String {
    let id = GROUP_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("group-{id}")
}

// =============================================================================
// Config Read/Write
// =============================================================================

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

// =============================================================================
// Group Level Calculations
// =============================================================================

pub fn calculate_group_level(
    existing_groups: &[GroupDefinition],
    start: u32,
    end: u32,
) -> Result<u32, String> {
    let mut max_overlapping_level: u32 = 0;
    for group in existing_groups {
        let overlaps = !(end < group.start || start > group.end);
        if overlaps && group.level > max_overlapping_level {
            max_overlapping_level = group.level;
        }
    }
    let new_level = max_overlapping_level + 1;
    if new_level > MAX_OUTLINE_LEVEL {
        return Err(format!(
            "Cannot create group: maximum outline level ({MAX_OUTLINE_LEVEL}) exceeded"
        ));
    }
    Ok(new_level)
}

pub fn find_parent_group(
    existing_groups: &[GroupDefinition],
    start: u32,
    end: u32,
    level: u32,
) -> Option<String> {
    if level <= 1 {
        return None;
    }
    let mut potential_parents: Vec<&GroupDefinition> = existing_groups
        .iter()
        .filter(|g| g.level == level - 1 && g.start <= start && g.end >= end)
        .collect();
    potential_parents.sort_by_key(|g| g.end - g.start);
    potential_parents.first().map(|g| g.id.clone())
}

// =============================================================================
// Row Group CRUD
// =============================================================================

pub fn group_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<GroupDefinition, String> {
    let (start, end) = if start_row > end_row {
        (end_row, start_row)
    } else {
        (start_row, end_row)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let level = calculate_group_level(&config.row_groups, start, end)?;
    let parent_id = find_parent_group(&config.row_groups, start, end, level);
    let group = GroupDefinition {
        id: generate_group_id(),
        sheet_id: sheet_id_to_hex(sheet_id),
        axis: GroupAxis::Row,
        start,
        end,
        level,
        collapsed: false,
        parent_id,
        hidden: false,
        collapsed_on_member: false,
    };
    config.row_groups.push(group.clone());
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    Ok(group)
}

pub fn ungroup_rows(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, start_row: u32, end_row: u32) {
    let (start, end) = if start_row > end_row {
        (end_row, start_row)
    } else {
        (start_row, end_row)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut containing: Vec<(usize, &GroupDefinition)> = config
        .row_groups
        .iter()
        .enumerate()
        .filter(|(_, g)| g.start <= start && g.end >= end)
        .collect();
    containing.sort_by(|a, b| b.1.level.cmp(&a.1.level));
    if let Some((idx, group)) = containing.first() {
        let group = (*group).clone();
        let idx = *idx;
        if group.start == start && group.end == end {
            // Exact match — remove entirely
            config.row_groups.remove(idx);
        } else if group.start == start {
            // Prefix removal — shrink group start
            config.row_groups[idx].start = end + 1;
        } else if group.end == end {
            // Suffix removal — shrink group end
            config.row_groups[idx].end = start - 1;
        } else {
            // Middle removal — split into two residual groups
            let left = GroupDefinition {
                id: generate_group_id(),
                sheet_id: group.sheet_id.clone(),
                axis: group.axis,
                start: group.start,
                end: start - 1,
                level: group.level,
                collapsed: false,
                parent_id: group.parent_id.clone(),
                hidden: false,
                collapsed_on_member: false,
            };
            let right = GroupDefinition {
                id: generate_group_id(),
                sheet_id: group.sheet_id.clone(),
                axis: group.axis,
                start: end + 1,
                end: group.end,
                level: group.level,
                collapsed: false,
                parent_id: group.parent_id.clone(),
                hidden: false,
                collapsed_on_member: false,
            };
            config.row_groups.remove(idx);
            config.row_groups.push(left);
            config.row_groups.push(right);
        }
        set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    }
}

pub fn clear_row_grouping(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) {
    let (start, end) = if start_row > end_row {
        (end_row, start_row)
    } else {
        (start_row, end_row)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    config.row_groups.retain(|g| g.end < start || g.start > end);
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
}

// =============================================================================
// Column Group CRUD
// =============================================================================

pub fn group_columns(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<GroupDefinition, String> {
    let (start, end) = if start_col > end_col {
        (end_col, start_col)
    } else {
        (start_col, end_col)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let level = calculate_group_level(&config.column_groups, start, end)?;
    let parent_id = find_parent_group(&config.column_groups, start, end, level);
    let group = GroupDefinition {
        id: generate_group_id(),
        sheet_id: sheet_id_to_hex(sheet_id),
        axis: GroupAxis::Column,
        start,
        end,
        level,
        collapsed: false,
        parent_id,
        hidden: false,
        collapsed_on_member: false,
    };
    config.column_groups.push(group.clone());
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    Ok(group)
}

pub fn ungroup_columns(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) {
    let (start, end) = if start_col > end_col {
        (end_col, start_col)
    } else {
        (start_col, end_col)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut containing: Vec<(usize, &GroupDefinition)> = config
        .column_groups
        .iter()
        .enumerate()
        .filter(|(_, g)| g.start <= start && g.end >= end)
        .collect();
    containing.sort_by(|a, b| b.1.level.cmp(&a.1.level));
    if let Some((idx, group)) = containing.first() {
        let group = (*group).clone();
        let idx = *idx;
        if group.start == start && group.end == end {
            // Exact match — remove entirely
            config.column_groups.remove(idx);
        } else if group.start == start {
            // Prefix removal — shrink group start
            config.column_groups[idx].start = end + 1;
        } else if group.end == end {
            // Suffix removal — shrink group end
            config.column_groups[idx].end = start - 1;
        } else {
            // Middle removal — split into two residual groups
            let left = GroupDefinition {
                id: generate_group_id(),
                sheet_id: group.sheet_id.clone(),
                axis: group.axis,
                start: group.start,
                end: start - 1,
                level: group.level,
                collapsed: false,
                parent_id: group.parent_id.clone(),
                hidden: false,
                collapsed_on_member: false,
            };
            let right = GroupDefinition {
                id: generate_group_id(),
                sheet_id: group.sheet_id.clone(),
                axis: group.axis,
                start: end + 1,
                end: group.end,
                level: group.level,
                collapsed: false,
                parent_id: group.parent_id.clone(),
                hidden: false,
                collapsed_on_member: false,
            };
            config.column_groups.remove(idx);
            config.column_groups.push(left);
            config.column_groups.push(right);
        }
        set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    }
}

pub fn clear_column_grouping(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) {
    let (start, end) = if start_col > end_col {
        (end_col, start_col)
    } else {
        (start_col, end_col)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    config
        .column_groups
        .retain(|g| g.end < start || g.start > end);
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
}

// =============================================================================
// Queries
// =============================================================================

pub fn get_group_in_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<GroupDefinition> {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    config
        .row_groups
        .iter()
        .chain(config.column_groups.iter())
        .find(|g| g.id == group_id)
        .cloned()
}

/// Search for a group by ID across multiple sheets.
///
/// Returns the first matching `GroupDefinition` found in any of the given sheets.
pub fn get_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_ids: &[SheetId],
    group_id: &str,
) -> Option<GroupDefinition> {
    for sid in sheet_ids {
        if let Some(g) = get_group_in_sheet(doc, sheets, sid, group_id) {
            return Some(g);
        }
    }
    None
}

pub fn get_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    axis: GroupAxis,
) -> Vec<GroupDefinition> {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    match axis {
        GroupAxis::Row => config.row_groups,
        GroupAxis::Column => config.column_groups,
    }
}

pub fn get_max_outline_level(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    axis: GroupAxis,
) -> u32 {
    get_groups(doc, sheets, sheet_id, axis)
        .iter()
        .map(|g| g.level)
        .max()
        .unwrap_or(0)
}

pub fn get_affected_rows_by_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    let group = match get_group_in_sheet(doc, sheets, sheet_id, group_id) {
        Some(g) if g.axis == GroupAxis::Row => g,
        _ => return vec![],
    };
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    (group.start..=group.end)
        .filter(|&row| {
            let is_summary = if config.summary_rows_below {
                row == group.end
            } else {
                row == group.start
            };
            !is_summary
        })
        .collect()
}

pub fn get_affected_columns_by_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    let group = match get_group_in_sheet(doc, sheets, sheet_id, group_id) {
        Some(g) if g.axis == GroupAxis::Column => g,
        _ => return vec![],
    };
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    (group.start..=group.end)
        .filter(|&col| {
            let is_summary = if config.summary_columns_right {
                col == group.end
            } else {
                col == group.start
            };
            !is_summary
        })
        .collect()
}

/// Rows whose effective rendered height is zero because at least one
/// collapsed row outline group contains them as a non-summary member.
pub fn get_rows_hidden_by_collapsed_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<u32> {
    let groups = get_groups(doc, sheets, sheet_id, GroupAxis::Row);
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut hidden = BTreeSet::new();

    for group in groups.iter().filter(|g| g.collapsed) {
        for row in group.start..=group.end {
            let is_summary = if config.summary_rows_below {
                row == group.end
            } else {
                row == group.start
            };
            if !is_summary {
                hidden.insert(row);
            }
        }
    }

    hidden.into_iter().collect()
}

/// Columns whose effective rendered width is zero because at least one
/// collapsed column outline group contains them as a non-summary member.
pub fn get_columns_hidden_by_collapsed_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<u32> {
    let groups = get_groups(doc, sheets, sheet_id, GroupAxis::Column);
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut hidden = BTreeSet::new();

    for group in groups.iter().filter(|g| g.collapsed) {
        for col in group.start..=group.end {
            let is_summary = if config.summary_columns_right {
                col == group.end
            } else {
                col == group.start
            };
            if !is_summary {
                hidden.insert(col);
            }
        }
    }

    hidden.into_iter().collect()
}

// =============================================================================
// Expand/Collapse
// =============================================================================

pub fn set_group_collapsed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
    collapsed: bool,
) {
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let found = config
        .row_groups
        .iter_mut()
        .chain(config.column_groups.iter_mut())
        .find(|g| g.id == group_id);
    if let Some(group) = found {
        if group.collapsed == collapsed {
            return;
        }
        group.collapsed = collapsed;
        set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    }
}

pub fn toggle_group_collapsed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<bool> {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let current = config
        .row_groups
        .iter()
        .chain(config.column_groups.iter())
        .find(|g| g.id == group_id)?;
    let new_state = !current.collapsed;
    set_group_collapsed(doc, sheets, sheet_id, group_id, new_state);
    Some(new_state)
}

pub fn set_level_collapsed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    axis: GroupAxis,
    level: u32,
    collapsed: bool,
) {
    let groups = get_groups(doc, sheets, sheet_id, axis);
    for group in &groups {
        if group.level >= level {
            set_group_collapsed(doc, sheets, sheet_id, &group.id, collapsed);
        }
    }
}

pub fn expand_all(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, axis: Option<GroupAxis>) {
    let axes = match axis {
        Some(a) => vec![a],
        None => vec![GroupAxis::Row, GroupAxis::Column],
    };
    for ax in axes {
        for group in &get_groups(doc, sheets, sheet_id, ax) {
            if group.collapsed {
                set_group_collapsed(doc, sheets, sheet_id, &group.id, false);
            }
        }
    }
}

pub fn collapse_all(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, axis: Option<GroupAxis>) {
    let axes = match axis {
        Some(a) => vec![a],
        None => vec![GroupAxis::Row, GroupAxis::Column],
    };
    for ax in axes {
        let mut groups = get_groups(doc, sheets, sheet_id, ax);
        groups.sort_by_key(|g| g.level);
        for group in &groups {
            if !group.collapsed {
                set_group_collapsed(doc, sheets, sheet_id, &group.id, true);
            }
        }
    }
}

// =============================================================================
// Outline Levels
// =============================================================================

pub fn get_row_outline_levels(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Vec<OutlineLevel> {
    let groups = get_groups(doc, sheets, sheet_id, GroupAxis::Row);
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let sb = config.summary_rows_below;
    let mut result = Vec::new();
    for row in start_row..=end_row {
        let containing: Vec<&GroupDefinition> = groups
            .iter()
            .filter(|g| row >= g.start && row <= g.end)
            .collect();
        let level = containing.iter().map(|g| g.level).max().unwrap_or(0);
        let visible = !containing.iter().any(|g| {
            if !g.collapsed {
                return false;
            }
            let is_sum = if sb { row == g.end } else { row == g.start };
            !is_sum
        });
        let is_summary = containing
            .iter()
            .any(|g| if sb { row == g.end } else { row == g.start });
        let mut sc = containing;
        sc.sort_by(|a, b| b.level.cmp(&a.level));
        let group_ids = sc.iter().map(|g| g.id.clone()).collect();
        result.push(OutlineLevel {
            index: row,
            level,
            visible,
            is_summary,
            group_ids,
        });
    }
    result
}

pub fn get_column_outline_levels(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<OutlineLevel> {
    let groups = get_groups(doc, sheets, sheet_id, GroupAxis::Column);
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let sr = config.summary_columns_right;
    let mut result = Vec::new();
    for col in start_col..=end_col {
        let containing: Vec<&GroupDefinition> = groups
            .iter()
            .filter(|g| col >= g.start && col <= g.end)
            .collect();
        let level = containing.iter().map(|g| g.level).max().unwrap_or(0);
        let visible = !containing.iter().any(|g| {
            if !g.collapsed {
                return false;
            }
            let is_sum = if sr { col == g.end } else { col == g.start };
            !is_sum
        });
        let is_summary = containing
            .iter()
            .any(|g| if sr { col == g.end } else { col == g.start });
        let mut sc = containing;
        sc.sort_by(|a, b| b.level.cmp(&a.level));
        let group_ids = sc.iter().map(|g| g.id.clone()).collect();
        result.push(OutlineLevel {
            index: col,
            level,
            visible,
            is_summary,
            group_ids,
        });
    }
    result
}

pub fn is_row_visible_by_groups(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, row: u32) -> bool {
    get_row_outline_levels(doc, sheets, sheet_id, row, row)
        .first()
        .map(|l| l.visible)
        .unwrap_or(true)
}

pub fn is_column_visible_by_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    get_column_outline_levels(doc, sheets, sheet_id, col, col)
        .first()
        .map(|l| l.visible)
        .unwrap_or(true)
}

// =============================================================================
// Settings
// =============================================================================

pub fn set_outline_settings(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    settings: &OutlineSettingsUpdate,
) {
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    if let Some(v) = settings.summary_rows_below {
        config.summary_rows_below = v;
    }
    if let Some(v) = settings.summary_columns_right {
        config.summary_columns_right = v;
    }
    if let Some(v) = settings.show_outline_symbols {
        config.show_outline_symbols = v;
    }
    if let Some(v) = settings.show_outline_level_buttons {
        config.show_outline_level_buttons = v;
    }
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
}

// =============================================================================
// Rendering
// =============================================================================

pub fn get_outline_symbols(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    viewport: &Viewport,
) -> Vec<OutlineSymbol> {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut symbols = Vec::new();
    for group in &get_groups(doc, sheets, sheet_id, GroupAxis::Row) {
        let idx = if config.summary_rows_below {
            group.end
        } else {
            group.start
        };
        if idx >= viewport.start_row && idx <= viewport.end_row {
            symbols.push(OutlineSymbol {
                id: group.id.clone(),
                axis: GroupAxis::Row,
                index: idx,
                level: group.level,
                collapsed: group.collapsed,
                group_id: group.id.clone(),
            });
        }
    }
    for group in &get_groups(doc, sheets, sheet_id, GroupAxis::Column) {
        let idx = if config.summary_columns_right {
            group.end
        } else {
            group.start
        };
        if idx >= viewport.start_col && idx <= viewport.end_col {
            symbols.push(OutlineSymbol {
                id: group.id.clone(),
                axis: GroupAxis::Column,
                index: idx,
                level: group.level,
                collapsed: group.collapsed,
                group_id: group.id.clone(),
            });
        }
    }
    symbols
}

pub fn get_outline_level_buttons(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<OutlineLevelButton> {
    let mut buttons = Vec::new();
    let max_row = get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Row);
    let max_col = get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Column);
    if max_row > 0 {
        for level in 1..=max_row + 1 {
            buttons.push(OutlineLevelButton {
                level,
                axis: GroupAxis::Row,
            });
        }
    }
    if max_col > 0 {
        for level in 1..=max_col + 1 {
            buttons.push(OutlineLevelButton {
                level,
                axis: GroupAxis::Column,
            });
        }
    }
    buttons
}

pub fn get_outline_render_data(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    viewport: &Viewport,
) -> OutlineRenderData {
    OutlineRenderData {
        config: get_sheet_grouping_config(doc, sheets, sheet_id),
        row_groups: get_groups(doc, sheets, sheet_id, GroupAxis::Row),
        column_groups: get_groups(doc, sheets, sheet_id, GroupAxis::Column),
        max_row_level: get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Row),
        max_col_level: get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Column),
        row_outline_levels: get_row_outline_levels(
            doc,
            sheets,
            sheet_id,
            viewport.start_row,
            viewport.end_row,
        ),
        column_outline_levels: get_column_outline_levels(
            doc,
            sheets,
            sheet_id,
            viewport.start_col,
            viewport.end_col,
        ),
        outline_symbols: get_outline_symbols(doc, sheets, sheet_id, viewport),
        level_buttons: get_outline_level_buttons(doc, sheets, sheet_id),
    }
}

pub fn should_render_outlines(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> bool {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    if !config.show_outline_symbols {
        return false;
    }
    get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Row) > 0
        || get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Column) > 0
}

pub fn get_outline_gutter_dimensions(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    level_width: u32,
    level_height: u32,
) -> (u32, u32) {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    if !config.show_outline_symbols {
        return (0, 0);
    }
    let mr = get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Row);
    let mc = get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Column);
    (
        if mr > 0 { mr * level_width } else { 0 },
        if mc > 0 { mc * level_height } else { 0 },
    )
}

// =============================================================================
// Auto-Outline
// =============================================================================

pub fn auto_outline(
    doc: &Doc,
    sheets: &MapRef,
    cell_accessor: &dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
) -> u32 {
    let agg_re = Regex::new(r"(?i)\b(SUM|SUBTOTAL|AVERAGE|COUNT|MAX|MIN|PRODUCT)\s*\(").unwrap();
    let mut created: u32 = 0;
    for row in (range.start_row() + 1)..=range.end_row() {
        for col in range.start_col()..=range.end_col() {
            let raw = cell_accessor.get_cell_raw_value(sheet_id, row, col);
            if !raw.starts_with('=') {
                continue;
            }
            let formula = raw.to_uppercase();
            if !agg_re.is_match(&formula) {
                continue;
            }
            let cl = col_to_letter(col);
            let rp = Regex::new(&format!(r"(?i){}(\d+):{}(\d+)", cl, cl)).unwrap();
            if let Some(caps) = rp.captures(&formula) {
                let rs: u32 = caps[1].parse::<u32>().unwrap_or(0).saturating_sub(1);
                let re: u32 = caps[2].parse::<u32>().unwrap_or(0).saturating_sub(1);
                if rs >= range.start_row() && re < row && re >= rs {
                    let existing = get_groups(doc, sheets, sheet_id, GroupAxis::Row);
                    if !existing.iter().any(|g| g.start == rs && g.end == row)
                        && group_rows(doc, sheets, sheet_id, rs, row).is_ok()
                    {
                        created += 1;
                    }
                }
            }
        }
    }
    created
}

// =============================================================================
// Subtotal Integration
// =============================================================================

pub fn build_subtotal_formula(
    func: SubtotalFunction,
    col: u32,
    start_row: u32,
    end_row: u32,
) -> String {
    format!(
        "=SUBTOTAL({},{}{}:{}{})",
        func.hidden_code(),
        col_to_letter(col),
        start_row + 1,
        col_to_letter(col),
        end_row + 1
    )
}

pub fn find_group_boundaries(
    cell_accessor: &dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
    group_by_column: u32,
    has_headers: bool,
) -> Vec<GroupBoundary> {
    let mut boundaries = Vec::new();
    let dsr = if has_headers {
        range.start_row() + 1
    } else {
        range.start_row()
    };
    if dsr > range.end_row() {
        return boundaries;
    }
    let mut cv = cell_accessor.get_cell_value(sheet_id, dsr, group_by_column);
    let mut gsr = dsr;
    for row in (dsr + 1)..=range.end_row() {
        let v = cell_accessor.get_cell_value(sheet_id, row, group_by_column);
        if v != cv {
            boundaries.push(GroupBoundary {
                group_value: cv,
                start_row: gsr,
                end_row: row - 1,
            });
            cv = v;
            gsr = row;
        }
    }
    boundaries.push(GroupBoundary {
        group_value: cv,
        start_row: gsr,
        end_row: range.end_row(),
    });
    boundaries
}

pub fn is_subtotal_row(
    cell_accessor: &dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    row: u32,
    start_col: u32,
    end_col: u32,
) -> bool {
    (start_col..=end_col).any(|col| {
        cell_accessor
            .get_cell_raw_value(sheet_id, row, col)
            .to_uppercase()
            .contains("SUBTOTAL(")
    })
}

pub fn create_subtotals(
    doc: &Doc,
    sheets: &MapRef,
    cell_accessor: &mut dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
    options: &SubtotalOptions,
) -> SubtotalResult {
    let sb = options.summary_below_data;
    if options.replace_existing {
        remove_subtotals(doc, sheets, cell_accessor, sheet_id, range);
    }
    let boundaries = find_group_boundaries(
        cell_accessor,
        sheet_id,
        range,
        options.group_by_column,
        options.has_headers,
    );
    if boundaries.is_empty() {
        return SubtotalResult {
            groups_created: 0,
            subtotal_rows_inserted: 0,
            affected_range: *range,
        };
    }
    let mut ri: u32 = 0;
    let mut gc: u32 = 0;
    let sorted: Vec<GroupBoundary> = if sb {
        boundaries.into_iter().rev().collect()
    } else {
        boundaries
    };
    for b in &sorted {
        let as_ = if sb { b.start_row } else { b.start_row + ri };
        let ae = b.end_row + ri;
        let srp = if sb { ae + 1 } else { as_ };
        cell_accessor.insert_rows(sheet_id, srp, 1);
        ri += 1;
        cell_accessor.set_cell_value(
            sheet_id,
            srp,
            options.group_by_column,
            &format!("{} Total", b.group_value),
        );
        for &col in &options.subtotal_columns {
            let fs = if sb { as_ } else { as_ + 1 };
            let fe = if sb { ae } else { ae + 1 };
            cell_accessor.set_cell_value(
                sheet_id,
                srp,
                col,
                &build_subtotal_formula(options.function, col, fs, fe),
            );
        }
        let gs = if sb { as_ } else { srp };
        let ge = if sb { srp } else { ae + 1 };
        if group_rows(doc, sheets, sheet_id, gs, ge).is_ok() {
            gc += 1;
        }
    }
    let mn = options
        .subtotal_columns
        .iter()
        .copied()
        .min()
        .unwrap_or(options.group_by_column)
        .min(options.group_by_column);
    let mx = options
        .subtotal_columns
        .iter()
        .copied()
        .max()
        .unwrap_or(options.group_by_column)
        .max(options.group_by_column);
    SubtotalResult {
        groups_created: gc,
        subtotal_rows_inserted: ri,
        affected_range: CellRange::new(range.start_row(), mn, range.end_row() + ri, mx),
    }
}

pub fn remove_subtotals(
    doc: &Doc,
    sheets: &MapRef,
    cell_accessor: &mut dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
) {
    let sr: Vec<u32> = (range.start_row()..=range.end_row())
        .rev()
        .filter(|&row| {
            is_subtotal_row(
                cell_accessor,
                sheet_id,
                row,
                range.start_col(),
                range.end_col(),
            )
        })
        .collect();
    if sr.is_empty() {
        return;
    }
    clear_row_grouping(doc, sheets, sheet_id, range.start_row(), range.end_row());
    for row in &sr {
        cell_accessor.delete_rows(sheet_id, *row, 1);
    }
}

pub fn clear_all_grouping(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    set_sheet_grouping_config(doc, sheets, sheet_id, &SheetGroupingConfig::default());
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn storage_with_sheet() -> (YrsStorage, SheetId) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sid = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
            .expect("add_sheet");
        (storage, sid)
    }

    struct MockCellAccessor {
        cells: std::collections::HashMap<(u32, u32), String>,
    }
    impl MockCellAccessor {
        fn new() -> Self {
            Self {
                cells: std::collections::HashMap::new(),
            }
        }
        fn set(&mut self, r: u32, c: u32, v: &str) {
            self.cells.insert((r, c), v.to_string());
        }
    }
    impl SubtotalsCellAccessor for MockCellAccessor {
        fn get_cell_value(&self, _: &SheetId, r: u32, c: u32) -> String {
            self.cells.get(&(r, c)).cloned().unwrap_or_default()
        }
        fn set_cell_value(&mut self, _: &SheetId, r: u32, c: u32, v: &str) {
            self.cells.insert((r, c), v.into());
        }
        fn insert_rows(&mut self, _: &SheetId, sr: u32, cnt: u32) {
            let mut n = std::collections::HashMap::new();
            for (&(r, c), v) in &self.cells {
                if r >= sr {
                    n.insert((r + cnt, c), v.clone());
                } else {
                    n.insert((r, c), v.clone());
                }
            }
            self.cells = n;
        }
        fn delete_rows(&mut self, _: &SheetId, sr: u32, cnt: u32) {
            let mut n = std::collections::HashMap::new();
            for (&(r, c), v) in &self.cells {
                if r >= sr + cnt {
                    n.insert((r - cnt, c), v.clone());
                } else if r < sr {
                    n.insert((r, c), v.clone());
                }
            }
            self.cells = n;
        }
        fn get_cell_raw_value(&self, _: &SheetId, r: u32, c: u32) -> String {
            self.cells.get(&(r, c)).cloned().unwrap_or_default()
        }
    }

    #[test]
    fn test_default_config() {
        let (s, id) = storage_with_sheet();
        let c = get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id);
        assert_eq!(c, SheetGroupingConfig::default());
    }
    #[test]
    fn test_group_rows_basic() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        assert_eq!(g.start, 2);
        assert_eq!(g.end, 5);
        assert_eq!(g.level, 1);
        assert!(!g.collapsed);
    }
    #[test]
    fn test_group_rows_reversed() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 5, 2).unwrap();
        assert_eq!(g.start, 2);
        assert_eq!(g.end, 5);
    }
    #[test]
    fn test_nested_groups() {
        let (s, id) = storage_with_sheet();
        let o = group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
        let i = group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
        assert_eq!(o.level, 1);
        assert_eq!(i.level, 2);
        assert_eq!(i.parent_id, Some(o.id));
    }
    #[test]
    fn test_max_level_exceeded() {
        let (s, id) = storage_with_sheet();
        for i in 0..8u32 {
            group_rows(s.doc(), &s.sheets_ref(), &id, i, 20 - i).unwrap();
        }
        assert!(group_rows(s.doc(), &s.sheets_ref(), &id, 4, 16).is_err());
    }
    #[test]
    fn test_ungroup_rows() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &id, 3, 4).unwrap();
        ungroup_rows(s.doc(), &s.sheets_ref(), &id, 3, 4);
        assert_eq!(
            get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id)
                .row_groups
                .len(),
            1
        );
    }
    #[test]
    fn test_clear_row_grouping() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &id, 3, 4).unwrap();
        clear_row_grouping(s.doc(), &s.sheets_ref(), &id, 2, 5);
        assert!(
            get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id)
                .row_groups
                .is_empty()
        );
    }
    #[test]
    fn test_group_columns_basic() {
        let (s, id) = storage_with_sheet();
        let g = group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();
        assert_eq!(g.axis, GroupAxis::Column);
        assert_eq!(g.level, 1);
    }
    #[test]
    fn test_ungroup_columns() {
        let (s, id) = storage_with_sheet();
        group_columns(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
        group_columns(s.doc(), &s.sheets_ref(), &id, 2, 3).unwrap();
        ungroup_columns(s.doc(), &s.sheets_ref(), &id, 2, 3);
        assert_eq!(
            get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id)
                .column_groups
                .len(),
            1
        );
    }
    #[test]
    fn test_clear_column_grouping() {
        let (s, id) = storage_with_sheet();
        group_columns(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
        clear_column_grouping(s.doc(), &s.sheets_ref(), &id, 1, 5);
        assert!(
            get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id)
                .column_groups
                .is_empty()
        );
    }
    #[test]
    fn test_get_group_in_sheet() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        assert!(get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &g.id).is_some());
        assert!(get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, "x").is_none());
    }
    #[test]
    fn test_get_group_across_sheets() {
        let mut s = YrsStorage::new();
        let mut m = crate::mirror::CellMirror::new();
        let a = make_sheet_id(1);
        let b = make_sheet_id(2);
        s.add_sheet(&mut m, a, "S1", 100, 26).unwrap();
        s.add_sheet(&mut m, b, "S2", 100, 26).unwrap();
        let g = group_rows(s.doc(), &s.sheets_ref(), &b, 0, 5).unwrap();
        assert!(get_group(s.doc(), &s.sheets_ref(), &[a, b], &g.id).is_some());
    }
    #[test]
    fn test_get_groups_by_axis() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &id, 7, 10).unwrap();
        group_columns(s.doc(), &s.sheets_ref(), &id, 0, 3).unwrap();
        assert_eq!(
            get_groups(s.doc(), &s.sheets_ref(), &id, GroupAxis::Row).len(),
            2
        );
        assert_eq!(
            get_groups(s.doc(), &s.sheets_ref(), &id, GroupAxis::Column).len(),
            1
        );
    }
    #[test]
    fn test_max_outline_level() {
        let (s, id) = storage_with_sheet();
        assert_eq!(
            get_max_outline_level(s.doc(), &s.sheets_ref(), &id, GroupAxis::Row),
            0
        );
        group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
        assert_eq!(
            get_max_outline_level(s.doc(), &s.sheets_ref(), &id, GroupAxis::Row),
            2
        );
    }
    #[test]
    fn test_affected_rows() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        assert_eq!(
            get_affected_rows_by_group(s.doc(), &s.sheets_ref(), &id, &g.id),
            vec![2, 3, 4]
        );
    }
    #[test]
    fn test_affected_rows_summary_above() {
        let (s, id) = storage_with_sheet();
        set_outline_settings(
            s.doc(),
            &s.sheets_ref(),
            &id,
            &OutlineSettingsUpdate {
                summary_rows_below: Some(false),
                ..Default::default()
            },
        );
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        assert_eq!(
            get_affected_rows_by_group(s.doc(), &s.sheets_ref(), &id, &g.id),
            vec![3, 4, 5]
        );
    }
    #[test]
    fn test_affected_columns() {
        let (s, id) = storage_with_sheet();
        let g = group_columns(s.doc(), &s.sheets_ref(), &id, 1, 4).unwrap();
        assert_eq!(
            get_affected_columns_by_group(s.doc(), &s.sheets_ref(), &id, &g.id),
            vec![1, 2, 3]
        );
    }
    #[test]
    fn test_set_group_collapsed() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, true);
        assert!(
            get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &g.id)
                .unwrap()
                .collapsed
        );
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, false);
        assert!(
            !get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &g.id)
                .unwrap()
                .collapsed
        );
    }
    #[test]
    fn test_toggle_collapsed() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        assert_eq!(
            toggle_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id),
            Some(true)
        );
        assert_eq!(
            toggle_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id),
            Some(false)
        );
    }
    #[test]
    fn test_set_level_collapsed() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
        let i = group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
        set_level_collapsed(s.doc(), &s.sheets_ref(), &id, GroupAxis::Row, 2, true);
        assert!(
            get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &i.id)
                .unwrap()
                .collapsed
        );
    }
    #[test]
    fn test_expand_all() {
        let (s, id) = storage_with_sheet();
        let a = group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
        let b = group_rows(s.doc(), &s.sheets_ref(), &id, 7, 10).unwrap();
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &a.id, true);
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &b.id, true);
        expand_all(s.doc(), &s.sheets_ref(), &id, Some(GroupAxis::Row));
        assert!(
            !get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &a.id)
                .unwrap()
                .collapsed
        );
    }
    #[test]
    fn test_collapse_all() {
        let (s, id) = storage_with_sheet();
        let a = group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
        let b = group_rows(s.doc(), &s.sheets_ref(), &id, 7, 10).unwrap();
        collapse_all(s.doc(), &s.sheets_ref(), &id, Some(GroupAxis::Row));
        assert!(
            get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &a.id)
                .unwrap()
                .collapsed
        );
        assert!(
            get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &b.id)
                .unwrap()
                .collapsed
        );
    }
    #[test]
    fn test_row_outline_levels() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        let l = get_row_outline_levels(s.doc(), &s.sheets_ref(), &id, 0, 7);
        assert_eq!(l[0].level, 0);
        assert_eq!(l[2].level, 1);
        assert!(l[5].is_summary);
        assert_eq!(l[6].level, 0);
    }
    #[test]
    fn test_row_visibility_collapsed() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, true);
        let l = get_row_outline_levels(s.doc(), &s.sheets_ref(), &id, 2, 5);
        assert!(!l[0].visible);
        assert!(!l[1].visible);
        assert!(l[3].visible);
    }
    #[test]
    fn test_column_outline_levels() {
        let (s, id) = storage_with_sheet();
        group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();
        let l = get_column_outline_levels(s.doc(), &s.sheets_ref(), &id, 0, 4);
        assert_eq!(l[0].level, 0);
        assert_eq!(l[1].level, 1);
        assert!(l[3].is_summary);
    }
    #[test]
    fn test_is_row_visible() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        assert!(is_row_visible_by_groups(s.doc(), &s.sheets_ref(), &id, 3));
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, true);
        assert!(!is_row_visible_by_groups(s.doc(), &s.sheets_ref(), &id, 3));
        assert!(is_row_visible_by_groups(s.doc(), &s.sheets_ref(), &id, 5));
    }
    #[test]
    fn test_is_col_visible() {
        let (s, id) = storage_with_sheet();
        let g = group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, true);
        assert!(!is_column_visible_by_groups(
            s.doc(),
            &s.sheets_ref(),
            &id,
            2
        ));
        assert!(is_column_visible_by_groups(
            s.doc(),
            &s.sheets_ref(),
            &id,
            3
        ));
    }
    #[test]
    fn test_set_outline_settings() {
        let (s, id) = storage_with_sheet();
        set_outline_settings(
            s.doc(),
            &s.sheets_ref(),
            &id,
            &OutlineSettingsUpdate {
                summary_rows_below: Some(false),
                show_outline_symbols: Some(false),
                ..Default::default()
            },
        );
        let c = get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id);
        assert!(!c.summary_rows_below);
        assert!(!c.show_outline_symbols);
        assert!(c.summary_columns_right);
    }
    #[test]
    fn test_outline_symbols() {
        let (s, id) = storage_with_sheet();
        let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        let vp = Viewport {
            start_row: 0,
            end_row: 10,
            start_col: 0,
            end_col: 10,
        };
        let sy = get_outline_symbols(s.doc(), &s.sheets_ref(), &id, &vp);
        assert_eq!(sy.len(), 1);
        assert_eq!(sy[0].index, 5);
        assert_eq!(sy[0].group_id, g.id);
    }
    #[test]
    fn test_symbols_outside_viewport() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 20, 30).unwrap();
        assert!(
            get_outline_symbols(
                s.doc(),
                &s.sheets_ref(),
                &id,
                &Viewport {
                    start_row: 0,
                    end_row: 10,
                    start_col: 0,
                    end_col: 10
                }
            )
            .is_empty()
        );
    }
    #[test]
    fn test_level_buttons() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
        let b: Vec<_> = get_outline_level_buttons(s.doc(), &s.sheets_ref(), &id)
            .into_iter()
            .filter(|x| x.axis == GroupAxis::Row)
            .collect();
        assert_eq!(b.len(), 3);
        assert_eq!(b[2].level, 3);
    }
    #[test]
    fn test_render_data() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();
        let d = get_outline_render_data(
            s.doc(),
            &s.sheets_ref(),
            &id,
            &Viewport {
                start_row: 0,
                end_row: 10,
                start_col: 0,
                end_col: 10,
            },
        );
        assert_eq!(d.row_groups.len(), 1);
        assert_eq!(d.column_groups.len(), 1);
    }
    #[test]
    fn test_should_render() {
        let (s, id) = storage_with_sheet();
        assert!(!should_render_outlines(s.doc(), &s.sheets_ref(), &id));
        group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
        assert!(should_render_outlines(s.doc(), &s.sheets_ref(), &id));
        set_outline_settings(
            s.doc(),
            &s.sheets_ref(),
            &id,
            &OutlineSettingsUpdate {
                show_outline_symbols: Some(false),
                ..Default::default()
            },
        );
        assert!(!should_render_outlines(s.doc(), &s.sheets_ref(), &id));
    }
    #[test]
    fn test_gutter() {
        let (s, id) = storage_with_sheet();
        assert_eq!(
            get_outline_gutter_dimensions(s.doc(), &s.sheets_ref(), &id, 16, 16),
            (0, 0)
        );
        group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
        assert_eq!(
            get_outline_gutter_dimensions(s.doc(), &s.sheets_ref(), &id, 16, 16),
            (32, 0)
        );
    }
    #[test]
    fn test_col_to_letter() {
        assert_eq!(col_to_letter(0), "A");
        assert_eq!(col_to_letter(25), "Z");
        assert_eq!(col_to_letter(26), "AA");
        assert_eq!(col_to_letter(702), "AAA");
    }
    #[test]
    fn test_subtotal_codes() {
        assert_eq!(SubtotalFunction::Sum.visible_code(), 9);
        assert_eq!(SubtotalFunction::Sum.hidden_code(), 109);
        assert_eq!(SubtotalFunction::Average.visible_code(), 1);
    }
    #[test]
    fn test_build_formula() {
        assert_eq!(
            build_subtotal_formula(SubtotalFunction::Sum, 0, 1, 5),
            "=SUBTOTAL(109,A2:A6)"
        );
        assert_eq!(
            build_subtotal_formula(SubtotalFunction::Average, 2, 0, 9),
            "=SUBTOTAL(101,C1:C10)"
        );
    }
    #[test]
    fn test_find_boundaries() {
        let (_, sid) = storage_with_sheet();
        let mut a = MockCellAccessor::new();
        a.set(0, 0, "Cat");
        a.set(1, 0, "A");
        a.set(2, 0, "A");
        a.set(3, 0, "B");
        a.set(4, 0, "B");
        a.set(5, 0, "B");
        a.set(6, 0, "C");
        let r = CellRange::new(0, 0, 6, 0);
        let b = find_group_boundaries(&a, &sid, &r, 0, true);
        assert_eq!(b.len(), 3);
        assert_eq!(b[0].group_value, "A");
        assert_eq!(b[1].group_value, "B");
    }
    #[test]
    fn test_is_subtotal_row() {
        let (_, sid) = storage_with_sheet();
        let mut a = MockCellAccessor::new();
        a.set(0, 0, "Data");
        a.set(1, 0, "=SUBTOTAL(109,A1:A1)");
        assert!(!is_subtotal_row(&a, &sid, 0, 0, 0));
        assert!(is_subtotal_row(&a, &sid, 1, 0, 0));
    }
    #[test]
    fn test_auto_outline() {
        let (s, sid) = storage_with_sheet();
        let a = MockCellAccessor {
            cells: {
                let mut m = std::collections::HashMap::new();
                m.insert((0, 0), "10".into());
                m.insert((1, 0), "20".into());
                m.insert((2, 0), "=SUM(A1:A2)".into());
                m
            },
        };
        assert_eq!(
            auto_outline(
                s.doc(),
                &s.sheets_ref(),
                &a,
                &sid,
                &CellRange::new(0, 0, 2, 0)
            ),
            1
        );
        assert_eq!(
            get_groups(s.doc(), &s.sheets_ref(), &sid, GroupAxis::Row)[0].start,
            0
        );
    }
    #[test]
    fn test_auto_outline_no_match() {
        let (s, sid) = storage_with_sheet();
        let a = MockCellAccessor {
            cells: {
                let mut m = std::collections::HashMap::new();
                m.insert((0, 0), "10".into());
                m.insert((1, 0), "20".into());
                m.insert((2, 0), "30".into());
                m
            },
        };
        assert_eq!(
            auto_outline(
                s.doc(),
                &s.sheets_ref(),
                &a,
                &sid,
                &CellRange::new(0, 0, 2, 0)
            ),
            0
        );
    }
    #[test]
    fn test_clear_all() {
        let (s, id) = storage_with_sheet();
        group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
        group_columns(s.doc(), &s.sheets_ref(), &id, 0, 3).unwrap();
        clear_all_grouping(s.doc(), &s.sheets_ref(), &id);
        let c = get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id);
        assert!(c.row_groups.is_empty() && c.column_groups.is_empty());
    }
    #[test]
    fn test_serde_roundtrip() {
        let c = SheetGroupingConfig {
            row_groups: vec![GroupDefinition {
                id: "g".into(),
                sheet_id: "s".into(),
                axis: GroupAxis::Row,
                start: 0,
                end: 5,
                level: 1,
                collapsed: false,
                parent_id: None,
                hidden: false,
                collapsed_on_member: false,
            }],
            ..Default::default()
        };
        assert_eq!(
            c,
            serde_json::from_str::<SheetGroupingConfig>(&serde_json::to_string(&c).unwrap())
                .unwrap()
        );
    }
    #[test]
    fn test_display_name() {
        assert_eq!(SubtotalFunction::Sum.display_name(), "Sum");
        assert_eq!(SubtotalFunction::CountNums.display_name(), "Count Numbers");
    }
    #[test]
    fn test_axis_serde() {
        assert_eq!(serde_json::to_string(&GroupAxis::Row).unwrap(), "\"row\"");
        assert_eq!(
            serde_json::from_str::<GroupAxis>("\"column\"").unwrap(),
            GroupAxis::Column
        );
    }
    #[test]
    fn test_multi_sheet_isolation() {
        let mut s = YrsStorage::new();
        let mut m = crate::mirror::CellMirror::new();
        let a = make_sheet_id(10);
        let b = make_sheet_id(20);
        s.add_sheet(&mut m, a, "S1", 100, 26).unwrap();
        s.add_sheet(&mut m, b, "S2", 100, 26).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &a, 1, 5).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &b, 10, 20).unwrap();
        group_rows(s.doc(), &s.sheets_ref(), &b, 12, 15).unwrap();
        assert_eq!(
            get_groups(s.doc(), &s.sheets_ref(), &a, GroupAxis::Row).len(),
            1
        );
        assert_eq!(
            get_groups(s.doc(), &s.sheets_ref(), &b, GroupAxis::Row).len(),
            2
        );
    }
    #[test]
    fn test_nonexistent_sheet() {
        let s = YrsStorage::new();
        assert_eq!(
            get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &make_sheet_id(999)),
            SheetGroupingConfig::default()
        );
    }
    #[test]
    fn test_calc_level_non_overlap() {
        let e = vec![GroupDefinition {
            id: "g".into(),
            sheet_id: "s".into(),
            axis: GroupAxis::Row,
            start: 10,
            end: 20,
            level: 1,
            collapsed: false,
            parent_id: None,
            hidden: false,
            collapsed_on_member: false,
        }];
        assert_eq!(calculate_group_level(&e, 0, 5).unwrap(), 1);
    }
    #[test]
    fn test_find_parent() {
        let e = vec![GroupDefinition {
            id: "p".into(),
            sheet_id: "s".into(),
            axis: GroupAxis::Row,
            start: 0,
            end: 10,
            level: 1,
            collapsed: false,
            parent_id: None,
            hidden: false,
            collapsed_on_member: false,
        }];
        assert_eq!(find_parent_group(&e, 2, 8, 2), Some("p".into()));
        assert_eq!(find_parent_group(&e, 2, 8, 1), None);
    }
    #[test]
    fn test_expand_both_axes() {
        let (s, id) = storage_with_sheet();
        let r = group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
        let c = group_columns(s.doc(), &s.sheets_ref(), &id, 0, 3).unwrap();
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &r.id, true);
        set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &c.id, true);
        expand_all(s.doc(), &s.sheets_ref(), &id, None);
        assert!(
            !get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &r.id)
                .unwrap()
                .collapsed
        );
        assert!(
            !get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &c.id)
                .unwrap()
                .collapsed
        );
    }
    #[test]
    fn test_hex_helpers() {
        let sid = SheetId::from_raw(42);
        let h = sheet_id_to_hex(&sid);
        assert_eq!(h, "0000000000000000000000000000002a");
        assert_eq!(hex_to_sheet_id(&h).unwrap(), sid);
    }
}
