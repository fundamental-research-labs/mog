// Integration tests for mutation_auto_fill: exercises the full engine pipeline
// (YrsComputeEngine → CellMirror → GridIndexes → build_adjusted_formula → to_a1_display).
//
// These tests reproduce the bugs documented in workstream-b-autofill-cellmirror.md:
//   Bug #2: AutoFill overwrites source range
//   Bug #3: AutoFill formulas produce #REF! (CellMirror desync)

use cell_types::{CellId, SheetId, SheetPos};
use compute_core::engine_types::fill::{BridgeAutoFillRequest, BridgeFillRangeSpec};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::CellFormat;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SHEET_UUID: &str = "00000000000000000000000000000001";

fn cell_uuid(row: u32, col: u32) -> String {
    format!("000000000000000000000000{:04x}{:04x}", row, col)
}

fn make_cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn make_snapshot(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn num(v: f64) -> CellValue {
    CellValue::number(v)
}

fn fill_request(
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    tgt_start_row: u32,
    tgt_start_col: u32,
    tgt_end_row: u32,
    tgt_end_col: u32,
    direction: &str,
) -> BridgeAutoFillRequest {
    BridgeAutoFillRequest {
        source_range: BridgeFillRangeSpec {
            start_row: src_start_row,
            start_col: src_start_col,
            end_row: src_end_row,
            end_col: src_end_col,
        },
        target_range: BridgeFillRangeSpec {
            start_row: tgt_start_row,
            start_col: tgt_start_col,
            end_row: tgt_end_row,
            end_col: tgt_end_col,
        },
        direction: direction.to_string(),
        mode: "auto".to_string(),
        include_formulas: true,
        include_values: true,
        include_formats: true,
        step_value: 1.0,
    }
}

fn cell_id_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> CellId {
    let cell_hex = engine
        .get_cell_id_at(sheet_id, row, col)
        .unwrap_or_else(|| panic!("cell at row {row} col {col} should have an id"));
    CellId::from_raw(u128::from_str_radix(&cell_hex, 16).expect("cell id hex parses"))
}

fn set_format_at(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    format: CellFormat,
) {
    let cell_id = cell_id_at(engine, sheet_id, row, col);
    engine
        .set_cell_format(sheet_id, &cell_id, &format)
        .expect("set cell format");
}

fn format_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> CellFormat {
    let cell_id = cell_id_at(engine, sheet_id, row, col);
    engine.get_cell_format(sheet_id, &cell_id, row, col)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bug #3 reproduction: Formula autofill must not produce #REF!
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Core reproduction of Bug #3: formula references must adjust correctly
/// when filling down, NOT produce #REF!.
///
/// Setup: A1=10, B1=20, C1=A1+B1 → fill C1 down to C2:C5
/// Expected: C2=A2+B2, C3=A3+B3, C4=A4+B4, C5=A5+B5
#[test]
fn bug3_formula_fill_down_no_ref_error() {
    // Set up engine with numeric values in A1 and B1
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0)), // A1 = 10
        make_cell(0, 1, num(20.0)), // B1 = 20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Set C1 = =A1+B1 via the parsing API (creates identity formula + CellIds)
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=A1+B1")
        .unwrap();

    // Verify C1 computed correctly before fill
    let c1_val = engine
        .mirror()
        .get_cell_value_at(&sheet_id, SheetPos::new(0, 2));
    assert_eq!(*c1_val.unwrap(), num(30.0), "C1 should compute A1+B1 = 30");

    // Fill C1 → C2:C5
    let request = fill_request(0, 2, 0, 2, 1, 2, 4, 2, "down");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    // Verify filled cells have formulas, not #REF!
    for target_row in 1..=4u32 {
        let pos = SheetPos::new(target_row, 2);
        let cell_id = engine.mirror().resolve_cell_id(&sheet_id, pos);
        assert!(
            cell_id.is_some(),
            "row {} col 2 should have a CellId after fill",
            target_row
        );

        // Check the formula display string via the engine's to_a1_display
        let formula = engine.mirror().get_formula(&cell_id.unwrap());
        assert!(
            formula.is_some(),
            "row {} col 2 should have a formula after fill",
            target_row
        );
        let display = engine.to_a1_display(&sheet_id, formula.unwrap());
        assert!(
            !display.contains("#REF!"),
            "row {} formula should not contain #REF!, got: {}",
            target_row,
            display
        );

        // Verify the formula display adjusts references correctly
        let expected = format!("=A{}+B{}", target_row + 1, target_row + 1);
        assert_eq!(
            display, expected,
            "row {} formula should be {}, got: {}",
            target_row, expected, display
        );
    }
}

/// Bug #3 variant: formula with multiple refs filling right.
///
/// Setup: A1=1, A2=2, A3=A1+A2 → fill A3 right to B3:D3
/// Expected: B3=B1+B2, C3=C1+C2, D3=D1+D2
#[test]
fn bug3_formula_fill_right_no_ref_error() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0)), // A1
        make_cell(1, 0, num(2.0)), // A2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // A3 = =A1+A2
    engine
        .set_cell_value_parsed(&sheet_id, 2, 0, "=A1+A2")
        .unwrap();

    // Fill A3 → B3:D3
    let request = fill_request(2, 0, 2, 0, 2, 1, 2, 3, "right");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    let expected_formulas = ["=B1+B2", "=C1+C2", "=D1+D2"];
    for (i, target_col) in (1..=3u32).enumerate() {
        let pos = SheetPos::new(2, target_col);
        let cell_id = engine
            .mirror()
            .resolve_cell_id(&sheet_id, pos)
            .unwrap_or_else(|| panic!("row 2 col {} should have a CellId after fill", target_col));
        let formula = engine
            .mirror()
            .get_formula(&cell_id)
            .unwrap_or_else(|| panic!("row 2 col {} should have a formula after fill", target_col));
        let display = engine.to_a1_display(&sheet_id, formula);
        assert!(
            !display.contains("#REF!"),
            "col {} formula should not contain #REF!, got: {}",
            target_col,
            display
        );
        assert_eq!(
            display, expected_formulas[i],
            "col {} formula mismatch",
            target_col
        );
    }
}

/// Bug #3 variant: formula with range reference.
///
/// Setup: A1=1, A2=2, A3=3, B1=SUM(A1:A3) → fill B1 down to B2:B3
/// Expected: B2=SUM(A2:A4), B3=SUM(A3:A5) — range refs shift
#[test]
fn bug3_formula_fill_range_ref_no_ref_error() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0)),
        make_cell(1, 0, num(2.0)),
        make_cell(2, 0, num(3.0)),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = =SUM(A1:A3)
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=SUM(A1:A3)")
        .unwrap();

    // Fill B1 → B2:B3
    let request = fill_request(0, 1, 0, 1, 1, 1, 2, 1, "down");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    // Get the source formula's identity for comparison
    let source_cell_id = engine
        .mirror()
        .resolve_cell_id(&sheet_id, SheetPos::new(0, 1))
        .unwrap();
    let source_formula = engine
        .mirror()
        .get_formula(&source_cell_id)
        .cloned()
        .unwrap();

    let expected = ["=SUM(A2:A4)", "=SUM(A3:A5)"];
    for (i, target_row) in (1..=2u32).enumerate() {
        let pos = SheetPos::new(target_row, 1);
        let cell_id = engine
            .mirror()
            .resolve_cell_id(&sheet_id, pos)
            .unwrap_or_else(|| panic!("row {} col 1 should have a CellId", target_row));
        let formula = engine
            .mirror()
            .get_formula(&cell_id)
            .unwrap_or_else(|| panic!("row {} col 1 should have a formula", target_row));

        // Filled formula must have new CellIds, not reuse source refs
        assert_ne!(
            formula.refs, source_formula.refs,
            "row {} formula refs should differ from source (adjustment should create new CellIds)",
            target_row
        );

        let display = engine.to_a1_display(&sheet_id, formula);
        assert!(
            !display.contains("#REF!"),
            "row {} formula should not contain #REF!, got: {}",
            target_row,
            display
        );
        assert_eq!(display, expected[i], "row {} formula mismatch", target_row);
    }
}

/// Bug #3 variant: mixed absolute and relative refs.
///
/// Setup: A1=100, B1==$A$1*2 → fill B1 down to B2:B4
/// Expected: B2=$A$1*2, B3=$A$1*2, B4=$A$1*2 (absolute ref doesn't shift)
#[test]
fn bug3_formula_fill_absolute_ref_stays_fixed() {
    let snapshot = make_snapshot(vec![make_cell(0, 0, num(100.0))]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = =$A$1*2
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=$A$1*2")
        .unwrap();

    // Fill B1 → B2:B4
    let request = fill_request(0, 1, 0, 1, 1, 1, 3, 1, "down");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    for target_row in 1..=3u32 {
        let pos = SheetPos::new(target_row, 1);
        let cell_id = engine
            .mirror()
            .resolve_cell_id(&sheet_id, pos)
            .unwrap_or_else(|| panic!("row {} col 1 should have a CellId", target_row));
        let formula = engine
            .mirror()
            .get_formula(&cell_id)
            .unwrap_or_else(|| panic!("row {} col 1 should have a formula", target_row));
        let display = engine.to_a1_display(&sheet_id, formula);
        assert!(
            !display.contains("#REF!"),
            "row {} formula should not contain #REF!, got: {}",
            target_row,
            display
        );
        assert_eq!(
            display, "=$A$1*2",
            "row {} absolute ref should not shift",
            target_row
        );
    }
}

/// Bug #3 variant: mixed absolute/relative ref.
///
/// Setup: A1=1, B1=2, C1==$A$1+B1 → fill C1 down to C2:C3
/// Expected: C2=$A$1+B2, C3=$A$1+B3 ($A$1 stays, B shifts)
#[test]
fn bug3_formula_fill_mixed_refs() {
    let snapshot = make_snapshot(vec![make_cell(0, 0, num(1.0)), make_cell(0, 1, num(2.0))]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // C1 = =$A$1+B1
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=$A$1+B1")
        .unwrap();

    // Fill C1 → C2:C3
    let request = fill_request(0, 2, 0, 2, 1, 2, 2, 2, "down");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    let expected = ["=$A$1+B2", "=$A$1+B3"];
    for (i, target_row) in (1..=2u32).enumerate() {
        let pos = SheetPos::new(target_row, 2);
        let cell_id = engine.mirror().resolve_cell_id(&sheet_id, pos).unwrap();
        let formula = engine.mirror().get_formula(&cell_id).unwrap();
        let display = engine.to_a1_display(&sheet_id, formula);
        assert!(
            !display.contains("#REF!"),
            "row {} formula should not contain #REF!, got: {}",
            target_row,
            display
        );
        assert_eq!(display, expected[i], "row {} formula mismatch", target_row);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bug #2 reproduction: AutoFill must not overwrite source range
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Bug #2 reproduction: seed [1,2] in A1:A2, fill down to A3:A10.
/// Source cells A1:A2 must retain original values [1,2].
#[test]
fn bug2_autofill_preserves_source_values() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0)), // A1 = 1
        make_cell(1, 0, num(2.0)), // A2 = 2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Fill A1:A2 → A3:A10
    let request = fill_request(0, 0, 1, 0, 2, 0, 9, 0, "down");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    // Source cells MUST be untouched
    let a1 = engine
        .mirror()
        .get_cell_value_at(&sheet_id, SheetPos::new(0, 0));
    assert_eq!(*a1.unwrap(), num(1.0), "A1 must remain 1 after fill");

    let a2 = engine
        .mirror()
        .get_cell_value_at(&sheet_id, SheetPos::new(1, 0));
    assert_eq!(*a2.unwrap(), num(2.0), "A2 must remain 2 after fill");

    // Target cells should have the series continuation: 3,4,5,6,7,8,9,10
    for target_row in 2..=9u32 {
        let val = engine
            .mirror()
            .get_cell_value_at(&sheet_id, SheetPos::new(target_row, 0));
        assert!(
            val.is_some(),
            "A{} should have a value after fill",
            target_row + 1
        );
        let expected = (target_row + 1) as f64;
        assert_eq!(
            *val.unwrap(),
            num(expected),
            "A{} should be {}",
            target_row + 1,
            expected
        );
    }
}

/// Bug #2 variant: fill with formulas — source formula must not be overwritten.
#[test]
fn bug2_autofill_preserves_source_formula() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0)), // A1 = 10
        make_cell(0, 1, num(20.0)), // B1 = 20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // C1 = =A1+B1
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=A1+B1")
        .unwrap();

    // Capture the source formula before fill
    let source_cell_id = engine
        .mirror()
        .resolve_cell_id(&sheet_id, SheetPos::new(0, 2))
        .unwrap();
    let source_formula_before = engine
        .mirror()
        .get_formula(&source_cell_id)
        .cloned()
        .unwrap();

    // Fill C1 → C2:C3
    let request = fill_request(0, 2, 0, 2, 1, 2, 2, 2, "down");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    // Source cell C1 must still have its original formula
    let source_formula_after = engine.mirror().get_formula(&source_cell_id);
    assert!(
        source_formula_after.is_some(),
        "C1 must still have a formula after fill"
    );
    assert_eq!(
        *source_formula_after.unwrap(),
        source_formula_before,
        "C1 formula must be unchanged after fill"
    );

    // Source cell value must still be correct
    let c1_val = engine
        .mirror()
        .get_cell_value_at(&sheet_id, SheetPos::new(0, 2));
    assert_eq!(
        *c1_val.unwrap(),
        num(30.0),
        "C1 value must still be 30 after fill"
    );
}

#[test]
fn autofill_copies_formats_for_value_and_formula_source_columns() {
    let snapshot = make_snapshot(vec![make_cell(0, 0, num(10.0)), make_cell(0, 1, num(20.0))]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=A1+B1")
        .unwrap();

    set_format_at(
        &mut engine,
        &sheet_id,
        0,
        0,
        CellFormat {
            background_color: Some("#FFEE00".to_string()),
            number_format: Some("$#,##0.00".to_string()),
            ..Default::default()
        },
    );
    set_format_at(
        &mut engine,
        &sheet_id,
        0,
        1,
        CellFormat {
            bold: Some(true),
            number_format: Some("0.00%".to_string()),
            ..Default::default()
        },
    );
    set_format_at(
        &mut engine,
        &sheet_id,
        0,
        2,
        CellFormat {
            bold: Some(true),
            background_color: Some("#C6EFCE".to_string()),
            number_format: Some("$#,##0.00".to_string()),
            ..Default::default()
        },
    );

    let request = fill_request(0, 0, 0, 2, 1, 0, 2, 2, "down");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    for row in 1..=2 {
        let a_fmt = format_at(&engine, &sheet_id, row, 0);
        assert_eq!(
            a_fmt.background_color.as_deref(),
            Some("#FFEE00"),
            "A{} should copy A1 fill",
            row + 1
        );
        assert_eq!(
            a_fmt.number_format.as_deref(),
            Some("$#,##0.00"),
            "A{} should copy A1 number format",
            row + 1
        );

        let b_fmt = format_at(&engine, &sheet_id, row, 1);
        assert_eq!(b_fmt.bold, Some(true), "B{} should copy B1 bold", row + 1);
        assert_eq!(
            b_fmt.number_format.as_deref(),
            Some("0.00%"),
            "B{} should copy B1 number format",
            row + 1
        );

        let c_fmt = format_at(&engine, &sheet_id, row, 2);
        assert_eq!(c_fmt.bold, Some(true), "C{} should copy C1 bold", row + 1);
        assert_eq!(
            c_fmt.background_color.as_deref(),
            Some("#C6EFCE"),
            "C{} should copy C1 fill",
            row + 1
        );
        assert_eq!(
            c_fmt.number_format.as_deref(),
            Some("$#,##0.00"),
            "C{} should copy C1 number format",
            row + 1
        );
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Additional edge cases
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Fill up: formulas should adjust references in reverse direction.
#[test]
fn formula_fill_up_adjusts_references() {
    let snapshot = make_snapshot(vec![
        make_cell(4, 0, num(5.0)),  // A5
        make_cell(4, 1, num(10.0)), // B5
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // C5 = =A5+B5
    engine
        .set_cell_value_parsed(&sheet_id, 4, 2, "=A5+B5")
        .unwrap();

    // Fill C5 up to C3:C4
    let request = fill_request(4, 2, 4, 2, 2, 2, 3, 2, "up");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    let expected = [("=A3+B3", 2u32), ("=A4+B4", 3)];
    for (exp_formula, target_row) in &expected {
        let pos = SheetPos::new(*target_row, 2);
        let cell_id = engine.mirror().resolve_cell_id(&sheet_id, pos).unwrap();
        let formula = engine.mirror().get_formula(&cell_id).unwrap();
        let display = engine.to_a1_display(&sheet_id, formula);
        assert!(
            !display.contains("#REF!"),
            "row {} formula should not contain #REF!, got: {}",
            target_row,
            display
        );
        assert_eq!(display, *exp_formula, "row {} formula mismatch", target_row);
    }
}

/// Autofill with multiple source cells containing a mix of values and formulas.
#[test]
fn formula_fill_multi_source_pattern() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0)), // A1
        make_cell(1, 0, num(2.0)), // A2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = =A1*10, B2 = =A2*10
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*10")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "=A2*10")
        .unwrap();

    // Fill B1:B2 → B3:B6
    let request = fill_request(0, 1, 1, 1, 2, 1, 5, 1, "down");
    let (_patches, _result) = engine.auto_fill(&sheet_id, request).unwrap();

    let expected = ["=A3*10", "=A4*10", "=A5*10", "=A6*10"];
    for (i, target_row) in (2..=5u32).enumerate() {
        let pos = SheetPos::new(target_row, 1);
        let cell_id = engine
            .mirror()
            .resolve_cell_id(&sheet_id, pos)
            .unwrap_or_else(|| panic!("row {} col 1 should have a CellId", target_row));
        let formula = engine
            .mirror()
            .get_formula(&cell_id)
            .unwrap_or_else(|| panic!("row {} col 1 should have a formula", target_row));
        let display = engine.to_a1_display(&sheet_id, formula);
        assert!(
            !display.contains("#REF!"),
            "row {} formula should not contain #REF!, got: {}",
            target_row,
            display
        );
        assert_eq!(display, expected[i], "row {} formula mismatch", target_row);
    }
}
