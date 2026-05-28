use super::super::entry::{
    auto_close_parentheses, auto_quote_sheet_names, strip_unnecessary_sheet_quotes,
    uppercase_cell_references,
};
use super::super::structured_refs::qualify_implicit_structured_refs;
use super::super::{normalize_formula_input, normalize_xlsx_formula};

// ─── UTF-8 multi-byte regression tests ─────────────────────────────────
//
// Regression: auto_quote_sheet_names iterated byte-by-byte inside
// double-quoted string literals (`bytes[i] as char; i += 1`), corrupting
// multi-byte UTF-8 characters.  En-dash (U+2013, 3 bytes: E2 80 93)
// became "â" (Latin-1 interpretation of 0xE2).
//
// These tests ensure multi-byte chars survive every code path that
// iterates over formula bytes.

#[test]
fn test_auto_quote_preserves_en_dash_in_string_literal() {
    // The exact pattern from the 0C4IrPq regression: en-dash inside a
    // string literal, with a quotable sheet name triggering the loop.
    let names = &["D&A"];
    assert_eq!(
        auto_quote_sheet_names(r#"=IF(D&A!A1<>"","N/A – Amendment","OK")"#, &names[..],),
        r#"=IF('D&A'!A1<>"","N/A – Amendment","OK")"#
    );
}

#[test]
fn test_auto_quote_preserves_em_dash_and_bullet_in_strings() {
    let names = &["Rev Summary"];
    assert_eq!(
        auto_quote_sheet_names(r#"=IF(Rev Summary!B1>0,"Pass — yes","• Fail")"#, &names[..],),
        r#"=IF('Rev Summary'!B1>0,"Pass — yes","• Fail")"#
    );
}

#[test]
fn test_auto_quote_preserves_cjk_and_emoji_in_strings() {
    let names = &["D&A"];
    assert_eq!(
        auto_quote_sheet_names(r#"=IF(D&A!A1>0,"結果🎉","失敗")"#, &names[..],),
        r#"=IF('D&A'!A1>0,"結果🎉","失敗")"#
    );
}

#[test]
fn test_auto_quote_preserves_en_dash_outside_strings() {
    // En-dash in a single-quoted sheet name (not in a double-quoted string)
    let names = &["Q1–Q2"];
    assert_eq!(
        auto_quote_sheet_names("=Q1–Q2!A1", &names[..]),
        "='Q1–Q2'!A1"
    );
}

#[test]
fn test_auto_quote_mixed_utf8_and_entities_full_formula() {
    // Realistic formula from the regression file:
    // quotable sheet name + en-dash string literals + comparisons
    let names = &["1| Rillet Customer Contracts"];
    let input = r#"=IF(AND('1| Rillet Customer Contracts'!AE5<>"Contract",'1| Rillet Customer Contracts'!AE5<>""),"N/A – Amendment","OK")"#;
    // Sheet name is already quoted, so no rewriting — just ensure en-dash
    // inside the string literal survives the iteration.
    assert_eq!(auto_quote_sheet_names(input, &names[..]), input);
}

#[test]
fn test_normalize_formula_input_preserves_en_dash() {
    // Full pipeline: auto_quote → auto_close → strip_quotes → uppercase
    let names = &["D&A"];
    assert_eq!(
        normalize_formula_input(
            r#"=IF(D&A!a1<>"","Amendment – Price Increase","OK")"#,
            &names[..],
        ),
        r#"=IF('D&A'!A1<>"","Amendment – Price Increase","OK")"#
    );
}

#[test]
fn test_normalize_xlsx_formula_preserves_en_dash() {
    // XLSX import path: entity decode + prefix strip
    assert_eq!(
        normalize_xlsx_formula(
            r#"IF(AND(AE5&lt;&gt;"Contract",AE5&lt;&gt;""),"N/A – Amendment","OK")"#
        ),
        r#"=IF(AND(AE5<>"Contract",AE5<>""),"N/A – Amendment","OK")"#
    );
}

#[test]
fn test_normalize_xlsx_formula_preserves_multiple_unicode_chars() {
    // Various multi-byte chars scattered throughout a formula
    assert_eq!(
        normalize_xlsx_formula(r#"_xlfn.IF(A1&gt;0,"✓ résumé – Pro™","• échec €0")"#),
        r#"=IF(A1>0,"✓ résumé – Pro™","• échec €0")"#
    );
}

#[test]
fn test_auto_close_preserves_utf8_in_sheet_name() {
    assert_eq!(
        auto_close_parentheses("='Résumé – 2026'!A1"),
        "='Résumé – 2026'!A1"
    );
}

#[test]
fn test_strip_quotes_preserves_utf8_required_name() {
    assert_eq!(
        strip_unnecessary_sheet_quotes("='Résumé – 2026'!A1"),
        "='Résumé – 2026'!A1"
    );
}

#[test]
fn test_uppercase_refs_preserves_utf8_string() {
    assert_eq!(
        uppercase_cell_references(r#"=a1&""Résumé – 2026"""#),
        r#"=A1&""Résumé – 2026"""#
    );
}

#[test]
fn test_structured_refs_preserve_utf8_string() {
    assert_eq!(
        qualify_implicit_structured_refs(r#"=""Résumé – [@Score]""&[@Score]"#, Some("Data")),
        r#"=""Résumé – [@Score]""&Data[@Score]"#
    );
}
