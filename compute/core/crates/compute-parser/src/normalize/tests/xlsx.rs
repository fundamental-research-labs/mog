use super::super::{decode_xml_entities_str, xlsx::normalize_xlsx_formula};

// Prefix stripping

#[test]
fn test_strip_xlfn() {
    assert_eq!(
        normalize_xlsx_formula("_xlfn.FILTER(A1:A10,B1:B10)"),
        "=FILTER(A1:A10,B1:B10)"
    );
}

#[test]
fn test_strip_xlfn_xlws() {
    assert_eq!(
        normalize_xlsx_formula("_xlfn._xlws.SORT(A1:A10)"),
        "=SORT(A1:A10)"
    );
}

#[test]
fn test_strip_xlfn_single_and_anchorarray() {
    assert_eq!(
        normalize_xlsx_formula("_xlfn.SINGLE(A1:A5)"),
        "=SINGLE(A1:A5)"
    );
    assert_eq!(
        normalize_xlsx_formula("_xlfn.ANCHORARRAY(A1)"),
        "=ANCHORARRAY(A1)"
    );
}

#[test]
fn test_strip_xlfn_xlws_single_and_anchorarray() {
    assert_eq!(
        normalize_xlsx_formula("_xlfn._xlws.SINGLE(A1:A5)"),
        "=SINGLE(A1:A5)"
    );
    assert_eq!(
        normalize_xlsx_formula("_XLFN._XLWS.ANCHORARRAY(A1)"),
        "=ANCHORARRAY(A1)"
    );
}

#[test]
fn test_strip_xlpm() {
    assert_eq!(
        normalize_xlsx_formula("_xlfn.LET(_xlpm.pos,1,_xlpm.pos+1)"),
        "=LET(pos,1,pos+1)"
    );
}

#[test]
fn test_strip_case_insensitive() {
    assert_eq!(
        normalize_xlsx_formula("_XLFN.FILTER(A1:A10,B1:B10)"),
        "=FILTER(A1:A10,B1:B10)"
    );
    assert_eq!(normalize_xlsx_formula("_Xlpm.var"), "=var");
}

#[test]
fn test_preserve_strings() {
    assert_eq!(
        normalize_xlsx_formula(r#"IF(A1="_xlfn.test","_xlpm.val",B1)"#),
        r#"=IF(A1="_xlfn.test","_xlpm.val",B1)"#
    );
    assert_eq!(
        normalize_xlsx_formula(r#"IF(A1="_xlfn.SINGLE(A1:A5)","_xlfn.ANCHORARRAY(A1)",B1)"#),
        r#"=IF(A1="_xlfn.SINGLE(A1:A5)","_xlfn.ANCHORARRAY(A1)",B1)"#
    );
}

#[test]
fn test_preserve_doubled_quotes_in_strings() {
    assert_eq!(
        normalize_xlsx_formula(r#"IF(A1="""_xlfn.x""",1,2)"#),
        r#"=IF(A1="""_xlfn.x""",1,2)"#
    );
}

// Combined: entities + prefixes

#[test]
fn test_combined_entity_and_prefix() {
    assert_eq!(
        normalize_xlsx_formula("_xlfn.IF(A1&amp;B1&gt;0,1,0)"),
        "=IF(A1&B1>0,1,0)"
    );
}

#[test]
fn test_cross_sheet_entity() {
    assert_eq!(decode_xml_entities_str("Sheet &amp; Data"), "Sheet & Data");
}

#[test]
fn test_full_formula_normalization() {
    let raw = "_xlfn.LET(_xlpm.x,Sheet1!A1&amp;B1,_xlfn.IF(_xlpm.x&gt;0,1,0))";
    let expected = "=LET(x,Sheet1!A1&B1,IF(x>0,1,0))";
    assert_eq!(normalize_xlsx_formula(raw), expected);
}

#[test]
fn test_unicode_in_formula() {
    // Multi-byte UTF-8 chars (checkmark, X mark, etc.) must not panic
    assert_eq!(
        normalize_xlsx_formula(r#"IF(A1>0,"✓ Pass","✗ Fail")"#),
        r#"=IF(A1>0,"✓ Pass","✗ Fail")"#
    );
    assert_eq!(
        normalize_xlsx_formula("_xlfn.IF(A1>0,\"✓\",\"✗\")"),
        "=IF(A1>0,\"✓\",\"✗\")"
    );
    assert_eq!(normalize_xlsx_formula("'Просрочка'!A1"), "='Просрочка'!A1");
}

#[test]
fn test_no_change_for_clean_formula() {
    // Bare formula from XLSX gets `=` prepended
    assert_eq!(
        normalize_xlsx_formula("SUM(A1:B10)+C1*2"),
        "=SUM(A1:B10)+C1*2"
    );
}

#[test]
fn test_already_has_equals_prefix() {
    // Formulas that already have `=` (e.g. from our own snapshot round-trip)
    // must not get double `=`
    assert_eq!(normalize_xlsx_formula("=SUM(A1:B10)"), "=SUM(A1:B10)");
    assert_eq!(
        normalize_xlsx_formula("=_xlfn.FILTER(A1:A10,B1:B10)"),
        "=FILTER(A1:A10,B1:B10)"
    );
}

#[test]
fn test_empty_string() {
    assert_eq!(normalize_xlsx_formula(""), "");
}

#[test]
fn test_preserve_xlsx_prefixes_in_doubled_quote_literal() {
    assert_eq!(
        normalize_xlsx_formula(r#"IF(A1=""""_xlpm.val"""",1,2)"#),
        r#"=IF(A1=""""_xlpm.val"""",1,2)"#
    );
}
