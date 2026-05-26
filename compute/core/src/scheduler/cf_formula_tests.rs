use super::*;
use crate::cf::types::{CFRule, CFRuleKind, CfRenderStyle};
use crate::mirror::CellMirror;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use cell_types::RangePos;
use compute_parser::{AbsFlags, CellRefNode, RangeRef};
use value_types::{CellValue, Color};

fn test_style() -> CfRenderStyle {
    CfRenderStyle {
        background_color: Some(Color::from_hex("#FF0000").unwrap()),
        ..Default::default()
    }
}

fn cell_uuid(n: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", n)
}

fn sheet_uuid() -> String {
    "00000000-0000-0000-0000-000000000001".to_string()
}

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid()).unwrap()
}

/// Workbook: A1:A5 = [1, 5, 10, 3, 0]. CellIDs: 0x10..0x14.
fn make_cf_snapshot() -> WorkbookSnapshot {
    let values = [1.0, 5.0, 10.0, 3.0, 0.0];
    let cells: Vec<CellData> = values
        .iter()
        .enumerate()
        .map(|(i, &v)| CellData {
            cell_id: cell_uuid(0x10 + i as u32),
            row: i as u32,
            col: 0,
            value: CellValue::number(v),
            formula: None,
            identity_formula: None,
            array_ref: None,
        })
        .collect();
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 5,
            cells,
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
    }
}

/// Build a RangePos covering the given row/col bounds on the test sheet.
fn make_range(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> RangePos {
    RangePos::new(sheet_id(), start_row, start_col, end_row, end_col)
}

/// Default test range: A1:A5 (rows 0-4, col 0).
fn default_range() -> RangePos {
    make_range(0, 0, 4, 0)
}

fn make_formula_rule(formula: &str, priority: i32) -> CFRule {
    CFRule {
        priority,
        stop_if_true: false,
        ranges: vec![default_range()],
        style: Some(test_style()),
        kind: CFRuleKind::Formula {
            formula: formula.to_string(),
        },
    }
}

#[test]
fn test_cf_formula_simple() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    let rules = vec![make_formula_rule("=A1>5", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    // Only A3=10 satisfies >5
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].row, 2);
    assert!(results[0].style.is_some());
}

#[test]
fn test_cf_formula_relative_shift() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    let rules = vec![make_formula_rule("=A1>=3", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    // A2=5, A3=10, A4=3 satisfy >=3
    assert_eq!(results.len(), 3);
    let mut rows: Vec<u32> = results.iter().map(|r| r.row).collect();
    rows.sort();
    assert_eq!(rows, vec![1, 2, 3]);
}

#[test]
fn test_cf_formula_absolute_ref() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    // $A$1>5 => all cells check A1=1, 1>5=false
    let rules = vec![make_formula_rule("=$A$1>5", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_cf_formula_absolute_ref_match() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    // $A$1>0 => all cells check A1=1, 1>0=true
    let rules = vec![make_formula_rule("=$A$1>0", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 5);
}

#[test]
fn test_cf_formula_mixed_ref() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    // $A1>3: col absolute, row relative
    let rules = vec![make_formula_rule("=$A1>3", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    // A2=5>3, A3=10>3
    assert_eq!(results.len(), 2);
    let mut rows: Vec<u32> = results.iter().map(|r| r.row).collect();
    rows.sort();
    assert_eq!(rows, vec![1, 2]);
}

#[test]
fn test_cf_formula_boolean_result() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    // =A1=10 => only A3=10 matches
    let rules = vec![make_formula_rule("=A1=10", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].row, 2);
}

#[test]
fn test_cf_formula_numeric_result() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    // =A1 => raw value, truthy if non-zero. A5=0 is falsy.
    let rules = vec![make_formula_rule("=A1", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 4);
    let mut rows: Vec<u32> = results.iter().map(|r| r.row).collect();
    rows.sort();
    assert_eq!(rows, vec![0, 1, 2, 3]);
}

#[test]
fn test_cf_formula_error() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    // =1/0 => IEEE 754 Infinity (truthy) or error. Must not panic.
    let rules = vec![make_formula_rule("=1/0", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert!(results.len() <= 5);
}

#[test]
fn test_cf_formula_invalid_parse() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    let rules = vec![make_formula_rule("=!!!INVALID!!!", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_cf_formula_no_equals_prefix() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    let rules = vec![make_formula_rule("A1>5", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].row, 2);
}

#[test]
fn test_cf_formula_empty_range() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    // Range outside any populated area — should produce no results
    let rules = vec![CFRule {
        priority: 1,
        stop_if_true: false,
        ranges: vec![make_range(1000, 1000, 1001, 1001)],
        style: Some(test_style()),
        kind: CFRuleKind::Formula {
            formula: "=A1>0".to_string(),
        },
    }];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_cf_formula_cross_column() {
    let cells = vec![
        CellData {
            cell_id: cell_uuid(0x20),
            row: 0,
            col: 0,
            value: CellValue::number(1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(0x21),
            row: 0,
            col: 1,
            value: CellValue::number(10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(0x22),
            row: 1,
            col: 0,
            value: CellValue::number(5.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(0x23),
            row: 1,
            col: 1,
            value: CellValue::number(3.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(0x24),
            row: 2,
            col: 0,
            value: CellValue::number(8.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(0x25),
            row: 2,
            col: 1,
            value: CellValue::number(2.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ];
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 5,
            cells,
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
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    // =A1>B1, applied to A1:A3
    let rules = vec![CFRule {
        priority: 1,
        stop_if_true: false,
        ranges: vec![make_range(0, 0, 2, 0)],
        style: Some(test_style()),
        kind: CFRuleKind::Formula {
            formula: "=A1>B1".to_string(),
        },
    }];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 2);
    let mut rows: Vec<u32> = results.iter().map(|r| r.row).collect();
    rows.sort();
    assert_eq!(rows, vec![1, 2]);
}

// --- shift_ast_for_cf unit tests ---

#[test]
fn test_shift_ast_relative() {
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: SheetId::from_raw(0),
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let shifted = shift_ast_for_cf(&ast, 2, 0, SheetId::from_raw(1));
    match shifted {
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional { sheet, row, col },
            ..
        }) => {
            assert_eq!(sheet, SheetId::from_raw(1));
            assert_eq!(row, 2);
            assert_eq!(col, 0);
        }
        _ => panic!("Expected shifted Positional"),
    }
}

#[test]
fn test_shift_ast_absolute() {
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: SheetId::from_raw(0),
            row: 0,
            col: 0,
        },
        abs_row: true,
        abs_col: true,
    });
    let shifted = shift_ast_for_cf(&ast, 5, 3, SheetId::from_raw(1));
    match shifted {
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional { row, col, .. },
            ..
        }) => {
            assert_eq!(row, 0);
            assert_eq!(col, 0);
        }
        _ => panic!("Expected Positional"),
    }
}

#[test]
fn test_shift_ast_mixed() {
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: SheetId::from_raw(0),
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: true,
    });
    let shifted = shift_ast_for_cf(&ast, 3, 2, SheetId::from_raw(1));
    match shifted {
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional { row, col, .. },
            ..
        }) => {
            assert_eq!(row, 3);
            assert_eq!(col, 0);
        }
        _ => panic!("Expected Positional"),
    }
}

#[test]
fn test_shift_ast_negative_clamp() {
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: SheetId::from_raw(0),
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let shifted = shift_ast_for_cf(&ast, -5, -3, SheetId::from_raw(1));
    match shifted {
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional { row, col, .. },
            ..
        }) => {
            assert_eq!(row, 0);
            assert_eq!(col, 0);
        }
        _ => panic!("Expected Positional"),
    }
}

#[test]
fn test_shift_ast_binary_op() {
    use compute_parser::BinOp;
    let ast = ASTNode::BinaryOp {
        op: BinOp::Gt,
        left: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            },
            abs_row: false,
            abs_col: false,
        })),
        right: Box::new(ASTNode::Number(5.0)),
    };
    let shifted = shift_ast_for_cf(&ast, 3, 0, SheetId::from_raw(1));
    match shifted {
        ASTNode::BinaryOp { left, right, .. } => {
            match *left {
                ASTNode::CellReference(CellRefNode {
                    reference: CellRef::Positional { row, .. },
                    ..
                }) => assert_eq!(row, 3),
                _ => panic!("Expected CellReference"),
            }
            match *right {
                ASTNode::Number(n) => assert_eq!(n, 5.0),
                _ => panic!("Expected Number"),
            }
        }
        _ => panic!("Expected BinaryOp"),
    }
}

#[test]
fn test_shift_ast_range() {
    use formula_types::RangeType;
    let ast = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: SheetId::from_raw(0),
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: SheetId::from_raw(0),
            row: 4,
            col: 1,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let shifted = shift_ast_for_cf(&ast, 2, 1, SheetId::from_raw(1));
    match shifted {
        ASTNode::Range(RangeRef {
            start: CellRef::Positional {
                row: sr, col: sc, ..
            },
            end: CellRef::Positional {
                row: er, col: ec, ..
            },
            ..
        }) => {
            assert_eq!(sr, 2);
            assert_eq!(sc, 1);
            assert_eq!(er, 6);
            assert_eq!(ec, 2);
        }
        _ => panic!("Expected Range"),
    }
}

#[test]
fn test_cf_formula_with_function() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    let rules = vec![make_formula_rule("=A1>SUM(A1:A5)/5", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 3);
    let mut rows: Vec<u32> = results.iter().map(|r| r.row).collect();
    rows.sort();
    assert_eq!(rows, vec![1, 2, 3]);
}

#[test]
fn test_cf_formula_multiple_rules() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    let rules = vec![
        CFRule {
            priority: 1,
            stop_if_true: false,
            ranges: vec![default_range()],
            style: Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            kind: CFRuleKind::Formula {
                formula: "=A1>5".to_string(),
            },
        },
        CFRule {
            priority: 2,
            stop_if_true: false,
            ranges: vec![default_range()],
            style: Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            kind: CFRuleKind::Formula {
                formula: "=A1>=1".to_string(),
            },
        },
    ];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    // A3: both rules -> red bg + bold
    let a3 = results.iter().find(|r| r.row == 2).unwrap();
    let a3s = a3.style.as_ref().unwrap();
    assert_eq!(
        a3s.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(a3s.bold, Some(true));
    // A1: only rule2 -> bold
    let a1 = results.iter().find(|r| r.row == 0).unwrap();
    let a1s = a1.style.as_ref().unwrap();
    assert_eq!(a1s.background_color, None);
    assert_eq!(a1s.bold, Some(true));
}

#[test]
fn test_cf_formula_stop_if_true() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    let rules = vec![
        CFRule {
            priority: 1,
            stop_if_true: true,
            ranges: vec![default_range()],
            style: Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            kind: CFRuleKind::Formula {
                formula: "=A1>5".to_string(),
            },
        },
        CFRule {
            priority: 2,
            stop_if_true: false,
            ranges: vec![default_range()],
            style: Some(CfRenderStyle {
                bold: Some(true),
                ..Default::default()
            }),
            kind: CFRuleKind::Formula {
                formula: "=A1>=1".to_string(),
            },
        },
    ];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    // A3 matches rule1 (stop), rule2 NOT evaluated
    let a3 = results.iter().find(|r| r.row == 2).unwrap();
    assert_eq!(
        a3.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(a3.style.as_ref().unwrap().bold, None);
    // A1 doesn't match rule1, rule2 IS evaluated
    let a1 = results.iter().find(|r| r.row == 0).unwrap();
    assert_eq!(a1.style.as_ref().unwrap().background_color, None);
    assert_eq!(a1.style.as_ref().unwrap().bold, Some(true));
}

#[test]
fn test_cf_formula_row_absolute() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    // =A$1>3: row absolute (always row 0 = A1=1), 1>3=false for all
    let rules = vec![make_formula_rule("=A$1>3", 1)];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_cf_formula_mixed_with_value_rules() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, make_cf_snapshot())
        .unwrap();
    let rules = vec![
        CFRule {
            priority: 1,
            stop_if_true: false,
            ranges: vec![default_range()],
            style: Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            kind: CFRuleKind::Formula {
                formula: "=A1>5".to_string(),
            },
        },
        CFRule {
            priority: 2,
            stop_if_true: false,
            ranges: vec![default_range()],
            style: Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            kind: CFRuleKind::CellValue {
                comparison: crate::cf::types::CellValueComparison::Single {
                    operator: crate::cf::types::CellValueSingleOp::Equal,
                    threshold: crate::cf::types::CellValueThreshold {
                        text: "0".to_string(),
                        number: Some(0.0),
                    },
                },
            },
        },
    ];
    let results = core.eval_cf(&mirror, &sheet_id(), &rules);
    // A3=10: formula matches
    let a3 = results.iter().find(|r| r.row == 2).unwrap();
    assert_eq!(
        a3.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // A5=0: value rule matches
    let a5 = results.iter().find(|r| r.row == 4).unwrap();
    assert_eq!(a5.style.as_ref().unwrap().italic, Some(true));
}
