pub(in crate::domain::charts::read) fn extract_data_label_data(
    dl: &ooxml_types::charts::DataLabelOptions,
) -> domain_types::chart::DataLabelData {
    use ooxml_types::charts::DataLabelPosition;

    let show = dl.show_value || dl.show_category || dl.show_series_name || dl.show_percent;
    let position = match dl.position {
        DataLabelPosition::OutsideEnd => Some("outside".to_string()),
        DataLabelPosition::InsideEnd | DataLabelPosition::InsideBase => Some("inside".to_string()),
        DataLabelPosition::Top => Some("top".to_string()),
        DataLabelPosition::Bottom => Some("bottom".to_string()),
        DataLabelPosition::Left => Some("left".to_string()),
        DataLabelPosition::Right => Some("right".to_string()),
        DataLabelPosition::Center => Some("inside".to_string()),
        DataLabelPosition::BestFit => None,
    };

    domain_types::chart::DataLabelData {
        show,
        position,
        format: None,
        show_value: if dl.show_value { Some(true) } else { None },
        show_category_name: if dl.show_category { Some(true) } else { None },
        show_series_name: if dl.show_series_name {
            Some(true)
        } else {
            None
        },
        show_percentage: if dl.show_percent { Some(true) } else { None },
        show_bubble_size: None,
        show_legend_key: None,
        separator: None,
        show_leader_lines: None,
        text: None,
        visual_format: None,
        number_format: None,
        text_orientation: None,
        rich_text: None,
        auto_text: None,
        horizontal_alignment: None,
        vertical_alignment: None,
        link_number_format: None,
        geometric_shape_type: None,
        formula: None,
        leader_lines_format: None,
    }
}

// Extract legend as typed LegendData.
