use super::*;
use crate::domain::drawings::{CellAnchor, ClientData, Extent, OneCellAnchor};
use crate::output::results::FullParsedSheet;
use domain_types::CFRule;
use ooxml_types::cond_format::{
    CfColor, CfRule as OoxmlCfRule, CfRuleType, Cfvo, CfvoType, DataBar, DataBarAxisPosition,
    DataBarDirection,
};

fn fallback_chart_spec() -> ChartSpec {
    build_fallback_chart_spec(
        &crate::domain::charts::Chart::default(),
        0,
        &FullParsedSheet::default(),
    )
}

fn data_bar_rule(data_bar: DataBar) -> OoxmlCfRule {
    OoxmlCfRule {
        rule_type: CfRuleType::DataBar,
        priority: 1,
        data_bar: Some(data_bar),
        ..Default::default()
    }
}

fn basic_ooxml_data_bar() -> DataBar {
    DataBar {
        cfvo: vec![
            Cfvo {
                cfvo_type: CfvoType::Min,
                val: None,
                gte: true,
                ext_lst_xml: None,
            },
            Cfvo {
                cfvo_type: CfvoType::Max,
                val: None,
                gte: true,
                ext_lst_xml: None,
            },
        ],
        color: CfColor {
            rgb: Some("FF638EC6".to_string()),
            ..Default::default()
        },
        ..Default::default()
    }
}

#[test]
fn data_bar_defaults_absent_stay_absent_in_domain() {
    let rule = data_bar_rule(basic_ooxml_data_bar());
    let converted = convert_cf_rule(&rule, &[], &[]);

    let CFRule::DataBar { data_bar, .. } = converted else {
        panic!("expected data bar rule");
    };
    assert_eq!(data_bar.min_length, None);
    assert_eq!(data_bar.max_length, None);
    assert_eq!(data_bar.show_value, None);
    assert_eq!(data_bar.gradient, None);
    assert_eq!(data_bar.direction, None);
    assert_eq!(data_bar.axis_position, None);
    assert_eq!(data_bar.show_border, None);
    assert_eq!(data_bar.match_positive_fill_color, None);
    assert_eq!(data_bar.match_positive_border_color, None);
}

#[test]
fn data_bar_explicit_default_attrs_stay_explicit_in_domain() {
    let mut data_bar = basic_ooxml_data_bar();
    data_bar.min_length_attr_present = true;
    data_bar.max_length_attr_present = true;
    data_bar.show_value_attr_present = true;
    data_bar.gradient_attr_present = true;
    data_bar.border_attr_present = true;
    data_bar.direction_attr_present = true;
    data_bar.negative_bar_color_same_as_positive_attr_present = true;
    data_bar.negative_bar_border_color_same_as_positive_attr_present = true;
    data_bar.axis_position_attr_present = true;
    data_bar.border = false;
    data_bar.direction = DataBarDirection::Context;
    data_bar.negative_bar_color_same_as_positive = true;
    data_bar.negative_bar_border_color_same_as_positive = false;
    data_bar.axis_position = DataBarAxisPosition::Automatic;

    let converted = convert_cf_rule(&data_bar_rule(data_bar), &[], &[]);

    let CFRule::DataBar { data_bar, .. } = converted else {
        panic!("expected data bar rule");
    };
    assert_eq!(data_bar.min_length, Some(10));
    assert_eq!(data_bar.max_length, Some(90));
    assert_eq!(data_bar.show_value, Some(true));
    assert_eq!(data_bar.gradient, Some(true));
    assert_eq!(data_bar.show_border, Some(false));
    assert_eq!(data_bar.direction, Some(DataBarDirection::Context));
    assert_eq!(data_bar.match_positive_fill_color, Some(true));
    assert_eq!(data_bar.match_positive_border_color, Some(false));
    assert_eq!(data_bar.axis_position, Some(DataBarAxisPosition::Automatic));
}

#[test]
fn data_bar_min_max_cfvo_val_is_preserved_for_roundtrip() {
    let mut data_bar = basic_ooxml_data_bar();
    data_bar.cfvo[0].val = Some("0".to_string());
    data_bar.cfvo[1].val = Some("0".to_string());

    let converted = convert_cf_rule(&data_bar_rule(data_bar), &[], &[]);

    let CFRule::DataBar { data_bar, .. } = converted else {
        panic!("expected data bar rule");
    };
    assert_eq!(data_bar.min_point.value, domain_types::CFValueRef::Min);
    assert_eq!(data_bar.min_point.ooxml_value.as_deref(), Some("0"));
    assert_eq!(data_bar.max_point.value, domain_types::CFValueRef::Max);
    assert_eq!(data_bar.max_point.ooxml_value.as_deref(), Some("0"));
}

#[test]
fn data_bar_x14_numeric_threshold_values_survive_domain_conversion() {
    let mut data_bar = basic_ooxml_data_bar();
    data_bar.cfvo[0].cfvo_type = CfvoType::Num;
    data_bar.cfvo[0].val = Some("0".to_string());
    data_bar.cfvo[1].cfvo_type = CfvoType::Num;
    data_bar.cfvo[1].val = Some("1".to_string());

    let converted = convert_cf_rule(&data_bar_rule(data_bar), &[], &[]);

    let CFRule::DataBar { data_bar, .. } = converted else {
        panic!("expected data bar rule");
    };
    assert_eq!(
        data_bar.min_point.value,
        domain_types::CFValueRef::Number { value: 0.0 }
    );
    assert_eq!(data_bar.min_point.ooxml_value.as_deref(), Some("0"));
    assert_eq!(
        data_bar.max_point.value,
        domain_types::CFValueRef::Number { value: 1.0 }
    );
    assert_eq!(data_bar.max_point.ooxml_value.as_deref(), Some("1"));
}

#[test]
fn chart_ref_extent_uses_one_cell_anchor_extent_not_graphic_frame_extent() {
    let mut spec = fallback_chart_spec();
    spec.position = AnchorPosition {
        anchor_row: 3,
        anchor_col: 8,
        anchor_row_offset: 0,
        anchor_col_offset: 0,
        absolute_x: None,
        absolute_y: None,
        end_row: None,
        end_col: None,
        end_row_offset: None,
        end_col_offset: None,
        extent_cx: Some(4_699_001),
        extent_cy: Some(3_260_722),
    };
    spec.xfrm_ext_cx = 0;
    spec.xfrm_ext_cy = 0;

    assert_eq!(chart_ref_extent_from_spec(&spec), (4_699_001, 3_260_722));
}

#[test]
fn chart_ref_extent_keeps_two_cell_graphic_frame_extent() {
    let mut spec = fallback_chart_spec();
    spec.position = AnchorPosition {
        anchor_row: 3,
        anchor_col: 8,
        anchor_row_offset: 0,
        anchor_col_offset: 0,
        absolute_x: None,
        absolute_y: None,
        end_row: Some(18),
        end_col: Some(16),
        end_row_offset: Some(0),
        end_col_offset: Some(0),
        extent_cx: Some(4_699_001),
        extent_cy: Some(3_260_722),
    };
    spec.xfrm_ext_cx = 1_234;
    spec.xfrm_ext_cy = 5_678;

    assert_eq!(chart_ref_extent_from_spec(&spec), (1_234, 5_678));
}

#[test]
fn chart_frames_by_relationship_target_uses_normalized_chart_part_identity() {
    let frames = vec![
        (
            AnchorPosition {
                anchor_row: 75,
                anchor_col: 2,
                anchor_row_offset: 65_607,
                anchor_col_offset: 194_224,
                absolute_x: None,
                absolute_y: None,
                end_row: Some(92),
                end_col: Some(8),
                end_row_offset: Some(63_507),
                end_col_offset: Some(381_274),
                extent_cx: None,
                extent_cy: None,
            },
            ChartDrawingFrameOoxmlProps {
                relationship_target: Some("../charts/chart8.xml".to_string()),
                anchor_index: Some(8),
                ..Default::default()
            },
        ),
        (
            AnchorPosition {
                anchor_row: 101,
                anchor_col: 2,
                anchor_row_offset: 137_697,
                anchor_col_offset: 578_704,
                absolute_x: None,
                absolute_y: None,
                end_row: Some(109),
                end_col: Some(9),
                end_row_offset: Some(103_247),
                end_col_offset: Some(558_992),
                extent_cx: None,
                extent_cy: None,
            },
            ChartDrawingFrameOoxmlProps {
                relationship_target: Some("../charts/chart9.xml".to_string()),
                anchor_index: Some(9),
                ..Default::default()
            },
        ),
    ];

    let by_target = chart_frames_by_relationship_target(&frames);

    let (chart9_position, chart9_frame) = by_target
        .get("xl/charts/chart9.xml")
        .expect("chart9 frame should be keyed by normalized OPC target");
    assert_eq!(chart9_position.anchor_row, 101);
    assert_eq!(chart9_position.anchor_col_offset, 578_704);
    assert_eq!(chart9_frame.anchor_index, Some(9));
}

#[test]
fn chart_ex_one_cell_anchor_position_preserves_extent() {
    let anchor = DrawingAnchor::OneCell(OneCellAnchor {
        from: CellAnchor {
            col: 8,
            row: 3,
            col_off: 11,
            row_off: 22,
        },
        extent: Extent {
            cx: 4_699_001,
            cy: 3_260_722,
        },
        content: DrawingContent::GraphicFrame(ooxml_types::drawings::SpreadsheetGraphicFrame {
            graphic_xml: Some("http://schemas.microsoft.com/office/drawing/2014/chartex".into()),
            ..Default::default()
        }),
        client_data: ClientData::default(),
        mc_alternate_content: None,
    });

    let pos = chart_ex_anchor_position(&anchor).expect("ChartEx anchor position");

    assert_eq!(pos.anchor_col, 8);
    assert_eq!(pos.anchor_row, 3);
    assert_eq!(pos.anchor_col_offset, 11);
    assert_eq!(pos.anchor_row_offset, 22);
    assert_eq!(pos.end_col, None);
    assert_eq!(pos.end_row, None);
    assert_eq!(pos.extent_cx, Some(4_699_001));
    assert_eq!(pos.extent_cy, Some(3_260_722));
}
