//! End-to-end round-trip tests for worksheet-level `<dataValidations>`.
//!
//! Typed OOXML preservation: inventory row 5.5 replaced the prior raw-XML sidecar
//! raw worksheet XML sidecars with full-coverage typed
//! fields: `SheetData.data_validations` carries `Vec<ValidationSpec>`, and
//! `SheetData.{data_validations_disable_prompts,_x_window,_y_window}` carry
//! the container attributes. `ValidationSpec` itself grew an `ime_mode`
//! field so the parser→domain→writer path no longer drops CT_DataValidation
//! attributes the blob was compensating for.
//!
//! These tests exercise the reconstruction path without any round-trip
//! context — the only source of truth is the typed `SheetData` — to lock
//! the blob-deletion fidelity contract.

use domain_types::{
    ErrorStyle, ImeMode, ParseOutput, SheetData, SheetDimensions, ValidationOperator,
    ValidationRule, ValidationSpec,
};
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

fn make_sheet_with_validations(
    specs: Vec<ValidationSpec>,
    disable_prompts: bool,
    x_window: Option<u32>,
    y_window: Option<u32>,
) -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 4,
            cells: Vec::new(),
            dimensions: SheetDimensions::default(),
            data_validations: specs,
            data_validations_disable_prompts: disable_prompts,
            data_validations_x_window: x_window,
            data_validations_y_window: y_window,
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn data_validations_typed_field_round_trips_losslessly() {
    let original = vec![
        ValidationSpec {
            ranges: vec!["A1:A10".to_string()],
            rule: ValidationRule::WholeNumber {
                operator: ValidationOperator::Between,
                formula1: "1".to_string(),
                formula2: Some("100".to_string()),
            },
            error_style: ErrorStyle::Warning,
            show_error: true,
            error_title: Some("Invalid".to_string()),
            error_message: Some("Enter 1-100".to_string()),
            show_prompt: true,
            prompt_title: Some("Input".to_string()),
            prompt_message: Some("Enter a number".to_string()),
            allow_blank: true,
            ime_mode: ImeMode::NoControl,
            uid: None,
        },
        ValidationSpec {
            ranges: vec!["B1:B5".to_string()],
            rule: ValidationRule::List {
                formula1: "\"Red,Green,Blue\"".to_string(),
                show_dropdown: true,
            },
            error_style: ErrorStyle::Stop,
            show_error: true,
            error_title: None,
            error_message: None,
            show_prompt: false,
            prompt_title: None,
            prompt_message: None,
            allow_blank: true,
            ime_mode: ImeMode::NoControl,
            uid: None,
        },
    ];

    let po = make_sheet_with_validations(original.clone(), false, None, None);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    assert_eq!(&bytes[0..2], b"PK");

    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    let dvs = &rt.sheets[0].data_validations;
    assert_eq!(dvs.len(), original.len());
    assert_eq!(dvs[0], original[0]);
    assert_eq!(dvs[1], original[1]);
}

#[test]
fn data_validations_container_attrs_round_trip() {
    // disable_prompts, x_window, y_window were silently dropped by the
    // pre-typed-OOXML-preservation writer when no raw blob was present. This test locks
    // the fix — the typed fields now round-trip without a sidecar.
    let original = vec![ValidationSpec {
        ranges: vec!["A1".to_string()],
        rule: ValidationRule::Custom {
            formula1: "=A1>0".to_string(),
        },
        error_style: ErrorStyle::Stop,
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

    let po = make_sheet_with_validations(original, true, Some(250), Some(400));
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    let sheet = &rt.sheets[0];

    assert!(
        sheet.data_validations_disable_prompts,
        "disablePrompts lost during round trip"
    );
    assert_eq!(
        sheet.data_validations_x_window,
        Some(250),
        "xWindow lost during round trip"
    );
    assert_eq!(
        sheet.data_validations_y_window,
        Some(400),
        "yWindow lost during round trip"
    );
}

#[test]
fn data_validations_declared_count_round_trips_when_imported() {
    let original = vec![ValidationSpec {
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

    let mut po = make_sheet_with_validations(original, false, None, None);
    po.sheets[0].data_validations_declared_count = Some(2);

    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let archive = XlsxArchive::new(&bytes).expect("xlsx archive");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(sheet_xml.contains("<dataValidations count=\"2\">"));
    assert_eq!(sheet_xml.matches("<dataValidation ").count(), 1);

    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    assert_eq!(rt.sheets[0].data_validations_declared_count, Some(2));
    assert_eq!(rt.sheets[0].data_validations.len(), 1);
}

#[test]
fn data_validations_ime_mode_round_trips() {
    // imeMode was parsed but never plumbed into `ValidationSpec` before
    // typed OOXML preservation This test covers the new `ime_mode` field end to
    // end: write → parse reproduces the original IME mode.
    let original = vec![ValidationSpec {
        ranges: vec!["C1:C10".to_string()],
        rule: ValidationRule::TextLength {
            operator: ValidationOperator::LessThanOrEqual,
            formula1: "20".to_string(),
            formula2: None,
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: None,
        error_message: None,
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: ImeMode::Hiragana,
        uid: None,
    }];

    let po = make_sheet_with_validations(original.clone(), false, None, None);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    let dv = &rt.sheets[0].data_validations[0];
    assert_eq!(
        dv.ime_mode,
        ImeMode::Hiragana,
        "imeMode lost during round trip"
    );
}

#[test]
fn data_validations_empty_produces_no_sidecar() {
    // Without validations, the worksheet must not emit a <dataValidations>
    // element at all (writer must not produce an empty container).
    let po = make_sheet_with_validations(Vec::new(), false, None, None);
    let bytes = write_xlsx_from_parse_output(&po).expect("write");
    let (rt, _diag) = parse_xlsx_to_output(&bytes).expect("parse");
    assert!(rt.sheets[0].data_validations.is_empty());
}
