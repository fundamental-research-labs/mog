use super::*;

// -----------------------------------------------------------------------
// Set cell with formula — recalc propagation
// -----------------------------------------------------------------------

#[test]
fn test_set_cell_formula_recalc() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let d1_id = cid(0x13);

    // Set D1 = C1 * 2
    let result = core
        .set_cell(&mut mirror, &sheet_id, d1_id, 0, 3, "=C1*2")
        .unwrap();

    // D1 should be 30 * 2 = 60
    let d1_val = core.get_cell_value(&mirror, &d1_id).unwrap();
    assert_eq!(*d1_val, CellValue::number(60.0));

    // D1 should be in changed cells
    assert!(
        result
            .changed_cells
            .iter()
            .any(|c| c.cell_id == d1_id.to_uuid_string())
    );
}

#[test]
fn test_set_cell_table_formula_without_region_returns_calc_error() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x30), 1, 1, "1000")
        .unwrap();

    let cases = [
        (cid(0x31), 1, 4, "=TABLE(B1,B2)"),
        (cid(0x32), 4, 4, "=TABLE(,B2)"),
        (cid(0x33), 5, 4, "=TABLE(B1,)"),
        (cid(0x34), 6, 4, "=TABLE(,)"),
    ];

    for (cell_id, row, col, formula) in cases {
        core.set_cell(&mut mirror, &sheet_id, cell_id, row, col, formula)
            .unwrap();

        assert_eq!(
            core.get_cell_value(&mirror, &cell_id),
            Some(&CellValue::Error(value_types::CellError::Calc, None)),
            "{formula} should remain an unsupported TABLE pseudo-function without a data-table region"
        );
    }
}

#[test]
fn test_set_cell_triggers_dependent_recalc() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let a1_id = cid(0x10);
    let c1_id = cid(0x12);

    // Change A1 from 10 to 50
    let result = core
        .set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "50")
        .unwrap();

    // C1 = A1 + B1 = 50 + 20 = 70
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(70.0));

    // C1 should be in changed cells
    assert!(
        result
            .changed_cells
            .iter()
            .any(|c| c.cell_id == c1_id.to_uuid_string())
    );
}

// -----------------------------------------------------------------------
// Set cell with plain value
// -----------------------------------------------------------------------

#[test]
fn test_set_cell_plain_number() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let a1_id = cid(0x10);

    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "42")
        .unwrap();

    let val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(*val, CellValue::number(42.0));
}

#[test]
fn test_set_cell_plain_boolean() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let new_cell = cid(0x20);

    core.set_cell(&mut mirror, &sheet_id, new_cell, 5, 0, "TRUE")
        .unwrap();

    let val = core.get_cell_value(&mirror, &new_cell).unwrap();
    assert_eq!(*val, CellValue::Boolean(true));
}

#[test]
fn test_set_cell_plain_text() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let new_cell = cid(0x21);

    core.set_cell(&mut mirror, &sheet_id, new_cell, 5, 1, "Hello World")
        .unwrap();

    let val = core.get_cell_value(&mirror, &new_cell).unwrap();
    assert_eq!(*val, CellValue::Text("Hello World".into()));
}

// -----------------------------------------------------------------------
// Clear cell
// -----------------------------------------------------------------------

#[test]
fn test_clear_cell_updates_dependents() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let a1_id = cid(0x10);
    let c1_id = cid(0x12);

    // C1 = A1 + B1 = 10 + 20 = 30
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(30.0)
    );

    // Clear A1
    core.clear_cells(&mut mirror, &[a1_id]).unwrap();

    // A1 should be null
    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    assert_eq!(*a1_val, CellValue::Null);

    // C1 = 0 + 20 = 20 (Null coerces to 0)
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(20.0));
}

#[test]
fn test_clear_formula_cell() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let c1_id = cid(0x12);

    // Clear C1 (which has formula =A1+B1)
    core.clear_cells(&mut mirror, &[c1_id]).unwrap();

    // Formula should be gone
    assert!(core.get_formula(&c1_id).is_none());

    // Value should be null
    let val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*val, CellValue::Null);
}

// -----------------------------------------------------------------------
// Batch edits
// -----------------------------------------------------------------------

#[test]
fn test_set_cells_batch() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let a1_id = cid(0x10);
    let b1_id = cid(0x11);
    let c1_id = cid(0x12);

    // Change both A1 and B1 at once
    use crate::storage::engine::mutation::CellInput;
    let edits = vec![
        (
            sheet_id,
            a1_id,
            0u32,
            0u32,
            CellInput::Parse {
                text: "100".to_string(),
            },
        ),
        (
            sheet_id,
            b1_id,
            0,
            1,
            CellInput::Parse {
                text: "200".to_string(),
            },
        ),
    ];

    let result = core.set_cells(&mut mirror, &edits, false).unwrap();

    // C1 = A1 + B1 = 100 + 200 = 300
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(300.0));

    // All three cells should be in changes
    let changed_ids: Vec<String> = result
        .changed_cells
        .iter()
        .map(|c| c.cell_id.clone())
        .collect();
    assert!(changed_ids.contains(&c1_id.to_uuid_string()));
}
