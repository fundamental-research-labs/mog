//! XLSX export regressions for runtime-created data validation metadata.

use super::super::*;
use super::helpers::*;
use domain_types::{
    ParseOutput, SheetData,
    domain::validation::{
        EnforcementLevel, ErrorMessage, ErrorStyle, IdentityRangeSchemaRef, ImeMode, InputMessage,
        RangeSchema, RangeSchemaDefinition, RangeSchemaUi, SchemaConstraints, SchemaType,
        ValidationOperator, ValidationRule, ValidationSpec,
    },
};

fn range_ref(start_id: &str, end_id: &str) -> IdentityRangeSchemaRef {
    IdentityRangeSchemaRef {
        start_id: start_id.to_string(),
        end_id: end_id.to_string(),
        sheet_id: None,
    }
}

fn list_validation_schema() -> RangeSchema {
    RangeSchema {
        id: "rs-status".to_string(),
        created_at: 0,
        ranges: vec![range_ref("1:0", "5:0")],
        schema: RangeSchemaDefinition {
            schema_type: None,
            constraints: Some(SchemaConstraints {
                enum_values: Some(vec![
                    "Draft".to_string(),
                    "Approved".to_string(),
                    "Blocked".to_string(),
                ]),
                allow_blank: Some(false),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: Some(RangeSchemaUi {
            show_dropdown: Some(true),
            error_message: Some(ErrorMessage {
                title: Some("Invalid status".to_string()),
                message: Some("Choose Draft, Approved, or Blocked".to_string()),
            }),
            input_message: Some(InputMessage {
                title: Some("Status".to_string()),
                message: Some("Choose a status".to_string()),
            }),
        }),
    }
}

fn whole_number_validation_schema() -> RangeSchema {
    RangeSchema {
        id: "rs-priority".to_string(),
        created_at: 0,
        ranges: vec![range_ref("1:1", "5:1")],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Integer),
            constraints: Some(SchemaConstraints {
                min: Some(1.0),
                max: Some(5.0),
                allow_blank: Some(false),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Warning),
        ui: Some(RangeSchemaUi {
            show_dropdown: None,
            error_message: Some(ErrorMessage {
                title: Some("Invalid priority".to_string()),
                message: Some("Priority must be 1 through 5".to_string()),
            }),
            input_message: None,
        }),
    }
}

#[test]
fn runtime_created_range_backed_validations_export_to_parse_output_and_xlsx() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .set_range_schema(&sid, &list_validation_schema())
        .expect("create list validation");
    engine
        .set_range_schema(&sid, &whole_number_validation_schema())
        .expect("create whole-number validation");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    let validations = &exported.sheets[0].data_validations;
    assert_eq!(validations.len(), 2);
    assert!(exported.sheets[0].x14_data_validations.is_empty());

    let status = validations
        .iter()
        .find(|spec| spec.ranges.as_slice() == ["A2:A6"])
        .expect("status validation");
    match &status.rule {
        ValidationRule::List {
            formula1,
            show_dropdown,
        } => {
            assert_eq!(formula1, "\"Draft,Approved,Blocked\"");
            assert!(*show_dropdown);
        }
        other => panic!("expected list validation, got {other:?}"),
    }
    assert!(!status.allow_blank);
    assert!(status.show_prompt);
    assert_eq!(status.prompt_title.as_deref(), Some("Status"));
    assert_eq!(status.error_title.as_deref(), Some("Invalid status"));
    assert_eq!(status.uid, None);

    let priority = validations
        .iter()
        .find(|spec| spec.ranges.as_slice() == ["B2:B6"])
        .expect("priority validation");
    match &priority.rule {
        ValidationRule::WholeNumber {
            operator,
            formula1,
            formula2,
        } => {
            assert_eq!(*operator, ValidationOperator::Between);
            assert_eq!(formula1, "1");
            assert_eq!(formula2.as_deref(), Some("5"));
        }
        other => panic!("expected whole-number validation, got {other:?}"),
    }
    assert!(!priority.allow_blank);
    assert_eq!(
        priority.error_style,
        domain_types::domain::validation::ErrorStyle::Warning
    );
    assert_eq!(priority.uid, None);

    let bytes = engine
        .export_to_xlsx_bytes()
        .expect("runtime-created validations should export to XLSX bytes");
    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).expect("xlsx archive");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(
        sheet_xml.contains(r#"<dataValidations count="2">"#),
        "{sheet_xml}"
    );
    assert!(sheet_xml.contains(r#"sqref="A2:A6""#), "{sheet_xml}");
    assert!(sheet_xml.contains(r#"type="list""#), "{sheet_xml}");
    assert!(
        sheet_xml.contains(r#"<formula1>"Draft,Approved,Blocked"</formula1>"#),
        "{sheet_xml}"
    );
    assert!(sheet_xml.contains(r#"sqref="B2:B6""#), "{sheet_xml}");
    assert!(sheet_xml.contains(r#"type="whole""#), "{sheet_xml}");
    assert!(
        sheet_xml.contains(r#"<formula1>1</formula1>"#),
        "{sheet_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<formula2>5</formula2>"#),
        "{sheet_xml}"
    );
    assert!(!sheet_xml.contains("xr:uid="), "{sheet_xml}");
}

#[test]
fn imported_x14_validations_hydrate_to_canonical_store_and_export_as_classic() {
    let mut input = ParseOutput {
        sheets: vec![SheetData {
            name: "DV_X14".to_string(),
            rows: 3,
            cols: 1,
            ..Default::default()
        }],
        ..Default::default()
    };
    input.sheets[0].x14_data_validations = vec![ValidationSpec {
        ranges: vec!["A1:A3".to_string()],
        rule: ValidationRule::WholeNumber {
            operator: ValidationOperator::GreaterThan,
            formula1: "5".to_string(),
            formula2: None,
        },
        error_style: ErrorStyle::Warning,
        show_error: true,
        error_title: Some("Too small".to_string()),
        error_message: Some("Use a value greater than 5".to_string()),
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: false,
        ime_mode: ImeMode::NoControl,
        uid: None,
    }];
    input.sheets[0].x14_data_validations_declared_count = Some(1);

    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&input)
        .expect("write_xlsx_from_parse_output");
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    assert!(exported.sheets[0].x14_data_validations.is_empty());
    assert_eq!(exported.sheets[0].x14_data_validations_declared_count, None);

    let validations = &exported.sheets[0].data_validations;
    assert_eq!(validations.len(), 1);
    assert_eq!(validations[0].ranges, vec!["A1:A3".to_string()]);
    assert_eq!(validations[0].uid, None);
    match &validations[0].rule {
        ValidationRule::WholeNumber {
            operator,
            formula1,
            formula2,
        } => {
            assert_eq!(*operator, ValidationOperator::GreaterThan);
            assert_eq!(formula1, "5");
            assert_eq!(formula2, &None);
        }
        other => panic!("expected whole-number validation, got {other:?}"),
    }

    let exported_bytes = engine
        .export_to_xlsx_bytes()
        .expect("normalized validations should export to XLSX bytes");
    let sheet_xml = archive_text(&exported_bytes, "xl/worksheets/sheet1.xml")
        .expect("worksheet xml should exist");
    assert!(
        sheet_xml.contains(r#"<dataValidations count="1">"#),
        "{sheet_xml}"
    );
    assert!(!sheet_xml.contains("<x14:dataValidations"), "{sheet_xml}");
    assert!(!sheet_xml.contains("xr:uid="), "{sheet_xml}");
}
