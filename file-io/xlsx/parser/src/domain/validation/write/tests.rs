use super::format::format_f64;
use super::*;
use domain_types::{ValidationRule, ValidationSpec};

// -------------------------------------------------------------------------
// ValidationType tests
// -------------------------------------------------------------------------

#[test]
fn test_validation_type_as_str() {
    assert_eq!(ValidationType::None.as_str(), "none");
    assert_eq!(ValidationType::Whole.as_str(), "whole");
    assert_eq!(ValidationType::Decimal.as_str(), "decimal");
    assert_eq!(ValidationType::List.as_str(), "list");
    assert_eq!(ValidationType::Date.as_str(), "date");
    assert_eq!(ValidationType::Time.as_str(), "time");
    assert_eq!(ValidationType::TextLength.as_str(), "textLength");
    assert_eq!(ValidationType::Custom.as_str(), "custom");
}

#[test]
fn test_validation_type_default() {
    let vt: ValidationType = Default::default();
    assert_eq!(vt, ValidationType::None);
}

// -------------------------------------------------------------------------
// ValidationOperator tests
// -------------------------------------------------------------------------

#[test]
fn test_validation_operator_as_str() {
    assert_eq!(ValidationOperator::Between.as_str(), "between");
    assert_eq!(ValidationOperator::NotBetween.as_str(), "notBetween");
    assert_eq!(ValidationOperator::Equal.as_str(), "equal");
    assert_eq!(ValidationOperator::NotEqual.as_str(), "notEqual");
    assert_eq!(ValidationOperator::LessThan.as_str(), "lessThan");
    assert_eq!(
        ValidationOperator::LessThanOrEqual.as_str(),
        "lessThanOrEqual"
    );
    assert_eq!(ValidationOperator::GreaterThan.as_str(), "greaterThan");
    assert_eq!(
        ValidationOperator::GreaterThanOrEqual.as_str(),
        "greaterThanOrEqual"
    );
}

#[test]
fn test_validation_operator_requires_formula2() {
    assert!(ValidationOperator::Between.requires_formula2());
    assert!(ValidationOperator::NotBetween.requires_formula2());
    assert!(!ValidationOperator::Equal.requires_formula2());
    assert!(!ValidationOperator::NotEqual.requires_formula2());
    assert!(!ValidationOperator::LessThan.requires_formula2());
    assert!(!ValidationOperator::LessThanOrEqual.requires_formula2());
    assert!(!ValidationOperator::GreaterThan.requires_formula2());
    assert!(!ValidationOperator::GreaterThanOrEqual.requires_formula2());
}

// -------------------------------------------------------------------------
// ErrorStyle tests
// -------------------------------------------------------------------------

#[test]
fn test_error_style_as_str() {
    assert_eq!(ErrorStyle::Stop.as_str(), "stop");
    assert_eq!(ErrorStyle::Warning.as_str(), "warning");
    assert_eq!(ErrorStyle::Information.as_str(), "information");
}

#[test]
fn test_error_style_default() {
    let es: ErrorStyle = Default::default();
    assert_eq!(es, ErrorStyle::Stop);
}

// -------------------------------------------------------------------------
// DataValidation builder tests
// -------------------------------------------------------------------------

#[test]
fn test_data_validation_builder() {
    let dv = DataValidation::new("A1:A10", ValidationType::Whole)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0")
        .error_style(ErrorStyle::Warning)
        .error_message("Error Title", "Error Message")
        .prompt("Prompt Title", "Prompt Message")
        .allow_blank(false)
        .show_input_message(true)
        .show_error_message(true);

    assert_eq!(dv.sqref, "A1:A10");
    assert_eq!(dv.validation_type, ValidationType::Whole);
    assert_eq!(dv.operator, Some(ValidationOperator::GreaterThan));
    assert_eq!(dv.formula1, Some("0".to_string()));
    assert_eq!(dv.error_style, ErrorStyle::Warning);
    assert_eq!(dv.error_title, Some("Error Title".to_string()));
    assert_eq!(dv.error_message, Some("Error Message".to_string()));
    assert_eq!(dv.prompt_title, Some("Prompt Title".to_string()));
    assert_eq!(dv.prompt_message, Some("Prompt Message".to_string()));
    assert!(!dv.allow_blank);
    assert!(dv.show_input_message);
    assert!(dv.show_error_message);
}

#[test]
fn test_data_validation_show_dropdown() {
    let dv = DataValidation::new("A1", ValidationType::List).show_dropdown(false);
    assert!(!dv.show_dropdown);
}

// -------------------------------------------------------------------------
// List validation tests
// -------------------------------------------------------------------------

#[test]
fn test_list_validation_from_values() {
    let mut writer = DataValidationWriter::new();
    writer.add_list("A1:A10", &["Red", "Green", "Blue"]);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("<dataValidations count=\"1\">"));
    assert!(xml.contains("type=\"list\""));
    assert!(xml.contains("sqref=\"A1:A10\""));
    assert!(xml.contains("<formula1>\"Red,Green,Blue\"</formula1>"));
    assert!(xml.contains("</dataValidations>"));
}

#[test]
fn test_list_validation_from_range() {
    let mut writer = DataValidationWriter::new();
    writer.add_list_range("B1:B10", "Sheet2!$A$1:$A$5");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"list\""));
    assert!(xml.contains("<formula1>Sheet2!$A$1:$A$5</formula1>"));
}

#[test]
fn test_list_validation_hide_dropdown() {
    let validation = DataValidation::new("A1", ValidationType::List)
        .formula1("\"Yes,No\"")
        .show_dropdown(false);

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // showDropDown="1" means HIDE the dropdown in XLSX
    assert!(xml.contains("showDropDown=\"1\""));
}

// -------------------------------------------------------------------------
// Whole number validation tests
// -------------------------------------------------------------------------

#[test]
fn test_whole_number_between() {
    let mut writer = DataValidationWriter::new();
    writer.add_whole_between("C1:C10", 1, 100);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"whole\""));
    assert!(xml.contains("<formula1>1</formula1>"));
    assert!(xml.contains("<formula2>100</formula2>"));
    // "between" is default, should not appear
    assert!(!xml.contains("operator=\"between\""));
}

#[test]
fn test_whole_number_greater_than() {
    let mut writer = DataValidationWriter::new();
    writer.add_whole("D1:D10", ValidationOperator::GreaterThan, 0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"whole\""));
    assert!(xml.contains("operator=\"greaterThan\""));
    assert!(xml.contains("<formula1>0</formula1>"));
    assert!(!xml.contains("<formula2>"));
}

#[test]
fn test_whole_number_less_than_or_equal() {
    let mut writer = DataValidationWriter::new();
    writer.add_whole("E1:E10", ValidationOperator::LessThanOrEqual, 50);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("operator=\"lessThanOrEqual\""));
    assert!(xml.contains("<formula1>50</formula1>"));
}

#[test]
fn test_whole_number_equal() {
    let mut writer = DataValidationWriter::new();
    writer.add_whole("F1", ValidationOperator::Equal, 42);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("operator=\"equal\""));
    assert!(xml.contains("<formula1>42</formula1>"));
}

#[test]
fn test_whole_number_not_equal() {
    let mut writer = DataValidationWriter::new();
    writer.add_whole("G1", ValidationOperator::NotEqual, 0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("operator=\"notEqual\""));
}

#[test]
fn test_whole_number_not_between() {
    let validation = DataValidation::new("H1:H10", ValidationType::Whole)
        .operator(ValidationOperator::NotBetween)
        .formula1("10")
        .formula2("20");

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("operator=\"notBetween\""));
    assert!(xml.contains("<formula1>10</formula1>"));
    assert!(xml.contains("<formula2>20</formula2>"));
}

// -------------------------------------------------------------------------
// Decimal validation tests
// -------------------------------------------------------------------------

#[test]
fn test_decimal_between() {
    let mut writer = DataValidationWriter::new();
    writer.add_decimal_between("I1:I10", 0.0, 100.5);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"decimal\""));
    assert!(xml.contains("<formula1>0</formula1>"));
    assert!(xml.contains("<formula2>100.5</formula2>"));
}

#[test]
fn test_decimal_greater_than() {
    let mut writer = DataValidationWriter::new();
    writer.add_decimal("J1:J10", ValidationOperator::GreaterThan, 0.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"decimal\""));
    assert!(xml.contains("operator=\"greaterThan\""));
    assert!(xml.contains("<formula1>0</formula1>"));
}

#[test]
fn test_decimal_formatting() {
    let mut writer = DataValidationWriter::new();
    writer.add_decimal("K1", ValidationOperator::LessThan, 3.14159265358979);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Should have reasonable precision
    assert!(xml.contains("3.14159265358979"));
}

// -------------------------------------------------------------------------
// Date validation tests
// -------------------------------------------------------------------------

#[test]
fn test_date_between() {
    let mut writer = DataValidationWriter::new();
    writer.add_date_between("L1:L10", "44927", "45292"); // 2023-01-01 to 2023-12-31

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"date\""));
    assert!(xml.contains("<formula1>44927</formula1>"));
    assert!(xml.contains("<formula2>45292</formula2>"));
}

#[test]
fn test_date_greater_than_or_equal_today() {
    let mut writer = DataValidationWriter::new();
    writer.add_date("M1:M10", ValidationOperator::GreaterThanOrEqual, "TODAY()");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"date\""));
    assert!(xml.contains("operator=\"greaterThanOrEqual\""));
    assert!(xml.contains("<formula1>TODAY()</formula1>"));
}

// -------------------------------------------------------------------------
// Time validation tests
// -------------------------------------------------------------------------

#[test]
fn test_time_between() {
    let mut writer = DataValidationWriter::new();
    // 8:00 AM to 5:00 PM (as fractions of day)
    writer.add_time_between("N1:N10", "0.333333", "0.708333");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"time\""));
    assert!(xml.contains("<formula1>0.333333</formula1>"));
    assert!(xml.contains("<formula2>0.708333</formula2>"));
}

// -------------------------------------------------------------------------
// Text length validation tests
// -------------------------------------------------------------------------

#[test]
fn test_text_length_less_than_or_equal() {
    let mut writer = DataValidationWriter::new();
    writer.add_text_length("O1:O10", ValidationOperator::LessThanOrEqual, 50);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"textLength\""));
    assert!(xml.contains("operator=\"lessThanOrEqual\""));
    assert!(xml.contains("<formula1>50</formula1>"));
}

#[test]
fn test_text_length_between() {
    let mut writer = DataValidationWriter::new();
    writer.add_text_length_between("P1:P10", 5, 20);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"textLength\""));
    assert!(xml.contains("<formula1>5</formula1>"));
    assert!(xml.contains("<formula2>20</formula2>"));
}

// -------------------------------------------------------------------------
// Custom formula validation tests
// -------------------------------------------------------------------------

#[test]
fn test_custom_formula() {
    let mut writer = DataValidationWriter::new();
    writer.add_custom("Q1:Q10", "AND(LEN(Q1)>=5,LEN(Q1)<=20)");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("type=\"custom\""));
    assert!(xml.contains("<formula1>AND(LEN(Q1)&gt;=5,LEN(Q1)&lt;=20)</formula1>"));
}

#[test]
fn test_custom_formula_isnumber() {
    let mut writer = DataValidationWriter::new();
    writer.add_custom("R1:R10", "ISNUMBER(R1)");

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("<formula1>ISNUMBER(R1)</formula1>"));
}

// -------------------------------------------------------------------------
// Error message tests
// -------------------------------------------------------------------------

#[test]
fn test_error_message() {
    let validation = DataValidation::new("S1:S10", ValidationType::Whole)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0")
        .error_message("Invalid Input", "Please enter a positive number");

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("errorTitle=\"Invalid Input\""));
    assert!(xml.contains("error=\"Please enter a positive number\""));
}

#[test]
fn test_error_style_warning() {
    let validation = DataValidation::new("T1:T10", ValidationType::Decimal)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0")
        .error_style(ErrorStyle::Warning)
        .error_message("Warning", "Value should be greater than 0");

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("errorStyle=\"warning\""));
}

#[test]
fn test_error_style_information() {
    let validation = DataValidation::new("U1:U10", ValidationType::TextLength)
        .operator(ValidationOperator::LessThanOrEqual)
        .formula1("100")
        .error_style(ErrorStyle::Information)
        .error_message("Note", "Text longer than 100 characters may be truncated");

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("errorStyle=\"information\""));
}

#[test]
fn test_error_style_stop_not_written() {
    let validation = DataValidation::new("V1", ValidationType::Whole)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0")
        .error_style(ErrorStyle::Stop);

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // "stop" is default, should not appear
    assert!(!xml.contains("errorStyle="));
}

// -------------------------------------------------------------------------
// Input prompt tests
// -------------------------------------------------------------------------

#[test]
fn test_input_prompt() {
    let validation = DataValidation::new("W1:W10", ValidationType::List)
        .formula1("\"Option1,Option2,Option3\"")
        .prompt("Select Option", "Choose from the dropdown list");

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("promptTitle=\"Select Option\""));
    assert!(xml.contains("prompt=\"Choose from the dropdown list\""));
}

// -------------------------------------------------------------------------
// DataValidationWriter utility tests
// -------------------------------------------------------------------------

#[test]
fn test_writer_is_empty() {
    let writer = DataValidationWriter::new();
    assert!(writer.is_empty());

    let mut writer = DataValidationWriter::new();
    writer.add_list("A1", &["Yes", "No"]);
    assert!(!writer.is_empty());
}

#[test]
fn test_writer_len() {
    let mut writer = DataValidationWriter::new();
    assert_eq!(writer.len(), 0);

    writer.add_list("A1", &["Yes", "No"]);
    assert_eq!(writer.len(), 1);

    writer.add_whole_between("B1", 1, 100);
    assert_eq!(writer.len(), 2);
}

#[test]
fn test_empty_writer_produces_no_output() {
    let writer = DataValidationWriter::new();
    let xml = writer.to_xml();
    assert!(xml.is_empty());
}

#[test]
fn test_multiple_validations() {
    let mut writer = DataValidationWriter::new();
    writer
        .add_list("A1:A10", &["Red", "Green", "Blue"])
        .add_whole_between("B1:B10", 1, 100)
        .add_decimal("C1:C10", ValidationOperator::GreaterThan, 0.0)
        .add_custom("D1:D10", "ISNUMBER(D1)");

    assert_eq!(writer.len(), 4);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("count=\"4\""));
    assert!(xml.contains("type=\"list\""));
    assert!(xml.contains("type=\"whole\""));
    assert!(xml.contains("type=\"decimal\""));
    assert!(xml.contains("type=\"custom\""));
}

#[test]
fn test_declared_count_overrides_child_count() {
    let mut writer = DataValidationWriter::new();
    writer.declared_count = Some(2);
    writer.add_list("C6", &["Not Started / Holding", "Planning", "In Progress"]);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("count=\"2\""));
    assert_eq!(xml.matches("<dataValidation ").count(), 1);
}

// -------------------------------------------------------------------------
// XML structure tests
// -------------------------------------------------------------------------

#[test]
fn test_self_closing_validation() {
    let validation = DataValidation::new("X1", ValidationType::None);

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Should be self-closing since there are no formulas
    // Note: includes default attributes like allowBlank, showInputMessage, showErrorMessage
    assert!(xml.contains("sqref=\"X1\""));
    assert!(xml.contains("/>"));
    assert!(!xml.contains("</dataValidation>"));
}

#[test]
fn test_allow_blank_false() {
    let validation = DataValidation::new("Y1", ValidationType::Whole)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0")
        .allow_blank(false);

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // allowBlank should NOT be present when false
    assert!(!xml.contains("allowBlank="));
}

#[test]
fn test_allow_blank_true() {
    let validation = DataValidation::new("Z1", ValidationType::Whole)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0")
        .allow_blank(true);

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("allowBlank=\"1\""));
}

// -------------------------------------------------------------------------
// Edge cases
// -------------------------------------------------------------------------

#[test]
fn test_special_characters_in_error_message() {
    let validation = DataValidation::new("AA1", ValidationType::Whole)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0")
        .error_message("Error: <invalid>", "Value must be > 0 & < 100 \"quoted\"");

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Should be properly escaped
    assert!(xml.contains("errorTitle=\"Error: &lt;invalid&gt;\""));
    assert!(xml.contains("error=\"Value must be &gt; 0 &amp; &lt; 100 &quot;quoted&quot;\""));
}

#[test]
fn test_prompt_and_error_messages_use_xstring_escaping() {
    let validation = DataValidation::new("AB1", ValidationType::List)
        .formula1("\"A,B\"")
        .error_message("Stop\rNow", "Line 1\r\nLine 2\t_x000d_")
        .prompt("Pick\tOne", "Prompt\rText");

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("errorTitle=\"Stop_x000d_Now\""));
    assert!(xml.contains("error=\"Line 1_x000d__x000a_Line 2_x0009__x005f_x000d_\""));
    assert!(xml.contains("promptTitle=\"Pick_x0009_One\""));
    assert!(xml.contains("prompt=\"Prompt_x000d_Text\""));
}

#[test]
fn test_multiple_ranges_in_sqref() {
    let validation = DataValidation::new("A1:A10 C1:C10 E1:E10", ValidationType::Whole)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0");

    let mut writer = DataValidationWriter::new();
    writer.add(validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("sqref=\"A1:A10 C1:C10 E1:E10\""));
}

#[test]
fn test_negative_numbers() {
    let mut writer = DataValidationWriter::new();
    writer.add_whole_between("AB1:AB10", -100, 100);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("<formula1>-100</formula1>"));
    assert!(xml.contains("<formula2>100</formula2>"));
}

#[test]
fn test_format_f64_integer() {
    assert_eq!(format_f64(5.0), "5");
    assert_eq!(format_f64(-10.0), "-10");
    assert_eq!(format_f64(0.0), "0");
}

#[test]
fn test_format_f64_decimal() {
    assert_eq!(format_f64(3.14), "3.14");
    assert_eq!(format_f64(0.5), "0.5");
    assert_eq!(format_f64(-2.718), "-2.718");
}

// -------------------------------------------------------------------------
// Integration test
// -------------------------------------------------------------------------

#[test]
fn test_complete_worksheet_validations() {
    let mut writer = DataValidationWriter::new();

    // Dropdown list from values
    let list_validation = DataValidation::new("A1:A10", ValidationType::List)
        .formula1("\"Red,Green,Blue,Yellow\"")
        .allow_blank(true)
        .prompt("Select Color", "Choose a color from the list");
    writer.add(list_validation);

    // Dropdown list from range
    writer.add_list_range("B1:B10", "Sheet2!$A$1:$A$5");

    // Whole number between
    let whole_validation = DataValidation::new("C1:C10", ValidationType::Whole)
        .operator(ValidationOperator::Between)
        .formula1("1")
        .formula2("100")
        .error_message("Invalid Number", "Enter a number between 1 and 100");
    writer.add(whole_validation);

    // Decimal greater than with warning
    let decimal_validation = DataValidation::new("D1:D10", ValidationType::Decimal)
        .operator(ValidationOperator::GreaterThan)
        .formula1("0")
        .error_style(ErrorStyle::Warning)
        .error_message("Warning", "Value should be greater than 0");
    writer.add(decimal_validation);

    // Custom formula
    writer.add_custom("E1:E10", "AND(LEN(E1)>=5,LEN(E1)<=20)");

    // Text length
    let text_validation = DataValidation::new("F1:F10", ValidationType::TextLength)
        .operator(ValidationOperator::LessThanOrEqual)
        .formula1("50")
        .prompt("Input", "Enter up to 50 characters");
    writer.add(text_validation);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Verify structure
    assert!(xml.contains("<dataValidations count=\"6\">"));
    assert!(xml.contains("</dataValidations>"));

    // Verify all validations are present
    // Note: <dataValidations also matches <dataValidation, so count is 7 (1 container + 6 rules)
    assert_eq!(xml.matches("<dataValidation ").count(), 6);
    assert!(xml.matches("</dataValidation>").count() >= 5); // At least 5 have formulas
}

#[test]
fn test_empty_container_attrs_are_written() {
    let mut writer = DataValidationWriter::new();
    writer.disable_prompts = true;
    writer.declared_count = Some(0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert_eq!(
        xml,
        r#"<dataValidations count="0" disablePrompts="1"></dataValidations>"#
    );
}

#[test]
fn test_x14_validation_ext_is_written_from_domain_state() {
    let xml = x14_validations_ext_xml_from_domain_with_opts(
        &[ValidationSpec {
            ranges: vec!["A1:A3".to_string()],
            rule: ValidationRule::None {
                formula1: "TRUE".to_string(),
            },
            ..Default::default()
        }],
        false,
        None,
        None,
        Some(1),
    );

    assert!(xml.contains("<x14:dataValidations"));
    assert!(xml.contains("<x14:dataValidation>") || xml.contains("<x14:dataValidation "));
    assert!(xml.contains("<x14:formula1><xm:f>TRUE</xm:f></x14:formula1>"));
    assert!(xml.contains("<xm:sqref>A1:A3</xm:sqref>"));
}
