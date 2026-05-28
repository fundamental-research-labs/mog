use cell_types::{CellId, SheetPos};
use value_types::CellValue;

use crate::mirror::types::CellEntry;

use super::helpers::make_mirror;

#[test]
fn col_version_returns_zero_for_untracked() {
    let (mirror, sheet_id) = make_mirror();
    assert_eq!(mirror.col_version(&sheet_id, 0), 0);
    assert_eq!(mirror.col_version(&sheet_id, 99), 0);
}

#[test]
fn insert_cell_bumps_col_version() {
    let (mut mirror, sheet_id) = make_mirror();
    assert_eq!(mirror.col_version(&sheet_id, 3), 0);

    let cell_id = CellId::from_raw(10);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 3),
        CellEntry {
            value: CellValue::number(1.0),
            formula: None,
        },
    );
    assert_eq!(mirror.col_version(&sheet_id, 3), 1);
}

#[test]
fn set_value_mut_bumps_col_version() {
    let (mut mirror, sheet_id) = make_mirror();
    let cell_id = CellId::from_raw(20);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 5),
        CellEntry {
            value: CellValue::number(1.0),
            formula: None,
        },
    );
    let v_after_insert = mirror.col_version(&sheet_id, 5);

    mirror.set_value_mut(&cell_id, CellValue::number(2.0));
    assert_eq!(mirror.col_version(&sheet_id, 5), v_after_insert + 1);
}

#[test]
fn remove_cell_bumps_col_version() {
    let (mut mirror, sheet_id) = make_mirror();
    let cell_id = CellId::from_raw(30);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 7),
        CellEntry {
            value: CellValue::number(1.0),
            formula: None,
        },
    );
    let v_after_insert = mirror.col_version(&sheet_id, 7);

    mirror.remove_cell(&cell_id);
    assert_eq!(mirror.col_version(&sheet_id, 7), v_after_insert + 1);
}

#[test]
fn apply_edit_bumps_col_version() {
    let (mut mirror, sheet_id) = make_mirror();
    assert_eq!(mirror.col_version(&sheet_id, 2), 0);

    let cell_id = CellId::from_raw(40);
    mirror.apply_edit(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 2),
        CellValue::number(99.0),
        None,
    );
    assert_eq!(mirror.col_version(&sheet_id, 2), 1);
}

#[test]
fn insert_cell_creates_col_data_for_new_column() {
    let (mut mirror, sheet_id) = make_mirror();
    // Column 20 has no col_data entry initially
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(!sheet.col_data.contains_key(&20));

    let cell_id = CellId::from_raw(100);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(5, 20),
        CellEntry {
            value: CellValue::number(42.0),
            formula: None,
        },
    );

    // col_data should now exist for column 20
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(sheet.col_data.contains_key(&20));
    let col_vec = &sheet.col_data[&20];
    assert_eq!(col_vec[5], CellValue::number(42.0));
}

#[test]
fn set_value_mut_creates_col_data_for_new_column() {
    let (mut mirror, sheet_id) = make_mirror();
    // Insert a cell into a column that has no col_data
    let cell_id = CellId::from_raw(101);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(3, 25),
        CellEntry {
            value: CellValue::number(1.0),
            formula: None,
        },
    );
    // col_data should exist now (from insert_cell fix)
    // Verify set_value_mut also works on it
    mirror.set_value_mut(&cell_id, CellValue::number(99.0));
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.col_data[&25][3], CellValue::number(99.0));
}

#[test]
fn apply_edit_creates_col_data_for_new_column() {
    let (mut mirror, sheet_id) = make_mirror();
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(!sheet.col_data.contains_key(&30));

    let cell_id = CellId::from_raw(102);
    mirror.apply_edit(
        &sheet_id,
        cell_id,
        SheetPos::new(2, 30),
        CellValue::number(77.0),
        None,
    );

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(sheet.col_data.contains_key(&30));
    assert_eq!(sheet.col_data[&30][2], CellValue::number(77.0));
}

#[test]
fn writing_col_a_does_not_affect_col_b() {
    let (mut mirror, sheet_id) = make_mirror();
    let cell_id = CellId::from_raw(50);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 0),
        CellEntry {
            value: CellValue::number(1.0),
            formula: None,
        },
    );
    assert_eq!(mirror.col_version(&sheet_id, 0), 1);
    assert_eq!(mirror.col_version(&sheet_id, 1), 0);
}

/// Reproduces a known bug: when `apply_edit` moves a CellId from position A
/// to position B, the stale `pos_to_id[A]` entry is NOT removed. This causes
/// two positions to resolve to the same CellId, so rendering position A
/// returns position B's value.
///
/// CORRECT behavior: `apply_edit` should detect that `cell_id` already exists
/// at a different position (via `id_to_pos`) and remove the old `pos_to_id`
/// entry (and clear the old `col_data` slot). Until that fix lands, this test
/// asserts the BUGGY behavior to document the issue.
#[test]
fn test_apply_edit_stale_pos_to_id_after_move() {
    use crate::projection::CellRender;

    let (mut mirror, sheet_id) = make_mirror();
    let cell_id = CellId::from_raw(500);

    // Step 1: Insert cell at position A (row=2, col=1) with value "hello"
    let pos_a = SheetPos::new(2, 1);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        pos_a,
        CellEntry {
            value: CellValue::from("hello"),
            formula: None,
        },
    );

    // Sanity: pos_a resolves to our cell_id
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.pos_to_id.get(&pos_a), Some(&cell_id));
    assert_eq!(sheet.id_to_pos.get(&cell_id), Some(&pos_a));

    // Step 2: apply_edit with the SAME cell_id but at position B (row=15, col=12)
    let pos_b = SheetPos::new(15, 12);
    mirror.apply_edit(&sheet_id, cell_id, pos_b, CellValue::from("world"), None);

    // id_to_pos correctly points to the new position B
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.id_to_pos.get(&cell_id), Some(&pos_b));

    // BUG: pos_to_id at position A still resolves to cell_id (stale entry).
    // The correct behavior would be: pos_to_id should NOT contain pos_a anymore.
    assert_eq!(
        sheet.pos_to_id.get(&pos_a),
        Some(&cell_id),
        "BUG: stale pos_to_id entry at old position A still points to the moved cell"
    );

    // BUG (user-visible): cell_render_at at position A returns "world" (the
    // moved cell's current value) instead of Empty.
    // Correct behavior: cell_render_at(pos_a) should return CellRender::Empty.
    match mirror.cell_render_at(&sheet_id, pos_a.row(), pos_a.col()) {
        CellRender::Plain(view) => {
            assert_eq!(view.cell_id, cell_id);
            assert_eq!(
                *view.value,
                CellValue::from("world"),
                "BUG: old position A renders the moved cell's new value 'world'"
            );
        }
        other => panic!(
            "Expected CellRender::Plain (buggy stale render), got {:?}",
            other
        ),
    }
}
