//! Source-independent formula contracts.
//!
//! These tests complement `dev/formula-eval`: they encode small, durable
//! product contracts without depending on XLSX cached values. Workbook cases
//! must hydrate through `YrsComputeEngine::from_snapshot` so they exercise the
//! same storage/mirror/recalc path used by production engine initialization.

use cell_types::{SheetId, SheetPos};
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use compute_core::storage::engine::YrsComputeEngine;
use value_types::{CellValue, FiniteF64};

#[derive(Debug, Clone, Copy)]
enum ContractKind {
    ExcelCompat,
    MogSpec,
}

#[derive(Debug, Clone)]
struct FormulaContractCase {
    id: &'static str,
    kind: ContractKind,
    snapshot: WorkbookSnapshot,
    expected: Vec<ExpectedCell>,
}

#[derive(Debug, Clone)]
struct ExpectedCell {
    sheet_name: &'static str,
    row: u32,
    col: u32,
    value: ExpectedValue,
}

#[derive(Debug, Clone)]
enum ExpectedValue {
    Number { value: f64, tolerance: f64 },
    Text(&'static str),
    Boolean(bool),
    Error(&'static str),
    Blank,
}

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn cell(sheet_idx: u32, row: u32, col: u32, value: CellValue, formula: Option<&str>) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value,
        formula: formula.map(str::to_string),
        identity_formula: None,
        array_ref: None,
    }
}

fn number(sheet_idx: u32, row: u32, col: u32, value: f64) -> CellData {
    cell(
        sheet_idx,
        row,
        col,
        CellValue::Number(FiniteF64::must(value)),
        None,
    )
}

fn text(sheet_idx: u32, row: u32, col: u32, value: &str) -> CellData {
    cell(sheet_idx, row, col, CellValue::Text(value.into()), None)
}

fn formula(sheet_idx: u32, row: u32, col: u32, formula: &str) -> CellData {
    cell(sheet_idx, row, col, CellValue::Null, Some(formula))
}

fn workbook(sheets: Vec<(&'static str, u32, u32, Vec<CellData>)>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: sheets
            .into_iter()
            .enumerate()
            .map(|(idx, (name, rows, cols, cells))| SheetSnapshot {
                id: sheet_uuid(idx as u32),
                name: name.to_string(),
                rows,
                cols,
                cells,
                ranges: vec![],
            })
            .collect(),
        ..WorkbookSnapshot::default()
    }
}

fn cases() -> Vec<FormulaContractCase> {
    vec![
        FormulaContractCase {
            id: "criteria_sumifs_cross_sheet_full_column_text_criteria",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![
                (
                    "Data",
                    100,
                    10,
                    vec![
                        text(0, 1, 0, "USA"),
                        number(0, 1, 1, 10.0),
                        text(0, 2, 0, "CAN"),
                        number(0, 2, 1, 20.0),
                        text(0, 3, 0, "USA"),
                        number(0, 3, 1, 30.0),
                        text(0, 4, 0, ""),
                        number(0, 4, 1, 40.0),
                    ],
                ),
                (
                    "Summary",
                    10,
                    10,
                    vec![formula(1, 0, 0, r#"SUMIFS(Data!B:B,Data!A:A,"USA")"#)],
                ),
            ]),
            expected: vec![ExpectedCell {
                sheet_name: "Summary",
                row: 0,
                col: 0,
                value: ExpectedValue::Number {
                    value: 40.0,
                    tolerance: 0.0,
                },
            }],
        },
        FormulaContractCase {
            id: "lookup_xlookup_exact_match_returns_first_unsorted_duplicate",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    text(0, 0, 0, "C"),
                    number(0, 0, 1, 30.0),
                    text(0, 1, 0, "B"),
                    number(0, 1, 1, 20.0),
                    text(0, 2, 0, "A"),
                    number(0, 2, 1, 10.0),
                    text(0, 3, 0, "B"),
                    number(0, 3, 1, 200.0),
                    formula(0, 0, 3, r#"XLOOKUP("B",A1:A4,B1:B4)"#),
                ],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 3,
                value: ExpectedValue::Number {
                    value: 20.0,
                    tolerance: 0.0,
                },
            }],
        },
        FormulaContractCase {
            id: "wrapper_iferror_contains_lookup_na_to_fallback_text",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    text(0, 0, 0, "A"),
                    number(0, 0, 1, 10.0),
                    text(0, 1, 0, "B"),
                    number(0, 1, 1, 20.0),
                    formula(0, 0, 3, r#"IFERROR(XLOOKUP("Z",A1:A2,B1:B2),"missing")"#),
                ],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 3,
                value: ExpectedValue::Text("missing"),
            }],
        },
        FormulaContractCase {
            id: "lookup_xlookup_missing_value_returns_na_error",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    text(0, 0, 0, "A"),
                    number(0, 0, 1, 10.0),
                    text(0, 1, 0, "B"),
                    number(0, 1, 1, 20.0),
                    formula(0, 0, 3, r#"XLOOKUP("Z",A1:A2,B1:B2)"#),
                ],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 3,
                value: ExpectedValue::Error("#N/A"),
            }],
        },
        FormulaContractCase {
            id: "mog_spec_boolean_logic_preserves_typed_boolean_result",
            kind: ContractKind::MogSpec,
            snapshot: workbook(vec![(
                "Sheet1",
                10,
                10,
                vec![formula(0, 0, 0, "AND(1<2,TRUE,NOT(FALSE))")],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 0,
                value: ExpectedValue::Boolean(true),
            }],
        },
        FormulaContractCase {
            id: "criteria_countif_wildcard_is_case_insensitive",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    text(0, 0, 0, "alpha"),
                    text(0, 1, 0, "ALPS"),
                    text(0, 2, 0, "beta"),
                    text(0, 3, 0, "apricot"),
                    formula(0, 0, 2, r#"COUNTIF(A1:A4,"a*")"#),
                ],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 2,
                value: ExpectedValue::Number {
                    value: 3.0,
                    tolerance: 0.0,
                },
            }],
        },
        FormulaContractCase {
            id: "criteria_countifs_pairs_apply_all_criteria",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    text(0, 0, 0, "west"),
                    text(0, 0, 1, "open"),
                    text(0, 1, 0, "west"),
                    text(0, 1, 1, "closed"),
                    text(0, 2, 0, "east"),
                    text(0, 2, 1, "open"),
                    text(0, 3, 0, "west"),
                    text(0, 3, 1, "open"),
                    formula(0, 0, 3, r#"COUNTIFS(A1:A4,"west",B1:B4,"open")"#),
                ],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 3,
                value: ExpectedValue::Number {
                    value: 2.0,
                    tolerance: 0.0,
                },
            }],
        },
        FormulaContractCase {
            id: "lookup_index_match_exact_match_over_unsorted_labels",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    text(0, 0, 0, "C"),
                    number(0, 0, 1, 30.0),
                    text(0, 1, 0, "B"),
                    number(0, 1, 1, 20.0),
                    text(0, 2, 0, "A"),
                    number(0, 2, 1, 10.0),
                    formula(0, 0, 3, r#"INDEX(B1:B3,MATCH("B",A1:A3,0))"#),
                ],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 3,
                value: ExpectedValue::Number {
                    value: 20.0,
                    tolerance: 0.0,
                },
            }],
        },
        FormulaContractCase {
            id: "math_sumproduct_multiplies_pairs_and_sums",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    number(0, 0, 0, 1.0),
                    number(0, 1, 0, 2.0),
                    number(0, 2, 0, 3.0),
                    number(0, 0, 1, 4.0),
                    number(0, 1, 1, 5.0),
                    number(0, 2, 1, 6.0),
                    formula(0, 0, 3, "SUMPRODUCT(A1:A3,B1:B3)"),
                ],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 3,
                value: ExpectedValue::Number {
                    value: 32.0,
                    tolerance: 0.0,
                },
            }],
        },
        FormulaContractCase {
            id: "wrapper_let_binds_aggregate_once",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    number(0, 0, 0, 1.0),
                    number(0, 1, 0, 2.0),
                    number(0, 2, 0, 3.0),
                    formula(0, 0, 2, "LET(total,SUM(A1:A3),total*2)"),
                ],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 2,
                value: ExpectedValue::Number {
                    value: 12.0,
                    tolerance: 0.0,
                },
            }],
        },
        FormulaContractCase {
            id: "wrapper_choose_returns_selected_text_arm",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                10,
                10,
                vec![formula(0, 0, 0, r#"CHOOSE(2,"first","second","third")"#)],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 0,
                value: ExpectedValue::Text("second"),
            }],
        },
        FormulaContractCase {
            id: "dynamic_filter_spills_matching_rows_and_stops_at_shape",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    text(0, 0, 0, "red"),
                    text(0, 1, 0, "green"),
                    text(0, 2, 0, "blue"),
                    text(0, 3, 0, "gray"),
                    text(0, 0, 1, "yes"),
                    text(0, 1, 1, "no"),
                    text(0, 2, 1, "yes"),
                    text(0, 3, 1, "no"),
                    formula(0, 0, 3, r#"FILTER(A1:A4,B1:B4="yes")"#),
                ],
            )]),
            expected: vec![
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 0,
                    col: 3,
                    value: ExpectedValue::Text("red"),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 1,
                    col: 3,
                    value: ExpectedValue::Text("blue"),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 2,
                    col: 3,
                    value: ExpectedValue::Blank,
                },
            ],
        },
        FormulaContractCase {
            id: "dynamic_sort_spills_sorted_numbers_vertically",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    number(0, 0, 0, 3.0),
                    number(0, 1, 0, 1.0),
                    number(0, 2, 0, 2.0),
                    formula(0, 0, 2, "SORT(A1:A3)"),
                ],
            )]),
            expected: vec![
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 0,
                    col: 2,
                    value: ExpectedValue::Number {
                        value: 1.0,
                        tolerance: 0.0,
                    },
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 1,
                    col: 2,
                    value: ExpectedValue::Number {
                        value: 2.0,
                        tolerance: 0.0,
                    },
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 2,
                    col: 2,
                    value: ExpectedValue::Number {
                        value: 3.0,
                        tolerance: 0.0,
                    },
                },
            ],
        },
        FormulaContractCase {
            id: "numeric_average_uses_tolerance_for_binary_float_result",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                10,
                10,
                vec![formula(0, 0, 0, "AVERAGE(0.1,0.2)")],
            )]),
            expected: vec![ExpectedCell {
                sheet_name: "Sheet1",
                row: 0,
                col: 0,
                value: ExpectedValue::Number {
                    value: 0.15,
                    tolerance: 1e-12,
                },
            }],
        },
        FormulaContractCase {
            id: "sheets_type_conversion_functions_evaluate_as_values",
            kind: ContractKind::ExcelCompat,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    formula(0, 0, 0, "TO_DATE(1)"),
                    formula(0, 1, 0, "TO_DOLLARS(12.5)"),
                    formula(0, 2, 0, "TO_PERCENT(0.5)"),
                    formula(0, 3, 0, "TO_PURE_NUMBER(50%)"),
                    formula(0, 4, 0, "TO_TEXT(24)"),
                    formula(0, 5, 0, "EPOCHTODATE(0,1)"),
                    formula(0, 6, 0, "_xlfn.TO_TEXT(24)"),
                ],
            )]),
            expected: vec![
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 0,
                    col: 0,
                    value: ExpectedValue::Number {
                        value: 1.0,
                        tolerance: 0.0,
                    },
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 1,
                    col: 0,
                    value: ExpectedValue::Number {
                        value: 12.5,
                        tolerance: 0.0,
                    },
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 2,
                    col: 0,
                    value: ExpectedValue::Number {
                        value: 0.5,
                        tolerance: 0.0,
                    },
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 3,
                    col: 0,
                    value: ExpectedValue::Number {
                        value: 0.5,
                        tolerance: 0.0,
                    },
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 4,
                    col: 0,
                    value: ExpectedValue::Text("24"),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 5,
                    col: 0,
                    value: ExpectedValue::Number {
                        value: 25569.0,
                        tolerance: 0.0,
                    },
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 6,
                    col: 0,
                    value: ExpectedValue::Text("24"),
                },
            ],
        },
        FormulaContractCase {
            id: "sheets_information_validation_predicates_workbook_path",
            kind: ContractKind::MogSpec,
            snapshot: workbook(vec![(
                "Sheet1",
                20,
                10,
                vec![
                    formula(0, 0, 0, "ISBETWEEN(5,1,10)"),
                    formula(0, 1, 0, "ISBETWEEN(1,1,10,FALSE,TRUE)"),
                    formula(0, 2, 0, "ISDATE(DATE(2025,1,1))"),
                    formula(0, 3, 0, r#"ISDATE("July")"#),
                    formula(0, 4, 0, r#"ISEMAIL("janesmith@yourname.xyz")"#),
                    formula(0, 5, 0, r#"ISEMAIL("missing-domain@")"#),
                    formula(0, 6, 0, r#"ISURL("https://example.com/path?q=1#top")"#),
                    formula(0, 7, 0, r#"ISURL("example")"#),
                    formula(0, 8, 0, r#"ISURL("mailto:noreply@example.com")"#),
                ],
            )]),
            expected: vec![
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 0,
                    col: 0,
                    value: ExpectedValue::Boolean(true),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 1,
                    col: 0,
                    value: ExpectedValue::Boolean(false),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 2,
                    col: 0,
                    value: ExpectedValue::Boolean(true),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 3,
                    col: 0,
                    value: ExpectedValue::Boolean(false),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 4,
                    col: 0,
                    value: ExpectedValue::Boolean(true),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 5,
                    col: 0,
                    value: ExpectedValue::Boolean(false),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 6,
                    col: 0,
                    value: ExpectedValue::Boolean(true),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 7,
                    col: 0,
                    value: ExpectedValue::Boolean(false),
                },
                ExpectedCell {
                    sheet_name: "Sheet1",
                    row: 8,
                    col: 0,
                    value: ExpectedValue::Boolean(true),
                },
            ],
        },
    ]
}

#[test]
fn formula_contract_cases() {
    for case in cases() {
        run_case(case);
    }
}

fn run_case(case: FormulaContractCase) {
    let FormulaContractCase {
        id,
        kind,
        snapshot,
        expected,
    } = case;
    let sheet_ids: Vec<(String, SheetId)> = snapshot
        .sheets
        .iter()
        .map(|sheet| {
            (
                sheet.name.clone(),
                SheetId::from_uuid_str(&sheet.id).expect("valid sheet uuid"),
            )
        })
        .collect();

    let (engine, _initial_recalc) = YrsComputeEngine::from_snapshot(snapshot)
        .unwrap_or_else(|err| panic!("[{} {:?}] from_snapshot failed: {:?}", id, kind, err));

    for expected in &expected {
        let sheet_id = sheet_ids
            .iter()
            .find(|(name, _)| name == expected.sheet_name)
            .map(|(_, sheet_id)| *sheet_id)
            .unwrap_or_else(|| panic!("[{}] missing sheet {}", id, expected.sheet_name));
        let actual = engine
            .mirror()
            .get_cell_value_at(&sheet_id, SheetPos::new(expected.row, expected.col))
            .cloned()
            .unwrap_or(CellValue::Null);
        assert_expected(id, kind, expected, &actual);
    }
}

fn assert_expected(case_id: &str, kind: ContractKind, expected: &ExpectedCell, actual: &CellValue) {
    match (&expected.value, actual) {
        (ExpectedValue::Number { value, tolerance }, CellValue::Number(actual)) => {
            let delta = (actual.get() - value).abs();
            assert!(
                delta <= *tolerance,
                "[{} {:?}] {}!R{}C{} expected number {} +/- {}, got {}",
                case_id,
                kind,
                expected.sheet_name,
                expected.row + 1,
                expected.col + 1,
                value,
                tolerance,
                actual.get()
            );
        }
        (ExpectedValue::Text(value), CellValue::Text(actual)) => {
            assert_eq!(
                actual.as_ref(),
                *value,
                "[{} {:?}] {}!R{}C{} text mismatch",
                case_id,
                kind,
                expected.sheet_name,
                expected.row + 1,
                expected.col + 1
            );
        }
        (ExpectedValue::Boolean(value), CellValue::Boolean(actual)) => {
            assert_eq!(
                actual,
                value,
                "[{} {:?}] {}!R{}C{} boolean mismatch",
                case_id,
                kind,
                expected.sheet_name,
                expected.row + 1,
                expected.col + 1
            );
        }
        (ExpectedValue::Error(value), CellValue::Error(actual, _)) => {
            assert_eq!(
                actual.as_str(),
                *value,
                "[{} {:?}] {}!R{}C{} error mismatch",
                case_id,
                kind,
                expected.sheet_name,
                expected.row + 1,
                expected.col + 1
            );
        }
        (ExpectedValue::Blank, CellValue::Null) => {}
        _ => panic!(
            "[{} {:?}] {}!R{}C{} expected {:?}, got {:?}",
            case_id,
            kind,
            expected.sheet_name,
            expected.row + 1,
            expected.col + 1,
            expected.value,
            actual
        ),
    }
}
