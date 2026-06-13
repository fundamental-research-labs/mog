use super::formatting::{extract_chart_format, extract_chart_line, extract_chart_rich_text};
use super::text::extract_chart_text_string;

pub(in crate::domain::charts::read) fn extract_data_label_data(
    dl: &ooxml_types::charts::DataLabelOptions,
) -> domain_types::chart::DataLabelData {
    let show = dl.delete != Some(true)
        && (dl.show_value
            || dl.show_category
            || dl.show_series_name
            || dl.show_percent
            || dl.show_bubble_size
            || dl.show_legend_key);
    let visual_format = extract_chart_format(dl.sp_pr.as_ref(), dl.tx_pr.as_ref());

    domain_types::chart::DataLabelData {
        show,
        delete: dl.delete,
        position: data_label_position_to_domain(dl.position),
        format: None,
        show_value: if dl.show_value { Some(true) } else { None },
        show_category_name: if dl.show_category { Some(true) } else { None },
        show_series_name: if dl.show_series_name {
            Some(true)
        } else {
            None
        },
        show_percentage: if dl.show_percent { Some(true) } else { None },
        show_bubble_size: if dl.show_bubble_size {
            Some(true)
        } else {
            None
        },
        show_legend_key: if dl.show_legend_key { Some(true) } else { None },
        separator: dl.separator.clone(),
        show_leader_lines: dl.show_leader_lines,
        text: None,
        text_orientation: visual_format
            .as_ref()
            .and_then(|format| format.text_rotation),
        visual_format,
        number_format: dl
            .num_fmt_obj
            .as_ref()
            .map(|format| format.format_code.clone())
            .or_else(|| dl.num_fmt.clone()),
        rich_text: dl.tx_pr.as_ref().and_then(extract_chart_rich_text),
        auto_text: None,
        horizontal_alignment: None,
        vertical_alignment: None,
        link_number_format: dl
            .num_fmt_obj
            .as_ref()
            .and_then(|format| format.source_linked),
        geometric_shape_type: None,
        formula: None,
        height: None,
        width: None,
        leader_lines_format: dl
            .leader_lines
            .as_ref()
            .and_then(|lines| lines.sp_pr.as_ref())
            .and_then(|sp_pr| sp_pr.ln.as_ref())
            .map(extract_chart_line),
        layout: dl.layout.as_ref().map(Into::into),
    }
}

pub(in crate::domain::charts::read) fn extract_individual_data_label_data(
    label: &ooxml_types::charts::DataLabel,
    defaults: Option<&ooxml_types::charts::DataLabelOptions>,
) -> domain_types::chart::DataLabelData {
    let visual_format = extract_chart_format(label.sp_pr.as_ref(), label.tx_pr.as_ref());
    let text = label.text.as_ref().and_then(extract_chart_text_string);
    let formula = label.text.as_ref().and_then(extract_chart_text_formula);
    let rich_text = label
        .text
        .as_ref()
        .and_then(|text| match text {
            ooxml_types::charts::ChartText::Rich(body) => extract_chart_rich_text(body),
            ooxml_types::charts::ChartText::StrRef(_) => None,
        })
        .or_else(|| label.tx_pr.as_ref().and_then(extract_chart_rich_text));
    let default_show = defaults.is_some_and(|dl| {
        dl.show_value
            || dl.show_category
            || dl.show_series_name
            || dl.show_percent
            || dl.show_bubble_size
            || dl.show_legend_key
    });
    let explicit_show_flags = [
        label.show_value,
        label.show_category,
        label.show_series_name,
        label.show_percent,
        label.show_bubble_size,
        label.show_legend_key,
    ];
    let show_flags = if explicit_show_flags.iter().any(Option::is_some) {
        explicit_show_flags.into_iter().flatten().any(|value| value)
    } else {
        default_show
    };
    let show = label.delete != Some(true) && (show_flags || text.is_some() || rich_text.is_some());

    domain_types::chart::DataLabelData {
        show,
        delete: label.delete,
        position: label
            .position
            .and_then(data_label_position_to_domain)
            .or_else(|| defaults.and_then(|dl| data_label_position_to_domain(dl.position))),
        format: None,
        show_value: label
            .show_value
            .or_else(|| defaults.map(|dl| dl.show_value)),
        show_category_name: label
            .show_category
            .or_else(|| defaults.map(|dl| dl.show_category)),
        show_series_name: label
            .show_series_name
            .or_else(|| defaults.map(|dl| dl.show_series_name)),
        show_percentage: label
            .show_percent
            .or_else(|| defaults.map(|dl| dl.show_percent)),
        show_bubble_size: label
            .show_bubble_size
            .or_else(|| defaults.map(|dl| dl.show_bubble_size)),
        show_legend_key: label
            .show_legend_key
            .or_else(|| defaults.map(|dl| dl.show_legend_key)),
        separator: label
            .separator
            .clone()
            .or_else(|| defaults.and_then(|dl| dl.separator.clone())),
        show_leader_lines: defaults.and_then(|dl| dl.show_leader_lines),
        text,
        text_orientation: visual_format
            .as_ref()
            .and_then(|format| format.text_rotation),
        visual_format,
        number_format: label
            .num_fmt
            .as_ref()
            .map(|format| format.format_code.clone())
            .or_else(|| {
                defaults.and_then(|dl| {
                    dl.num_fmt_obj
                        .as_ref()
                        .map(|format| format.format_code.clone())
                        .or_else(|| dl.num_fmt.clone())
                })
            }),
        rich_text,
        auto_text: None,
        horizontal_alignment: None,
        vertical_alignment: None,
        link_number_format: label
            .num_fmt
            .as_ref()
            .and_then(|format| format.source_linked)
            .or_else(|| defaults.and_then(|dl| dl.num_fmt_obj.as_ref()?.source_linked)),
        geometric_shape_type: None,
        formula,
        height: None,
        width: None,
        leader_lines_format: defaults
            .and_then(|dl| dl.leader_lines.as_ref())
            .and_then(|lines| lines.sp_pr.as_ref())
            .and_then(|sp_pr| sp_pr.ln.as_ref())
            .map(extract_chart_line),
        layout: label.layout.as_ref().map(Into::into),
    }
}

fn extract_chart_text_formula(ct: &ooxml_types::charts::ChartText) -> Option<String> {
    match ct {
        ooxml_types::charts::ChartText::StrRef(str_ref) => Some(str_ref.f.clone()),
        ooxml_types::charts::ChartText::Rich(_) => None,
    }
}

fn data_label_position_to_domain(
    position: ooxml_types::charts::DataLabelPosition,
) -> Option<String> {
    use ooxml_types::charts::DataLabelPosition;

    match position {
        DataLabelPosition::OutsideEnd => Some("outsideEnd".to_string()),
        DataLabelPosition::InsideEnd => Some("insideEnd".to_string()),
        DataLabelPosition::InsideBase => Some("insideBase".to_string()),
        DataLabelPosition::Top => Some("top".to_string()),
        DataLabelPosition::Bottom => Some("bottom".to_string()),
        DataLabelPosition::Left => Some("left".to_string()),
        DataLabelPosition::Right => Some("right".to_string()),
        DataLabelPosition::Center => Some("center".to_string()),
        DataLabelPosition::BestFit => Some("bestFit".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::chart::{ChartColorData, ChartFillData};

    #[test]
    fn extracts_data_label_visual_text_number_and_leader_line_format() {
        let label_options = ooxml_types::charts::DataLabelOptions {
            show_value: true,
            show_legend_key: true,
            separator: Some(", ".to_string()),
            num_fmt_obj: Some(ooxml_types::charts::NumFmt {
                format_code: "0.0%".to_string(),
                source_linked: Some(false),
            }),
            sp_pr: Some(crate::domain::charts::parse_shape_properties(
                br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                    <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
                </c:spPr>"#,
            )),
            tx_pr: Some(crate::domain::charts::parse_text_body(
                br#"<c:txPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                    <a:bodyPr rot="5400000"/>
                    <a:p><a:r><a:rPr sz="1200" b="1"/><a:t>Label</a:t></a:r></a:p>
                </c:txPr>"#,
            )),
            show_leader_lines: Some(true),
            leader_lines: Some(ooxml_types::charts::ChartLines {
                sp_pr: Some(crate::domain::charts::parse_shape_properties(
                    br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:ln w="12700"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln>
                    </c:spPr>"#,
                )),
            }),
            ..Default::default()
        };

        let data = extract_data_label_data(&label_options);

        assert!(data.show);
        assert_eq!(data.show_value, Some(true));
        assert_eq!(data.show_legend_key, Some(true));
        assert_eq!(data.separator.as_deref(), Some(", "));
        assert_eq!(data.number_format.as_deref(), Some("0.0%"));
        assert_eq!(data.link_number_format, Some(false));
        assert_eq!(data.text_orientation, Some(90.0));
        assert_eq!(data.rich_text.as_ref().map(Vec::len), Some(1));
        assert_eq!(
            data.visual_format.and_then(|format| format.fill),
            Some(ChartFillData::Solid {
                color: ChartColorData::Hex("FF0000".to_string()),
                transparency: None,
            })
        );
        assert_eq!(
            data.leader_lines_format.and_then(|line| line.color),
            Some(ChartColorData::Hex("00FF00".to_string()))
        );
    }
}
