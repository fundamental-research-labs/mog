//! Authored workbook sheet order.

use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use value_types::ComputeError;

pub(crate) fn get_sheet_order(storage: &WorkbookStorage) -> Vec<SheetId> {
    storage.sheet_order()
}

/// Move a sheet to a clamped position. Returns whether the order changed.
pub(crate) fn move_sheet(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    new_index: u32,
) -> bool {
    crate::storage::engine::history::metadata::capture_workbook_field!(storage, sheet_order);
    let order = &mut storage.metadata.sheet_order;
    let Some(from) = order.iter().position(|id| id == sheet_id) else {
        return false;
    };
    let to = (new_index as usize).min(order.len().saturating_sub(1));
    if from == to {
        return false;
    }
    let id = order.remove(from);
    order.insert(to, id);
    true
}

/// Validate the complete replacement before changing the authored order.
pub(crate) fn reorder_sheets(
    storage: &mut WorkbookStorage,
    new_order: &[SheetId],
) -> Result<(), ComputeError> {
    let current = &storage.metadata.sheet_order;
    if current.len() != new_order.len() {
        return Err(ComputeError::Eval {
            message: format!(
                "reorder: new order length ({}) must match current ({})",
                new_order.len(),
                current.len()
            ),
        });
    }
    let current_set: std::collections::HashSet<_> = current.iter().collect();
    let mut seen = std::collections::HashSet::new();
    for id in new_order {
        if !current_set.contains(id) {
            return Err(ComputeError::SheetNotFound {
                sheet_id: id.to_uuid_string(),
            });
        }
        if !seen.insert(id) {
            return Err(ComputeError::Eval {
                message: "reorder: duplicate sheet IDs in new order".into(),
            });
        }
    }
    crate::storage::engine::history::metadata::capture_workbook_field!(storage, sheet_order);
    storage.metadata.sheet_order = new_order.to_vec();
    Ok(())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::CellMirror;
    use crate::storage::WorkbookStorage;
    use crate::storage::sheet::test_support::make_sheet_id;

    #[test]
    fn test_get_sheet_order() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "C", 10, 5).unwrap();

        let order = get_sheet_order(&storage);
        assert_eq!(order, vec![s1, s2, s3]);
    }

    #[test]
    fn test_move_sheet() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "C", 10, 5).unwrap();

        // Move s1 to end
        assert!(move_sheet(&mut storage, &s1, 2));
        assert_eq!(get_sheet_order(&storage), vec![s2, s3, s1]);

        // Move nonexistent
        assert!(!move_sheet(&mut storage, &make_sheet_id(999), 0));
    }

    #[test]
    fn test_reorder_sheets() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s3, "C", 10, 5).unwrap();

        reorder_sheets(&mut storage, &[s3, s1, s2]).unwrap();
        assert_eq!(get_sheet_order(&storage), vec![s3, s1, s2]);
    }

    #[test]
    fn test_reorder_sheets_wrong_length() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        let result = reorder_sheets(&mut storage, &[s1]);
        assert!(result.is_err());
    }

    #[test]
    fn test_move_sheet_same_position() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        assert!(!move_sheet(&mut storage, &s1, 0));
    }

    #[test]
    fn test_reorder_duplicate_ids_fails() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        let result = reorder_sheets(&mut storage, &[s1, s1]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reorder_unknown_sheet_fails() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        let result = reorder_sheets(&mut storage, &[s1, make_sheet_id(999)]);
        assert!(result.is_err());
    }

    #[test]
    fn test_reorder_same_order_noop() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        storage.add_sheet(&mut mirror, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut mirror, s2, "B", 10, 5).unwrap();

        reorder_sheets(&mut storage, &[s1, s2]).unwrap();
        assert_eq!(get_sheet_order(&storage), vec![s1, s2]);
    }
}
