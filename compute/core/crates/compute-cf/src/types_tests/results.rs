use super::*;

// -----------------------------------------------------------------------
// Output types
// -----------------------------------------------------------------------

#[test]
fn test_cell_cf_result_has_any() {
    let empty = CellCFResult::default();
    assert!(!empty.has_any());

    let with_style = CellCFResult {
        row: 0,
        col: 0,
        style: Some(CfRenderStyle::default()),
        ..Default::default()
    };
    assert!(with_style.has_any());

    let with_data_bar = CellCFResult {
        row: 1,
        col: 2,
        data_bar: Some(DataBarResult {
            fill_percent: 50.0,
            color: Color::rgba(0, 128, 255, 255),
            gradient: false,
            axis_position: 0.0,
            is_negative: false,
            negative_color: None,
            show_value: true,
            show_axis: false,
            border_color: None,
            negative_border_color: None,
            show_border: false,
            direction: CFDataBarDirection::LeftToRight,
            axis_color: None,
        }),
        ..Default::default()
    };
    assert!(with_data_bar.has_any());

    let with_color_scale = CellCFResult {
        color_scale: Some(ColorScaleResult {
            color: Color::rgb(255, 0, 0),
        }),
        ..Default::default()
    };
    assert!(with_color_scale.has_any());

    let with_icon = CellCFResult {
        icon: Some(IconResult {
            set_name: CFIconSetName::ThreeArrows,
            icon_index: 0,
            show_value: true,
        }),
        ..Default::default()
    };
    assert!(with_icon.has_any());
}

// -----------------------------------------------------------------------
// Output serialization
// -----------------------------------------------------------------------

#[test]
fn test_cell_cf_result_serialization() {
    let result = CellCFResult {
        row: 5,
        col: 3,
        style: Some(CfRenderStyle {
            background_color: Some(Color::from_hex("#FF0000").unwrap()),
            bold: Some(true),
            ..Default::default()
        }),
        data_bar: None,
        color_scale: None,
        icon: None,
    };

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"row\":5"));
    assert!(json.contains("\"col\":3"));
    assert!(json.contains("\"backgroundColor\":\"#ff0000\""));
    assert!(json.contains("\"bold\":true"));
    // None fields should be skipped
    assert!(!json.contains("dataBar"));
    assert!(!json.contains("colorScale"));
    assert!(!json.contains("icon"));
}

// -----------------------------------------------------------------------
// CfRenderStyle serialization with camelCase
// -----------------------------------------------------------------------

#[test]
fn test_cf_style_camel_case_serde() {
    let style = CfRenderStyle {
        background_color: Some(Color::from_hex("#AABBCC").unwrap()),
        font_color: Some(Color::from_hex("#112233").unwrap()),
        bold: Some(true),
        italic: Some(false),
        underline_type: Some(CFUnderlineType::Single),
        strikethrough: Some(true),
        border_color: Some(Color::from_hex("#445566").unwrap()),
        border_style: Some(CFBorderStyle::Thick),
        number_format: None,
        ..Default::default()
    };

    let json = serde_json::to_string(&style).unwrap();
    assert!(json.contains("\"backgroundColor\""));
    assert!(json.contains("\"fontColor\""));
    assert!(json.contains("\"underlineType\""));
    assert!(json.contains("\"borderColor\""));
    assert!(json.contains("\"borderStyle\""));

    // Round-trip
    let parsed: CfRenderStyle = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, style);
}

#[test]
fn test_cf_style_skip_serializing_none_fields() {
    let style = CfRenderStyle {
        background_color: Some(Color::from_hex("#FF0000").unwrap()),
        bold: Some(true),
        ..Default::default()
    };

    let json = serde_json::to_string(&style).unwrap();
    // Present fields should be serialized
    assert!(json.contains("\"backgroundColor\":\"#ff0000\""));
    assert!(json.contains("\"bold\":true"));
    // None fields should be skipped
    assert!(
        !json.contains("fontColor"),
        "fontColor should be skipped when None"
    );
    assert!(
        !json.contains("italic"),
        "italic should be skipped when None"
    );
    assert!(
        !json.contains("underlineType"),
        "underlineType should be skipped when None"
    );
    assert!(
        !json.contains("strikethrough"),
        "strikethrough should be skipped when None"
    );
    assert!(
        !json.contains("borderColor"),
        "borderColor should be skipped when None"
    );
    assert!(
        !json.contains("borderStyle"),
        "borderStyle should be skipped when None"
    );
    assert!(
        !json.contains("numberFormat"),
        "numberFormat should be skipped when None"
    );

    // Round-trip still works
    let parsed: CfRenderStyle = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, style);
}

#[test]
fn test_data_bar_result_skip_serializing_none_option_fields() {
    let result = DataBarResult {
        fill_percent: 50.0,
        color: Color::rgb(255, 0, 0),
        gradient: false,
        axis_position: 0.0,
        is_negative: false,
        negative_color: None,
        show_value: true,
        show_axis: false,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    };

    let json = serde_json::to_string(&result).unwrap();
    // None Option fields should be skipped
    assert!(
        !json.contains("negativeColor"),
        "negativeColor should be skipped when None"
    );
    assert!(
        !json.contains("borderColor"),
        "borderColor should be skipped when None"
    );
    assert!(
        !json.contains("negativeBorderColor"),
        "negativeBorderColor should be skipped when None"
    );
    assert!(
        !json.contains("axisColor"),
        "axisColor should be skipped when None"
    );
    // Non-option fields should still be present
    assert!(json.contains("\"fillPercent\":50.0"));
    assert!(json.contains("\"showValue\":true"));
}

// -----------------------------------------------------------------------
// DataBarResult serialization
// -----------------------------------------------------------------------

#[test]
fn test_data_bar_result_serialization() {
    let result = DataBarResult {
        fill_percent: 75.5,
        color: Color::rgb(100, 200, 50),
        gradient: true,
        axis_position: 25.0,
        is_negative: false,
        negative_color: Some(Color::rgb(255, 0, 0)),
        show_value: true,
        show_axis: true,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    };

    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"fillPercent\":75.5"));
    assert!(json.contains("\"gradient\":true"));
    assert!(json.contains("\"axisPosition\":25.0"));
    assert!(json.contains("\"isNegative\":false"));
    assert!(json.contains("\"showValue\":true"));
    assert!(json.contains("\"showAxis\":true"));
}

// -----------------------------------------------------------------------
// Output type PartialEq
// -----------------------------------------------------------------------

#[test]
fn test_output_types_partial_eq() {
    let db1 = DataBarResult {
        fill_percent: 50.0,
        color: Color::rgb(255, 0, 0),
        gradient: false,
        axis_position: 0.0,
        is_negative: false,
        negative_color: None,
        show_value: true,
        show_axis: false,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    };
    let db2 = db1.clone();
    assert_eq!(db1, db2);

    let cs1 = ColorScaleResult {
        color: Color::rgb(128, 128, 128),
    };
    let cs2 = cs1.clone();
    assert_eq!(cs1, cs2);

    let icon1 = IconResult {
        set_name: CFIconSetName::ThreeArrows,
        icon_index: 1,
        show_value: true,
    };
    let icon2 = icon1.clone();
    assert_eq!(icon1, icon2);
}

// -----------------------------------------------------------------------
// CFMatchResult::into_cell_result
// -----------------------------------------------------------------------

#[test]
fn test_cf_match_result_into_cell_result_full() {
    // CFMatchResult carries style + visual results without position info.
    // into_cell_result() should stamp row/col and transfer all fields.
    let style = CfRenderStyle {
        background_color: Some(Color::from_hex("#FF0000").unwrap()),
        bold: Some(true),
        ..Default::default()
    };
    let data_bar = DataBarResult {
        fill_percent: 75.0,
        color: Color::rgba(0, 128, 255, 255),
        gradient: true,
        axis_position: 0.0,
        is_negative: false,
        negative_color: None,
        show_value: true,
        show_axis: false,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    };

    let match_result = CFMatchResult {
        style: Some(style.clone()),
        data_bar: Some(data_bar.clone()),
        color_scale: Some(ColorScaleResult {
            color: Color::rgb(255, 128, 0),
        }),
        icon: Some(IconResult {
            set_name: CFIconSetName::ThreeArrows,
            icon_index: 2,
            show_value: false,
        }),
    };

    let cell_result = match_result.into_cell_result(7, 3);

    // Position must be stamped
    assert_eq!(cell_result.row, 7);
    assert_eq!(cell_result.col, 3);

    // All fields must transfer
    assert_eq!(cell_result.style.as_ref().unwrap().bold, Some(true));
    assert_eq!(
        cell_result.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(cell_result.data_bar.as_ref().unwrap().fill_percent, 75.0);
    assert!(cell_result.data_bar.as_ref().unwrap().gradient);
    assert_eq!(
        cell_result.color_scale.as_ref().unwrap().color,
        Color::rgb(255, 128, 0)
    );
    assert_eq!(cell_result.icon.as_ref().unwrap().icon_index, 2);
    assert!(!cell_result.icon.as_ref().unwrap().show_value);
}

#[test]
fn test_cf_match_result_into_cell_result_empty() {
    // An empty CFMatchResult (no rules matched) should produce an empty CellCFResult
    let match_result = CFMatchResult::default();
    let cell_result = match_result.into_cell_result(0, 0);

    assert_eq!(cell_result.row, 0);
    assert_eq!(cell_result.col, 0);
    assert!(!cell_result.has_any());
}
