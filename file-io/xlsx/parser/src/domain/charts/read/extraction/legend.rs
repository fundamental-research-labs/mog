use super::formatting::extract_chart_format;

pub(super) fn extract_legend_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Option<domain_types::chart::LegendData> {
    use ooxml_types::charts::LegendPosition;

    cs.chart.legend.as_ref().map(|l| {
        let position = match l.legend_pos.unwrap_or(LegendPosition::Right) {
            LegendPosition::Bottom => "bottom",
            LegendPosition::Top => "top",
            LegendPosition::Left => "left",
            LegendPosition::Right => "right",
            LegendPosition::TopRight => "topRight",
        };

        let format = extract_chart_format(l.sp_pr.as_ref(), l.tx_pr.as_ref());
        let layout: Option<domain_types::domain::drawings::ManualLayout> =
            l.layout.as_ref().map(Into::into);

        let entries = if l.legend_entry.is_empty() {
            None
        } else {
            Some(
                l.legend_entry
                    .iter()
                    .map(|le| {
                        let entry_format = le
                            .tx_pr
                            .as_ref()
                            .and_then(|tp| extract_chart_format(None, Some(tp)));
                        domain_types::chart::LegendEntryData {
                            idx: le.idx,
                            delete: le.delete,
                            format: entry_format,
                            visible: None,
                        }
                    })
                    .collect(),
            )
        };

        domain_types::chart::LegendData {
            show: true,
            position: position.to_string(),
            visible: true,
            overlay: l.overlay,
            format,
            entries,
            custom_x: layout.as_ref().and_then(|layout| layout.x),
            custom_y: layout.as_ref().and_then(|layout| layout.y),
            layout,
            shadow: None,
            show_shadow: None,
        }
    })
}

// Extract axes from ChartSpace.

#[cfg(test)]
mod tests {
    use super::extract_legend_from_chart_space;

    #[test]
    fn legend_entry_text_properties_extract_as_entry_format() {
        let tx_pr = crate::domain::charts::parse_text_body(
            br#"<c:txPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr rot="2520000"/>
                <a:lstStyle/>
                <a:p>
                    <a:pPr>
                        <a:defRPr b="1" i="1" sz="4200" u="sng" strike="sngStrike">
                            <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
                            <a:latin typeface="Mog chart contract"/>
                        </a:defRPr>
                    </a:pPr>
                </a:p>
            </c:txPr>"#,
        );
        let chart_space = ooxml_types::charts::ChartSpace {
            chart: ooxml_types::charts::Chart {
                legend: Some(ooxml_types::charts::Legend {
                    legend_entry: vec![ooxml_types::charts::LegendEntry {
                        idx: 0,
                        tx_pr: Some(tx_pr),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                ..Default::default()
            },
            ..Default::default()
        };

        let legend = extract_legend_from_chart_space(&chart_space).unwrap();
        let entries = legend.entries.as_ref().unwrap();
        let format = entries[0].format.as_ref().unwrap();
        let font = format.font.as_ref().unwrap();

        assert_eq!(format.text_rotation, Some(42.0));
        assert_eq!(font.bold, Some(true));
        assert_eq!(font.italic, Some(true));
        assert_eq!(font.size, Some(42.0));
        assert_eq!(font.name.as_deref(), Some("Mog chart contract"));
    }
}
