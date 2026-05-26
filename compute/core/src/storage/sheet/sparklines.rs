//! Sheet-level Sparkline CRUD operations.
//!
//! Port of `spreadsheet-model/src/sparklines/sparkline-store.ts`
//! (spreadsheet-model elimination).
//!
//! Provides CRUD for sparklines, sparkline groups, a cell index for O(1)
//! lookup, and range operations. All data is stored per-sheet in the
//! Yrs CRDT document under each sheet's `sparklines` map.
//!
//! ## Yrs Storage Layout (structured Y.Map)
//!
//! Sparklines and groups are stored as structured Y.Map entries (not JSON blobs).
//!
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- sparklines: Y.Map
//!           +-- {sparklineId}:    Y.Map (structured Sparkline fields)
//!           +-- group:{groupId}:  Y.Map (structured SparklineGroup fields)
//!           +-- idx:{row},{col}:  String (sparklineId — cell index for O(1) lookup)
//! ```

use std::sync::Arc;

use compute_document::undo::ORIGIN_USER_EDIT;
pub use domain_types::domain::sparkline::*;
use domain_types::yrs_schema::sparkline as yrs_sparkline;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

pub use crate::engine_types::sparklines::*;
use crate::storage::infra::grid_helpers::sheet_id_to_hex;
use cell_types::SheetId;
use compute_document::schema::KEY_SPARKLINES;

/// Position-only cell range (re-exported from compute-types for backward compat).
pub type CellRange = crate::PositionRange;

// =============================================================================
// Key Prefixes
// =============================================================================

/// Prefix for group entries in the sparklines map.
const GROUP_PREFIX: &str = "group:";

/// Prefix for cell-index entries in the sparklines map.
const IDX_PREFIX: &str = "idx:";

// =============================================================================
// Internal Helpers
// =============================================================================

/// Build the cell-index key for a (row, col) pair.
fn idx_key(row: u32, col: u32) -> String {
    format!("{}{},{}", IDX_PREFIX, row, col)
}

/// Build the group key for a group ID.
fn group_key(group_id: &str) -> String {
    format!("{}{}", GROUP_PREFIX, group_id)
}

/// Get the per-sheet `sparklines` MapRef (read-only).
fn get_sparklines_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_SPARKLINES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

// =============================================================================
// Yrs read/write via domain-types yrs_schema
// =============================================================================

/// Write a Sparkline into a parent Y.Map at the given key.
///
/// Uses `domain_types::yrs_schema::sparkline::to_yrs_prelim` for serialization.
fn write_sparkline(parent: &MapRef, txn: &mut yrs::TransactionMut, key: &str, sp: &Sparkline) {
    let entries = yrs_sparkline::to_yrs_prelim(sp);
    let prelim: MapPrelim = entries.into_iter().collect();
    parent.insert(txn, key, prelim);
}

/// Read a Sparkline from a Yrs Out value.
///
/// Handles structured Y.Map entries only (legacy JSON fallback removed).
fn read_sparkline_from_out<T: yrs::ReadTxn>(out: &Out, txn: &T) -> Option<Sparkline> {
    match out {
        Out::YMap(map) => yrs_sparkline::from_yrs_map(map, txn),
        _ => None,
    }
}

/// Write a SparklineGroup into a parent Y.Map at the given key.
///
/// Uses `domain_types::yrs_schema::sparkline::group_to_yrs_prelim` for serialization.
fn write_group(parent: &MapRef, txn: &mut yrs::TransactionMut, key: &str, group: &SparklineGroup) {
    let entries = yrs_sparkline::group_to_yrs_prelim(group);
    let prelim: MapPrelim = entries.into_iter().collect();
    parent.insert(txn, key, prelim);
}

/// Read a SparklineGroup from a Yrs Out value.
///
/// Handles structured Y.Map entries only (legacy JSON fallback removed).
fn read_group_from_out<T: yrs::ReadTxn>(out: &Out, txn: &T) -> Option<SparklineGroup> {
    match out {
        Out::YMap(map) => yrs_sparkline::group_from_yrs_map(map, txn),
        _ => None,
    }
}

// =============================================================================
// Sparkline CRUD
// =============================================================================

/// Add a new sparkline.
///
/// Stores the sparkline as a structured Y.Map in the sheet's `sparklines` map
/// and creates a cell-index entry for O(1) lookup.
pub fn add_sparkline(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, sparkline: &Sparkline) {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    write_sparkline(&sp_map, &mut txn, &sparkline.id, sparkline);
    sp_map.insert(
        &mut txn,
        &*idx_key(sparkline.cell.row, sparkline.cell.col),
        Any::String(Arc::from(sparkline.id.as_str())),
    );
}

/// Get a sparkline by ID.
pub fn get_sparkline(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Option<Sparkline> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let sp_map = get_sparklines_map(&txn, sheets, &sheet_hex)?;
    let out = sp_map.get(&txn, sparkline_id)?;
    read_sparkline_from_out(&out, &txn)
}

/// Get sparkline at a specific cell using the cell index (O(1) lookup).
pub fn get_sparkline_at_cell(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<Sparkline> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let sp_map = get_sparklines_map(&txn, sheets, &sheet_hex)?;
    let key = idx_key(row, col);
    let sparkline_id = match sp_map.get(&txn, &key) {
        Some(Out::Any(Any::String(s))) => s.to_string(),
        _ => return None,
    };
    let out = sp_map.get(&txn, &sparkline_id)?;
    read_sparkline_from_out(&out, &txn)
}

/// Get all sparklines in a sheet.
pub fn get_sparklines_in_sheet(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<Sparkline> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in sp_map.iter(&txn) {
        // Skip group entries and index entries
        if key.starts_with(GROUP_PREFIX) || key.starts_with(IDX_PREFIX) {
            continue;
        }
        if let Some(sparkline) = read_sparkline_from_out(&value, &txn) {
            result.push(sparkline);
        }
    }
    result
}

/// Update an existing sparkline.
///
/// Merges the provided `updates` into the existing sparkline, preserving
/// the original sparkline ID. Updates the cell index if the cell position
/// changed.
///
/// Returns `true` if the sparkline was found and updated, `false` otherwise.
pub fn update_sparkline(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    sparkline_id: &str,
    updates: &SparklineUpdate,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };

    // Read existing sparkline
    let mut existing = match sp_map.get(&txn, sparkline_id) {
        Some(out) => match read_sparkline_from_out(&out, &txn) {
            Some(s) => s,
            None => return false,
        },
        None => return false,
    };

    // Check if cell position will change (for index update)
    let old_idx = idx_key(existing.cell.row, existing.cell.col);

    // Apply partial update
    existing.apply_update(updates);

    // Update cell index if position changed
    let new_idx = idx_key(existing.cell.row, existing.cell.col);
    if old_idx != new_idx {
        sp_map.remove(&mut txn, &old_idx);
        sp_map.insert(&mut txn, &*new_idx, Any::String(Arc::from(sparkline_id)));
    }

    // Write updated sparkline as structured Y.Map
    write_sparkline(&sp_map, &mut txn, sparkline_id, &existing);

    true
}

/// Delete a sparkline.
///
/// Removes the sparkline from the sparklines map, the cell index, and
/// its group (if part of one). If the group becomes empty, it is also deleted.
///
/// Returns `true` if the sparkline was found and deleted, `false` otherwise.
pub fn delete_sparkline(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };

    // Read existing sparkline
    let existing = match sp_map.get(&txn, sparkline_id) {
        Some(out) => match read_sparkline_from_out(&out, &txn) {
            Some(s) => s,
            None => return false,
        },
        None => return false,
    };

    // Remove cell index
    let key = idx_key(existing.cell.row, existing.cell.col);
    sp_map.remove(&mut txn, &key);

    // Remove sparkline
    sp_map.remove(&mut txn, sparkline_id);

    // Remove from group if part of one
    if let Some(ref gid) = existing.group_id {
        let gkey = group_key(gid);
        if let Some(out) = sp_map.get(&txn, &gkey)
            && let Some(mut group) = read_group_from_out(&out, &txn)
        {
            group.sparkline_ids.retain(|id| id != sparkline_id);
            if group.sparkline_ids.is_empty() {
                sp_map.remove(&mut txn, &gkey);
            } else {
                write_group(&sp_map, &mut txn, &gkey, &group);
            }
        }
    }

    true
}

// =============================================================================
// Group CRUD
// =============================================================================

/// Add a new sparkline group.
///
/// Stores the group and updates all member sparklines to reference this group.
pub fn add_sparkline_group(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, group: &SparklineGroup) {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    let gkey = group_key(&group.id);
    write_group(&sp_map, &mut txn, &gkey, group);

    // Update all sparklines in the group to reference this group
    for sparkline_id in &group.sparkline_ids {
        if let Some(out) = sp_map.get(&txn, sparkline_id.as_str())
            && let Some(mut sparkline) = read_sparkline_from_out(&out, &txn)
        {
            sparkline.group_id = Some(group.id.clone());
            write_sparkline(&sp_map, &mut txn, sparkline_id.as_str(), &sparkline);
        }
    }
}

/// Get a sparkline group by ID.
pub fn get_sparkline_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<SparklineGroup> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let sp_map = get_sparklines_map(&txn, sheets, &sheet_hex)?;
    let gkey = group_key(group_id);
    let out = sp_map.get(&txn, &gkey)?;
    read_group_from_out(&out, &txn)
}

/// Get all sparkline groups in a sheet.
pub fn get_sparkline_groups_in_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<SparklineGroup> {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in sp_map.iter(&txn) {
        if key.starts_with(GROUP_PREFIX)
            && let Some(group) = read_group_from_out(&value, &txn)
        {
            result.push(group);
        }
    }
    result
}

/// Delete a sparkline group.
///
/// If `delete_sparklines` is true, all member sparklines are also deleted
/// (including their cell-index entries). If false, member sparklines become
/// standalone (their `group_id` is cleared).
///
/// Returns `true` if the group was found and deleted, `false` otherwise.
pub fn delete_sparkline_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
    delete_sparklines_flag: bool,
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };

    let gkey = group_key(group_id);
    let group = match sp_map.get(&txn, &gkey) {
        Some(out) => match read_group_from_out(&out, &txn) {
            Some(g) => g,
            None => return false,
        },
        None => return false,
    };

    if delete_sparklines_flag {
        // Delete all member sparklines and their cell-index entries
        for sparkline_id in &group.sparkline_ids {
            if let Some(out) = sp_map.get(&txn, sparkline_id.as_str())
                && let Some(sparkline) = read_sparkline_from_out(&out, &txn)
            {
                let ikey = idx_key(sparkline.cell.row, sparkline.cell.col);
                sp_map.remove(&mut txn, &ikey);
            }
            sp_map.remove(&mut txn, sparkline_id.as_str());
        }
    } else {
        // Remove group_id from sparklines (make them standalone)
        for sparkline_id in &group.sparkline_ids {
            if let Some(out) = sp_map.get(&txn, sparkline_id.as_str())
                && let Some(mut sparkline) = read_sparkline_from_out(&out, &txn)
            {
                sparkline.group_id = None;
                write_sparkline(&sp_map, &mut txn, sparkline_id.as_str(), &sparkline);
            }
        }
    }

    // Delete the group itself
    sp_map.remove(&mut txn, &gkey);

    true
}

// =============================================================================
// Range Operations
// =============================================================================

/// Clear all sparklines whose cell falls within the given range.
///
/// Also removes cell-index entries and cleans up group membership.
pub fn clear_sparklines_in_range(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    range: &CellRange,
) {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    // Collect sparkline IDs in the range via the cell index
    let mut to_delete: Vec<String> = Vec::new();
    for row in range.start_row()..=range.end_row() {
        for col in range.start_col()..=range.end_col() {
            let ikey = idx_key(row, col);
            if let Some(Out::Any(Any::String(sid))) = sp_map.get(&txn, &ikey) {
                let sid_str = sid.to_string();
                if !to_delete.contains(&sid_str) {
                    to_delete.push(sid_str);
                }
            }
        }
    }

    for sparkline_id in &to_delete {
        if let Some(out) = sp_map.get(&txn, sparkline_id.as_str())
            && let Some(sparkline) = read_sparkline_from_out(&out, &txn)
        {
            // Remove cell index
            let ikey = idx_key(sparkline.cell.row, sparkline.cell.col);
            sp_map.remove(&mut txn, &ikey);

            // Remove sparkline
            sp_map.remove(&mut txn, sparkline_id.as_str());

            // Clean up group membership
            if let Some(ref gid) = sparkline.group_id {
                let gkey = group_key(gid);
                if let Some(gout) = sp_map.get(&txn, &gkey)
                    && let Some(mut group) = read_group_from_out(&gout, &txn)
                {
                    group.sparkline_ids.retain(|id| id != sparkline_id);
                    if group.sparkline_ids.is_empty() {
                        sp_map.remove(&mut txn, &gkey);
                    } else {
                        write_group(&sp_map, &mut txn, &gkey, &group);
                    }
                }
            }
        }
    }
}

/// Clear all sparklines and groups for a sheet.
///
/// Called when a sheet is deleted.
pub fn clear_sparklines_for_sheet(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return,
    };

    // Collect all keys, then remove them
    let keys: Vec<String> = sp_map.iter(&txn).map(|(k, _)| k.to_string()).collect();
    for key in &keys {
        sp_map.remove(&mut txn, key.as_str());
    }
}

// =============================================================================
// Query Operations
// =============================================================================

/// Check if a cell has a sparkline (O(1) via cell index).
pub fn has_sparkline(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, row: u32, col: u32) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let txn = doc.transact();
    let sp_map = match get_sparklines_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    let key = idx_key(row, col);
    sp_map.get(&txn, &key).is_some()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Create a YrsStorage with one sheet and return (storage, sheet_id).
    fn storage_with_sheet() -> (YrsStorage, SheetId) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");
        (storage, sheet_id)
    }

    fn default_visual() -> SparklineVisualSettings {
        SparklineVisualSettings {
            color: "#4285F4".to_string(),
            negative_color: None,
            show_markers: None,
            marker_color: None,
            high_point_color: None,
            low_point_color: None,
            first_point_color: None,
            last_point_color: None,
            line_weight: None,
            column_gap: None,
            bar_gap: None,
        }
    }

    fn default_axis() -> SparklineAxisSettings {
        SparklineAxisSettings {
            min_value: AxisBound::Label(AxisBoundLabel::Auto),
            max_value: AxisBound::Label(AxisBoundLabel::Auto),
            show_axis: None,
            axis_color: None,
            display_empty_cells: EmptyCellDisplay::Gaps,
            right_to_left: None,
        }
    }

    fn make_sparkline(id: &str, sheet_id: &str, row: u32, col: u32) -> Sparkline {
        Sparkline {
            id: id.to_string(),
            sheet_id: sheet_id.to_string(),
            cell: SparklineCellAddress {
                sheet_id: sheet_id.to_string(),
                row,
                col,
            },
            data_range: SparklineDataRange {
                start_row: row,
                start_col: col + 1,
                end_row: row,
                end_col: col + 5,
            },
            sparkline_type: SparklineType::Line,
            data_in_rows: true,
            group_id: None,
            visual: default_visual(),
            axis: default_axis(),
            created_at: Some(1000),
            updated_at: Some(1000),
        }
    }

    fn make_group(id: &str, sheet_id: &str, sparkline_ids: Vec<&str>) -> SparklineGroup {
        SparklineGroup {
            id: id.to_string(),
            sheet_id: sheet_id.to_string(),
            sparkline_ids: sparkline_ids.into_iter().map(String::from).collect(),
            sparkline_type: SparklineType::Line,
            visual: default_visual(),
            axis: default_axis(),
            created_at: Some(1000),
            updated_at: Some(1000),
        }
    }

    fn sheet_hex(n: u128) -> String {
        format!("{:032x}", n)
    }

    // -------------------------------------------------------------------
    // Test 1: Add + get sparkline
    // -------------------------------------------------------------------

    #[test]
    fn test_add_and_get_sparkline() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);
        let sp = make_sparkline("sp-1", &hex, 0, 0);

        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp);

        let retrieved = get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1");
        assert!(retrieved.is_some());
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.id, "sp-1");
        assert_eq!(retrieved.cell.row, 0);
        assert_eq!(retrieved.cell.col, 0);
        assert_eq!(retrieved.sparkline_type, SparklineType::Line);
    }

    // -------------------------------------------------------------------
    // Test 2: Get sparkline at cell (O(1) via index)
    // -------------------------------------------------------------------

    #[test]
    fn test_get_sparkline_at_cell() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);
        let sp = make_sparkline("sp-1", &hex, 3, 5);

        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp);

        let at_cell = get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 3, 5);
        assert!(at_cell.is_some());
        assert_eq!(at_cell.unwrap().id, "sp-1");

        // Different cell should return None
        assert!(get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 0, 0).is_none());
    }

    // -------------------------------------------------------------------
    // Test 3: Get sparklines in sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_get_sparklines_in_sheet() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-1", &hex, 0, 0),
        );
        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-2", &hex, 1, 0),
        );
        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-3", &hex, 2, 0),
        );

        let sparklines = get_sparklines_in_sheet(storage.doc(), &storage.sheets_ref(), &sid);
        assert_eq!(sparklines.len(), 3);
    }

    // -------------------------------------------------------------------
    // Test 4: Update sparkline (including cell position change)
    // -------------------------------------------------------------------

    #[test]
    fn test_update_sparkline_position_change() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);
        let sp = make_sparkline("sp-1", &hex, 0, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp);

        // Update to new position via SparklineUpdate
        let update = SparklineUpdate {
            cell: Some(SparklineCellAddress {
                sheet_id: hex.clone(),
                row: 5,
                col: 3,
            }),
            updated_at: Some(2000),
            ..Default::default()
        };

        let result = update_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1", &update);
        assert!(result);

        // Old position should not have sparkline
        assert!(get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 0, 0).is_none());

        // New position should have sparkline
        let at_new = get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 5, 3);
        assert!(at_new.is_some());
        assert_eq!(at_new.unwrap().updated_at, Some(2000));
    }

    // -------------------------------------------------------------------
    // Test 5: Delete sparkline (removes from index + group)
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_sparkline_removes_from_group() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp1 = make_sparkline("sp-1", &hex, 0, 0);
        let sp2 = make_sparkline("sp-2", &hex, 1, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp2);

        let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

        // Delete sp-1
        let result = delete_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1");
        assert!(result);

        // sp-1 should be gone
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").is_none());
        assert!(get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 0, 0).is_none());

        // Group should still exist but without sp-1
        let g = get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1").unwrap();
        assert_eq!(g.sparkline_ids, vec!["sp-2".to_string()]);
    }

    // -------------------------------------------------------------------
    // Test 6: Add + get group
    // -------------------------------------------------------------------

    #[test]
    fn test_add_and_get_group() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp1 = make_sparkline("sp-1", &hex, 0, 0);
        let sp2 = make_sparkline("sp-2", &hex, 1, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp2);

        let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

        let retrieved = get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1");
        assert!(retrieved.is_some());
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.id, "g-1");
        assert_eq!(retrieved.sparkline_ids.len(), 2);

        // Member sparklines should have group_id set
        let sp = get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").unwrap();
        assert_eq!(sp.group_id, Some("g-1".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 7: Delete group with sparklines
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_group_with_sparklines() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp1 = make_sparkline("sp-1", &hex, 0, 0);
        let sp2 = make_sparkline("sp-2", &hex, 1, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp2);

        let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

        let result =
            delete_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1", true);
        assert!(result);

        // Group should be gone
        assert!(get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1").is_none());

        // Sparklines should also be gone
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").is_none());
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-2").is_none());

        // Cell index should also be cleaned up
        assert!(!has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));
        assert!(!has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            1,
            0
        ));
    }

    // -------------------------------------------------------------------
    // Test 8: Delete group without deleting sparklines
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_group_keep_sparklines() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp1 = make_sparkline("sp-1", &hex, 0, 0);
        let sp2 = make_sparkline("sp-2", &hex, 1, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp2);

        let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

        let result =
            delete_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1", false);
        assert!(result);

        // Group should be gone
        assert!(get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1").is_none());

        // Sparklines should still exist, without group_id
        let sp = get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").unwrap();
        assert!(sp.group_id.is_none());

        let sp = get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-2").unwrap();
        assert!(sp.group_id.is_none());

        // Cell index should still work
        assert!(has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));
        assert!(has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            1,
            0
        ));
    }

    // -------------------------------------------------------------------
    // Test 9: Clear sparklines in range
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_sparklines_in_range() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        // Add sparklines at rows 0-4
        for i in 0..5 {
            add_sparkline(
                storage.doc(),
                &storage.sheets_ref(),
                &sid,
                &make_sparkline(&format!("sp-{}", i), &hex, i, 0),
            );
        }

        // Clear range covering rows 1-3
        let range = CellRange::new(1, 0, 3, 0);
        clear_sparklines_in_range(storage.doc(), &storage.sheets_ref(), &sid, &range);

        // sp-0 and sp-4 should remain
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-0").is_some());
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-4").is_some());

        // sp-1, sp-2, sp-3 should be gone
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").is_none());
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-2").is_none());
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-3").is_none());

        // Total should be 2
        assert_eq!(
            get_sparklines_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).len(),
            2
        );
    }

    // -------------------------------------------------------------------
    // Test 10: Clear sparklines for sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_sparklines_for_sheet() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-1", &hex, 0, 0),
        );
        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-2", &hex, 1, 0),
        );

        let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

        clear_sparklines_for_sheet(storage.doc(), &storage.sheets_ref(), &sid);

        assert!(get_sparklines_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty());
        assert!(
            get_sparkline_groups_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty()
        );
        assert!(!has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));
    }

    // -------------------------------------------------------------------
    // Test 11: Has sparkline check
    // -------------------------------------------------------------------

    #[test]
    fn test_has_sparkline() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        assert!(!has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));

        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-1", &hex, 0, 0),
        );

        assert!(has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));
        assert!(!has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            1,
            1
        ));
    }

    // -------------------------------------------------------------------
    // Test 12: Multiple sparklines in different cells
    // -------------------------------------------------------------------

    #[test]
    fn test_multiple_sparklines_different_cells() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-a", &hex, 0, 0),
        );
        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-b", &hex, 0, 1),
        );
        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-c", &hex, 1, 0),
        );
        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline("sp-d", &hex, 1, 1),
        );

        assert!(has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));
        assert!(has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            1
        ));
        assert!(has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            1,
            0
        ));
        assert!(has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            1,
            1
        ));
        assert!(!has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            2,
            0
        ));

        assert_eq!(
            get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 0, 0)
                .unwrap()
                .id,
            "sp-a"
        );
        assert_eq!(
            get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 0, 1)
                .unwrap()
                .id,
            "sp-b"
        );
        assert_eq!(
            get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 1, 0)
                .unwrap()
                .id,
            "sp-c"
        );
        assert_eq!(
            get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 1, 1)
                .unwrap()
                .id,
            "sp-d"
        );
    }

    // -------------------------------------------------------------------
    // Test 13: Empty sheet returns empty
    // -------------------------------------------------------------------

    #[test]
    fn test_empty_sheet_returns_empty() {
        let (storage, sid) = storage_with_sheet();

        assert!(get_sparklines_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty());
        assert!(
            get_sparkline_groups_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty()
        );
        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "nonexistent").is_none());
        assert!(get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 0, 0).is_none());
        assert!(!has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));
    }

    // -------------------------------------------------------------------
    // Test 14: Sparkline group membership
    // -------------------------------------------------------------------

    #[test]
    fn test_sparkline_group_membership() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp1 = make_sparkline("sp-1", &hex, 0, 0);
        let sp2 = make_sparkline("sp-2", &hex, 1, 0);
        let sp3 = make_sparkline("sp-3", &hex, 2, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp2);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp3);

        // Group sp-1 and sp-2
        let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

        // sp-1 and sp-2 should have group_id
        assert_eq!(
            get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1")
                .unwrap()
                .group_id,
            Some("g-1".to_string())
        );
        assert_eq!(
            get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-2")
                .unwrap()
                .group_id,
            Some("g-1".to_string())
        );

        // sp-3 should not have group_id
        assert!(
            get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-3")
                .unwrap()
                .group_id
                .is_none()
        );
    }

    // -------------------------------------------------------------------
    // Test 15: Delete last sparkline in group removes group
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_last_sparkline_in_group_removes_group() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp1 = make_sparkline("sp-1", &hex, 0, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);

        let group = make_group("g-1", &hex, vec!["sp-1"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

        // Group should exist
        assert!(get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1").is_some());

        // Delete the only sparkline in the group
        delete_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1");

        // Group should be auto-deleted since it's now empty
        assert!(get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1").is_none());
    }

    // -------------------------------------------------------------------
    // Test 16: Update sparkline without position change
    // -------------------------------------------------------------------

    #[test]
    fn test_update_sparkline_no_position_change() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp = make_sparkline("sp-1", &hex, 0, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp);

        let update = SparklineUpdate {
            sparkline_type: Some(SparklineType::Column),
            visual: Some(SparklineVisualSettings {
                color: "#FF0000".to_string(),
                ..Default::default()
            }),
            ..Default::default()
        };

        let result = update_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1", &update);
        assert!(result);

        let retrieved = get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").unwrap();
        assert_eq!(retrieved.sparkline_type, SparklineType::Column);
        assert_eq!(retrieved.visual.color, "#FF0000");

        // Cell index should still work
        assert!(has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));
        assert_eq!(
            get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 0, 0)
                .unwrap()
                .id,
            "sp-1"
        );
    }

    // -------------------------------------------------------------------
    // Test 17: Update nonexistent sparkline returns false
    // -------------------------------------------------------------------

    #[test]
    fn test_update_nonexistent_sparkline() {
        let (storage, sid) = storage_with_sheet();

        let update = SparklineUpdate {
            visual: Some(SparklineVisualSettings {
                color: "#FF0000".to_string(),
                ..Default::default()
            }),
            ..Default::default()
        };

        let result = update_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1", &update);
        assert!(!result);
    }

    // -------------------------------------------------------------------
    // Test 18: Delete nonexistent sparkline returns false
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_nonexistent_sparkline() {
        let (storage, sid) = storage_with_sheet();

        let result = delete_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "nonexistent");
        assert!(!result);
    }

    // -------------------------------------------------------------------
    // Test 19: Delete nonexistent group returns false
    // -------------------------------------------------------------------

    #[test]
    fn test_delete_nonexistent_group() {
        let (storage, sid) = storage_with_sheet();

        let result = delete_sparkline_group(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            "nonexistent",
            true,
        );
        assert!(!result);
    }

    // -------------------------------------------------------------------
    // Test 20: Get sparkline groups in sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_get_sparkline_groups_in_sheet() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp1 = make_sparkline("sp-1", &hex, 0, 0);
        let sp2 = make_sparkline("sp-2", &hex, 1, 0);
        let sp3 = make_sparkline("sp-3", &hex, 2, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp2);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp3);

        let g1 = make_group("g-1", &hex, vec!["sp-1"]);
        let g2 = make_group("g-2", &hex, vec!["sp-2", "sp-3"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &g1);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &g2);

        let groups = get_sparkline_groups_in_sheet(storage.doc(), &storage.sheets_ref(), &sid);
        assert_eq!(groups.len(), 2);
    }

    // -------------------------------------------------------------------
    // Test 21: Sparkline serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_sparkline_serde_roundtrip() {
        let sp = Sparkline {
            id: "sp-test".to_string(),
            sheet_id: "sheet-1".to_string(),
            cell: SparklineCellAddress {
                sheet_id: "sheet-1".to_string(),
                row: 5,
                col: 3,
            },
            data_range: SparklineDataRange {
                start_row: 5,
                start_col: 4,
                end_row: 5,
                end_col: 10,
            },
            sparkline_type: SparklineType::Column,
            data_in_rows: false,
            group_id: Some("g-1".to_string()),
            visual: SparklineVisualSettings {
                color: "#4285F4".to_string(),
                negative_color: Some("#EA4335".to_string()),
                show_markers: Some(true),
                marker_color: Some("#000000".to_string()),
                high_point_color: None,
                low_point_color: None,
                first_point_color: None,
                last_point_color: None,
                line_weight: Some(1.5),
                column_gap: Some(0.2),
                bar_gap: None,
            },
            axis: SparklineAxisSettings {
                min_value: AxisBound::Value(0.0),
                max_value: AxisBound::Label(AxisBoundLabel::Auto),
                show_axis: Some(true),
                axis_color: Some("#CCCCCC".to_string()),
                display_empty_cells: EmptyCellDisplay::Zero,
                right_to_left: Some(false),
            },
            created_at: Some(1700000000000),
            updated_at: Some(1700000000001),
        };

        let json = serde_json::to_string(&sp).unwrap();
        let deserialized: Sparkline = serde_json::from_str(&json).unwrap();
        assert_eq!(sp, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 22: SparklineGroup serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_sparkline_group_serde_roundtrip() {
        let group = SparklineGroup {
            id: "g-test".to_string(),
            sheet_id: "sheet-1".to_string(),
            sparkline_ids: vec!["sp-1".to_string(), "sp-2".to_string()],
            sparkline_type: SparklineType::WinLoss,
            visual: default_visual(),
            axis: default_axis(),
            created_at: Some(1000),
            updated_at: Some(2000),
        };

        let json = serde_json::to_string(&group).unwrap();
        let deserialized: SparklineGroup = serde_json::from_str(&json).unwrap();
        assert_eq!(group, deserialized);
    }

    // -------------------------------------------------------------------
    // Test 23: Clear sparklines in range also cleans group membership
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_range_cleans_group() {
        let (storage, sid) = storage_with_sheet();
        let hex = sheet_hex(1);

        let sp1 = make_sparkline("sp-1", &hex, 0, 0);
        let sp2 = make_sparkline("sp-2", &hex, 1, 0);
        let sp3 = make_sparkline("sp-3", &hex, 2, 0);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp2);
        add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp3);

        let group = make_group("g-1", &hex, vec!["sp-1", "sp-2", "sp-3"]);
        add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

        // Clear range covering only sp-1 at (0,0)
        let range = CellRange::new(0, 0, 0, 0);
        clear_sparklines_in_range(storage.doc(), &storage.sheets_ref(), &sid, &range);

        // Group should still exist but without sp-1
        let g = get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1").unwrap();
        assert_eq!(g.sparkline_ids.len(), 2);
        assert!(!g.sparkline_ids.contains(&"sp-1".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 24: Nonexistent sheet operations do not panic
    // -------------------------------------------------------------------

    #[test]
    fn test_nonexistent_sheet_operations() {
        let storage = YrsStorage::new();
        let sid = make_sheet_id(999);

        assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").is_none());
        assert!(get_sparkline_at_cell(storage.doc(), &storage.sheets_ref(), &sid, 0, 0).is_none());
        assert!(get_sparklines_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty());
        assert!(
            get_sparkline_groups_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty()
        );
        assert!(!has_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            0,
            0
        ));
        assert!(!delete_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            "sp-1"
        ));
        assert!(!delete_sparkline_group(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            "g-1",
            true
        ));
        assert!(!update_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            "sp-1",
            &SparklineUpdate::default()
        ));

        // Range operations on nonexistent sheet should not panic
        let range = CellRange::new(0, 0, 5, 5);
        clear_sparklines_in_range(storage.doc(), &storage.sheets_ref(), &sid, &range);
        clear_sparklines_for_sheet(storage.doc(), &storage.sheets_ref(), &sid);
    }

    // -------------------------------------------------------------------
    // Test 25: AxisBound serde roundtrip (all variants)
    // -------------------------------------------------------------------

    #[test]
    fn test_axis_bound_serde_roundtrip() {
        // Auto
        let auto = AxisBound::Label(AxisBoundLabel::Auto);
        let json = serde_json::to_string(&auto).unwrap();
        let parsed: AxisBound = serde_json::from_str(&json).unwrap();
        assert_eq!(auto, parsed);

        // Same
        let same = AxisBound::Label(AxisBoundLabel::Same);
        let json = serde_json::to_string(&same).unwrap();
        let parsed: AxisBound = serde_json::from_str(&json).unwrap();
        assert_eq!(same, parsed);

        // Value
        let val = AxisBound::Value(42.5);
        let json = serde_json::to_string(&val).unwrap();
        let parsed: AxisBound = serde_json::from_str(&json).unwrap();
        assert_eq!(val, parsed);
    }
}
