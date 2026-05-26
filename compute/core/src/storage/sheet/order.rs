//! Sheet ordering — read, move, reorder sheet IDs in `workbook/sheetOrder`.

use std::sync::Arc;

use yrs::{Any, Array, Doc, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;

use super::yrs_helpers::{get_sheet_order_array, read_sheet_order};

/// Get ordered list of sheet IDs (reads from workbook/sheetOrder array).
pub(crate) fn get_sheet_order(doc: &Doc, workbook: &MapRef) -> Vec<SheetId> {
    let txn = doc.transact();
    read_sheet_order(workbook, &txn)
}

/// Move a sheet to a new position in the order.
/// Returns `true` if moved, `false` if sheet not found or same position.
pub(crate) fn move_sheet(doc: &Doc, workbook: &MapRef, sheet_id: &SheetId, new_index: u32) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let Some(order_arr) = get_sheet_order_array(workbook, &txn) else {
        return false;
    };
    let len = order_arr.len(&txn);

    // Find current index
    let mut from_index = None;
    for i in 0..len {
        if let Some(Out::Any(Any::String(s))) = order_arr.get(&txn, i)
            && *s == *sheet_hex
        {
            from_index = Some(i);
            break;
        }
    }

    let from_index = match from_index {
        Some(i) => i,
        None => return false,
    };

    let clamped = new_index.min(len.saturating_sub(1));
    if from_index == clamped {
        return false;
    }

    // Remove from old position, insert at new
    order_arr.remove(&mut txn, from_index);
    order_arr.insert(
        &mut txn,
        clamped,
        Any::String(Arc::from(sheet_hex.as_str())),
    );
    true
}

/// Reorder all sheets. The new order must contain exactly the same sheets.
pub(crate) fn reorder_sheets(
    doc: &Doc,
    workbook: &MapRef,
    new_order: &[SheetId],
) -> Result<(), ComputeError> {
    let txn_r = doc.transact();
    let current = read_sheet_order(workbook, &txn_r);
    drop(txn_r);

    if current.len() != new_order.len() {
        return Err(ComputeError::Eval {
            message: format!(
                "reorder: new order length ({}) must match current ({})",
                new_order.len(),
                current.len()
            ),
        });
    }

    let current_set: std::collections::HashSet<u128> =
        current.iter().map(|s| s.as_u128()).collect();
    let mut new_set = std::collections::HashSet::new();
    for sid in new_order {
        if !current_set.contains(&sid.as_u128()) {
            return Err(ComputeError::SheetNotFound {
                sheet_id: id_to_hex(sid.as_u128()).to_string(),
            });
        }
        if !new_set.insert(sid.as_u128()) {
            return Err(ComputeError::Eval {
                message: "reorder: duplicate sheet IDs in new order".to_string(),
            });
        }
    }

    // Check if unchanged
    if current
        .iter()
        .zip(new_order.iter())
        .all(|(a, b)| a.as_u128() == b.as_u128())
    {
        return Ok(());
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let Some(order_arr) = get_sheet_order_array(workbook, &txn) else {
        return Ok(());
    };
    let len = order_arr.len(&txn);

    // Clear
    for _ in 0..len {
        order_arr.remove(&mut txn, 0);
    }

    // Repopulate
    for sid in new_order {
        let hex = id_to_hex(sid.as_u128());
        order_arr.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
    }

    Ok(())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::CellMirror;
    use crate::storage::YrsStorage;
    use crate::storage::sheet::test_support::make_sheet_id;

    #[test]
    fn test_get_sheet_order() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "C", 10, 5).unwrap();

        let order = get_sheet_order(storage.doc(), storage.workbook_map());
        assert_eq!(order, vec![s1, s2, s3]);
    }

    #[test]
    fn test_move_sheet() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "C", 10, 5).unwrap();

        // Move s1 to end
        assert!(move_sheet(storage.doc(), storage.workbook_map(), &s1, 2));
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()),
            vec![s2, s3, s1]
        );

        // Move nonexistent
        assert!(!move_sheet(
            storage.doc(),
            storage.workbook_map(),
            &make_sheet_id(999),
            0
        ));
    }

    #[test]
    fn test_reorder_sheets() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "C", 10, 5).unwrap();

        reorder_sheets(storage.doc(), storage.workbook_map(), &[s3, s1, s2]).unwrap();
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()),
            vec![s3, s1, s2]
        );
    }

    #[test]
    fn test_reorder_sheets_wrong_length() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        let result = reorder_sheets(storage.doc(), storage.workbook_map(), &[s1]);
        assert!(result.is_err());
    }

    #[test]
    fn test_move_sheet_same_position() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        assert!(!move_sheet(storage.doc(), storage.workbook_map(), &s1, 0));
    }

    #[test]
    fn test_reorder_duplicate_ids_fails() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        let result = reorder_sheets(storage.doc(), storage.workbook_map(), &[s1, s1]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reorder_unknown_sheet_fails() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        let result = reorder_sheets(
            storage.doc(),
            storage.workbook_map(),
            &[s1, make_sheet_id(999)],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_reorder_same_order_noop() {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        reorder_sheets(storage.doc(), storage.workbook_map(), &[s1, s2]).unwrap();
        assert_eq!(
            get_sheet_order(storage.doc(), storage.workbook_map()),
            vec![s1, s2]
        );
    }
}
