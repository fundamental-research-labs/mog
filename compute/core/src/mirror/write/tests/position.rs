use cell_types::{CellId, SheetPos};
use value_types::CellValue;

use crate::mirror::types::CellEntry;

use super::helpers::make_mirror;

#[test]
fn vacate_position_clears_position_state_without_deleting_cell() {
    let (mut mirror, sheet_id) = make_mirror();
    let cell_id = CellId::from_raw(700);
    let old_pos = SheetPos::new(2, 4);
    let new_pos = SheetPos::new(3, 4);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        old_pos,
        CellEntry {
            value: CellValue::number(12.0),
            formula: None,
        },
    );
    mirror.update_id_to_pos(&sheet_id, cell_id, new_pos);

    mirror.vacate_position(&sheet_id, old_pos);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(!sheet.pos_to_id.contains_key(&old_pos));
    assert_eq!(sheet.id_to_pos.get(&cell_id), Some(&new_pos));
    assert!(sheet.cells.contains_key(&cell_id));
    assert_eq!(sheet.col_data[&4][2], CellValue::Null);
}

#[test]
fn sync_cell_position_mapping_restores_position_and_col_data() {
    let (mut mirror, sheet_id) = make_mirror();
    let cell_id = CellId::from_raw(701);
    let pos = SheetPos::new(6, 8);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 0),
        CellEntry {
            value: CellValue::from("cached"),
            formula: None,
        },
    );

    mirror.sync_cell_position_mapping(&sheet_id, cell_id, pos);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.pos_to_id.get(&pos), Some(&cell_id));
    assert_eq!(sheet.id_to_pos.get(&cell_id), Some(&pos));
    assert_eq!(sheet.col_data[&8][6], CellValue::from("cached"));
}
