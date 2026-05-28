//! Type inference engine.
//!
//! Infers cell types from CellValue and column schemas from sample data.

use std::collections::HashMap;

use value_types::CellValue;

use super::patterns::detect_semantic_type;
use super::types::{ColumnSchema, InferredSchema, SchemaConstraints, SchemaType};

// ---------------------------------------------------------------------------
// Single-value inference
// ---------------------------------------------------------------------------

/// Infer the `SchemaType` of a single `CellValue`.
pub fn infer_type(value: &CellValue) -> SchemaType {
    match value {
        CellValue::Null => SchemaType::Null,
        CellValue::Boolean(_) => SchemaType::Boolean,
        CellValue::Number(n) => {
            let f: f64 = **n;
            if f.fract() == 0.0 {
                SchemaType::Integer
            } else {
                SchemaType::Number
            }
        }
        CellValue::Text(s) => infer_text_type(s),
        CellValue::Error(..) => SchemaType::Any,
        CellValue::Array(_) => SchemaType::Any,
        CellValue::Control(_) => SchemaType::Boolean,
        CellValue::Image(_) => SchemaType::Any,
    }
}

/// Infer the schema type from a text string value.
fn infer_text_type(text: &str) -> SchemaType {
    let trimmed = text.trim();

    // Empty string -> Null
    if trimmed.is_empty() {
        return SchemaType::Null;
    }

    // Boolean strings
    let lower = trimmed.to_ascii_lowercase();
    if lower == "true" || lower == "false" {
        return SchemaType::Boolean;
    }

    // Semantic pattern detection
    if let Some(semantic) = detect_semantic_type(trimmed) {
        return semantic;
    }

    // Numeric string -- only if round-trip matches
    if let Ok(n) = trimmed.parse::<f64>()
        && format!("{}", n) == trimmed
    {
        return SchemaType::Number;
    }

    // Default
    SchemaType::String
}

// ---------------------------------------------------------------------------
// Type compatibility
// ---------------------------------------------------------------------------

/// Returns the set of target types that `source` is compatible with.
fn compatible_targets(source: SchemaType) -> &'static [SchemaType] {
    use SchemaType::*;
    match source {
        Null => &[Null, Any],
        Boolean => &[Boolean, Any],
        Number => &[Number, Any],
        Integer => &[Integer, Number, Any],
        String => &[String, Any],
        Date => &[Date, Any],
        Email => &[Email, String, Any],
        Url => &[Url, String, Any],
        Phone => &[Phone, String, Any],
        Currency => &[Currency, Number, Any],
        Percentage => &[Percentage, Number, Any],
        Time => &[Time, String, Number, Any],
        Company => &[Company, String, Any],
        Person => &[Person, String, Any],
        Stock => &[Stock, String, Any],
        Location => &[Location, String, Any],
        Distribution => &[Distribution, Number, Any],
        Any => &[Any],
    }
}

/// Check if `source` type is compatible with `target` type.
///
/// E.g., `Integer` is compatible with `Number`; `Email` is compatible with `String`.
pub fn is_compatible_type(source: SchemaType, target: SchemaType) -> bool {
    if source == target {
        return true;
    }
    if target == SchemaType::Any {
        return true;
    }
    compatible_targets(source).contains(&target)
}

// ---------------------------------------------------------------------------
// Common type
// ---------------------------------------------------------------------------

/// Find the most specific common type for two types.
///
/// - Same type returns itself.
/// - If one is `Null`, returns the other.
/// - If both share the same base type, returns that base type.
/// - Otherwise returns `Any`.
pub fn common_type(type1: SchemaType, type2: SchemaType) -> SchemaType {
    if type1 == type2 {
        return type1;
    }
    if type1 == SchemaType::Null {
        return type2;
    }
    if type2 == SchemaType::Null {
        return type1;
    }

    let base1 = type1.base_type();
    let base2 = type2.base_type();

    if base1 == base2 {
        return base1;
    }

    SchemaType::Any
}

// ---------------------------------------------------------------------------
// Type priority
// ---------------------------------------------------------------------------

/// Type priority for column inference. Higher values mean more specific types.
fn type_priority(t: SchemaType) -> u8 {
    use SchemaType::*;
    match t {
        // Entities (most specific)
        Stock => 100,
        Company => 99,
        Person => 98,
        Location => 97,
        // Semantic (specific)
        Email => 90,
        Url => 89,
        Phone => 88,
        Percentage => 85,
        Currency => 84,
        Time => 83,
        // Primitives
        Date => 70,
        Integer => 60,
        Number => 50,
        Boolean => 40,
        String => 30,
        // Generic
        Null => 10,
        Distribution => 5,
        Any => 0,
    }
}

// ---------------------------------------------------------------------------
// Column schema inference
// ---------------------------------------------------------------------------

/// Infer a column schema from sample cell values.
///
/// Returns an `InferredSchema` with the dominant type, confidence, sample size,
/// and the distribution of types found.
pub fn infer_column_schema(values: &[CellValue]) -> InferredSchema {
    if values.is_empty() {
        return InferredSchema {
            schema: ColumnSchema {
                id: std::string::String::new(),
                name: std::string::String::new(),
                schema_type: SchemaType::Any,
                constraints: None,
                distribution: None,
                description: None,
            },
            confidence: 0.0,
            sample_size: 0,
            types_found: HashMap::new(),
        };
    }

    // Count types
    let mut type_counts: HashMap<SchemaType, usize> = HashMap::new();
    let mut non_null_count: usize = 0;

    for v in values {
        let t = infer_type(v);
        *type_counts.entry(t).or_insert(0) += 1;
        if t != SchemaType::Null {
            non_null_count += 1;
        }
    }

    // If no non-null values found
    if non_null_count == 0 {
        return InferredSchema {
            schema: ColumnSchema {
                id: std::string::String::new(),
                name: std::string::String::new(),
                schema_type: SchemaType::Null,
                constraints: None,
                distribution: None,
                description: None,
            },
            confidence: 1.0,
            sample_size: values.len(),
            types_found: type_counts,
        };
    }

    // Find the dominant non-null type (highest count, then highest priority)
    let mut dominant_type = SchemaType::Any;
    let mut dominant_count: usize = 0;
    let mut dominant_priority: i16 = -1;

    for (&t, &count) in &type_counts {
        if t == SchemaType::Null {
            continue;
        }
        let priority = type_priority(t) as i16;
        if count > dominant_count || (count == dominant_count && priority > dominant_priority) {
            dominant_type = t;
            dominant_count = count;
            dominant_priority = priority;
        }
    }

    // Check compatibility -- widen to base type if needed
    let mut compatible_count: usize = 0;
    for (&t, &count) in &type_counts {
        if t == SchemaType::Null || is_compatible_type(t, dominant_type) {
            compatible_count += count;
        } else if is_compatible_type(dominant_type, t) {
            // dominant is a subtype of t, so widen to t
            compatible_count += count;
            dominant_type = t;
        } else {
            // Check if they share a common base type
            let base1 = t.base_type();
            let base2 = dominant_type.base_type();
            if base1 == base2 {
                compatible_count += count;
                // Widen to base type if types differ
                if t != dominant_type {
                    dominant_type = base1;
                }
            }
        }
    }

    // Calculate confidence
    let confidence = compatible_count as f64 / values.len() as f64;

    // Infer constraints from values
    let constraints = infer_constraints(values, dominant_type);
    let has_constraints = constraints.required.is_some()
        || constraints.min.is_some()
        || constraints.max.is_some()
        || constraints.max_length.is_some()
        || constraints.enum_values.is_some();

    InferredSchema {
        schema: ColumnSchema {
            id: std::string::String::new(),
            name: std::string::String::new(),
            schema_type: dominant_type,
            constraints: if has_constraints {
                Some(constraints)
            } else {
                None
            },
            distribution: None,
            description: None,
        },
        confidence,
        sample_size: values.len(),
        types_found: type_counts,
    }
}

// ---------------------------------------------------------------------------
// Constraint inference
// ---------------------------------------------------------------------------

/// Infer constraints from sample values for a given dominant type.
fn infer_constraints(values: &[CellValue], dominant_type: SchemaType) -> SchemaConstraints {
    let mut constraints = SchemaConstraints::default();

    // Check for required (no null/empty values)
    let has_nulls = values.iter().any(|v| match v {
        CellValue::Null => true,
        CellValue::Text(s) => s.is_empty(),
        _ => false,
    });
    if !has_nulls {
        constraints.required = Some(true);
    }

    // Numeric constraints
    let is_numeric = matches!(
        dominant_type,
        SchemaType::Number | SchemaType::Integer | SchemaType::Currency | SchemaType::Percentage
    );
    if is_numeric {
        let numbers: Vec<f64> = values
            .iter()
            .filter_map(|v| match v {
                CellValue::Number(n) => Some(**n),
                CellValue::Text(s) => {
                    let cleaned: std::string::String = s
                        .chars()
                        .filter(|c| {
                            !matches!(
                                c,
                                '$' | '\u{20ac}'
                                    | '\u{00a3}'
                                    | '\u{00a5}'
                                    | '\u{20b9}'
                                    | '\u{20bd}'
                                    | '\u{20a9}'
                                    | '%'
                                    | ','
                                    | ' '
                            )
                        })
                        .collect();
                    cleaned.parse::<f64>().ok()
                }
                _ => None,
            })
            .collect();

        if !numbers.is_empty() {
            let min = numbers.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = numbers.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

            if min >= 0.0 {
                constraints.min = Some(min);
            }
            if max <= 100.0
                && (dominant_type == SchemaType::Percentage || dominant_type == SchemaType::Integer)
            {
                constraints.max = Some(max);
            }
        }
    }

    // String length constraints
    let is_string_like = matches!(
        dominant_type,
        SchemaType::String | SchemaType::Email | SchemaType::Url | SchemaType::Phone
    );
    if is_string_like {
        let max_length: Option<usize> = values
            .iter()
            .filter_map(|v| {
                if let CellValue::Text(s) = v {
                    Some(s.len())
                } else {
                    None
                }
            })
            .max();

        if let Some(ml) = max_length
            && ml <= 255
        {
            constraints.max_length = Some(ml);
        }
    }

    // Enum detection: few unique non-null values and unique count < total/2
    let unique_values: std::collections::HashSet<std::string::String> = values
        .iter()
        .filter_map(|v| match v {
            CellValue::Null => None,
            CellValue::Text(s) if s.is_empty() => None,
            CellValue::Text(s) => Some(s.to_string()),
            CellValue::Number(n) => Some(format!("{}", **n)),
            CellValue::Boolean(b) => Some(b.to_string()),
            _ => None,
        })
        .collect();

    if !unique_values.is_empty()
        && unique_values.len() <= 10
        && unique_values.len() < values.len() / 2
    {
        let mut enum_vals: Vec<std::string::String> = unique_values.into_iter().collect();
        enum_vals.sort();
        constraints.enum_values = Some(enum_vals);
    }

    constraints
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::FiniteF64;

    fn num(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::new(v).unwrap())
    }

    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    // -- infer_type tests --

    #[test]
    fn infer_null() {
        assert_eq!(infer_type(&CellValue::Null), SchemaType::Null);
    }

    #[test]
    fn infer_boolean() {
        assert_eq!(infer_type(&CellValue::Boolean(true)), SchemaType::Boolean);
    }

    #[test]
    fn infer_integer() {
        assert_eq!(infer_type(&num(42.0)), SchemaType::Integer);
    }

    #[test]
    fn infer_float() {
        assert_eq!(infer_type(&num(3.14)), SchemaType::Number);
    }

    #[test]
    fn infer_text_email() {
        assert_eq!(infer_type(&text("user@example.com")), SchemaType::Email);
    }

    #[test]
    fn infer_text_url() {
        assert_eq!(infer_type(&text("https://example.com")), SchemaType::Url);
    }

    #[test]
    fn infer_text_plain() {
        assert_eq!(infer_type(&text("hello")), SchemaType::String);
    }

    #[test]
    fn infer_text_empty() {
        assert_eq!(infer_type(&text("")), SchemaType::Null);
    }

    #[test]
    fn infer_text_boolean_string() {
        assert_eq!(infer_type(&text("true")), SchemaType::Boolean);
        assert_eq!(infer_type(&text("FALSE")), SchemaType::Boolean);
    }

    #[test]
    fn infer_text_number_string() {
        assert_eq!(infer_type(&text("3.14")), SchemaType::Number);
    }

    #[test]
    fn infer_text_number_string_no_roundtrip() {
        assert_eq!(infer_type(&text("03.14")), SchemaType::String);
    }

    #[test]
    fn infer_error() {
        assert_eq!(
            infer_type(&CellValue::Error(value_types::CellError::Value, None)),
            SchemaType::Any
        );
    }

    #[test]
    fn infer_array() {
        assert_eq!(infer_type(&CellValue::from_rows(vec![])), SchemaType::Any);
    }

    // -- is_compatible_type tests --

    #[test]
    fn compatible_integer_number() {
        assert!(is_compatible_type(SchemaType::Integer, SchemaType::Number));
    }

    #[test]
    fn compatible_email_string() {
        assert!(is_compatible_type(SchemaType::Email, SchemaType::String));
    }

    #[test]
    fn not_compatible_number_integer() {
        assert!(!is_compatible_type(SchemaType::Number, SchemaType::Integer));
    }

    #[test]
    fn compatible_currency_number() {
        assert!(is_compatible_type(SchemaType::Currency, SchemaType::Number));
    }

    #[test]
    fn compatible_time_string() {
        assert!(is_compatible_type(SchemaType::Time, SchemaType::String));
    }

    #[test]
    fn compatible_time_number() {
        assert!(is_compatible_type(SchemaType::Time, SchemaType::Number));
    }

    #[test]
    fn compatible_same_type() {
        assert!(is_compatible_type(SchemaType::Date, SchemaType::Date));
    }

    #[test]
    fn compatible_any_target() {
        assert!(is_compatible_type(SchemaType::Boolean, SchemaType::Any));
    }

    #[test]
    fn not_compatible_string_number() {
        assert!(!is_compatible_type(SchemaType::String, SchemaType::Number));
    }

    // -- common_type tests --

    #[test]
    fn common_type_same() {
        assert_eq!(
            common_type(SchemaType::Date, SchemaType::Date),
            SchemaType::Date
        );
    }

    #[test]
    fn common_type_null_absorb() {
        assert_eq!(
            common_type(SchemaType::Null, SchemaType::Number),
            SchemaType::Number
        );
        assert_eq!(
            common_type(SchemaType::Integer, SchemaType::Null),
            SchemaType::Integer
        );
    }

    #[test]
    fn common_type_base() {
        assert_eq!(
            common_type(SchemaType::Email, SchemaType::Url),
            SchemaType::String
        );
    }

    #[test]
    fn common_type_integer_currency() {
        assert_eq!(
            common_type(SchemaType::Integer, SchemaType::Currency),
            SchemaType::Number
        );
    }

    #[test]
    fn common_type_incompatible() {
        assert_eq!(
            common_type(SchemaType::Boolean, SchemaType::Number),
            SchemaType::Any
        );
    }

    // -- infer_column_schema tests --

    #[test]
    fn infer_column_empty() {
        let result = infer_column_schema(&[]);
        assert_eq!(result.confidence, 0.0);
        assert_eq!(result.sample_size, 0);
        assert_eq!(result.schema.schema_type, SchemaType::Any);
    }

    #[test]
    fn infer_column_all_nulls() {
        let values = vec![CellValue::Null, CellValue::Null, CellValue::Null];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::Null);
        assert_eq!(result.confidence, 1.0);
        assert_eq!(result.sample_size, 3);
    }

    #[test]
    fn infer_column_integers() {
        let values = vec![num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::Integer);
        assert_eq!(result.confidence, 1.0);
        assert_eq!(result.sample_size, 5);
    }

    #[test]
    fn infer_column_mixed_numeric() {
        let values = vec![num(1.0), num(2.5), num(3.0), num(4.7)];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::Number);
        assert_eq!(result.confidence, 1.0);
    }

    #[test]
    fn infer_column_with_nulls() {
        let values = vec![
            num(1.0),
            CellValue::Null,
            num(3.0),
            CellValue::Null,
            num(5.0),
        ];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::Integer);
        assert_eq!(result.confidence, 1.0);
        assert_eq!(result.sample_size, 5);
    }

    #[test]
    fn infer_column_emails() {
        let values = vec![
            text("a@example.com"),
            text("b@example.com"),
            text("c@example.com"),
        ];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::Email);
        assert_eq!(result.confidence, 1.0);
    }

    #[test]
    fn infer_column_strings_with_enum() {
        let values = vec![
            text("Red"),
            text("Blue"),
            text("Red"),
            text("Green"),
            text("Blue"),
            text("Red"),
            text("Green"),
            text("Blue"),
        ];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::String);
        let constraints = result
            .schema
            .constraints
            .as_ref()
            .expect("should have constraints");
        let enums = constraints
            .enum_values
            .as_ref()
            .expect("should have enum_values");
        assert_eq!(enums.len(), 3);
        assert!(enums.contains(&"Red".to_string()));
        assert!(enums.contains(&"Blue".to_string()));
        assert!(enums.contains(&"Green".to_string()));
    }

    #[test]
    fn infer_column_required_constraint() {
        let values = vec![num(1.0), num(2.0), num(3.0)];
        let result = infer_column_schema(&values);
        let constraints = result
            .schema
            .constraints
            .as_ref()
            .expect("should have constraints");
        assert_eq!(constraints.required, Some(true));
    }

    #[test]
    fn infer_column_not_required_with_nulls() {
        let values = vec![num(1.0), CellValue::Null, num(3.0)];
        let result = infer_column_schema(&values);
        let required = result.schema.constraints.as_ref().and_then(|c| c.required);
        assert_ne!(required, Some(true));
    }

    #[test]
    fn infer_column_numeric_min_constraint() {
        let values = vec![num(5.0), num(10.0), num(15.0)];
        let result = infer_column_schema(&values);
        let constraints = result
            .schema
            .constraints
            .as_ref()
            .expect("should have constraints");
        assert_eq!(constraints.min, Some(5.0));
    }

    #[test]
    fn infer_column_mixed_types_incompatible() {
        let values = vec![
            CellValue::Boolean(true),
            CellValue::Boolean(false),
            num(42.0),
            num(10.0),
        ];
        let result = infer_column_schema(&values);
        assert!(result.confidence < 1.0);
    }

    #[test]
    fn type_priority_ordering() {
        assert!(type_priority(SchemaType::Stock) > type_priority(SchemaType::String));
        assert!(type_priority(SchemaType::Integer) > type_priority(SchemaType::Number));
        assert_eq!(type_priority(SchemaType::Any), 0);
    }

    // -- Column inference: type widening --

    #[test]
    fn infer_column_email_and_url_widen_to_string() {
        let values = vec![
            text("user@example.com"),
            text("https://example.com"),
            text("other@test.org"),
            text("http://test.com"),
        ];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::String);
    }

    #[test]
    fn infer_column_currency_and_percentage_widen_to_number() {
        let values = vec![text("$100"), text("50%"), text("$200"), text("75%")];
        let result = infer_column_schema(&values);
        assert!(
            result.schema.schema_type == SchemaType::Number
                || result.schema.schema_type == SchemaType::Currency
                || result.schema.schema_type == SchemaType::Percentage,
            "Currency + Percentage should widen to Number, got {:?}",
            result.schema.schema_type
        );
    }

    #[test]
    fn infer_column_phone_and_email_widen_to_string() {
        let values = vec![
            text("user@example.com"),
            text("+1-555-555-5555"),
            text("other@test.org"),
            text("+14155551234"),
        ];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::String);
    }

    // -- Constraint inference edge cases --

    #[test]
    fn infer_column_with_empty_strings_not_required() {
        let values = vec![text("hello"), text(""), text("world")];
        let result = infer_column_schema(&values);
        let required = result.schema.constraints.as_ref().and_then(|c| c.required);
        assert_ne!(required, Some(true));
    }

    #[test]
    fn infer_column_no_max_when_values_exceed_100() {
        let values = vec![num(50.0), num(150.0), num(200.0)];
        let result = infer_column_schema(&values);
        let max = result.schema.constraints.as_ref().and_then(|c| c.max);
        assert_eq!(max, None);
    }

    #[test]
    fn infer_column_no_min_for_negative_numbers() {
        let values = vec![num(-10.0), num(5.0), num(20.0)];
        let result = infer_column_schema(&values);
        let min = result.schema.constraints.as_ref().and_then(|c| c.min);
        assert_eq!(min, None);
    }

    #[test]
    fn infer_column_no_max_length_for_long_strings() {
        let long_string = "a".repeat(300);
        let values = vec![text(&long_string), text("short")];
        let result = infer_column_schema(&values);
        let max_length = result
            .schema
            .constraints
            .as_ref()
            .and_then(|c| c.max_length);
        assert_eq!(max_length, None);
    }

    #[test]
    fn infer_column_enum_with_10_unique_values() {
        let mut values = Vec::new();
        for i in 0..10 {
            let val = format!("option_{}", i);
            values.push(text(&val));
            values.push(text(&val));
            values.push(text(&val));
        }
        let result = infer_column_schema(&values);
        let has_enum = result
            .schema
            .constraints
            .as_ref()
            .and_then(|c| c.enum_values.as_ref())
            .is_some();
        assert!(
            has_enum,
            "10 unique values with 30 total should trigger enum detection"
        );
    }

    #[test]
    fn infer_column_no_enum_with_11_unique_values() {
        let mut values = Vec::new();
        for i in 0..11 {
            let val = format!("option_{}", i);
            values.push(text(&val));
            values.push(text(&val));
            values.push(text(&val));
        }
        let result = infer_column_schema(&values);
        let has_enum = result
            .schema
            .constraints
            .as_ref()
            .and_then(|c| c.enum_values.as_ref())
            .is_some();
        assert!(
            !has_enum,
            "11 unique values should NOT trigger enum detection"
        );
    }

    #[test]
    fn infer_column_no_enum_when_mostly_unique() {
        let values = vec![
            text("a"),
            text("b"),
            text("c"),
            text("d"),
            text("e"),
            text("a"),
            text("b"),
            text("c"),
        ];
        let result = infer_column_schema(&values);
        let has_enum = result
            .schema
            .constraints
            .as_ref()
            .and_then(|c| c.enum_values.as_ref())
            .is_some();
        assert!(
            !has_enum,
            "5 unique out of 8 should not trigger enum (5 >= 8/2)"
        );
    }

    #[test]
    fn infer_column_integers_get_max_constraint() {
        let values = vec![num(10.0), num(20.0), num(50.0), num(80.0)];
        let result = infer_column_schema(&values);
        let max = result.schema.constraints.as_ref().and_then(|c| c.max);
        assert!(
            max.is_some(),
            "Integer column with max <= 100 should infer max"
        );
    }

    #[test]
    fn infer_column_dates() {
        let values = vec![text("2024-01-01"), text("2024-06-15"), text("2024-12-31")];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::Date);
    }

    #[test]
    fn infer_column_times() {
        let values = vec![text("09:00"), text("14:30"), text("23:59")];
        let result = infer_column_schema(&values);
        assert_eq!(result.schema.schema_type, SchemaType::Time);
    }

    // -- Type inference edge cases --

    #[test]
    fn infer_text_currency() {
        assert_eq!(infer_type(&text("$100")), SchemaType::Currency);
        assert_eq!(infer_type(&text("\u{20ac}50.00")), SchemaType::Currency);
    }

    #[test]
    fn infer_text_percentage() {
        assert_eq!(infer_type(&text("50%")), SchemaType::Percentage);
    }

    #[test]
    fn infer_text_phone() {
        assert_eq!(infer_type(&text("+1-555-555-5555")), SchemaType::Phone);
    }

    #[test]
    fn infer_text_time() {
        assert_eq!(infer_type(&text("14:30")), SchemaType::Time);
    }

    #[test]
    fn infer_text_date() {
        assert_eq!(infer_type(&text("2024-12-11")), SchemaType::Date);
    }

    #[test]
    fn compatible_percentage_number() {
        assert!(is_compatible_type(
            SchemaType::Percentage,
            SchemaType::Number
        ));
    }

    #[test]
    fn compatible_company_string() {
        assert!(is_compatible_type(SchemaType::Company, SchemaType::String));
    }
}
