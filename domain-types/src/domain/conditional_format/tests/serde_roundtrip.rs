use super::*;

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
            points: vec![],
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
            negative_border_color: None,
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
            percent: None,
            thresholds: vec![
                CFIconThreshold {
                    value_type: CfvoType::Percent,
                    value: Some("33".into()),
                    gte: true,
                    ext_lst_xml: None,
                },
                CFIconThreshold {
                    value_type: CfvoType::Percent,
                    value: Some("67".into()),
                    gte: true,
                    ext_lst_xml: None,
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
