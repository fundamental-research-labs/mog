use value_types::{CellError, CellValue};

use super::super::number::try_parse_criteria_number;
use crate::helpers::criteria::parse_criteria;

#[test]
fn test_parse_criteria_number() {
    let crit = parse_criteria(&CellValue::number(5.0));
    assert!(crit(&CellValue::number(5.0)));
    assert!(!crit(&CellValue::number(4.0)));
}

#[test]
fn test_parse_criteria_comparison() {
    let crit = parse_criteria(&CellValue::Text(">5".into()));
    assert!(crit(&CellValue::number(6.0)));
    assert!(!crit(&CellValue::number(5.0)));
    assert!(!crit(&CellValue::number(4.0)));

    let crit = parse_criteria(&CellValue::Text(">=5".into()));
    assert!(crit(&CellValue::number(5.0)));
    assert!(!crit(&CellValue::number(4.0)));

    let crit = parse_criteria(&CellValue::Text("<>5".into()));
    assert!(crit(&CellValue::number(4.0)));
    assert!(!crit(&CellValue::number(5.0)));
}

// -----------------------------------------------------------------------
// FIX 3: parse_criteria text comparisons with >, >=, <, <=
// -----------------------------------------------------------------------

#[test]
fn test_parse_criteria_gt_text() {
    // ">m" should match text values > "m" (case-insensitive)
    let crit = parse_criteria(&CellValue::Text(">m".into()));
    assert!(crit(&CellValue::Text("zebra".into())));
    assert!(crit(&CellValue::Text("n".into())));
    assert!(!crit(&CellValue::Text("m".into()))); // equal, not greater
    assert!(!crit(&CellValue::Text("apple".into())));
    // Numbers should NOT match text comparisons
    assert!(!crit(&CellValue::number(100.0)));
    // Errors should NOT match
    assert!(!crit(&CellValue::Error(CellError::Value, None)));
    // Null should NOT match
    assert!(!crit(&CellValue::Null));
}

#[test]
fn test_parse_criteria_gte_text() {
    // ">=m" should match text values >= "m" (case-insensitive)
    let crit = parse_criteria(&CellValue::Text(">=m".into()));
    assert!(crit(&CellValue::Text("zebra".into())));
    assert!(crit(&CellValue::Text("m".into()))); // equal, should match
    assert!(crit(&CellValue::Text("M".into()))); // case-insensitive
    assert!(!crit(&CellValue::Text("apple".into())));
    assert!(!crit(&CellValue::number(100.0)));
    assert!(!crit(&CellValue::Error(CellError::Na, None)));
}

#[test]
fn test_parse_criteria_lt_text() {
    // "<m" should match text values < "m" (case-insensitive)
    let crit = parse_criteria(&CellValue::Text("<m".into()));
    assert!(crit(&CellValue::Text("apple".into())));
    assert!(crit(&CellValue::Text("lemon".into())));
    assert!(!crit(&CellValue::Text("m".into()))); // equal, not less
    assert!(!crit(&CellValue::Text("zebra".into())));
    assert!(!crit(&CellValue::number(1.0)));
}

#[test]
fn test_parse_criteria_lte_text() {
    // "<=m" should match text values <= "m" (case-insensitive)
    let crit = parse_criteria(&CellValue::Text("<=m".into()));
    assert!(crit(&CellValue::Text("apple".into())));
    assert!(crit(&CellValue::Text("m".into()))); // equal, should match
    assert!(crit(&CellValue::Text("M".into()))); // case-insensitive
    assert!(!crit(&CellValue::Text("zebra".into())));
    assert!(!crit(&CellValue::number(1.0)));
}

#[test]
fn test_parse_criteria_gt_text_case_insensitive() {
    // Verify case-insensitive comparison
    let crit = parse_criteria(&CellValue::Text(">Apple".into()));
    assert!(crit(&CellValue::Text("banana".into())));
    assert!(crit(&CellValue::Text("BANANA".into())));
    assert!(!crit(&CellValue::Text("aaa".into())));
}

#[test]
fn test_parse_criteria_numeric_gt_still_works() {
    // Ensure numeric comparisons still work after the fix
    let crit = parse_criteria(&CellValue::Text(">50".into()));
    assert!(crit(&CellValue::number(100.0)));
    assert!(!crit(&CellValue::number(50.0)));
    assert!(!crit(&CellValue::number(25.0)));
    // COUNTIF/SUMIF: text does not participate in numeric comparisons
    assert!(!crit(&CellValue::Text("hello".into())));
}

#[test]
fn test_parse_criteria_numeric_gte_still_works() {
    let crit = parse_criteria(&CellValue::Text(">=50".into()));
    assert!(crit(&CellValue::number(100.0)));
    assert!(crit(&CellValue::number(50.0)));
    assert!(!crit(&CellValue::number(25.0)));
}

#[test]
fn test_parse_criteria_numeric_lt_still_works() {
    let crit = parse_criteria(&CellValue::Text("<50".into()));
    assert!(crit(&CellValue::number(25.0)));
    assert!(!crit(&CellValue::number(50.0)));
    assert!(!crit(&CellValue::number(100.0)));
}

#[test]
fn test_parse_criteria_numeric_lte_still_works() {
    let crit = parse_criteria(&CellValue::Text("<=50".into()));
    assert!(crit(&CellValue::number(25.0)));
    assert!(crit(&CellValue::number(50.0)));
    assert!(!crit(&CellValue::number(100.0)));
}

// -----------------------------------------------------------------------
// FIX 4: Null criteria should only match Null, not Number(0.0)
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// FIX 5: Text criteria should NOT trim whitespace for plain matching
// -----------------------------------------------------------------------

#[test]
fn test_parse_criteria_text_preserves_whitespace() {
    // Trailing space in criteria should be significant
    let crit = parse_criteria(&CellValue::Text("hello ".into()));
    assert!(crit(&CellValue::Text("hello ".into())));
    assert!(!crit(&CellValue::Text("hello".into()))); // no trailing space

    // Leading space in criteria should be significant
    let crit = parse_criteria(&CellValue::Text(" hello".into()));
    assert!(crit(&CellValue::Text(" hello".into())));
    assert!(!crit(&CellValue::Text("hello".into()))); // no leading space

    // Operator criteria should still work with surrounding whitespace
    let crit = parse_criteria(&CellValue::Text(" >=5 ".into()));
    assert!(crit(&CellValue::number(5.0)));
    assert!(crit(&CellValue::number(10.0)));
    assert!(!crit(&CellValue::number(4.0)));
}

#[test]
fn test_ne_numeric_text_is_not_equal() {
    // Unparseable text IS "not equal" to a number
    let crit = parse_criteria(&CellValue::Text("<>5".into()));
    assert!(crit(&CellValue::Text("hello".into())));
    // Parseable text that equals the number is NOT "not equal"
    assert!(!crit(&CellValue::Text("5".into())));
}

#[test]
fn test_empty_text_does_not_match_numeric_criteria() {
    assert!(!parse_criteria(&CellValue::number(0.0))(&CellValue::Text(
        "".into()
    )));
    assert!(!parse_criteria(&CellValue::Text("=0".into()))(
        &CellValue::Text("".into())
    ));
    // COUNTIF/SUMIF: text does not participate in numeric comparisons
    assert!(!parse_criteria(&CellValue::Text(">=0".into()))(
        &CellValue::Text("".into())
    ));
    // Empty text IS "not equal" to a number (it's Text, just empty)
    assert!(parse_criteria(&CellValue::Text("<>0".into()))(
        &CellValue::Text("".into())
    ));
}

// -----------------------------------------------------------------------
// Complementarity — COUNTIF("=") + COUNTIF("<>") = non-error count
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// FIX 9: Percentage suffix in criteria strings
// -----------------------------------------------------------------------

#[test]
fn test_try_parse_criteria_number_percent() {
    assert_eq!(try_parse_criteria_number("42"), Some(42.0));
    assert_eq!(try_parse_criteria_number("-999%"), Some(-9.99));
    assert_eq!(try_parse_criteria_number("50%"), Some(0.5));
    assert_eq!(try_parse_criteria_number("100%"), Some(1.0));
    assert_eq!(try_parse_criteria_number("0%"), Some(0.0));
    assert_eq!(try_parse_criteria_number("hello"), None);
    assert_eq!(try_parse_criteria_number("hello%"), None);
}

#[test]
fn test_countif_criteria_with_percent_suffix() {
    // ">-999%" should mean "> -9.99"
    let crit = parse_criteria(&CellValue::Text(">-999%".into()));
    // Numbers > -9.99 should match
    assert!(crit(&CellValue::number(0.05)));
    assert!(crit(&CellValue::number(0.0)));
    assert!(crit(&CellValue::number(-9.0)));
    // Number <= -9.99 should NOT match
    assert!(!crit(&CellValue::number(-9.99)));
    assert!(!crit(&CellValue::number(-100.0)));
    // COUNTIF/SUMIF: text does not participate in numeric comparisons
    assert!(!crit(&CellValue::Text("—".into())));
    assert!(!crit(&CellValue::Text("hello".into())));
}

#[test]
fn test_gte_criteria_with_percent_suffix() {
    let crit = parse_criteria(&CellValue::Text(">=50%".into()));
    assert!(crit(&CellValue::number(0.5)));
    assert!(crit(&CellValue::number(1.0)));
    assert!(!crit(&CellValue::number(0.49)));
    // COUNTIF/SUMIF: text does not participate in numeric comparisons
    assert!(!crit(&CellValue::Text("anything".into())));
}

#[test]
fn test_lt_criteria_with_percent_suffix() {
    let crit = parse_criteria(&CellValue::Text("<50%".into()));
    assert!(crit(&CellValue::number(0.49)));
    assert!(!crit(&CellValue::number(0.5)));
    assert!(!crit(&CellValue::number(1.0)));
    // Text never matches < numeric (text > any number)
    assert!(!crit(&CellValue::Text("anything".into())));
}

#[test]
fn test_lte_criteria_with_percent_suffix() {
    let crit = parse_criteria(&CellValue::Text("<=100%".into()));
    assert!(crit(&CellValue::number(1.0)));
    assert!(crit(&CellValue::number(0.5)));
    assert!(!crit(&CellValue::number(1.01)));
    // Text never matches <= numeric
    assert!(!crit(&CellValue::Text("anything".into())));
}

#[test]
fn test_eq_criteria_with_percent_suffix() {
    let crit = parse_criteria(&CellValue::Text("=50%".into()));
    assert!(crit(&CellValue::number(0.5)));
    assert!(!crit(&CellValue::number(0.51)));
}

#[test]
fn test_ne_criteria_with_percent_suffix() {
    let crit = parse_criteria(&CellValue::Text("<>50%".into()));
    assert!(!crit(&CellValue::number(0.5)));
    assert!(crit(&CellValue::number(0.51)));
}

// -----------------------------------------------------------------------
// FIX 10: Excel mixed-type ordering — text > any number
// -----------------------------------------------------------------------

#[test]
fn test_gt_numeric_excludes_text_cells() {
    // COUNTIF/SUMIF: text does not participate in numeric comparisons
    let crit = parse_criteria(&CellValue::Text(">0".into()));
    assert!(!crit(&CellValue::Text("hello".into())));
    assert!(!crit(&CellValue::Text("—".into())));
    assert!(!crit(&CellValue::Text("".into())));
}

#[test]
fn test_gte_numeric_excludes_text_cells() {
    // COUNTIF/SUMIF: text does not participate in numeric comparisons
    let crit = parse_criteria(&CellValue::Text(">=0".into()));
    assert!(!crit(&CellValue::Text("hello".into())));
}

#[test]
fn test_lt_numeric_does_not_match_text() {
    // Text is NOT less than any number
    let crit = parse_criteria(&CellValue::Text("<999999".into()));
    assert!(!crit(&CellValue::Text("hello".into())));
}

#[test]
fn test_lte_numeric_does_not_match_text() {
    let crit = parse_criteria(&CellValue::Text("<=999999".into()));
    assert!(!crit(&CellValue::Text("hello".into())));
}
