use super::*;

#[test]
fn classify_broken_ref_bare() {
    assert_eq!(
        ParsedExpr::classify("#REF!"),
        ParsedExpr::BrokenRef { sheet: None }
    );
    assert_eq!(
        ParsedExpr::classify("#ref!"),
        ParsedExpr::BrokenRef { sheet: None }
    );
    assert_eq!(
        ParsedExpr::classify("=#REF!"),
        ParsedExpr::BrokenRef { sheet: None }
    );
}

#[test]
fn classify_broken_ref_sheet_qualified() {
    match ParsedExpr::classify("Sheet1!#REF!") {
        ParsedExpr::BrokenRef { sheet: Some(name) } => assert_eq!(name.as_str(), "Sheet1"),
        other => panic!("expected BrokenRef with sheet, got {other:?}"),
    }
    match ParsedExpr::classify("'Deleted Sheet'!#REF!") {
        ParsedExpr::BrokenRef { sheet: Some(name) } => {
            assert_eq!(name.as_str(), "Deleted Sheet");
        }
        other => panic!("expected BrokenRef with quoted sheet, got {other:?}"),
    }
    match ParsedExpr::classify("='Deleted Sheet'!#REF!") {
        ParsedExpr::BrokenRef { sheet: Some(name) } => {
            assert_eq!(name.as_str(), "Deleted Sheet");
        }
        other => panic!("expected BrokenRef with quoted sheet, got {other:?}"),
    }
}

#[test]
fn broken_ref_plus_other_tokens_remains_formula() {
    for s in ["Sheet1!#REF!+A1", "=Sheet1!#REF!+A1", "=#REF!+1"] {
        match ParsedExpr::classify(s) {
            ParsedExpr::Formula(fs) => assert_eq!(fs.original, s),
            other => panic!("expected Formula for {s}, got {other:?}"),
        }
    }
}

#[test]
fn sanitize_regression_ref_error_only_pure_ref() {
    assert!(is_orphan_ref("#REF!"));
    assert!(is_orphan_ref("=#REF!"));
    assert!(is_orphan_ref(" #REF! "));
    assert!(is_orphan_ref(" =#REF! "));
}

#[test]
fn sanitize_regression_ref_error_only_sheet_qualified() {
    assert!(is_orphan_ref("Sheet1!#REF!"));
    assert!(is_orphan_ref("=Sheet1!#REF!"));
    assert!(is_orphan_ref("'Bond-Refinancing'!#REF!"));
    assert!(is_orphan_ref("='Bond-Refinancing'!#REF!"));
}

#[test]
fn sanitize_regression_ref_error_only_expressions_with_refs() {
    assert!(!is_orphan_ref("=#REF!+1"));
    assert!(!is_orphan_ref("=Sheet1!#REF!+A1"));
}

#[test]
fn sanitize_regression_ref_error_only_valid_refs_and_constants() {
    assert!(!is_orphan_ref("=42"));
    assert!(!is_orphan_ref("='Sheet1'!$A$1"));
}

#[test]
fn sanitize_regression_ref_error_only_empty_is_orphan() {
    assert!(is_orphan_ref(""));
}

#[test]
fn sanitize_regression_utf8_boundary_no_panic() {
    assert!(!is_orphan_ref(
        "OFFSET(Πλήρης_Εκτύπωση,0,0,'Input -1'!Τελευταία_γραμμή)"
    ));
    assert!(!is_orphan_ref("=Sheet1!γραμμή"));
    assert!(!is_orphan_ref("μμμμμμ"));
}

#[test]
fn sanitize_regression_non_ascii_sheet_name_broken_ref() {
    assert!(is_orphan_ref("'Πίνακας'!#REF!"));
    assert!(is_orphan_ref("='Πίνακας'!#REF!"));
}

#[test]
fn sanitize_regression_is_ref_error_only_never_panics_samples() {
    let samples = [
        "",
        "!",
        "#",
        "!#",
        "!#R",
        "!#RE",
        "!#REF",
        "!#REF!",
        "μ",
        "μμ",
        "μμμ",
        "μμμμ",
        "μμμμμ",
        "μμμμμμ",
        "μμμμμμμ",
        "=μ",
        "=μμμμμμ",
        "a!μμμμμ",
        "a!#μREF",
        "a!#RμF!",
        "a!#REFμ",
        "💥",
        "💥!#REF!",
        "'a'!#REF!💥",
        "A!#REF!",
    ];
    for s in samples {
        let _ = ParsedExpr::classify(s);
    }
}

#[test]
fn sanitize_regression_broken_cell_ref_semantics() {
    assert!(matches!(ParsedExpr::classify("$A$1"), ParsedExpr::Cell(_)));
    assert!(matches!(
        ParsedExpr::classify("Sheet1!$F$10"),
        ParsedExpr::Cell(_)
    ));
    assert!(matches!(
        ParsedExpr::classify("#REF!"),
        ParsedExpr::BrokenRef { .. }
    ));
    assert!(matches!(
        ParsedExpr::classify("Sheet1!#REF!"),
        ParsedExpr::BrokenRef { .. }
    ));
}
