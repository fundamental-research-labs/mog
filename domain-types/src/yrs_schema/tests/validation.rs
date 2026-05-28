use crate::domain::validation::{
    ErrorStyle, ImeMode, ValidationOperator, ValidationRule, ValidationSpec,
};
use crate::yrs_schema::validation;

use super::support::roundtrip_map;

fn base_spec(rule: ValidationRule) -> ValidationSpec {
    ValidationSpec {
        ranges: vec!["A1:A10".to_string()],
        rule,
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: Some("Invalid".to_string()),
        error_message: Some("Try again".to_string()),
        show_prompt: true,
        prompt_title: Some("Prompt".to_string()),
        prompt_message: Some("Enter a value".to_string()),
        allow_blank: false,
        ime_mode: ImeMode::Disabled,
        uid: Some("{validation-uid}".to_string()),
    }
}

fn assert_rule_round_trip(rule: ValidationRule) {
    let spec = base_spec(rule);
    assert_eq!(
        spec,
        roundtrip_map(validation::to_yrs_prelim(&spec), |map, txn| {
            validation::from_yrs_map(map, txn)
        })
    );
}

#[test]
fn whole_number_rule_round_trips() {
    assert_rule_round_trip(ValidationRule::WholeNumber {
        operator: ValidationOperator::Between,
        formula1: "1".to_string(),
        formula2: Some("100".to_string()),
    });
}

#[test]
fn decimal_rule_round_trips() {
    assert_rule_round_trip(ValidationRule::Decimal {
        operator: ValidationOperator::GreaterThan,
        formula1: "0.5".to_string(),
        formula2: None,
    });
}

#[test]
fn list_rule_round_trips() {
    assert_rule_round_trip(ValidationRule::List {
        formula1: "\"Red,Green,Blue\"".to_string(),
        show_dropdown: true,
    });
}

#[test]
fn date_rule_round_trips() {
    assert_rule_round_trip(ValidationRule::Date {
        operator: ValidationOperator::Between,
        formula1: "2024-01-01".to_string(),
        formula2: Some("2024-12-31".to_string()),
    });
}

#[test]
fn time_rule_round_trips() {
    assert_rule_round_trip(ValidationRule::Time {
        operator: ValidationOperator::LessThan,
        formula1: "0.75".to_string(),
        formula2: None,
    });
}

#[test]
fn text_length_rule_round_trips() {
    assert_rule_round_trip(ValidationRule::TextLength {
        operator: ValidationOperator::LessThanOrEqual,
        formula1: "255".to_string(),
        formula2: None,
    });
}

#[test]
fn custom_rule_round_trips() {
    assert_rule_round_trip(ValidationRule::Custom {
        formula1: "=AND(A1>0,B1>0)".to_string(),
    });
}

#[test]
fn none_rule_round_trips() {
    assert_rule_round_trip(ValidationRule::None {
        formula1: "TRUE".to_string(),
    });
}
