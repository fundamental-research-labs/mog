use std::sync::Arc;

use super::helpers::*;
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::{ErrorStyle, ImeMode, ValidationOperator, ValidationRule, ValidationSpec};
use value_types::{CellValue, FiniteF64};
use xlsx_parser::write::write_xlsx_from_parse_output;

#[test]
fn roundtrip_data_validation_whole_number() {
    let mut output = make_single_sheet(
        "DV_WholeNumber",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(5.0).unwrap()))],
    );
    output.sheets[0].data_validations = vec![ValidationSpec {
        ranges: vec!["A1:A10".to_string()],
        rule: ValidationRule::WholeNumber {
            operator: ValidationOperator::Between,
            formula1: "1".to_string(),
            formula2: Some("100".to_string()),
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: Some("Invalid".to_string()),
        error_message: Some("Enter a number between 1 and 100".to_string()),
        show_prompt: true,
        prompt_title: Some("Input".to_string()),
        prompt_message: Some("Enter a whole number".to_string()),
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    }];

    let rt = roundtrip(&output);
    let rt_dvs = &rt.sheets[0].data_validations;
    assert!(
        !rt_dvs.is_empty(),
        "Data validations should survive round-trip"
    );

    let dv = &rt_dvs[0];
    // Verify range
    assert!(
        dv.ranges.iter().any(|r| r.contains("A1")),
        "Validation range should reference A1. Got: {:?}",
        dv.ranges
    );

    // Verify rule type
    match &dv.rule {
        ValidationRule::WholeNumber {
            operator,
            formula1,
            formula2,
        } => {
            assert_eq!(
                *operator,
                ValidationOperator::Between,
                "Operator should be preserved"
            );
            assert_eq!(formula1, "1", "Formula1 should be preserved");
            assert_eq!(
                formula2.as_deref(),
                Some("100"),
                "Formula2 should be preserved"
            );
        }
        other => panic!("Expected WholeNumber rule, got {:?}", other),
    }

    // Verify error/prompt messages
    assert_eq!(dv.error_style, ErrorStyle::Stop);
    assert_eq!(dv.show_error, true);
    assert_eq!(dv.error_title.as_deref(), Some("Invalid"));
    assert_eq!(
        dv.error_message.as_deref(),
        Some("Enter a number between 1 and 100")
    );
    assert_eq!(dv.show_prompt, true);
    assert_eq!(dv.prompt_title.as_deref(), Some("Input"));
    assert_eq!(dv.prompt_message.as_deref(), Some("Enter a whole number"));
}

#[test]
fn roundtrip_data_validation_list() {
    let mut output = make_single_sheet(
        "DV_List",
        vec![cell(0, 0, CellValue::Text(Arc::from("Red")))],
    );
    output.sheets[0].data_validations = vec![ValidationSpec {
        ranges: vec!["A1:A5".to_string()],
        rule: ValidationRule::List {
            formula1: "\"Red,Green,Blue\"".to_string(),
            show_dropdown: true,
        },
        error_style: ErrorStyle::Warning,
        show_error: true,
        error_title: None,
        error_message: None,
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    }];

    let rt = roundtrip(&output);
    let rt_dvs = &rt.sheets[0].data_validations;
    assert!(!rt_dvs.is_empty(), "List validation should survive");

    match &rt_dvs[0].rule {
        ValidationRule::List {
            formula1,
            show_dropdown,
        } => {
            assert!(
                formula1.contains("Red") && formula1.contains("Green") && formula1.contains("Blue"),
                "List items should be preserved. Got: {formula1}"
            );
            assert_eq!(*show_dropdown, true, "show_dropdown should be preserved");
        }
        other => panic!("Expected List rule, got {:?}", other),
    }
}

#[test]
fn roundtrip_data_validation_declared_count_survives_l2_hydration_export() {
    let mut output = make_single_sheet(
        "DV_DeclaredCount",
        vec![cell(0, 0, CellValue::Text(Arc::from("Planning")))],
    );
    output.sheets[0].data_validations = vec![ValidationSpec {
        ranges: vec!["C6".to_string()],
        rule: ValidationRule::List {
            formula1: "\"Not Started / Holding,Planning,In Progress,Complete,Delayed\"".to_string(),
            show_dropdown: true,
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: None,
        error_message: None,
        show_prompt: true,
        prompt_title: None,
        prompt_message: Some(
            "Invalid Status - Please select a status from the dropdown list.".to_string(),
        ),
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    }];
    output.sheets[0].data_validations_declared_count = Some(2);

    let xlsx_bytes = write_xlsx_from_parse_output(&output).expect("write_xlsx_from_parse_output");
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;

    assert_eq!(exported.sheets[0].data_validations_declared_count, Some(2));
    assert_eq!(exported.sheets[0].data_validations.len(), 1);
}

#[test]
fn roundtrip_x14_data_validation_hydrates_into_canonical_validation_store() {
    let mut output = make_single_sheet(
        "DV_X14",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(7.0).unwrap()))],
    );
    output.sheets[0].x14_data_validations = vec![ValidationSpec {
        ranges: vec!["A1:A3".to_string()],
        rule: ValidationRule::WholeNumber {
            operator: ValidationOperator::GreaterThan,
            formula1: "5".to_string(),
            formula2: None,
        },
        allow_blank: true,
        ..Default::default()
    }];
    output.sheets[0].x14_data_validations_declared_count = Some(1);

    let xlsx_bytes = write_xlsx_from_parse_output(&output).expect("write_xlsx_from_parse_output");
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;

    assert_eq!(exported.sheets[0].x14_data_validations_declared_count, None);
    assert!(exported.sheets[0].x14_data_validations.is_empty());
    assert_eq!(exported.sheets[0].data_validations.len(), 1);
    assert_eq!(
        exported.sheets[0].data_validations[0].ranges,
        vec!["A1:A3".to_string()]
    );
}

#[test]
fn roundtrip_empty_data_validation_container_survives_l2_hydration_export() {
    let mut output = make_single_sheet("DV_EmptyContainer", vec![]);
    output.sheets[0].data_validations_disable_prompts = true;
    output.sheets[0].data_validations_declared_count = Some(0);

    let xlsx_bytes = write_xlsx_from_parse_output(&output).expect("write_xlsx_from_parse_output");
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;

    assert!(exported.sheets[0].data_validations.is_empty());
    assert!(exported.sheets[0].data_validations_disable_prompts);
    assert_eq!(exported.sheets[0].data_validations_declared_count, Some(0));
}

#[test]
fn roundtrip_data_validation_custom() {
    let mut output = make_single_sheet(
        "DV_Custom",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(42.0).unwrap()))],
    );
    output.sheets[0].data_validations = vec![ValidationSpec {
        ranges: vec!["A1".to_string()],
        rule: ValidationRule::Custom {
            formula1: "AND(A1>0,A1<100)".to_string(),
        },
        error_style: ErrorStyle::Information,
        show_error: true,
        error_title: Some("Notice".to_string()),
        error_message: Some("Value should be 1-99".to_string()),
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: false,
        ime_mode: ImeMode::NoControl,
        uid: None,
    }];

    let rt = roundtrip(&output);
    let rt_dvs = &rt.sheets[0].data_validations;
    assert!(!rt_dvs.is_empty(), "Custom validation should survive");

    match &rt_dvs[0].rule {
        ValidationRule::Custom { formula1 } => {
            assert!(
                formula1.contains("A1"),
                "Custom formula should reference A1. Got: {formula1}"
            );
        }
        other => panic!("Expected Custom rule, got {:?}", other),
    }

    assert_eq!(
        rt_dvs[0].allow_blank, false,
        "allow_blank should be preserved"
    );
}
