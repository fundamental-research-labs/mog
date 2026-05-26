//! Editor type resolution logic.
//!
//! Pure decision logic that determines which cell editor to show based on schema.
//! Ported from TypeScript `resolveEditorType`.

use serde::{Deserialize, Serialize};

use super::types::{EditorType, EditorTypeResolutionResult, SchemaConstraints, SchemaType};

/// Minimal cell schema for editor resolution (simpler than full ColumnSchema).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellSchema {
    #[serde(rename = "type")]
    pub schema_type: Option<SchemaType>,
    pub constraints: Option<SchemaConstraints>,
}

/// Input for editor type resolution.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorTypeResolutionInput {
    pub schema: Option<CellSchema>,
    pub resolved_enum_items: Option<Vec<String>>,
}

/// Resolve the appropriate editor type from a cell's schema.
///
/// Resolution priority:
/// 1. Dropdown: enum_values constraint present
/// 2. Checkbox: boolean type
/// 3. Date: date type
/// 4. Slider: number-like type with BOTH min AND max constraints
/// 5. Text: default (with validation flag if has constraints)
pub fn resolve_editor_type(input: &EditorTypeResolutionInput) -> EditorTypeResolutionResult {
    let schema = match &input.schema {
        Some(s) => s,
        None => {
            return EditorTypeResolutionResult {
                editor_type: EditorType::Text,
                enum_items: None,
                requires_validation: false,
            };
        }
    };

    let constraints = &schema.constraints;

    // Priority 1: Dropdown — enum_values constraint present
    if has_dropdown_constraint(constraints) {
        let items = if input.resolved_enum_items.is_some() {
            input.resolved_enum_items.clone()
        } else {
            constraints.as_ref().and_then(|c| c.enum_values.clone())
        };
        return EditorTypeResolutionResult {
            editor_type: EditorType::Dropdown,
            enum_items: items,
            requires_validation: true,
        };
    }

    // Priority 2: Checkbox — boolean type
    if schema.schema_type == Some(SchemaType::Boolean) {
        return EditorTypeResolutionResult {
            editor_type: EditorType::Checkbox,
            enum_items: None,
            requires_validation: false,
        };
    }

    // Priority 3: Date — date type
    if schema.schema_type == Some(SchemaType::Date) {
        return EditorTypeResolutionResult {
            editor_type: EditorType::Date,
            enum_items: None,
            requires_validation: has_any_constraint(constraints),
        };
    }

    // Priority 4: Slider — number-like type with BOTH min AND max
    if let Some(schema_type) = schema.schema_type
        && is_number_like(schema_type)
        && let Some(c) = constraints.as_ref()
        && c.min.is_some()
        && c.max.is_some()
    {
        return EditorTypeResolutionResult {
            editor_type: EditorType::Slider,
            enum_items: None,
            requires_validation: true,
        };
    }

    // Default: Text
    EditorTypeResolutionResult {
        editor_type: EditorType::Text,
        enum_items: None,
        requires_validation: has_any_constraint(constraints),
    }
}

/// Check if a schema type is number-like (eligible for slider).
fn is_number_like(schema_type: SchemaType) -> bool {
    matches!(
        schema_type,
        SchemaType::Number | SchemaType::Integer | SchemaType::Currency | SchemaType::Percentage
    )
}

/// Check if constraints include a non-empty enum (dropdown trigger).
fn has_dropdown_constraint(constraints: &Option<SchemaConstraints>) -> bool {
    constraints
        .as_ref()
        .and_then(|c| c.enum_values.as_ref())
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

/// Check if constraints have any validation requirement.
fn has_any_constraint(constraints: &Option<SchemaConstraints>) -> bool {
    match constraints {
        None => false,
        Some(c) => {
            c.required == Some(true)
                || c.min.is_some()
                || c.max.is_some()
                || c.min_length.is_some()
                || c.max_length.is_some()
                || c.pattern.is_some()
                || c.unique == Some(true)
                || c.formula.is_some()
        }
    }
}

/// Get enum items from schema (resolved takes priority over static).
pub fn get_schema_enum_items(
    schema: &Option<CellSchema>,
    resolved: Option<&[String]>,
) -> Option<Vec<String>> {
    if let Some(items) = resolved {
        return Some(items.to_vec());
    }
    schema
        .as_ref()
        .and_then(|s| s.constraints.as_ref())
        .and_then(|c| c.enum_values.clone())
}

/// Quick check: does this schema produce a dropdown editor?
pub fn is_dropdown_schema(schema: &Option<CellSchema>) -> bool {
    schema
        .as_ref()
        .and_then(|s| s.constraints.as_ref())
        .and_then(|c| c.enum_values.as_ref())
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

/// Quick check: does this schema produce a checkbox editor?
pub fn is_checkbox_schema(schema: &Option<CellSchema>) -> bool {
    schema
        .as_ref()
        .map(|s| s.schema_type == Some(SchemaType::Boolean))
        .unwrap_or(false)
}

/// Quick check: does this schema produce a date editor?
pub fn is_date_schema(schema: &Option<CellSchema>) -> bool {
    schema
        .as_ref()
        .map(|s| s.schema_type == Some(SchemaType::Date))
        .unwrap_or(false)
}

/// Quick check: does this schema produce a slider editor?
/// Requires a number-like type with BOTH min AND max constraints.
pub fn is_slider_schema(schema: &Option<CellSchema>) -> bool {
    schema
        .as_ref()
        .map(|s| {
            if let Some(st) = s.schema_type
                && is_number_like(st)
                && let Some(c) = &s.constraints
            {
                return c.min.is_some() && c.max.is_some();
            }
            false
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

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

    // ─── resolve_editor_type ───

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
        assert_eq!(result.enum_items, None);
        assert!(!result.requires_validation);
    }

    #[test]
    fn date_returns_date_no_validation() {
        let schema = make_schema(Some(SchemaType::Date), None);
        let result = resolve_editor_type(&make_input(Some(schema)));
        assert_eq!(result.editor_type, EditorType::Date);
        assert_eq!(result.enum_items, None);
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
        assert_eq!(result.enum_items, None);
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
        assert_eq!(result.enum_items, None);
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
        assert_eq!(result.enum_items, None);
        assert!(result.requires_validation);
    }

    #[test]
    fn number_with_only_min_returns_text_with_validation() {
        let constraints = SchemaConstraints {
            min: Some(0.0),
            ..Default::default()
        };
        let schema = make_schema(Some(SchemaType::Number), Some(constraints));
        let result = resolve_editor_type(&make_input(Some(schema)));
        assert_eq!(result.editor_type, EditorType::Text);
        assert_eq!(result.enum_items, None);
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
        assert_eq!(result.enum_items, None);
        assert!(result.requires_validation);
    }

    #[test]
    fn plain_string_returns_text_no_validation() {
        let schema = make_schema(Some(SchemaType::String), None);
        let result = resolve_editor_type(&make_input(Some(schema)));
        assert_eq!(result.editor_type, EditorType::Text);
        assert_eq!(result.enum_items, None);
        assert!(!result.requires_validation);
    }

    // ─── helper functions ───

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
    fn test_is_dropdown_without_enum() {
        let schema = Some(make_schema(Some(SchemaType::String), None));
        assert!(!is_dropdown_schema(&schema));
    }

    #[test]
    fn test_is_checkbox_with_boolean() {
        let schema = Some(make_schema(Some(SchemaType::Boolean), None));
        assert!(is_checkbox_schema(&schema));
    }

    #[test]
    fn test_is_checkbox_with_string() {
        let schema = Some(make_schema(Some(SchemaType::String), None));
        assert!(!is_checkbox_schema(&schema));
    }

    #[test]
    fn test_is_date_with_date_type() {
        let schema = Some(make_schema(Some(SchemaType::Date), None));
        assert!(is_date_schema(&schema));
    }

    #[test]
    fn test_is_date_with_string_type() {
        let schema = Some(make_schema(Some(SchemaType::String), None));
        assert!(!is_date_schema(&schema));
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
    fn test_is_slider_number_without_max_returns_false() {
        let schema = Some(make_schema(
            Some(SchemaType::Number),
            Some(SchemaConstraints {
                min: Some(0.0),
                ..Default::default()
            }),
        ));
        assert!(!is_slider_schema(&schema));
    }

    // ─── get_schema_enum_items ───

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

    // ─── has_any_constraint ───

    #[test]
    fn test_has_any_constraint_empty() {
        assert!(!has_any_constraint(&None));
        assert!(!has_any_constraint(&Some(SchemaConstraints::default())));
    }

    #[test]
    fn test_has_any_constraint_required() {
        let c = SchemaConstraints {
            required: Some(true),
            ..Default::default()
        };
        assert!(has_any_constraint(&Some(c)));
    }

    #[test]
    fn test_has_any_constraint_pattern() {
        let c = SchemaConstraints {
            pattern: Some("^[A-Z]+$".into()),
            ..Default::default()
        };
        assert!(has_any_constraint(&Some(c)));
    }

    #[test]
    fn test_has_any_constraint_formula() {
        let c = SchemaConstraints {
            formula: Some("=A1>0".into()),
            ..Default::default()
        };
        assert!(has_any_constraint(&Some(c)));
    }

    #[test]
    fn test_has_any_constraint_unique() {
        let c = SchemaConstraints {
            unique: Some(true),
            ..Default::default()
        };
        assert!(has_any_constraint(&Some(c)));
    }

    // ─── priority tests ───

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
}
