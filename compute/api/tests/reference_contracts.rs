//! Reference syntax survives engine persistence, recalculation and mutation.
use compute_api::{CellValue, DefinedNameInput, Workbook};

#[test]
fn workbook_scoped_reference_survives_formula_commit_and_tracks_its_precedent() {
    let (workbook, _) = Workbook::blank().unwrap();
    let sheet = workbook.sheet_by_index(0).unwrap();
    sheet.set_cell("A1", "2").unwrap();
    sheet.set_cell("B1", "7").unwrap();
    for (scope, refers_to) in [
        (None, "=Sheet1!$A$1"),
        (Some(sheet.id().to_string()), "=Sheet1!$B$1"),
    ] {
        workbook
            .names()
            .create_named_range(DefinedNameInput {
                name: "Revenue".into(),
                refers_to: refers_to.into(),
                scope,
                comment: None,
            })
            .unwrap();
    }
    sheet.set_cell("C1", "=[0]!Revenue*10").unwrap();
    sheet.set_cell("D1", "=Revenue*10").unwrap();
    assert_eq!(sheet.get_cell_value("C1").unwrap(), CellValue::number(20.0));
    assert_eq!(sheet.get_cell_value("D1").unwrap(), CellValue::number(70.0));
    assert!(
        sheet
            .get_formula("C1")
            .unwrap()
            .unwrap()
            .contains("[0]!Revenue")
    );
    sheet.set_cell("A1", "3").unwrap();
    assert_eq!(sheet.get_cell_value("C1").unwrap(), CellValue::number(30.0));
    assert_eq!(sheet.get_cell_value("D1").unwrap(), CellValue::number(70.0));
    sheet.set_cell("B1", "9").unwrap();
    assert_eq!(sheet.get_cell_value("C1").unwrap(), CellValue::number(30.0));
    assert_eq!(sheet.get_cell_value("D1").unwrap(), CellValue::number(90.0));
}

#[test]
fn indirect_r1c1_and_reference_metadata_use_the_production_evaluator() {
    let (workbook, _) = Workbook::blank().unwrap();
    let sheet = workbook.sheet_by_index(0).unwrap();
    sheet.set_cell("A1", "11").unwrap();
    sheet
        .set_cell("B2", "=INDIRECT(\"R[-1]C[-1]\",FALSE)")
        .unwrap();
    sheet.set_cell("C2", "=ROW(INDIRECT(\"A5\"))").unwrap();
    sheet
        .set_cell("D2", "=COLUMN(INDIRECT(\"R1C5\",FALSE))")
        .unwrap();
    assert_eq!(sheet.get_cell_value("B2").unwrap(), CellValue::number(11.0));
    assert_eq!(sheet.get_cell_value("C2").unwrap(), CellValue::number(5.0));
    assert_eq!(sheet.get_cell_value("D2").unwrap(), CellValue::number(5.0));
    sheet.set_cell("A1", "23").unwrap();
    assert_eq!(sheet.get_cell_value("B2").unwrap(), CellValue::number(23.0));
}

#[test]
fn reverse_lookups_honor_bounds_duplicates_wildcards_and_cache_invalidation() {
    let (workbook, _) = Workbook::blank().unwrap();
    let sheet = workbook.sheet_by_index(0).unwrap();
    for (row, label, value) in [
        (1, "alpha", 900),
        (2, "alpha", 10),
        (3, "beta", 20),
        (4, "alpha", 30),
        (5, "alpha*", 40),
        (6, "alpha", 600),
    ] {
        sheet.set_cell(format!("A{row}").as_str(), label).unwrap();
        sheet
            .set_cell(format!("B{row}").as_str(), value.to_string().as_str())
            .unwrap();
    }
    for (address, formula, expected) in [
        ("D1", r#"=XLOOKUP("alpha",$A$2:$A$5,$B$2:$B$5,,0,-1)"#, 30.0),
        ("D2", r#"=XMATCH("alpha",$A$2:$A$5,0,-1)"#, 3.0),
        (
            "D3",
            r#"=XLOOKUP("ALPHA*",$A$2:$A$5,$B$2:$B$5,,2,-1)"#,
            40.0,
        ),
        (
            "D4",
            r#"=XLOOKUP("alpha*",$A$2:$A$5,$B$2:$B$5,-1,0,-1)"#,
            40.0,
        ),
        ("D5", r#"=XMATCH("ALPHA*",$A$2:$A$5,2,-1)"#, 4.0),
        (
            "D6",
            r#"=XLOOKUP({"alpha","beta"},$A$2:$A$5,$B$2:$B$5,,0,-1)"#,
            30.0,
        ),
    ] {
        sheet.set_cell(address, formula).unwrap();
        assert_eq!(
            sheet.get_cell_value(address).unwrap(),
            CellValue::number(expected),
            "{formula}"
        );
    }
    sheet
        .set_cell(
            "D7",
            r#"=XLOOKUP({"ALPHA*","bet?"},$A$2:$A$5,$B$2:$B$5,,2,-1)"#,
        )
        .unwrap();
    assert_eq!(sheet.get_cell_value("D7").unwrap(), CellValue::number(40.0));
    assert_eq!(sheet.get_cell_value("E7").unwrap(), CellValue::number(20.0));
    assert_eq!(sheet.get_cell_value("E6").unwrap(), CellValue::number(20.0));
    workbook.recalculate().unwrap();
    assert_eq!(sheet.get_cell_value("D1").unwrap(), CellValue::number(30.0));
    sheet.set_cell("A4", "gamma").unwrap();
    assert_eq!(sheet.get_cell_value("D1").unwrap(), CellValue::number(10.0));
    assert_eq!(sheet.get_cell_value("D2").unwrap(), CellValue::number(1.0));
    assert_eq!(sheet.get_cell_value("D6").unwrap(), CellValue::number(10.0));
    sheet.set_cell("A5", "gamma").unwrap();
    assert_eq!(sheet.get_cell_value("D3").unwrap(), CellValue::number(10.0));
    assert_eq!(sheet.get_cell_value("D4").unwrap(), CellValue::number(-1.0));
    assert_eq!(sheet.get_cell_value("D5").unwrap(), CellValue::number(1.0));
    assert_eq!(sheet.get_cell_value("D7").unwrap(), CellValue::number(10.0));
    assert_eq!(sheet.get_cell_value("E7").unwrap(), CellValue::number(20.0));
}

#[test]
fn information_functions_distinguish_reference_identity_and_array_value_type() {
    let (workbook, _) = Workbook::blank().unwrap();
    let sheet = workbook.sheet_by_index(0).unwrap();
    sheet.set_cell("A1", "=1/0").unwrap();
    for (address, formula, expected) in [
        ("C1", "=ISREF(A1)", CellValue::Boolean(true)),
        ("C2", "=ISREF(\"A1\")", CellValue::Boolean(false)),
        ("C3", "=ISREF(1)", CellValue::Boolean(false)),
        ("C4", "=ISREF({1,2})", CellValue::Boolean(false)),
        ("C5", "=ISREF(INDIRECT(\"A1\"))", CellValue::Boolean(true)),
        ("C6", "=ISREF(OFFSET(A1,1,0))", CellValue::Boolean(true)),
        ("C7", "=ISREF(INDIRECT(\"A0\"))", CellValue::Boolean(false)),
        ("D1", "=TYPE({1,2;3,4})", CellValue::number(64.0)),
        ("D2", "=TYPE(A1)", CellValue::number(16.0)),
        ("D3", "=TYPE(\"text\")", CellValue::number(2.0)),
        ("D4", "=TYPE(TRUE)", CellValue::number(4.0)),
        ("D5", "=TYPE(3)", CellValue::number(1.0)),
    ] {
        sheet.set_cell(address, formula).unwrap();
        assert_eq!(
            sheet.get_cell_value(address).unwrap(),
            expected,
            "{formula}"
        );
    }
}

#[test]
fn undefined_named_series_propagates_name_error_through_regression() {
    let (workbook, _) = Workbook::blank().unwrap();
    let sheet = workbook.sheet_by_index(0).unwrap();
    for (address, value) in [("A1", "1"), ("A2", "2"), ("A3", "3")] {
        sheet.set_cell(address, value).unwrap();
    }
    workbook
        .names()
        .create_named_range(DefinedNameInput {
            name: "observations".into(),
            refers_to: "=Sheet1!$A$1:$A$3".into(),
            scope: None,
            comment: None,
        })
        .unwrap();
    sheet
        .set_cell("C1", "=SLOPE(observations,missing_series)")
        .unwrap();
    sheet.set_cell("C2", "=SUM(missing_series)").unwrap();
    let expected = sheet.get_cell_value("C2").unwrap();
    assert!(matches!(
        expected,
        CellValue::Error(value_types::CellError::Name, _)
    ));
    assert!(matches!(
        sheet.get_cell_value("C1").unwrap(),
        CellValue::Error(value_types::CellError::Name, _)
    ));
}
