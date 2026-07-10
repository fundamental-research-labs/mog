//! Cross-type approximate match, binary search text, null lookup, formula variables.

use super::*;
use crate::mirror::CellMirror;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};

// -----------------------------------------------------------------------
// Cross-type approximate match tests (VLOOKUP, HLOOKUP, MATCH)
// -----------------------------------------------------------------------
// Excel skips values of different types in approximate match mode.
// Numbers, Text, and Booleans are distinct types — cross-type comparisons
// must be skipped (return None from cell_value_cmp_for_lookup).

#[test]
fn test_vlookup_approx_skips_cross_type() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Table first column: "A", 10, "B", 20, "C", 30
    // Lookup 25 (Number) with approximate match (TRUE).
    // Should skip "A", "B", "C" (Text) and find largest Number <= 25 → 20 at row 4.
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("A".into()), ASTNode::Number(100.0)],
            vec![ASTNode::Number(10.0), ASTNode::Number(200.0)],
            vec![ASTNode::Text("B".into()), ASTNode::Number(300.0)],
            vec![ASTNode::Number(20.0), ASTNode::Number(400.0)],
            vec![ASTNode::Text("C".into()), ASTNode::Number(500.0)],
            vec![ASTNode::Number(30.0), ASTNode::Number(600.0)],
        ],
    };
    let node = func(
        "VLOOKUP",
        vec![
            ASTNode::Number(25.0),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(true),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(400.0));
}

#[test]
fn test_vlookup_approx_text_lookup_skips_numbers() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Table first column: 100, "Apple", 200, "Banana", 300, "Cherry"
    // Lookup "Bz" (Text) with approximate match.
    // Should skip 100, 200, 300 (Numbers) and find largest Text <= "Bz" → "Banana".
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(100.0), ASTNode::Text("r1".into())],
            vec![ASTNode::Text("Apple".into()), ASTNode::Text("r2".into())],
            vec![ASTNode::Number(200.0), ASTNode::Text("r3".into())],
            vec![ASTNode::Text("Banana".into()), ASTNode::Text("r4".into())],
            vec![ASTNode::Number(300.0), ASTNode::Text("r5".into())],
            vec![ASTNode::Text("Cherry".into()), ASTNode::Text("r6".into())],
        ],
    };
    let node = func(
        "VLOOKUP",
        vec![
            ASTNode::Text("Bz".into()),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(true),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("r4".into()));
}

#[test]
fn test_hlookup_approx_skips_cross_type() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // First row: "Q25", 500, "Z", 1000, 1500, "W", 6000
    // Lookup "Q25" (Text) with approximate match.
    // Should skip 500, 1000, 1500, 6000 (Numbers), find largest Text <= "Q25".
    // Text values in sorted order: "Q25", "W", "Z"
    // "Q25" <= "Q25" → match. Next text "W" > "Q25" → skip/irrelevant.
    // Best = index 0 ("Q25").
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Text("Q25".into()),
                ASTNode::Number(500.0),
                ASTNode::Text("Z".into()),
                ASTNode::Number(1000.0),
                ASTNode::Number(1500.0),
                ASTNode::Text("W".into()),
                ASTNode::Number(6000.0),
            ],
            vec![
                ASTNode::Number(1.0),
                ASTNode::Number(2.0),
                ASTNode::Number(3.0),
                ASTNode::Number(4.0),
                ASTNode::Number(5.0),
                ASTNode::Number(6.0),
                ASTNode::Number(7.0),
            ],
        ],
    };
    let node = func(
        "HLOOKUP",
        vec![
            ASTNode::Text("Q25".into()),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(true),
        ],
    );
    // Should match column 0 ("Q25") → row 2 value = 1.0
    assert_eq!(eval(&node, &ctx), CellValue::number(1.0));
}

#[test]
fn test_match_ascending_skips_cross_type() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Array: "x", 10, "y", 20, "z", 30
    // match_type=1 (ascending approximate), lookup=25 (Number)
    // Should skip "x", "y", "z" (Text) and find largest Number <= 25 → 20 at position 4.
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("x".into())],
            vec![ASTNode::Number(10.0)],
            vec![ASTNode::Text("y".into())],
            vec![ASTNode::Number(20.0)],
            vec![ASTNode::Text("z".into())],
            vec![ASTNode::Number(30.0)],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Number(25.0), arr, ASTNode::Number(1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(4.0));
}

#[test]
fn test_match_descending_skips_cross_type() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Array: 100, "z", 80, "y", 60, "x", 40
    // match_type=-1 (descending approximate), lookup=100 (Number)
    // Should skip "z", "y", "x" (Text) and find smallest Number >= 100 → 100 at position 1.
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(100.0)],
            vec![ASTNode::Text("z".into())],
            vec![ASTNode::Number(80.0)],
            vec![ASTNode::Text("y".into())],
            vec![ASTNode::Number(60.0)],
            vec![ASTNode::Text("x".into())],
            vec![ASTNode::Number(40.0)],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Number(100.0), arr, ASTNode::Number(-1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(1.0));
}

#[test]
fn test_match_descending_cross_type_inner() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Array: 100, "z", 80, "y", 60, "x", 40
    // match_type=-1 (descending), lookup=70 (Number)
    // Should skip text, find smallest Number >= 70 → 80 at position 3.
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(100.0)],
            vec![ASTNode::Text("z".into())],
            vec![ASTNode::Number(80.0)],
            vec![ASTNode::Text("y".into())],
            vec![ASTNode::Number(60.0)],
            vec![ASTNode::Text("x".into())],
            vec![ASTNode::Number(40.0)],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Number(70.0), arr, ASTNode::Number(-1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn test_vlookup_approx_all_different_type_returns_na() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Table first column: all Text. Lookup is a Number.
    // No same-type matches → #N/A.
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("a".into()), ASTNode::Number(1.0)],
            vec![ASTNode::Text("b".into()), ASTNode::Number(2.0)],
        ],
    };
    let node = func(
        "VLOOKUP",
        vec![
            ASTNode::Number(5.0),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(true),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

#[test]
fn test_match_ascending_all_cross_type_returns_na() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // All Text values, lookup is Number. No same-type match → #N/A.
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("a".into())],
            vec![ASTNode::Text("b".into())],
            vec![ASTNode::Text("c".into())],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Number(1.0), arr, ASTNode::Number(1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

#[test]
fn test_hlookup_approx_all_cross_type_returns_na() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // First row all Numbers, lookup is Text. No same-type → #N/A.
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Number(1.0),
                ASTNode::Number(2.0),
                ASTNode::Number(3.0),
            ],
            vec![
                ASTNode::Text("a".into()),
                ASTNode::Text("b".into()),
                ASTNode::Text("c".into()),
            ],
        ],
    };
    let node = func(
        "HLOOKUP",
        vec![
            ASTNode::Text("x".into()),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(true),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

// =======================================================================
// Binary search approximate match on non-lexicographic text data
// (Excel uses binary search; linear scan diverges on imperfectly sorted data)
// =======================================================================

#[test]
fn test_vlookup_approx_text_sorted_by_numeric_field() {
    // Text values sorted by underlying numeric field, not lexicographic:
    // "item; 11.6lb" < "item; 9.5lb" lexicographically ('1' < '9')
    // but numerically 9.5 < 11.6. An exact match exists at row 2.
    // Linear scan would break at row 0 ('1' < '9'), binary search finds row 2.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Text("4.5in; 9.5lb; H-40".into()),
                ASTNode::Number(100.0),
            ],
            vec![
                ASTNode::Text("4.5in; 11.6lb; J-55".into()),
                ASTNode::Number(200.0),
            ],
            vec![
                ASTNode::Text("4.5in; 11.6lb; P-110".into()),
                ASTNode::Number(300.0),
            ],
            vec![
                ASTNode::Text("4.5in; 13.5lb; Q-125".into()),
                ASTNode::Number(400.0),
            ],
        ],
    };
    let node = func(
        "VLOOKUP",
        vec![
            ASTNode::Text("4.5in; 11.6lb; P-110".into()),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(true),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(300.0));
}

#[test]
fn test_hlookup_approx_text_sorted_by_numeric_field() {
    // Same pattern as VLOOKUP test but horizontal.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Text("4.5in; 9.5lb".into()),
                ASTNode::Text("4.5in; 11.6lb".into()),
                ASTNode::Text("4.5in; 13.5lb".into()),
            ],
            vec![
                ASTNode::Number(100.0),
                ASTNode::Number(200.0),
                ASTNode::Number(300.0),
            ],
        ],
    };
    let node = func(
        "HLOOKUP",
        vec![
            ASTNode::Text("4.5in; 11.6lb".into()),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(true),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(200.0));
}

#[test]
fn test_match_ascending_text_sorted_by_numeric_field() {
    // MATCH match_type=1 on text sorted by numeric field.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("4.5in; 9.5lb".into())],
            vec![ASTNode::Text("4.5in; 11.6lb".into())],
            vec![ASTNode::Text("4.5in; 13.5lb".into())],
        ],
    };
    let node = func(
        "MATCH",
        vec![
            ASTNode::Text("4.5in; 11.6lb".into()),
            arr,
            ASTNode::Number(1.0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(2.0));
}

#[test]
fn test_match_descending_approx() {
    // MATCH match_type=-1 (descending): sorted descending data.
    // Lookup 5 in [9, 7, 5, 3, 1] → exact match at position 3.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(9.0)],
            vec![ASTNode::Number(7.0)],
            vec![ASTNode::Number(5.0)],
            vec![ASTNode::Number(3.0)],
            vec![ASTNode::Number(1.0)],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Number(5.0), arr, ASTNode::Number(-1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn test_match_descending_approx_between_values() {
    // MATCH match_type=-1 (descending): lookup 6 in [9, 7, 5, 3, 1].
    // Smallest value >= 6 is 7 at position 2.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(9.0)],
            vec![ASTNode::Number(7.0)],
            vec![ASTNode::Number(5.0)],
            vec![ASTNode::Number(3.0)],
            vec![ASTNode::Number(1.0)],
        ],
    };
    let node = func(
        "MATCH",
        vec![ASTNode::Number(6.0), arr, ASTNode::Number(-1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(2.0));
}

// =======================================================================
// VLOOKUP / HLOOKUP: Null lookup with approximate match → #N/A
// (Excel does not match blank against sorted data)
// =======================================================================

#[test]
fn test_vlookup_approx_null_lookup_returns_na() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Table with numeric first column. Lookup is Null (empty cell).
    // Approximate match should return #N/A for blank lookup values.
    let null_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 99,
            col: 99,
        },
        abs_row: false,
        abs_col: false,
    });
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(10.0)],
            vec![ASTNode::Number(2.0), ASTNode::Number(20.0)],
        ],
    };
    let node = func("VLOOKUP", vec![null_ref, table, ASTNode::Number(2.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

#[test]
fn test_vlookup_approx_null_lookup_all_null_table_returns_na() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Table with all-Null first column. Lookup is Null.
    // Approximate match should still return #N/A (not match Null == Null).
    let null_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 99,
            col: 99,
        },
        abs_row: false,
        abs_col: false,
    });
    let null_cell1 = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 90,
            col: 90,
        },
        abs_row: false,
        abs_col: false,
    });
    let null_cell2 = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 91,
            col: 91,
        },
        abs_row: false,
        abs_col: false,
    });
    let table = ASTNode::Array {
        rows: vec![
            vec![null_cell1, ASTNode::Number(10.0)],
            vec![null_cell2, ASTNode::Number(20.0)],
        ],
    };
    let node = func("VLOOKUP", vec![null_ref, table, ASTNode::Number(2.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

#[test]
fn test_vlookup_exact_null_lookup_finds_null() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Exact match with Null lookup SHOULD find null cells (unlike approximate).
    let null_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 99,
            col: 99,
        },
        abs_row: false,
        abs_col: false,
    });
    let null_cell = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 90,
            col: 90,
        },
        abs_row: false,
        abs_col: false,
    });
    let table = ASTNode::Array {
        rows: vec![
            vec![null_cell, ASTNode::Number(10.0)],
            vec![ASTNode::Number(2.0), ASTNode::Number(20.0)],
        ],
    };
    let node = func(
        "VLOOKUP",
        vec![
            null_ref,
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    // exact match: FALSE → match_type_arg negated → exact = true
    assert_eq!(eval(&node, &ctx), CellValue::number(10.0));
}

#[test]
fn test_hlookup_approx_null_lookup_returns_na() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // HLOOKUP approximate match with Null lookup → #N/A (same behavior as VLOOKUP).
    let null_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 99,
            col: 99,
        },
        abs_row: false,
        abs_col: false,
    });
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Number(1.0),
                ASTNode::Number(2.0),
                ASTNode::Number(3.0),
            ],
            vec![
                ASTNode::Number(10.0),
                ASTNode::Number(20.0),
                ASTNode::Number(30.0),
            ],
        ],
    };
    let node = func("HLOOKUP", vec![null_ref, table, ASTNode::Number(2.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

// =======================================================================
// Formula variable evaluation
// =======================================================================

#[test]
fn test_formula_variable_simple_arithmetic() {
    // Variable "MyConst" defined as "=1+2" should evaluate to 3
    let nrs = vec![NamedRangeDef::from_expression(
        "MyConst".to_string(),
        Scope::Workbook,
        "=1+2".to_string(),
    )];
    let (m, s) = test_mirror_with_named_ranges(nrs);
    let ctx = make_ctx(&m, s);
    let node = ident("MyConst");
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn test_formula_variable_with_function() {
    // Variable "SumVar" defined as "=SUM(1,2,3)" should evaluate to 6
    let nrs = vec![NamedRangeDef::from_expression(
        "SumVar".to_string(),
        Scope::Workbook,
        "=SUM(1,2,3)".to_string(),
    )];
    let (m, s) = test_mirror_with_named_ranges(nrs);
    let ctx = make_ctx(&m, s);
    let node = ident("SumVar");
    assert_eq!(eval(&node, &ctx), CellValue::number(6.0));
}

#[test]
fn test_formula_variable_uses_explicit_sheet_context_without_a_current_cell() {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: TEST_SHEET_UUID.to_string(),
            name: "Inputs".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: cell_uuid(0, 9),
                    row: 0,
                    col: 9,
                    value: CellValue::number(7.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_uuid(1, 9),
                    row: 1,
                    col: 9,
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![NamedRangeDef::from_expression(
            "InputPair".to_string(),
            Scope::Workbook,
            "=SUM(J1:J2)".to_string(),
        )],
        ..Default::default()
    };
    let mirror = CellMirror::from_snapshot(snapshot).unwrap();
    let sheet_id = mirror.sheet_by_name("Inputs").unwrap();
    let ctx = MirrorContext::new(&mirror, CellId::from_raw(0), sheet_id);

    assert_eq!(eval(&ident("InputPair"), &ctx), CellValue::number(12.0));
}

#[test]
fn test_formula_variable_transitive_resolution() {
    // Variable "Base" = "=10", Variable "Derived" = "=Base+5"
    // Derived should evaluate to 15 (transitive through Base)
    let nrs = vec![
        NamedRangeDef::from_expression("Base".to_string(), Scope::Workbook, "=10".to_string()),
        NamedRangeDef::from_expression(
            "Derived".to_string(),
            Scope::Workbook,
            "=Base+5".to_string(),
        ),
    ];
    let (m, s) = test_mirror_with_named_ranges(nrs);
    let ctx = make_ctx(&m, s);
    let node = ident("Derived");
    assert_eq!(eval(&node, &ctx), CellValue::number(15.0));
}

#[test]
fn test_formula_variable_error_propagation_not_name() {
    // Variable "BadDiv" defined as "=1/0" should return #DIV/0!, NOT #NAME?
    // This verifies 2b: existing-but-error variables propagate the specific error.
    let nrs = vec![NamedRangeDef::from_expression(
        "BadDiv".to_string(),
        Scope::Workbook,
        "=1/0".to_string(),
    )];
    let (m, s) = test_mirror_with_named_ranges(nrs);
    let ctx = make_ctx(&m, s);
    let node = ident("BadDiv");
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Div0, None));
}

#[test]
fn test_formula_variable_unknown_name_returns_name_error() {
    // An identifier that doesn't resolve at all should return #NAME?
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ident("NoSuchVariable");
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Name, None));
}

#[test]
fn test_formula_variable_unparseable_returns_name_error() {
    // Variable with an unparseable expression returns #NAME?
    let nrs = vec![NamedRangeDef::from_expression(
        "BadFormula".to_string(),
        Scope::Workbook,
        "=@@@INVALID".to_string(),
    )];
    let (m, s) = test_mirror_with_named_ranges(nrs);
    let ctx = make_ctx(&m, s);
    let node = ident("BadFormula");
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Name, None));
}

#[test]
fn test_formula_variable_circular_returns_ref_error() {
    // Circular variable: A references B, B references A.
    // Should hit depth limit and return #REF! (not infinite loop).
    let nrs = vec![
        NamedRangeDef::from_expression("VarA".to_string(), Scope::Workbook, "=VarB".to_string()),
        NamedRangeDef::from_expression("VarB".to_string(), Scope::Workbook, "=VarA".to_string()),
    ];
    let result = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024) // 64 MB — deep recursion needs large stack in debug
        .spawn(move || {
            let (m, s) = test_mirror_with_named_ranges(nrs);
            let ctx = make_ctx(&m, s);
            let node = ident("VarA");
            eval(&node, &ctx)
        })
        .unwrap()
        .join()
        .unwrap();
    // Circular chain hits depth limit -> #REF!
    assert_eq!(result, CellValue::Error(CellError::Ref, None));
}

#[test]
fn test_formula_variable_self_referential_returns_ref_error() {
    // Self-referencing variable: X = "=X + 1"
    let nrs = vec![NamedRangeDef::from_expression(
        "X".to_string(),
        Scope::Workbook,
        "=X+1".to_string(),
    )];
    let result = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(move || {
            let (m, s) = test_mirror_with_named_ranges(nrs);
            let ctx = make_ctx(&m, s);
            let node = ident("X");
            eval(&node, &ctx)
        })
        .unwrap()
        .join()
        .unwrap();
    assert_eq!(result, CellValue::Error(CellError::Ref, None));
}

#[test]
fn test_formula_variable_string_concat() {
    // Variable "Greeting" = "=\"Hello\" & \" World\""
    let nrs = vec![NamedRangeDef::from_expression(
        "Greeting".to_string(),
        Scope::Workbook,
        "=\"Hello\"&\" World\"".to_string(),
    )];
    let (m, s) = test_mirror_with_named_ranges(nrs);
    let ctx = make_ctx(&m, s);
    let node = ident("Greeting");
    assert_eq!(eval(&node, &ctx), CellValue::Text("Hello World".into()));
}

#[test]
fn test_formula_variable_nested_functions() {
    // Variable "Nested" = "=IF(TRUE, 42, 0)"
    let nrs = vec![NamedRangeDef::from_expression(
        "Nested".to_string(),
        Scope::Workbook,
        "=IF(TRUE,42,0)".to_string(),
    )];
    let (m, s) = test_mirror_with_named_ranges(nrs);
    let ctx = make_ctx(&m, s);
    let node = ident("Nested");
    assert_eq!(eval(&node, &ctx), CellValue::number(42.0));
}

#[test]
fn test_formula_variable_case_insensitive() {
    // Variable "myvar" should be resolvable as "MYVAR", "MyVar", etc.
    let nrs = vec![NamedRangeDef::from_expression(
        "myvar".to_string(),
        Scope::Workbook,
        "=99".to_string(),
    )];
    let (m, s) = test_mirror_with_named_ranges(nrs);
    let ctx = make_ctx(&m, s);
    // The identifier in the AST is "MYVAR" (uppercase)
    let node = ident("MYVAR");
    assert_eq!(eval(&node, &ctx), CellValue::number(99.0));
}
