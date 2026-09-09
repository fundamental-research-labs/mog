use cell_types::{CellId, SheetPos};
use value_types::CellValue;

use crate::cells::types::CellEntry;

use super::helpers::make_store;

#[test]
fn vacate_position_clears_position_state_without_deleting_cell() {
    let (mut cell_store, sheet_id) = make_store();
    let cell_id = CellId::from_raw(700);
    let old_pos = SheetPos::new(2, 4);
    let new_pos = SheetPos::new(3, 4);
    cell_store.insert_cell(
        &sheet_id,
        cell_id,
        old_pos,
        CellEntry {
            value: CellValue::number(12.0),
        },
    );
    assert!(cell_store.move_cell(&cell_id, &sheet_id, new_pos));

    cell_store.vacate_position(&sheet_id, old_pos);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert!(!sheet.authored_cell_id_at(old_pos).is_some());
    assert_eq!(sheet.position_of(&cell_id).as_ref(), Some(&new_pos));
    assert!(sheet.cells.contains_key(&cell_id));
    assert_eq!(sheet.get_column_view(4).unwrap()[2], CellValue::Null);
}

#[test]
fn moving_identity_preserves_value_at_destination() {
    let (mut cell_store, sheet_id) = make_store();
    let cell_id = CellId::from_raw(701);
    let pos = SheetPos::new(6, 8);
    cell_store.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 0),
        CellEntry {
            value: CellValue::from("cached"),
        },
    );

    assert!(cell_store.move_cell(&cell_id, &sheet_id, pos));

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.authored_cell_id_at(pos).as_ref(), Some(&cell_id));
    assert_eq!(sheet.position_of(&cell_id).as_ref(), Some(&pos));
    assert_eq!(
        sheet.get_column_view(8).unwrap()[6],
        CellValue::from("cached")
    );
}
