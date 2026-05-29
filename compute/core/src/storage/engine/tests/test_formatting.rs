//! Group 15: format_cell_display / format_value_at_cell tests.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot};
use value_types::{CellValue, FiniteF64};

fn stored_number_format_at(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let cell_id = crate::storage::engine::services::cell_editing::find_cell_id_at(
        &engine.stores,
        sheet_id,
        row,
        col,
    )
    .expect("cell allocated");
    engine
        .get_cell_format(sheet_id, &cell_id, row, col)
        .number_format
}

#[test]
fn test_format_cell_display_general_number() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A1 = 10 with General format -> "10"
    let display = engine.format_cell_display(&sheet_id(), 0, 0);
    assert_eq!(display, "10");
}

#[test]
fn test_format_cell_display_formula_result() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A2 has formula =A1+B1; from_snapshot runs full_recalc so value is 30
    let display = engine.format_cell_display(&sheet_id(), 1, 0);
    assert_eq!(display, "30");
}

#[test]
fn test_format_cell_display_with_number_format() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set number format on A1 (value = 10)
    let format = CellFormat {
        number_format: Some("#,##0.00".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    // Should now format with the custom format
    let display = engine.format_cell_display(&sid, 0, 0);
    assert_eq!(display, "10.00");
}

#[test]
fn test_format_cell_display_empty_cell() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Row 5, col 5 is empty -> ""
    let display = engine.format_cell_display(&sheet_id(), 5, 5);
    assert_eq!(display, "");
}

#[test]
fn test_format_cell_display_large_number_with_format() {
    use domain_types::CellFormat;

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "550e8400-e29b-41d4-a716-446655440010".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Number(FiniteF64::must(1234.567)),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Apply #,##0.00 format
    let format = CellFormat {
        number_format: Some("#,##0.00".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &format)
        .unwrap();

    let display = engine.format_cell_display(&sid, 0, 0);
    assert_eq!(display, "1,234.57");
}

#[test]
fn test_get_display_value_bridge_uses_format() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Set percentage format on B1 (value = 20)
    let format = CellFormat {
        number_format: Some("0%".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 1, 0, 1)], &format)
        .unwrap();

    // The bridge method should use the canonical path
    let display = engine.get_display_value(&sid, 0, 1);
    assert_eq!(display, "2000%");
}

// =========================================================================
// Formula display uses the formula cell's OWN format, not the referenced cell's
// =========================================================================
//
// Excel applies operand-format inheritance at edit time (the format becomes
// part of the formula cell's own format). At display time, we use whatever
// format is actually stored on the formula cell. This was previously buggy:
// the runtime path walked the formula's references and inherited their
// number_format, producing displayText that disagreed with format_idx and
// forcing a TS-side workaround. The hack is gone; this is the regression
// guard.

#[test]
fn formula_edit_copies_single_referenced_number_format() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    engine.set_cell_value_parsed(&sid, 0, 1, "=A1*2").unwrap();

    let resolved = engine.get_resolved_format(&sid, 0, 1);
    assert_eq!(resolved.number_format.as_deref(), Some("$#,##0.00"));
    assert_eq!(engine.format_cell_display(&sid, 0, 1), "$20.00");
}

#[test]
fn formula_edit_does_not_override_existing_formula_cell_number_format() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 1, 0, 1)],
            &CellFormat {
                number_format: Some("0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    engine.set_cell_value_parsed(&sid, 0, 1, "=A1*2").unwrap();

    let resolved = engine.get_resolved_format(&sid, 0, 1);
    assert_eq!(resolved.number_format.as_deref(), Some("0.00"));
    assert_eq!(engine.format_cell_display(&sid, 0, 1), "20.00");
}

#[test]
fn formula_edit_skips_mixed_reference_number_formats() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 1, 0, 1)],
            &CellFormat {
                number_format: Some("0.00%".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    engine.set_cell_value_parsed(&sid, 0, 2, "=A1+B1").unwrap();

    let resolved = engine.get_resolved_format(&sid, 0, 2);
    assert!(matches!(
        resolved.number_format.as_deref(),
        None | Some("General")
    ));
    assert_eq!(engine.format_cell_display(&sid, 0, 2), "30");
}

#[test]
fn formula_edit_copies_number_format_through_formula_chain() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    engine.set_cell_value_parsed(&sid, 0, 1, "=A1*2").unwrap();
    engine.set_cell_value_parsed(&sid, 0, 2, "=B1*2").unwrap();

    let resolved = engine.get_resolved_format(&sid, 0, 2);
    assert_eq!(resolved.number_format.as_deref(), Some("$#,##0.00"));
    assert_eq!(engine.format_cell_display(&sid, 0, 2), "$40.00");
}

#[test]
fn test_set_cell_date_formula_applies_date_format() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0u32,
                3u32,
                CellInput::Parse {
                    text: "=DATE(2026,1,2)".to_string(),
                },
            )],
            true,
        )
        .unwrap();

    let cell_value = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 3));
    match cell_value {
        Some(CellValue::Number(serial)) => {
            assert!(
                serial.get() > 40000.0,
                "expected date serial, got {serial:?}"
            );
        }
        other => panic!("expected Number for DATE formula result, got {:?}", other),
    }

    assert_eq!(
        stored_number_format_at(&engine, &sid, 0, 3).as_deref(),
        Some("M/d/yyyy")
    );
    let display = engine.format_cell_display(&sid, 0, 3);
    assert_eq!(display, "1/2/2026");
    assert_ne!(display, "46024");
}

#[test]
fn test_set_cell_datevalue_formula_keeps_general_serial_display() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0u32,
                3u32,
                CellInput::Parse {
                    text: "=DATEVALUE(\"2/29/1900\")".to_string(),
                },
            )],
            true,
        )
        .unwrap();

    let cell_value = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 3));
    match cell_value {
        Some(CellValue::Number(serial)) => assert_eq!(serial.get(), 60.0),
        other => panic!(
            "expected Number for DATEVALUE formula result, got {:?}",
            other
        ),
    }

    assert!(matches!(
        stored_number_format_at(&engine, &sid, 0, 3).as_deref(),
        None | Some("General")
    ));
    assert_eq!(engine.format_cell_display(&sid, 0, 3), "60");
}

#[test]
fn test_date_pair_formulas_inherit_shared_reference_date_format() {
    use crate::bridge_types::CellInput;
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 1)],
            &CellFormat {
                number_format: Some("yyyy-MM-dd".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0u32,
                    2u32,
                    CellInput::Parse {
                        text: "=DATEDIF(A1,B1,\"d\")".to_string(),
                    },
                ),
                (
                    sid,
                    0u32,
                    3u32,
                    CellInput::Parse {
                        text: "=NETWORKDAYS(A1,B1)".to_string(),
                    },
                ),
                (
                    sid,
                    0u32,
                    4u32,
                    CellInput::Parse {
                        text: "=DAYS(B1,A1)".to_string(),
                    },
                ),
            ],
            true,
        )
        .unwrap();

    assert_eq!(
        stored_number_format_at(&engine, &sid, 0, 2).as_deref(),
        Some("yyyy-MM-dd")
    );
    assert_eq!(
        stored_number_format_at(&engine, &sid, 0, 3).as_deref(),
        Some("yyyy-MM-dd")
    );
    assert_eq!(
        stored_number_format_at(&engine, &sid, 0, 4).as_deref(),
        Some("yyyy-MM-dd")
    );
}

#[test]
fn test_networkdays_expression_argument_keeps_numeric_format() {
    use crate::bridge_types::CellInput;
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("M/d/yyyy".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0u32,
                2u32,
                CellInput::Parse {
                    text: "=NETWORKDAYS(A1,A1+7)".to_string(),
                },
            )],
            true,
        )
        .unwrap();

    assert!(matches!(
        stored_number_format_at(&engine, &sid, 0, 2).as_deref(),
        None | Some("General")
    ));
}

#[test]
fn test_set_cell_date_formula_preserves_explicit_destination_format() {
    use crate::bridge_types::CellInput;
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 4, 0, 4)],
            &CellFormat {
                number_format: Some("0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0u32,
                4u32,
                CellInput::Parse {
                    text: "=DATE(2026,1,2)".to_string(),
                },
            )],
            true,
        )
        .unwrap();

    let resolved = engine.get_resolved_format(&sid, 0, 4);
    assert_eq!(resolved.number_format.as_deref(), Some("0.00"));
    assert_eq!(engine.format_cell_display(&sid, 0, 4), "46024.00");
}

#[test]
fn test_set_cell_date_formula_error_keeps_general_format() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0u32,
                5u32,
                CellInput::Parse {
                    text: "=DATE(\"bad\",1,2)".to_string(),
                },
            )],
            true,
        )
        .unwrap();

    let cell_value = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 5));
    assert!(
        matches!(cell_value, Some(CellValue::Error(_, _))),
        "expected error for invalid DATE formula, got {:?}",
        cell_value
    );
    let resolved = engine.get_resolved_format(&sid, 0, 5);
    assert!(matches!(
        resolved.number_format.as_deref(),
        None | Some("General")
    ));
}

#[test]
fn formula_display_does_not_inherit_referenced_cell_format() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Apply a EUR-currency format to A1 (value = 10).
    let eur_format = CellFormat {
        number_format: Some("€#,##0.00".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &eur_format)
        .unwrap();

    // A1 itself displays with EUR format.
    assert_eq!(engine.format_cell_display(&sid, 0, 0), "€10.00");

    // A2 has formula =A1+B1 (=30) and NO format set -> General.
    // Critically, this must NOT inherit EUR from A1.
    let formula_display = engine.format_cell_display(&sid, 1, 0);
    assert_eq!(
        formula_display, "30",
        "formula cell with default General format must not inherit referenced cell's EUR format"
    );
}

#[test]
fn formula_display_uses_explicit_general_when_set() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // A1 -> percent. A2 has formula =A1+B1, set to explicit General.
    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("0.00%".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges(
            &sid,
            &[(1, 0, 1, 0)],
            &CellFormat {
                number_format: Some("General".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    // Formula displays as General — not as percent inherited from A1.
    assert_eq!(engine.format_cell_display(&sid, 1, 0), "30");
}

#[test]
fn formula_display_respects_cells_own_explicit_format() {
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // The formula cell has its OWN currency format -> wins.
    engine
        .set_format_for_ranges(
            &sid,
            &[(1, 0, 1, 0)],
            &CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    // A2 = =A1+B1 = 30; cell's own format -> "$30.00".
    assert_eq!(engine.format_cell_display(&sid, 1, 0), "$30.00");
}

#[test]
fn test_format_value_at_cell_directly() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Format a known value at a cell position (General format)
    let val = CellValue::Number(FiniteF64::must(42.5));
    let display = engine.format_value_at_cell(&val, &sid, 0, 0);
    assert_eq!(display, "42.5");

    // Boolean
    let val = CellValue::Boolean(true);
    let display = engine.format_value_at_cell(&val, &sid, 0, 0);
    assert_eq!(display, "TRUE");

    // Error
    let val = CellValue::Error(value_types::CellError::Div0, None);
    let display = engine.format_value_at_cell(&val, &sid, 0, 0);
    assert_eq!(display, "#DIV/0!");

    // Text
    let val = CellValue::Text("hello".into());
    let display = engine.format_value_at_cell(&val, &sid, 0, 0);
    assert_eq!(display, "hello");

    // Null
    let val = CellValue::Null;
    let display = engine.format_value_at_cell(&val, &sid, 0, 0);
    assert_eq!(display, "");
}

// =========================================================================
// Date format inference on set_cell — Rust replaces the prior TS-side
// `parseDateInput` shim. Setting a date string should produce a numeric
// (serial) value AND apply the locale's date format to the cell.
// =========================================================================

#[test]
fn test_set_cell_date_string_applies_date_format_us() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Write "3/15/2024" into D1 (row 0, col 3) — empty cell, default locale (US/MDY).
    let edits = vec![(
        sid,
        0u32,
        3u32,
        CellInput::Parse {
            text: "3/15/2024".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    // Verify the value is a numeric serial.
    let cell_value = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 3));
    match cell_value {
        Some(value_types::CellValue::Number(_)) => {}
        other => panic!("expected Number for date serial, got {:?}", other),
    }

    // Verify a date format was applied (M/d/yyyy in US locale).
    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 3)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 3);
    assert_eq!(format.number_format.as_deref(), Some("M/d/yyyy"));
}

#[test]
fn test_set_cell_iso_date_applies_iso_format() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let edits = vec![(
        sid,
        0u32,
        4u32,
        CellInput::Parse {
            text: "2024-03-15".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 4)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 4);
    assert_eq!(format.number_format.as_deref(), Some("yyyy-mm-dd"));
}

#[test]
fn test_set_cell_non_date_string_keeps_general_format() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Plain text — no date format should be applied.
    let edits = vec![(
        sid,
        0u32,
        5u32,
        CellInput::Parse {
            text: "abc".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 5)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 5);
    // No date format — number_format is unset (General).
    assert!(
        format.number_format.is_none(),
        "non-date input should not trigger date format inference, got {:?}",
        format.number_format
    );
}

#[test]
fn test_set_cell_existing_date_format_preserved() {
    use crate::bridge_types::CellInput;
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Pre-apply yyyy-mm-dd format to F1.
    let preset = CellFormat {
        number_format: Some("yyyy-mm-dd".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 6, 0, 6)], &preset)
        .unwrap();

    // Now write a slash-formatted date — the inference should NOT overwrite
    // the user's preset format.
    let edits = vec![(
        sid,
        0u32,
        6u32,
        CellInput::Parse {
            text: "3/15/2024".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 6)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 6);
    assert_eq!(
        format.number_format.as_deref(),
        Some("yyyy-mm-dd"),
        "pre-existing date format should not be replaced by inferred format"
    );
}

// =========================================================================
// Explicit non-General formats are sticky against auto date-inference. The
// previous skip predicate only protected date
// formats; every other explicit format (Number, Currency, Fraction,
// Percentage, Scientific, Special, Custom) was overwritten by the
// inferred date format. Excel parity: any explicit format wins.
// =========================================================================

#[test]
fn test_set_cell_explicit_fraction_format_preserved_against_date_inference() {
    use crate::bridge_types::CellInput;
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Pre-apply Fraction format to A1.
    let preset = CellFormat {
        number_format: Some("# ?/?".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 0, 0, 0)], &preset)
        .unwrap();

    // Write "1/2" — the parser hits G3 and lands 0.5; auto-inference
    // must NOT replace the Fraction format with a date format.
    let edits = vec![(
        sid,
        0u32,
        0u32,
        CellInput::Parse {
            text: "1/2".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 0)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 0);
    assert_eq!(
        format.number_format.as_deref(),
        Some("# ?/?"),
        "fraction format should not be overwritten by date inference"
    );
}

#[test]
fn test_set_cell_explicit_currency_format_preserved_against_date_inference() {
    use crate::bridge_types::CellInput;
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Pre-apply Currency format to B1.
    let preset = CellFormat {
        number_format: Some("$#,##0".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 1, 0, 1)], &preset)
        .unwrap();

    // Write "3/15/2024" — under pass 2 the value lands as text and
    // the format must stay Currency.
    let edits = vec![(
        sid,
        0u32,
        1u32,
        CellInput::Parse {
            text: "3/15/2024".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 1)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 1);
    assert_eq!(
        format.number_format.as_deref(),
        Some("$#,##0"),
        "currency format should not be overwritten by date inference"
    );
    // Phase-2 co-check: the value is text, not a serial.
    let cell_value = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 1));
    match cell_value {
        Some(value_types::CellValue::Text(s)) => assert_eq!(s.as_ref(), "3/15/2024"),
        other => panic!(
            "expected Text(\"3/15/2024\") under explicit currency, got {:?}",
            other
        ),
    }
}

#[test]
fn test_set_cell_explicit_number_format_preserved_against_date_inference() {
    use crate::bridge_types::CellInput;
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Pre-apply Number format `0.00` to C1.
    let preset = CellFormat {
        number_format: Some("0.00".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 2, 0, 2)], &preset)
        .unwrap();

    // Write "3/15/2024" — under pass 2 the value lands as text and
    // the format must stay `0.00` (not be overwritten with a date format).
    let edits = vec![(
        sid,
        0u32,
        2u32,
        CellInput::Parse {
            text: "3/15/2024".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 2)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 2);
    assert_eq!(
        format.number_format.as_deref(),
        Some("0.00"),
        "number format should not be overwritten by date inference"
    );
    let cell_value = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 2));
    match cell_value {
        Some(value_types::CellValue::Text(s)) => assert_eq!(s.as_ref(), "3/15/2024"),
        other => panic!(
            "expected Text(\"3/15/2024\") under explicit number format, got {:?}",
            other
        ),
    }
}

/// Negative control: General cell still picks up the inferred date format
/// — auto-inference is alive and well, just gated to General.
#[test]
fn test_set_cell_general_format_still_gets_inferred_date_format() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // No pre-applied format on D1 — it's General.
    let edits = vec![(
        sid,
        0u32,
        3u32,
        CellInput::Parse {
            text: "3/15/2024".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 3)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 3);
    assert_eq!(
        format.number_format.as_deref(),
        Some("M/d/yyyy"),
        "General cell should still receive the inferred date format"
    );
}

#[test]
fn test_text_to_columns_general_preserves_leading_zeros() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Seed C1 with "00123,abc,42" — we'll split into D1, E1, F1.
    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0u32,
                2u32,
                CellInput::Parse {
                    text: "00123,abc,42".into(),
                },
            )],
            true,
        )
        .unwrap();

    // Run text-to-columns: source = C1, destination = D1.
    let options = serde_json::json!({
        "splitType": "Delimited",
        "delimiters": { "comma": true },
        "treatConsecutiveAsOne": false,
        "textQualifier": "doubleQuote",
    });
    engine
        .text_to_columns(&sid, 0, 0, 2, 0, 3, options)
        .unwrap();

    // D1 = "00123" (string, leading zero preserved on General)
    let v_d = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 3))
        .cloned()
        .unwrap_or(value_types::CellValue::Null);
    match v_d {
        value_types::CellValue::Text(s) => assert_eq!(s.as_ref(), "00123"),
        other => panic!("expected Text(\"00123\") at D1, got {:?}", other),
    }

    // E1 = "abc"
    let v_e = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 4))
        .cloned()
        .unwrap_or(value_types::CellValue::Null);
    match v_e {
        value_types::CellValue::Text(s) => assert_eq!(s.as_ref(), "abc"),
        other => panic!("expected Text(\"abc\") at E1, got {:?}", other),
    }

    // F1 = 42 (number)
    let v_f = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 5))
        .cloned()
        .unwrap_or(value_types::CellValue::Null);
    match v_f {
        value_types::CellValue::Number(n) => {
            assert!((n.get() - 42.0).abs() < 1e-9);
        }
        other => panic!("expected Number(42) at F1, got {:?}", other),
    }
}

#[test]
fn test_text_to_columns_destination_numeric_format_coerces_leading_zeros() {
    use crate::bridge_types::CellInput;
    use domain_types::CellFormat;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Seed C1 with "00123,abc".
    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0u32,
                2u32,
                CellInput::Parse {
                    text: "00123,abc".into(),
                },
            )],
            true,
        )
        .unwrap();

    // Pre-format the destination column D as Number.
    let number_fmt = CellFormat {
        number_format: Some("#,##0".to_string()),
        ..Default::default()
    };
    engine
        .set_col_format(&sid, 3, number_fmt)
        .expect("set_col_format");

    // Run text-to-columns into D1/E1.
    let options = serde_json::json!({
        "splitType": "Delimited",
        "delimiters": { "comma": true },
        "treatConsecutiveAsOne": false,
        "textQualifier": "doubleQuote",
    });
    engine
        .text_to_columns(&sid, 0, 0, 2, 0, 3, options)
        .unwrap();

    // D1: with Number format on the destination column, "00123" coerces to 123.
    let v_d = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 3))
        .cloned()
        .unwrap_or(value_types::CellValue::Null);
    match v_d {
        value_types::CellValue::Number(n) => {
            assert!(
                (n.get() - 123.0).abs() < 1e-9,
                "expected 123 at D1, got {}",
                n.get()
            );
        }
        other => panic!("expected Number(123) at D1, got {:?}", other),
    }

    // E1: "abc" remains text regardless of column format.
    let v_e = engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 4))
        .cloned()
        .unwrap_or(value_types::CellValue::Null);
    match v_e {
        value_types::CellValue::Text(s) => assert_eq!(s.as_ref(), "abc"),
        other => panic!("expected Text(\"abc\") at E1, got {:?}", other),
    }
}

#[test]
fn test_set_cell_plain_number_does_not_get_date_format() {
    use crate::bridge_types::CellInput;

    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // "42" parses as a plain number, not a date — no format should be applied.
    let edits = vec![(
        sid,
        0u32,
        7u32,
        CellInput::Parse {
            text: "42".to_string(),
        },
    )];
    engine.batch_set_cells_by_position(edits, true).unwrap();

    let cell_id =
        crate::storage::engine::services::cell_editing::find_cell_id_at(&engine.stores, &sid, 0, 7)
            .expect("cell allocated");
    let format = engine.get_cell_format(&sid, &cell_id, 0, 7);
    assert!(
        format.number_format.is_none(),
        "plain number 42 should not get a date format, got {:?}",
        format.number_format
    );
}
