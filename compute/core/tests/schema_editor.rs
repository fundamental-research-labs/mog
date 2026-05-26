//! Integration tests for schema::editor module.

use compute_core::schema::editor::*;
use compute_core::schema::types::{EditorType, SchemaConstraints, SchemaType};

fn make_input(schema: Option<CellSchema>) -> EditorTypeResolutionInput {
    EditorTypeResolutionInput {
        schema,
        resolved_enum_items: None,
    }
}

fn make_schema(
    schema_type: Option<SchemaType>,
    constraints: Option<SchemaConstraints>,
) -> CellSchema {
    CellSchema {
        schema_type,
        constraints,
    }
}

#[test]
fn no_schema_returns_text_no_validation() {
    let result = resolve_editor_type(&make_input(None));
    assert_eq!(result.editor_type, EditorType::Text);
    assert_eq!(result.enum_items, None);
    assert!(!result.requires_validation);
}

#[test]
fn enum_constraint_returns_dropdown() {
    let constraints = SchemaConstraints {
        enum_values: Some(vec!["A".into(), "B".into(), "C".into()]),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::String), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Dropdown);
    assert_eq!(
        result.enum_items,
        Some(vec!["A".into(), "B".into(), "C".into()])
    );
    assert!(result.requires_validation);
}

#[test]
fn resolved_enum_items_override_static() {
    let constraints = SchemaConstraints {
        enum_values: Some(vec!["static".into()]),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::String), Some(constraints));
    let input = EditorTypeResolutionInput {
        schema: Some(schema),
        resolved_enum_items: Some(vec!["resolved_a".into(), "resolved_b".into()]),
    };
    let result = resolve_editor_type(&input);
    assert_eq!(result.editor_type, EditorType::Dropdown);
    assert_eq!(
        result.enum_items,
        Some(vec!["resolved_a".into(), "resolved_b".into()])
    );
}

#[test]
fn boolean_returns_checkbox() {
    let schema = make_schema(Some(SchemaType::Boolean), None);
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Checkbox);
    assert!(!result.requires_validation);
}

#[test]
fn date_returns_date_no_validation() {
    let schema = make_schema(Some(SchemaType::Date), None);
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Date);
    assert!(!result.requires_validation);
}

#[test]
fn date_with_required_returns_date_with_validation() {
    let constraints = SchemaConstraints {
        required: Some(true),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::Date), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Date);
    assert!(result.requires_validation);
}

#[test]
fn number_with_min_and_max_returns_slider() {
    let constraints = SchemaConstraints {
        min: Some(0.0),
        max: Some(100.0),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::Number), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Slider);
    assert!(result.requires_validation);
}

#[test]
fn integer_with_min_and_max_returns_slider() {
    let constraints = SchemaConstraints {
        min: Some(1.0),
        max: Some(10.0),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::Integer), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Slider);
    assert!(result.requires_validation);
}

#[test]
fn number_with_only_min_returns_text() {
    let constraints = SchemaConstraints {
        min: Some(0.0),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::Number), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Text);
    assert!(result.requires_validation);
}

#[test]
fn string_with_required_returns_text_with_validation() {
    let constraints = SchemaConstraints {
        required: Some(true),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::String), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Text);
    assert!(result.requires_validation);
}

#[test]
fn test_is_dropdown_with_enum() {
    let schema = Some(make_schema(
        Some(SchemaType::String),
        Some(SchemaConstraints {
            enum_values: Some(vec!["a".into()]),
            ..Default::default()
        }),
    ));
    assert!(is_dropdown_schema(&schema));
}

#[test]
fn test_is_checkbox_with_boolean() {
    let schema = Some(make_schema(Some(SchemaType::Boolean), None));
    assert!(is_checkbox_schema(&schema));
}

#[test]
fn test_is_date_with_date_type() {
    let schema = Some(make_schema(Some(SchemaType::Date), None));
    assert!(is_date_schema(&schema));
}

#[test]
fn test_is_slider_number_with_bounds() {
    let schema = Some(make_schema(
        Some(SchemaType::Number),
        Some(SchemaConstraints {
            min: Some(0.0),
            max: Some(100.0),
            ..Default::default()
        }),
    ));
    assert!(is_slider_schema(&schema));
}

#[test]
fn test_is_slider_string_with_bounds_returns_false() {
    let schema = Some(make_schema(
        Some(SchemaType::String),
        Some(SchemaConstraints {
            min: Some(0.0),
            max: Some(100.0),
            ..Default::default()
        }),
    ));
    assert!(!is_slider_schema(&schema));
}

#[test]
fn dropdown_takes_priority_over_boolean() {
    let constraints = SchemaConstraints {
        enum_values: Some(vec!["Yes".into(), "No".into()]),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::Boolean), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Dropdown);
}

#[test]
fn empty_enum_does_not_trigger_dropdown() {
    let constraints = SchemaConstraints {
        enum_values: Some(vec![]),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::String), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Text);
}

#[test]
fn currency_with_min_max_returns_slider() {
    let constraints = SchemaConstraints {
        min: Some(0.0),
        max: Some(1000.0),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::Currency), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Slider);
}

#[test]
fn percentage_with_min_max_returns_slider() {
    let constraints = SchemaConstraints {
        min: Some(0.0),
        max: Some(1.0),
        ..Default::default()
    };
    let schema = make_schema(Some(SchemaType::Percentage), Some(constraints));
    let result = resolve_editor_type(&make_input(Some(schema)));
    assert_eq!(result.editor_type, EditorType::Slider);
}

#[test]
fn get_enum_items_resolved_takes_priority() {
    let schema = Some(make_schema(
        Some(SchemaType::String),
        Some(SchemaConstraints {
            enum_values: Some(vec!["static".into()]),
            ..Default::default()
        }),
    ));
    let resolved = vec!["resolved".to_string()];
    let result = get_schema_enum_items(&schema, Some(&resolved));
    assert_eq!(result, Some(vec!["resolved".into()]));
}

#[test]
fn get_enum_items_falls_back_to_static() {
    let schema = Some(make_schema(
        Some(SchemaType::String),
        Some(SchemaConstraints {
            enum_values: Some(vec!["static".into()]),
            ..Default::default()
        }),
    ));
    let result = get_schema_enum_items(&schema, None);
    assert_eq!(result, Some(vec!["static".into()]));
}

#[test]
fn get_enum_items_none_when_no_schema() {
    let result = get_schema_enum_items(&None, None);
    assert_eq!(result, None);
}
