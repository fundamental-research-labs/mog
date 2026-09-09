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
fn insert_cell_creates_column_values_for_new_column() {
    let (mut mirror, sheet_id) = make_mirror();
    // Column 20 has no column_values entry initially
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(!sheet.get_column_view(20).is_some());

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

    // column_values should now exist for column 20
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(sheet.get_column_view(20).is_some());
    let col_vec = &sheet.get_column_view(20).unwrap();
    assert_eq!(col_vec[5], CellValue::number(42.0));
}

#[test]
fn set_value_mut_creates_column_values_for_new_column() {
    let (mut mirror, sheet_id) = make_mirror();
    // Insert a cell into a column that has no column_values
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
    // column_values should exist now (from insert_cell fix)
    // Verify set_value_mut also works on it
    mirror.set_value_mut(&cell_id, CellValue::number(99.0));
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(
        sheet.get_column_view(25).unwrap()[3],
        CellValue::number(99.0)
    );
}

#[test]
fn apply_edit_creates_column_values_for_new_column() {
    let (mut mirror, sheet_id) = make_mirror();
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(!sheet.get_column_view(30).is_some());

    let cell_id = CellId::from_raw(102);
    mirror.apply_edit(
        &sheet_id,
        cell_id,
        SheetPos::new(2, 30),
        CellValue::number(77.0),
        None,
    );

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(sheet.get_column_view(30).is_some());
    assert_eq!(
        sheet.get_column_view(30).unwrap()[2],
        CellValue::number(77.0)
    );
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

/// Moving an identity must remove its old position and invalidate that column.
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

    assert!(!sheet.pos_to_id.contains_key(&pos_a));
    assert!(matches!(
        mirror.cell_render_at(&sheet_id, pos_a.row(), pos_a.col()),
        CellRender::Empty
    ));
    assert_eq!(
        mirror.get_cell_value_at(&sheet_id, pos_b),
        Some(&CellValue::from("world"))
    );
}

#[test]
fn distant_cell_uses_sparse_storage_and_column_view_borrows_the_authority() {
    let (mut mirror, sheet_id) = make_mirror();
    let id = CellId::from_raw(900_001);
    let pos = SheetPos::new(1_000_000, 200);
    mirror.apply_edit(&sheet_id, id, pos, CellValue::from("sparse"), None);
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    let entry = sheet.get_cell(&id).unwrap();
    let column = sheet.get_column_view(200).unwrap();
    assert_eq!(column.len(), 1_000_001);
    assert!(std::ptr::eq(column.get(1_000_000).unwrap(), &entry.value));
    assert_eq!(column.get(999_999), Some(&CellValue::Null));
    assert!(sheet.generated_values.is_empty());
}

#[test]
fn authored_edit_releases_imported_payload_but_metadata_ghosts_preserve_it() {
    use crate::mirror::range_view::RangeView;
    use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId};
    use std::sync::Arc;

    let (mut mirror, sheet_id) = make_mirror();
    let row_id = RowId::from_raw(1);
    let col_id = ColId::from_raw(1);
    let range_id = RangeId::from_raw(1);
    let text: Arc<str> = Arc::from("original imported text");
    let original = Arc::downgrade(&text);
    let sheet = mirror.get_sheet_mut(&sheet_id).unwrap();
    sheet.row_axis = std::sync::Arc::new(compute_document::identity::AxisIndex::new(
        cell_types::AxisIdentityStore::Explicit(vec![row_id]),
    ));
    sheet.col_axis = std::sync::Arc::new(compute_document::identity::AxisIndex::new(
        cell_types::AxisIdentityStore::Explicit(vec![col_id]),
    ));
    sheet.range_views.insert(
        range_id,
        RangeView {
            range_id,
            kind: RangeKind::Data,
            anchor: RangeAnchor::Strict {
                row_ids: vec![row_id],
                col_ids: vec![col_id],
            },
            encoding: PayloadEncoding::MixedCbor,
            values: Arc::from([CellValue::Text(text)]),
            payload_cols: 1,
            row_offset_by_id: [(row_id, 0)].into_iter().collect(),
            col_offset_by_id: [(col_id, 0)].into_iter().collect(),
        },
    );
    sheet.rebuild_column_index();
    let id = CellId::from_raw(500);
    let pos = SheetPos::new(0, 0);
    mirror.register_identity_only(&sheet_id, pos, id);
    assert_eq!(
        mirror.get_cell_value(&id),
        Some(&CellValue::from("original imported text"))
    );
    mirror.remove_cell(&id);
    assert_eq!(
        mirror.get_cell_value_at(&sheet_id, pos),
        Some(&CellValue::from("original imported text"))
    );

    mirror.apply_edit(&sheet_id, id, pos, CellValue::from("edited"), None);
    assert!(
        original.upgrade().is_none(),
        "overwritten text must be released, not retained as history"
    );
    assert_eq!(mirror.get_cell_value(&id), Some(&CellValue::from("edited")));
    mirror.remove_cell(&id);
    assert_eq!(
        mirror.get_cell_value_at(&sheet_id, pos),
        Some(&CellValue::Null)
    );
}

#[test]
fn moving_between_sheets_transfers_ownership_and_invalidates_both_columns() {
    use crate::mirror::types::SheetMirror;
    use cell_types::SheetId;

    let (mut mirror, source_sheet) = make_mirror();
    let destination_sheet = SheetId::from_raw(999);
    mirror.add_sheet_mirror(
        destination_sheet,
        "Destination".into(),
        SheetMirror::new(destination_sheet, "Destination".into(), 10, 10),
    );
    let cell = CellId::from_raw(501);
    let source_pos = SheetPos::new(1, 2);
    let destination_pos = SheetPos::new(3, 4);
    mirror.apply_edit(
        &source_sheet,
        cell,
        source_pos,
        CellValue::from("moved"),
        None,
    );
    let source_version = mirror.col_version(&source_sheet, source_pos.col());
    let destination_version = mirror.col_version(&destination_sheet, destination_pos.col());
    assert!(mirror.move_cell(&cell, &destination_sheet, destination_pos));
    assert_eq!(mirror.sheet_for_cell(&cell), Some(destination_sheet));
    assert_eq!(
        mirror.get_cell_value(&cell),
        Some(&CellValue::from("moved"))
    );
    let source = mirror.get_sheet(&source_sheet).unwrap();
    assert!(!source.cells.contains_key(&cell));
    assert!(!source.id_to_pos.contains_key(&cell));
    assert!(!source.pos_to_id.contains_key(&source_pos));
    assert_eq!(
        mirror.col_version(&source_sheet, source_pos.col()),
        source_version + 1
    );
    assert_eq!(
        mirror.col_version(&destination_sheet, destination_pos.col()),
        destination_version + 1
    );
    assert!(!mirror.move_cell(&cell, &SheetId::from_raw(998), SheetPos::new(0, 0)));
    assert_eq!(
        mirror.get_cell_value(&cell),
        Some(&CellValue::from("moved"))
    );
}
