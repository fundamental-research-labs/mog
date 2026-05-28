use crate::mirror::test_helpers::{make_cell_id, make_sheet_id, mirror_with_grid};
use crate::mirror::{CellEdit, CellEntry, CellMirror};
use cell_types::SheetPos;
use value_types::{CellValue, FiniteF64};

#[test]
fn test_get_cell_value_across_sheets() {
    let (mirror, _) = mirror_with_grid();
    let cell_id = make_cell_id(100); // row=0, col=0
    let val = mirror.get_cell_value(&cell_id).unwrap();
    assert_eq!(*val, CellValue::Number(FiniteF64::must(0.0)));
}
#[test]
fn test_get_cell_value_in_sheet() {
    let (mirror, sheet_id) = mirror_with_grid();
    let cell_id = make_cell_id(111); // row=1, col=1
    let val = mirror.get_cell_value_in_sheet(&sheet_id, &cell_id).unwrap();
    assert_eq!(*val, CellValue::Number(FiniteF64::must(11.0)));
}
#[test]
fn test_get_cell_value_nonexistent() {
    let (mirror, _) = mirror_with_grid();
    let cell_id = make_cell_id(999);
    assert!(mirror.get_cell_value(&cell_id).is_none());
}
#[test]
fn test_set_value_mut() {
    let (mut mirror, _) = mirror_with_grid();
    let cell_id = make_cell_id(100);
    assert!(mirror.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(999.0))));
    assert_eq!(
        *mirror.get_cell_value(&cell_id).unwrap(),
        CellValue::Number(FiniteF64::must(999.0))
    );
}
#[test]
fn test_set_value_mut_nonexistent() {
    let (mut mirror, _) = mirror_with_grid();
    let cell_id = make_cell_id(999);
    assert!(!mirror.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(1.0))));
}
#[test]
fn test_set_formula() {
    let (mut mirror, _) = mirror_with_grid();
    let cell_id = make_cell_id(100);
    // set_formula now accepts Option<IdentityFormula>; use None for clearing
    assert!(mirror.set_formula(&cell_id, None));
    assert!(mirror.get_formula(&cell_id).is_none());
}
#[test]
fn test_set_formula_nonexistent() {
    let (mut mirror, _) = mirror_with_grid();
    let cell_id = make_cell_id(999);
    assert!(!mirror.set_formula(&cell_id, None));
}
#[test]
fn test_get_cell_value_at() {
    let (mirror, sheet_id) = mirror_with_grid();
    let val = mirror
        .get_cell_value_at(&sheet_id, SheetPos::new(2, 1))
        .unwrap();
    assert_eq!(*val, CellValue::Number(FiniteF64::must(21.0)));
}
#[test]
fn test_get_cell_value_at_empty() {
    let (mirror, sheet_id) = mirror_with_grid();
    // row=5 is outside our 3x3 grid
    assert!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(5, 0))
            .is_none()
    );
}
#[test]
fn test_resolve_cell_id() {
    let (mirror, sheet_id) = mirror_with_grid();
    let cell_id = mirror
        .resolve_cell_id(&sheet_id, SheetPos::new(1, 2))
        .unwrap();
    assert_eq!(cell_id, make_cell_id(112));
}
#[test]
fn test_resolve_position() {
    let (mirror, _) = mirror_with_grid();
    let cell_id = make_cell_id(121); // row=2, col=1
    let pos = mirror.resolve_position(&cell_id).unwrap();
    assert_eq!(pos, SheetPos::new(2, 1));
}
#[test]
fn test_insert_cell() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    let cell_id = make_cell_id(500);
    let entry = CellEntry {
        value: CellValue::Text("new cell".into()),
        formula: None,
    };
    mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(5, 5), entry);

    assert_eq!(
        *mirror.get_cell_value(&cell_id).unwrap(),
        CellValue::Text("new cell".into())
    );
    assert_eq!(
        mirror.resolve_position(&cell_id).unwrap(),
        SheetPos::new(5, 5)
    );
    assert_eq!(
        mirror
            .resolve_cell_id(&sheet_id, SheetPos::new(5, 5))
            .unwrap(),
        cell_id
    );
}
#[test]
fn test_remove_cell() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    let cell_id = make_cell_id(100);
    assert!(mirror.get_cell_value(&cell_id).is_some());
    assert!(mirror.resolve_position(&cell_id).is_some());

    mirror.remove_cell(&cell_id);

    assert!(mirror.get_cell_value(&cell_id).is_none());
    assert!(mirror.resolve_position(&cell_id).is_none());
    assert!(
        mirror
            .resolve_cell_id(&sheet_id, SheetPos::new(0, 0))
            .is_none()
    );
}
#[test]
fn test_remove_cell_nonexistent() {
    let (mut mirror, _) = mirror_with_grid();
    // Should not panic
    mirror.remove_cell(&make_cell_id(999));
}
#[test]
fn test_apply_edit() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    let cell_id = make_cell_id(600);
    // apply_edit formula param is now Option<IdentityFormula>; use None
    mirror.apply_edit(
        &sheet_id,
        cell_id,
        SheetPos::new(7, 3),
        CellValue::Boolean(true),
        None,
    );

    assert_eq!(
        *mirror.get_cell_value(&cell_id).unwrap(),
        CellValue::Boolean(true)
    );
    assert!(mirror.get_formula(&cell_id).is_none());
    assert_eq!(
        mirror.resolve_position(&cell_id).unwrap(),
        SheetPos::new(7, 3)
    );
}
#[test]
fn test_apply_edits_batch() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    let edits = vec![
        CellEdit {
            sheet: sheet_id,
            cell: make_cell_id(700),
            pos: SheetPos::new(4, 0),
            value: CellValue::Number(FiniteF64::must(1.0)),
            formula: None,
        },
        CellEdit {
            sheet: sheet_id,
            cell: make_cell_id(701),
            pos: SheetPos::new(4, 1),
            value: CellValue::Number(FiniteF64::must(2.0)),
            formula: None,
        },
        CellEdit {
            sheet: sheet_id,
            cell: make_cell_id(702),
            pos: SheetPos::new(4, 2),
            value: CellValue::Number(FiniteF64::must(3.0)),
            // CellEdit.formula is now Option<IdentityFormula>; use None
            formula: None,
        },
    ];

    mirror.apply_edits(&edits);

    assert_eq!(
        *mirror.get_cell_value(&make_cell_id(700)).unwrap(),
        CellValue::Number(FiniteF64::must(1.0))
    );
    assert_eq!(
        *mirror.get_cell_value(&make_cell_id(702)).unwrap(),
        CellValue::Number(FiniteF64::must(3.0))
    );
    // Formula is no longer stored in CellEntry (yrs doc is the authoritative source)
    assert!(mirror.get_formula(&make_cell_id(702)).is_none());
}
#[test]
fn test_insert_cell_overwrites() {
    let (mut mirror, sheet_id) = mirror_with_grid();
    let cell_id = make_cell_id(100); // Already at (0, 0)

    // Overwrite with new entry
    let entry = CellEntry {
        value: CellValue::Text("overwritten".into()),
        formula: None,
    };
    mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(0, 0), entry);

    assert_eq!(
        *mirror.get_cell_value(&cell_id).unwrap(),
        CellValue::Text("overwritten".into())
    );
    assert!(mirror.get_formula(&cell_id).is_none());
}
#[test]
fn test_apply_edit_to_nonexistent_sheet() {
    let mut mirror = CellMirror::new();
    // Should not panic — edit is silently ignored since sheet doesn't exist
    mirror.apply_edit(
        &make_sheet_id(999),
        make_cell_id(1),
        SheetPos::new(0, 0),
        CellValue::Null,
        None,
    );
    assert!(mirror.get_cell_value(&make_cell_id(1)).is_none());
}
#[test]
fn test_insert_cell_to_nonexistent_sheet() {
    let mut mirror = CellMirror::new();
    let entry = CellEntry {
        value: CellValue::Null,
        formula: None,
    };
    // Should not panic
    mirror.insert_cell(
        &make_sheet_id(999),
        make_cell_id(1),
        SheetPos::new(0, 0),
        entry,
    );
    assert!(mirror.get_cell_value(&make_cell_id(1)).is_none());
}
#[test]
fn test_default_trait() {
    let mirror = CellMirror::default();
    assert_eq!(mirror.sheet_ids().count(), 0);
}
#[test]
fn test_is_ghost_null_no_formula() {
    let entry = CellEntry {
        value: CellValue::Null,
        formula: None,
    };
    assert!(entry.is_ghost());
}
#[test]
fn test_is_ghost_null_with_formula() {
    // CellEntry.formula is now IdentityFormula; use a minimal one for this test
    let formula = formula_types::IdentityFormula {
        template: "1".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    let entry = CellEntry {
        value: CellValue::Null,
        formula: Some(Box::new(formula)),
    };
    assert!(!entry.is_ghost());
}
#[test]
fn test_is_ghost_number_no_formula() {
    let entry = CellEntry {
        value: CellValue::Number(FiniteF64::must(0.0)),
        formula: None,
    };
    assert!(!entry.is_ghost());
}
