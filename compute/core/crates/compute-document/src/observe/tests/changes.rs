use super::super::{CellChange, CellChangeKind, DocumentChanges, PropertyCellChange};
use super::fixtures::{make_cell_id, make_sheet_id};

#[test]
fn test_document_changes_is_empty() {
    let dc = DocumentChanges::default();
    assert!(dc.is_empty());
    assert!(!dc.has_non_cell_changes());
}

#[test]
fn test_document_changes_has_non_cell_changes() {
    let mut dc = DocumentChanges::default();
    dc.cells.push(CellChange {
        sheet_id: make_sheet_id(1),
        cell_id: make_cell_id(1),
        kind: CellChangeKind::Modified,
        old_value: None,
    });
    assert!(!dc.is_empty());
    assert!(!dc.has_non_cell_changes());

    dc.properties.push(PropertyCellChange {
        sheet_id: make_sheet_id(1),
        cell_id: make_cell_id(1),
        kind: CellChangeKind::Modified,
    });
    assert!(dc.has_non_cell_changes());
}
