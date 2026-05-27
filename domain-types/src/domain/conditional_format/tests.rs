use super::*;
use ooxml_types::cond_format::{CfOperator, CfTimePeriod, CfvoType, IconSetType};
use ooxml_types::styles::{BorderStyle, UnderlineStyle};
use serde::{Deserialize, Serialize};

fn roundtrip_json<T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug>(val: &T) {
    let json = serde_json::to_string(val).unwrap();
    let back: T = serde_json::from_str(&json).unwrap();
    assert_eq!(val, &back);
}

#[test]
fn cell_value_roundtrip() {
    let rule = CFRule::CellValue {
        id: "r1".into(),
        priority: 1,
        stop_if_true: Some(true),
        operator: CfOperator::GreaterThan,
        value1: serde_json::json!(100),
        value2: None,
        style: CFStyle {
            background_color: Some("#FF0000".into()),
            ..Default::default()
        },
        text: None,
    };
    roundtrip_json(&rule);
}

/// Locks the wire-compat invariant: the on-wire form of the
/// `operator` field is the OOXML token string `"greaterThan"`, not a
/// Rust variant name or PascalCase rendering.
#[test]
fn cell_value_operator_wire_shape() {
    let rule = CFRule::CellValue {
        id: "r1".into(),
        priority: 1,
        stop_if_true: None,
        operator: CfOperator::GreaterThan,
        value1: serde_json::json!(100),
        value2: None,
        style: CFStyle::default(),
        text: None,
    };
    let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
    assert_eq!(v["operator"], "greaterThan");
}

#[test]
fn formula_roundtrip() {
    let rule = CFRule::Formula {
        id: "r2".into(),
        priority: 2,
        stop_if_true: None,
        formula: "=A1>B1".into(),
        style: CFStyle::default(),
        text: None,
    };
    roundtrip_json(&rule);
}

#[test]
fn color_scale_roundtrip() {
    let rule = CFRule::ColorScale {
        id: "r3".into(),
        priority: 3,
        stop_if_true: None,
        color_scale: CFColorScale {
            min_point: CFColorPoint {
                value: CFValueRef::Min,
                color: "#FF0000".into(),
                ..Default::default()
            },
            mid_point: Some(CFColorPoint {
                value: CFValueRef::Percentile { value: 50.0 },
                color: "#FFFF00".into(),
                ..Default::default()
            }),
            max_point: CFColorPoint {
                value: CFValueRef::Max,
                color: "#00FF00".into(),
                ..Default::default()
            },
        },
    };
    roundtrip_json(&rule);
}

#[test]
fn data_bar_roundtrip() {
    let rule = CFRule::DataBar {
        id: "r4".into(),
        priority: 4,
        stop_if_true: None,
        data_bar: CFDataBar {
            min_point: CFColorPoint {
                value: CFValueRef::Min,
                color: "".into(),
                ..Default::default()
            },
            max_point: CFColorPoint {
                value: CFValueRef::Max,
                color: "".into(),
                ..Default::default()
            },
            min_length: None,
            max_length: None,
            positive_color: "#638EC6".into(),
            negative_color: Some("#FF0000".into()),
            border_color: None,
            show_border: None,
            gradient: Some(true),
            direction: None,
            axis_position: None,
            axis_color: None,
            show_value: Some(true),
            ext_id: Some("{abc-123}".into()),
            match_positive_fill_color: None,
            match_positive_border_color: None,
        },
    };
    roundtrip_json(&rule);
}

#[test]
fn icon_set_roundtrip() {
    let rule = CFRule::IconSet {
        id: "r5".into(),
        priority: 5,
        stop_if_true: None,
        icon_set: CFIconSet {
            icon_set_name: IconSetType::ThreeArrows,
            reverse_order: Some(false),
            show_icon_only: None,
            thresholds: vec![
                CFIconThreshold {
                    value_type: CfvoType::Percent,
                    value: Some("33".into()),
                    gte: true,
                },
                CFIconThreshold {
                    value_type: CfvoType::Percent,
                    value: Some("67".into()),
                    gte: true,
                },
            ],
            custom_icons: vec![],
        },
    };
    roundtrip_json(&rule);
}

#[test]
fn top10_roundtrip() {
    let rule = CFRule::Top10 {
        id: "r6".into(),
        priority: 6,
        stop_if_true: None,
        rank: 10,
        percent: Some(true),
        bottom: Some(false),
        style: CFStyle::default(),
    };
    roundtrip_json(&rule);
}

#[test]
fn above_average_roundtrip() {
    let rule = CFRule::AboveAverage {
        id: "r7".into(),
        priority: 7,
        stop_if_true: None,
        above_average: true,
        equal_average: Some(false),
        std_dev: Some(1),
        style: CFStyle::default(),
        formula: Some("=AVERAGE(A1:A10)".into()),
    };
    roundtrip_json(&rule);
}

#[test]
fn duplicate_values_roundtrip() {
    let rule = CFRule::DuplicateValues {
        id: "r8".into(),
        priority: 8,
        stop_if_true: None,
        unique: Some(true),
        style: CFStyle::default(),
    };
    roundtrip_json(&rule);
}

#[test]
fn contains_text_roundtrip() {
    let rule = CFRule::ContainsText {
        id: "r9".into(),
        priority: 9,
        stop_if_true: None,
        operator: CfOperator::ContainsText,
        text: "hello".into(),
        style: CFStyle::default(),
        formula: Some("=NOT(ISERROR(SEARCH(\"hello\",A1)))".into()),
    };
    roundtrip_json(&rule);
}

/// Locks the wire-compat invariant for ContainsText: the `operator`
/// field serializes to the OOXML token string (e.g. `"containsText"`),
/// not a Rust variant name.
#[test]
fn contains_text_operator_wire_shape() {
    let rule = CFRule::ContainsText {
        id: "r9".into(),
        priority: 9,
        stop_if_true: None,
        operator: CfOperator::ContainsText,
        text: "hello".into(),
        style: CFStyle::default(),
        formula: None,
    };
    let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
    assert_eq!(v["operator"], "containsText");
}

#[test]
fn contains_blanks_roundtrip() {
    let rule = CFRule::ContainsBlanks {
        id: "r10".into(),
        priority: 10,
        stop_if_true: None,
        blanks: true,
        style: CFStyle::default(),
        formula: Some("=LEN(TRIM(A1))=0".into()),
    };
    roundtrip_json(&rule);
    // Non-blank variant
    let non_blank = CFRule::ContainsBlanks {
        id: "r10b".into(),
        priority: 11,
        stop_if_true: None,
        blanks: false,
        style: CFStyle::default(),
        formula: Some("=LEN(TRIM(A1))>0".into()),
    };
    roundtrip_json(&non_blank);
}

#[test]
fn contains_errors_roundtrip() {
    let rule = CFRule::ContainsErrors {
        id: "r11".into(),
        priority: 12,
        stop_if_true: None,
        errors: true,
        style: CFStyle::default(),
        formula: Some("=ISERROR(A1)".into()),
    };
    roundtrip_json(&rule);
    // Non-error variant
    let non_error = CFRule::ContainsErrors {
        id: "r11b".into(),
        priority: 13,
        stop_if_true: None,
        errors: false,
        style: CFStyle::default(),
        formula: Some("=NOT(ISERROR(A1))".into()),
    };
    roundtrip_json(&non_error);
}

#[test]
fn time_period_roundtrip() {
    let rule = CFRule::TimePeriod {
        id: "r12".into(),
        priority: 14,
        stop_if_true: None,
        time_period: CfTimePeriod::Today,
        style: CFStyle::default(),
        formula: Some("=FLOOR(A1,1)=TODAY()".into()),
    };
    roundtrip_json(&rule);
}

/// Locks the wire-compat invariant for TimePeriod: the
/// `time_period` field serializes to the OOXML token string, and reads
/// back as the same enum variant.
#[test]
fn time_period_wire_shape() {
    let rule = CFRule::TimePeriod {
        id: "r12".into(),
        priority: 14,
        stop_if_true: None,
        time_period: CfTimePeriod::Last7Days,
        style: CFStyle::default(),
        formula: None,
    };
    let v: serde_json::Value = serde_json::to_value(&rule).unwrap();
    assert_eq!(v["timePeriod"], "last7Days");
    let back: CFRule = serde_json::from_value(v).unwrap();
    match back {
        CFRule::TimePeriod { time_period, .. } => {
            assert_eq!(time_period, CfTimePeriod::Last7Days)
        }
        _ => panic!("unexpected variant"),
    }
}

#[test]
fn cf_style_roundtrip() {
    let style = CFStyle {
        background_color: Some("#FFFF00".into()),
        font_color: Some("#000000".into()),
        bold: Some(true),
        italic: Some(false),
        underline_type: Some(UnderlineStyle::Single),
        underline_legacy: None,
        strikethrough: None,
        number_format: Some("#,##0.00".into()),
        border_color: Some("#0000FF".into()),
        border_style: Some(BorderStyle::Thin),
        border_top_color: None,
        border_top_style: None,
        border_bottom_color: None,
        border_bottom_style: None,
        border_left_color: None,
        border_left_style: None,
        border_right_color: None,
        border_right_style: None,
        dxf_id: None,
    };
    roundtrip_json(&style);
}

#[test]
fn cf_style_legacy_underline_bool_deserializes() {
    // Old Yrs documents store `"underline": true` — must still parse.
    let json = r#"{"underline":true,"bold":true}"#;
    let style: CFStyle = serde_json::from_str(json).unwrap();
    assert_eq!(style.underline_legacy, Some(true));
    assert_eq!(style.bold, Some(true));
}

#[test]
fn cf_style_typed_enum_wire_is_ooxml_token() {
    // CFStyle.underline_type / .border_style are typed ooxml enums; the
    // serde wire format must still be OOXML token strings byte-for-byte so
    // legacy Yrs/JSON docs continue to deserialize correctly.
    let style = CFStyle {
        underline_type: Some(UnderlineStyle::DoubleAccounting),
        border_style: Some(BorderStyle::MediumDashDotDot),
        ..Default::default()
    };
    let json = serde_json::to_value(&style).unwrap();
    assert_eq!(json["underlineType"], "doubleAccounting");
    assert_eq!(json["borderStyle"], "mediumDashDotDot");

    let rt: CFStyle = serde_json::from_value(json).unwrap();
    assert_eq!(rt.underline_type, Some(UnderlineStyle::DoubleAccounting));
    assert_eq!(rt.border_style, Some(BorderStyle::MediumDashDotDot));
}

#[test]
fn cf_style_legacy_string_tokens_deserialize_into_typed_enum() {
    // A legacy document with string values for underlineType / borderStyle
    // must still deserialize into the typed enum.
    let json = r#"{"underlineType":"single","borderStyle":"thin"}"#;
    let style: CFStyle = serde_json::from_str(json).unwrap();
    assert_eq!(style.underline_type, Some(UnderlineStyle::Single));
    assert_eq!(style.border_style, Some(BorderStyle::Thin));
}

#[test]
fn conditional_format_roundtrip() {
    let cf = ConditionalFormat {
        id: "cf1".into(),
        sheet_id: "s1".into(),
        pivot: Some(true),
        ranges: vec![CFCellRange::new(0, 0, 9, 3)],
        range_identities: Some(vec![CellIdRange {
            top_left_cell_id: "c1".into(),
            bottom_right_cell_id: "c2".into(),
        }]),
        rules: vec![CFRule::CellValue {
            id: "r1".into(),
            priority: 1,
            stop_if_true: None,
            operator: CfOperator::GreaterThan,
            value1: serde_json::json!(50),
            value2: None,
            style: CFStyle::default(),
            text: None,
        }],
    };
    roundtrip_json(&cf);
}

#[test]
fn tag_discriminator_is_type() {
    let rule = CFRule::CellValue {
        id: "r1".into(),
        priority: 1,
        stop_if_true: None,
        operator: CfOperator::GreaterThan,
        value1: serde_json::json!(100),
        value2: None,
        style: CFStyle::default(),
        text: None,
    };
    let json: serde_json::Value = serde_json::to_value(&rule).unwrap();
    assert_eq!(json["type"], "cellValue");
}

#[test]
fn id_and_priority_accessors() {
    let rule = CFRule::Formula {
        id: "test-id".into(),
        priority: 42,
        stop_if_true: None,
        formula: "=TRUE".into(),
        style: CFStyle::default(),
        text: None,
    };
    assert_eq!(rule.id(), "test-id");
    assert_eq!(rule.priority(), 42);
}

// =========================================================================
// from_ooxml_token — regression tests for typed formula boundary
//
// Each OOXML token the deleted `parse_cf_operator` / `parse_text_operator` /
// `parse_date_period` shadow parsers accepted must continue to parse via
// `from_ooxml_token`. Every malformed token must return `None` without
// panicking.
// =========================================================================

#[test]
fn cf_operator_from_ooxml_token_accepts_all_known_tokens() {
    let cases = [
        ("greaterThan", CFOperator::GreaterThan),
        ("lessThan", CFOperator::LessThan),
        ("greaterThanOrEqual", CFOperator::GreaterThanOrEqual),
        ("lessThanOrEqual", CFOperator::LessThanOrEqual),
        ("equal", CFOperator::Equal),
        ("notEqual", CFOperator::NotEqual),
        ("between", CFOperator::Between),
        ("notBetween", CFOperator::NotBetween),
    ];
    for (token, expected) in cases {
        assert_eq!(
            CFOperator::from_ooxml_token(token),
            Some(expected),
            "token {token} should parse"
        );
    }
}

#[test]
fn cf_operator_from_ooxml_token_rejects_malformed() {
    assert_eq!(CFOperator::from_ooxml_token(""), None);
    assert_eq!(CFOperator::from_ooxml_token("GreaterThan"), None); // wrong case
    assert_eq!(CFOperator::from_ooxml_token("nope"), None);
    assert_eq!(CFOperator::from_ooxml_token("greaterThan "), None); // trailing space
    assert_eq!(CFOperator::from_ooxml_token("ΕΛΛΗΝΙΚΑ"), None); // non-ASCII
}

#[test]
fn cf_text_operator_from_ooxml_token_accepts_all_known_tokens() {
    let cases = [
        ("contains", CFTextOperator::Contains),
        ("notContains", CFTextOperator::NotContains),
        ("beginsWith", CFTextOperator::BeginsWith),
        ("endsWith", CFTextOperator::EndsWith),
    ];
    for (token, expected) in cases {
        assert_eq!(
            CFTextOperator::from_ooxml_token(token),
            Some(expected),
            "token {token} should parse"
        );
    }
}

#[test]
fn cf_text_operator_from_ooxml_token_rejects_malformed() {
    assert_eq!(CFTextOperator::from_ooxml_token(""), None);
    assert_eq!(CFTextOperator::from_ooxml_token("Contains"), None);
    assert_eq!(CFTextOperator::from_ooxml_token("nope"), None);
}

#[test]
fn date_period_from_ooxml_token_accepts_all_known_tokens() {
    let cases = [
        ("yesterday", DatePeriod::Yesterday),
        ("today", DatePeriod::Today),
        ("tomorrow", DatePeriod::Tomorrow),
        ("last7Days", DatePeriod::Last7Days),
        ("lastWeek", DatePeriod::LastWeek),
        ("thisWeek", DatePeriod::ThisWeek),
        ("nextWeek", DatePeriod::NextWeek),
        ("lastMonth", DatePeriod::LastMonth),
        ("thisMonth", DatePeriod::ThisMonth),
        ("nextMonth", DatePeriod::NextMonth),
        ("lastQuarter", DatePeriod::LastQuarter),
        ("thisQuarter", DatePeriod::ThisQuarter),
        ("nextQuarter", DatePeriod::NextQuarter),
        ("lastYear", DatePeriod::LastYear),
        ("thisYear", DatePeriod::ThisYear),
        ("nextYear", DatePeriod::NextYear),
    ];
    for (token, expected) in cases {
        assert_eq!(
            DatePeriod::from_ooxml_token(token),
            Some(expected),
            "token {token} should parse"
        );
    }
}

#[test]
fn date_period_from_ooxml_token_rejects_malformed() {
    assert_eq!(DatePeriod::from_ooxml_token(""), None);
    assert_eq!(DatePeriod::from_ooxml_token("Today"), None);
    assert_eq!(DatePeriod::from_ooxml_token("last7days"), None); // wrong case
    assert_eq!(DatePeriod::from_ooxml_token("nope"), None);
}

// =========================================================================
// Wire-input normalization — replaces the deleted TS `coerceRuleShape`.
//
// Each test exercises one of the rule-shape variants the deleted TS
// adapter handled. The normalization function is the single Rust-side
// entry point that translates the public/canonical TS schema into the
// canonical `CFRule` enum.
// =========================================================================

fn normalize_and_parse(json: serde_json::Value) -> CFRule {
    let mut v = json;
    normalize_cf_rule_input(&mut v);
    serde_json::from_value::<CFRule>(v).expect("normalized JSON must deserialize to CFRule")
}

#[test]
fn normalize_contains_blanks_default_blanks_true() {
    // Canonical schema: `containsBlanks` requires `blanks: bool`. Public
    // callers historically omitted it, expecting the default to be `true`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "containsBlanks",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::ContainsBlanks { blanks, .. } => assert!(blanks),
        _ => panic!("expected ContainsBlanks variant"),
    }
}

#[test]
fn normalize_not_contains_blanks_to_contains_blanks_false() {
    // `notContainsBlanks` is a public-API type promotion: the canonical
    // schema only models `containsBlanks` with `blanks: bool`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "notContainsBlanks",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::ContainsBlanks { blanks, .. } => assert!(!blanks),
        _ => panic!("expected ContainsBlanks variant"),
    }
}

#[test]
fn normalize_contains_errors_default_errors_true() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "containsErrors",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::ContainsErrors { errors, .. } => assert!(errors),
        _ => panic!("expected ContainsErrors variant"),
    }
}

#[test]
fn normalize_not_contains_errors_to_contains_errors_false() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "notContainsErrors",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::ContainsErrors { errors, .. } => assert!(!errors),
        _ => panic!("expected ContainsErrors variant"),
    }
}

#[test]
fn normalize_top10_value1_to_rank() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "top10",
        "id": "r1",
        "priority": 1,
        "value1": 5,
        "operator": "topPercent",
        "style": {},
    }));
    match rule {
        CFRule::Top10 {
            rank,
            percent,
            bottom,
            ..
        } => {
            assert_eq!(rank, 5);
            assert_eq!(percent, Some(true));
            assert_eq!(bottom, None);
        }
        _ => panic!("expected Top10 variant"),
    }
}

#[test]
fn normalize_top10_bottom_operator_sets_bottom_flag() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "top10",
        "id": "r1",
        "priority": 1,
        "value1": 3,
        "operator": "bottom",
        "style": {},
    }));
    match rule {
        CFRule::Top10 { rank, bottom, .. } => {
            assert_eq!(rank, 3);
            assert_eq!(bottom, Some(true));
        }
        _ => panic!("expected Top10 variant"),
    }
}

#[test]
fn normalize_cell_value_with_text_op_promotes_to_contains_text() {
    // Public API ergonomics: callers historically sent
    // `{ type: 'cellValue', operator: 'containsText', value1: 'foo' }`.
    // The canonical Rust shape is `{ type: 'containsText', operator:
    // 'containsText', text: 'foo' }`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "containsText",
        "value1": "hello",
        "style": {},
    }));
    match rule {
        CFRule::ContainsText { operator, text, .. } => {
            assert_eq!(operator, CfOperator::ContainsText);
            assert_eq!(text, "hello");
        }
        _ => panic!("expected ContainsText variant"),
    }
}

#[test]
fn normalize_cell_value_not_contains_promotes_to_contains_text_not_contains() {
    // `notContainsText` is a deprecated public alias; the canonical
    // OOXML token on `containsText.operator` is `notContains`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "notContainsText",
        "value1": "bad",
        "style": {},
    }));
    match rule {
        CFRule::ContainsText { operator, text, .. } => {
            assert_eq!(operator, CfOperator::NotContains);
            assert_eq!(text, "bad");
        }
        _ => panic!("expected ContainsText variant"),
    }
}

#[test]
fn normalize_cell_value_with_comparison_op_stays_cell_value() {
    // Non-text operators must keep `cellValue` shape untouched.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "greaterThan",
        "value1": 100,
        "style": {},
    }));
    match rule {
        CFRule::CellValue {
            operator, value1, ..
        } => {
            assert_eq!(operator, CfOperator::GreaterThan);
            assert_eq!(value1, serde_json::json!(100));
        }
        _ => panic!("expected CellValue variant"),
    }
}

#[test]
fn expression_alias_deserializes_to_formula_variant() {
    // Field-rename aliases are handled by `#[serde(alias = "expression")]`
    // on the `Formula` variant, not by `normalize_cf_rule_input`. This
    // test locks the behavior so future refactors can't drop the alias.
    let json = serde_json::json!({
        "type": "expression",
        "id": "r1",
        "priority": 1,
        "formula": "=A1>10",
        "style": {},
    });
    let rule: CFRule = serde_json::from_value(json).unwrap();
    match rule {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=A1>10"),
        _ => panic!("expected Formula variant"),
    }
}

#[test]
fn normalize_contains_text_value1_fallback_to_text() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "containsText",
        "id": "r1",
        "priority": 1,
        "operator": "containsText",
        "value1": "needle",
        "style": {},
    }));
    match rule {
        CFRule::ContainsText { text, .. } => assert_eq!(text, "needle"),
        _ => panic!("expected ContainsText variant"),
    }
}

#[test]
fn normalize_idempotent_on_canonical_input() {
    // A fully-canonical rule must round-trip unchanged through normalization.
    let canonical = serde_json::json!({
        "type": "containsBlanks",
        "id": "r1",
        "priority": 1,
        "blanks": true,
        "style": {},
    });
    let mut v = canonical.clone();
    normalize_cf_rule_input(&mut v);
    assert_eq!(v, canonical);
}

#[test]
fn normalize_conditional_format_walks_all_rules() {
    let mut cf = serde_json::json!({
        "id": "cf-1",
        "sheetId": "s1",
        "ranges": [],
        "rules": [
            { "type": "notContainsBlanks", "id": "r1", "priority": 1, "style": {} },
            { "type": "expression", "id": "r2", "priority": 2, "formula": "=TRUE", "style": {} },
        ],
    });
    normalize_conditional_format_input(&mut cf);
    let parsed: ConditionalFormat = serde_json::from_value(cf).unwrap();
    assert_eq!(parsed.rules.len(), 2);
    match &parsed.rules[0] {
        CFRule::ContainsBlanks { blanks, .. } => assert!(!blanks),
        _ => panic!("expected ContainsBlanks variant"),
    }
    match &parsed.rules[1] {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=TRUE"),
        _ => panic!("expected Formula variant"),
    }
}

// =========================================================================
// Public CF rule type completeness
//
// Every variant the public TS API can produce or that XLSX hydration
// emits must round-trip through `normalize_cf_rule_input` to a
// canonical [`CFRule`]. This test set is the structural enumeration.
// =========================================================================

#[test]
fn normalize_cell_is_alias_to_cell_value() {
    // OOXML uses `<cfRule type="cellIs">`; the public TS API exposes
    // `cellIs` for parity. The canonical Rust enum tag is `cellValue`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellIs",
        "id": "r1",
        "priority": 1,
        "operator": "greaterThan",
        "value1": 10,
        "style": {},
    }));
    match rule {
        CFRule::CellValue {
            operator, value1, ..
        } => {
            assert_eq!(operator, CfOperator::GreaterThan);
            assert_eq!(value1, serde_json::json!(10));
        }
        _ => panic!("expected CellValue variant"),
    }
}

#[test]
fn normalize_cell_is_with_text_op_promotes_to_contains_text() {
    // `cellIs` with a text operator should rewrite to `containsText`,
    // matching the `cellValue` arm's behavior.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellIs",
        "id": "r1",
        "priority": 1,
        "operator": "containsText",
        "value1": "hello",
        "style": {},
    }));
    match rule {
        CFRule::ContainsText { operator, text, .. } => {
            assert_eq!(operator, CfOperator::ContainsText);
            assert_eq!(text, "hello");
        }
        _ => panic!("expected ContainsText variant"),
    }
}

#[test]
fn normalize_cell_value_value_shorthand_to_value1() {
    // Public API ergonomics: `value` is a single-shorthand for
    // `value1` on equality / comparison rules.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "equal",
        "value": 42,
        "style": {},
    }));
    match rule {
        CFRule::CellValue {
            operator, value1, ..
        } => {
            assert_eq!(operator, CfOperator::Equal);
            assert_eq!(value1, serde_json::json!(42));
        }
        _ => panic!("expected CellValue variant"),
    }
}

#[test]
fn normalize_cell_value_formula_field_to_value1() {
    // OOXML-style: a `cellIs`/`cellValue` rule sometimes ships its
    // comparison value inside `formula` (an OOXML formula token).
    // The canonical schema accepts any JSON in `value1`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "cellValue",
        "id": "r1",
        "priority": 1,
        "operator": "greaterThan",
        "formula": "=A1*2",
        "style": {},
    }));
    match rule {
        CFRule::CellValue {
            operator, value1, ..
        } => {
            assert_eq!(operator, CfOperator::GreaterThan);
            assert_eq!(value1, serde_json::json!("=A1*2"));
        }
        _ => panic!("expected CellValue variant"),
    }
}

#[test]
fn normalize_formula_value1_shorthand() {
    // `formula` with `value1` shorthand (matches the `cellValue`
    // shape used by `cf-custom-formula` app-eval scenario).
    let rule = normalize_and_parse(serde_json::json!({
        "type": "formula",
        "id": "r1",
        "priority": 1,
        "operator": "expression",
        "value1": "=MOD(ROW(),2)=0",
        "style": {},
    }));
    match rule {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=MOD(ROW(),2)=0"),
        _ => panic!("expected Formula variant"),
    }
}

#[test]
fn normalize_expression_value1_shorthand_promotes_to_formula() {
    // `expression` is a deprecated public alias for the `formula`
    // type tag; combined with the `value1` shorthand it must still
    // produce a valid Formula variant. This is the exact shape
    // shipped by the `cf-custom-formula` app-eval scenario.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "expression",
        "id": "r1",
        "priority": 1,
        "operator": "expression",
        "value1": "=MOD(ROW(),2)=0",
        "style": { "backgroundColor": "#E6F0FF" },
    }));
    match rule {
        CFRule::Formula { formula, .. } => assert_eq!(formula, "=MOD(ROW(),2)=0"),
        _ => panic!("expected Formula variant"),
    }
}

#[test]
fn normalize_above_average_default_true() {
    // `aboveAverage` without an explicit flag defaults to `true`
    // (Excel's "Above Average" UI command).
    let rule = normalize_and_parse(serde_json::json!({
        "type": "aboveAverage",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::AboveAverage { above_average, .. } => assert!(above_average),
        _ => panic!("expected AboveAverage variant"),
    }
}

#[test]
fn normalize_above_average_camelcase_field() {
    // Rust uses `above_average`; normalized JSON uses the camelCase
    // TS/API wire field.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "aboveAverage",
        "id": "r1",
        "priority": 1,
        "aboveAverage": false,
        "style": {},
    }));
    match rule {
        CFRule::AboveAverage { above_average, .. } => assert!(!above_average),
        _ => panic!("expected AboveAverage variant"),
    }
}

#[test]
fn normalize_below_average_to_above_average_false() {
    // `belowAverage` is a public alias for the negation form of
    // `aboveAverage`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "belowAverage",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::AboveAverage { above_average, .. } => assert!(!above_average),
        _ => panic!("expected AboveAverage variant"),
    }
}

#[test]
fn normalize_unique_values_to_duplicate_values_unique_true() {
    // OOXML's `uniqueValues` is the negation form of
    // `duplicateValues`; the canonical enum collapses both into
    // `DuplicateValues { unique: bool }`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "uniqueValues",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::DuplicateValues { unique, .. } => assert_eq!(unique, Some(true)),
        _ => panic!("expected DuplicateValues variant"),
    }
}

#[test]
fn normalize_duplicate_values_canonical() {
    let rule = normalize_and_parse(serde_json::json!({
        "type": "duplicateValues",
        "id": "r1",
        "priority": 1,
        "style": {},
    }));
    match rule {
        CFRule::DuplicateValues { unique, .. } => assert_eq!(unique, None),
        _ => panic!("expected DuplicateValues variant"),
    }
}

#[test]
fn normalize_time_period_canonical() {
    // Rust uses `time_period`; normalized JSON uses the camelCase
    // TS/API wire field.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "timePeriod",
        "id": "r1",
        "priority": 1,
        "timePeriod": "today",
        "style": {},
    }));
    match rule {
        CFRule::TimePeriod { time_period, .. } => {
            assert_eq!(time_period, CfTimePeriod::Today);
        }
        _ => panic!("expected TimePeriod variant"),
    }
}

#[test]
fn normalize_color_scale_canonical_passthrough() {
    // colorScale carries its payload nested; the normalizer must
    // not alter the shape. The canonical CFColorPoint uses
    // `value: { kind: ... }` (a typed `CFValueRef`), not
    // `valueType`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "colorScale",
        "id": "r1",
        "priority": 1,
        "colorScale": {
            "minPoint": { "value": { "kind": "min" }, "color": "#FF0000" },
            "maxPoint": { "value": { "kind": "max" }, "color": "#00FF00" },
        },
    }));
    assert!(matches!(rule, CFRule::ColorScale { .. }));
}

#[test]
fn normalize_data_bar_canonical_passthrough() {
    // CFDataBar uses `#[serde(rename_all = "camelCase")]`. Each
    // CFColorPoint requires `value` (CFValueRef) and `color`.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "dataBar",
        "id": "r1",
        "priority": 1,
        "dataBar": {
            "minPoint": { "value": { "kind": "min" }, "color": "" },
            "maxPoint": { "value": { "kind": "max" }, "color": "" },
            "positiveColor": "#638EC6",
        },
    }));
    assert!(matches!(rule, CFRule::DataBar { .. }));
}

#[test]
fn normalize_icon_set_canonical_passthrough() {
    // CFIconSet uses `#[serde(rename_all = "camelCase")]`, so
    // `icon_set_name` becomes `iconSetName` in JSON.
    let rule = normalize_and_parse(serde_json::json!({
        "type": "iconSet",
        "id": "r1",
        "priority": 1,
        "iconSet": {
            "iconSetName": "3TrafficLights1",
            "thresholds": [],
        },
    }));
    assert!(matches!(rule, CFRule::IconSet { .. }));
}

/// Drives [`normalize_cf_rule_input`] across every public rule type
/// and verifies the result deserializes to a canonical [`CFRule`].
/// The asserted set is [`CANONICAL_CF_RULE_TYPES`] plus the public
/// aliases (`cellIs`, `belowAverage`, `uniqueValues`, `expression`,
/// `notContainsBlanks`, `notContainsErrors`).
///
/// If a future audit adds a new public rule type, this test must
/// fail until the normalization arm is added.
#[test]
fn normalize_full_public_cf_rule_type_set() {
    let cases: Vec<(&str, serde_json::Value)> = vec![
        (
            "cellValue",
            serde_json::json!({
                "type": "cellValue", "id": "r", "priority": 1,
                "operator": "greaterThan", "value1": 1, "style": {}
            }),
        ),
        (
            "cellIs",
            serde_json::json!({
                "type": "cellIs", "id": "r", "priority": 1,
                "operator": "lessThan", "value1": 1, "style": {}
            }),
        ),
        (
            "formula",
            serde_json::json!({
                "type": "formula", "id": "r", "priority": 1,
                "formula": "=TRUE", "style": {}
            }),
        ),
        (
            "expression",
            serde_json::json!({
                "type": "expression", "id": "r", "priority": 1,
                "value1": "=TRUE", "style": {}
            }),
        ),
        (
            "colorScale",
            serde_json::json!({
                "type": "colorScale", "id": "r", "priority": 1,
                "colorScale": {
                    "minPoint": { "value": { "kind": "min" }, "color": "#FF0000" },
                    "maxPoint": { "value": { "kind": "max" }, "color": "#00FF00" },
                },
            }),
        ),
        (
            "dataBar",
            serde_json::json!({
                "type": "dataBar", "id": "r", "priority": 1,
                "dataBar": {
                    "minPoint": { "value": { "kind": "min" }, "color": "" },
                    "maxPoint": { "value": { "kind": "max" }, "color": "" },
                    "positiveColor": "#638EC6",
                },
            }),
        ),
        (
            "iconSet",
            serde_json::json!({
                "type": "iconSet", "id": "r", "priority": 1,
                "iconSet": {
                    "iconSetName": "3TrafficLights1",
                    "thresholds": [],
                },
            }),
        ),
        (
            "top10",
            serde_json::json!({
                "type": "top10", "id": "r", "priority": 1,
                "rank": 10, "style": {}
            }),
        ),
        (
            "aboveAverage",
            serde_json::json!({
                "type": "aboveAverage", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "belowAverage",
            serde_json::json!({
                "type": "belowAverage", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "duplicateValues",
            serde_json::json!({
                "type": "duplicateValues", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "uniqueValues",
            serde_json::json!({
                "type": "uniqueValues", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "containsText",
            serde_json::json!({
                "type": "containsText", "id": "r", "priority": 1,
                "operator": "containsText", "text": "x", "style": {}
            }),
        ),
        (
            "containsBlanks",
            serde_json::json!({
                "type": "containsBlanks", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "notContainsBlanks",
            serde_json::json!({
                "type": "notContainsBlanks", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "containsErrors",
            serde_json::json!({
                "type": "containsErrors", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "notContainsErrors",
            serde_json::json!({
                "type": "notContainsErrors", "id": "r", "priority": 1,
                "style": {}
            }),
        ),
        (
            "timePeriod",
            serde_json::json!({
                "type": "timePeriod", "id": "r", "priority": 1,
                "timePeriod": "today", "style": {}
            }),
        ),
    ];

    for (label, mut json) in cases {
        normalize_cf_rule_input(&mut json);
        let parsed: CFRule = serde_json::from_value(json.clone()).unwrap_or_else(|e| {
            panic!("input '{}' must normalize: err={} json={}", label, e, json)
        });
        // Every output type tag must be in the canonical set.
        let json_after = serde_json::to_value(&parsed).unwrap();
        let tag = json_after
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(
            CANONICAL_CF_RULE_TYPES.contains(&tag),
            "input '{}' produced non-canonical tag '{}'",
            label,
            tag,
        );
    }
}

// =========================================================================
// Typed priority bumping
//
// The set_priority API is used by `services::formatting::bump_cf_priorities`
// (called from `add_cf_rule` to renumber existing formats when a new
// one is inserted at priority 1). This test confirms the typed API
// covers every variant that carries a priority field.
// =========================================================================

#[test]
fn set_priority_covers_every_variant() {
    // Build one rule per variant and confirm `set_priority` mutates
    // the field on each. The list mirrors `CANONICAL_CF_RULE_TYPES`.
    let mut rules: Vec<CFRule> = vec![
        CFRule::CellValue {
            id: "a".into(),
            priority: 5,
            stop_if_true: None,
            operator: CfOperator::GreaterThan,
            value1: serde_json::json!(0),
            value2: None,
            style: CFStyle::default(),
            text: None,
        },
        CFRule::Formula {
            id: "b".into(),
            priority: 5,
            stop_if_true: None,
            formula: "=TRUE".into(),
            style: CFStyle::default(),
            text: None,
        },
        CFRule::Top10 {
            id: "c".into(),
            priority: 5,
            stop_if_true: None,
            rank: 10,
            percent: None,
            bottom: None,
            style: CFStyle::default(),
        },
        CFRule::AboveAverage {
            id: "d".into(),
            priority: 5,
            stop_if_true: None,
            above_average: true,
            equal_average: None,
            std_dev: None,
            style: CFStyle::default(),
            formula: None,
        },
        CFRule::DuplicateValues {
            id: "e".into(),
            priority: 5,
            stop_if_true: None,
            unique: None,
            style: CFStyle::default(),
        },
        CFRule::ContainsText {
            id: "f".into(),
            priority: 5,
            stop_if_true: None,
            operator: CfOperator::ContainsText,
            text: "x".into(),
            style: CFStyle::default(),
            formula: None,
        },
        CFRule::ContainsBlanks {
            id: "g".into(),
            priority: 5,
            stop_if_true: None,
            blanks: true,
            style: CFStyle::default(),
            formula: None,
        },
        CFRule::ContainsErrors {
            id: "h".into(),
            priority: 5,
            stop_if_true: None,
            errors: true,
            style: CFStyle::default(),
            formula: None,
        },
        CFRule::TimePeriod {
            id: "i".into(),
            priority: 5,
            stop_if_true: None,
            time_period: CfTimePeriod::Today,
            style: CFStyle::default(),
            formula: None,
        },
    ];
    for r in rules.iter_mut() {
        assert_eq!(r.priority(), 5);
        r.set_priority(99);
        assert_eq!(r.priority(), 99);
    }
}
