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

#[test]
fn test_preserve_prefixed_sheet_and_table_names() {
    for formula in [
        "'_xlfn.Budget'!A1+_xlfn.SUM(A2)",
        "'Budget''s _xlpm.total'!A1+_xlfn.SUM(A2)",
        "_xlfn.Budget!A1+_xlfn.SUM(A2)",
        "_xlpm.Table[Amount]+_xlfn.SUM(A2)",
        "_xlfn.Budget ! A1+_xlfn.SUM(A2)",
        "_xlpm.Table [Amount]+_xlfn.SUM(A2)",
        "Sheet1!_xlpm.x+_xlfn.SUM(A2)",
        "'Sheet 1' ! _xlpm.x+_xlfn.SUM(A2)",
        "SUM(_xlfn.Start : _xlpm.End ! A1)+_xlfn.SUM(A2)",
        "SUM(_xlfn.Start:_xlpm.End!A1)+_xlfn.SUM(A2)",
        "SUM(_xlfn.Start:'_xlpm.End Sheet'!A1)+_xlfn.SUM(A2)",
    ] {
        let expected = format!("={}", formula.replace("_xlfn.SUM", "SUM"));
        assert_eq!(normalize_xlsx_formula(formula), expected, "{formula}");
    }
}

#[test]
fn test_preserve_prefixes_in_structured_and_external_references() {
    for formula in [
        "SUM(Table[_xlpm.Amount])+_xlfn.SINGLE(A1)",
        "SUM(Table[[#Headers],[_xlfn.Amount]])+_xlfn.SINGLE(A1)",
        "SUM(Table[Amount']_xlpm.tail])+_xlfn.SINGLE(A1)",
        "SUM([_xlfn.Workbook.xlsx]Sheet1!A1)+_xlfn.SINGLE(A1)",
    ] {
        let expected = format!("={}", formula.replace("_xlfn.SINGLE", "SINGLE"));
        assert_eq!(normalize_xlsx_formula(formula), expected, "{formula}");
    }
}

#[test]
fn test_only_strip_prefixes_at_identifier_boundaries() {
    assert_eq!(
        normalize_xlsx_formula(
            "_xlfn.LET(_xlpm.x,1,my_xlpm.x+name._xlfn.x+測定_xlpm.x+\\_xlpm.x+_xlpm.x)"
        ),
        "=LET(x,1,my_xlpm.x+name._xlfn.x+測定_xlpm.x+\\_xlpm.x+x)"
    );
}

#[test]
fn test_entity_decoding_precedes_prefix_detection() {
    assert_eq!(
        normalize_xlsx_formula("&#95;xlfn.LET(&#95;xlpm.x,1,&#95;xlpm.x)"),
        "=LET(x,1,x)"
    );
    assert_eq!(
        normalize_xlsx_formula("&apos;_xlfn.Sheet&apos;!A1+_xlfn.SUM(A2)"),
        "='_xlfn.Sheet'!A1+SUM(A2)"
    );
    assert_eq!(
        normalize_xlsx_formula("&quot;_xlpm.x&quot;&amp;_xlpm.x"),
        "=\"_xlpm.x\"&x"
    );
}

#[test]
fn test_preserve_unterminated_protected_regions() {
    for formula in ["'_xlfn.Sheet", "Table[_xlpm.Header", "\"_xlfn.SUM"] {
        assert_eq!(normalize_xlsx_formula(formula), format!("={formula}"));
    }
}

#[test]
fn test_unicode_whitespace_is_an_identifier_boundary() {
    for space in ['\u{00a0}', '\u{2003}'] {
        assert_eq!(
            normalize_xlsx_formula(&format!("A1{space}_xlfn.SUM(A2)+{space}_xlpm.x")),
            format!("=A1{space}SUM(A2)+{space}x")
        );
    }
}
