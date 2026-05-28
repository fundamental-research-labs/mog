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
            LegendPosition::TopRight => "right",
        };

        let format = extract_chart_format(l.sp_pr.as_ref(), l.tx_pr.as_ref());

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
            show: false,
            position: position.to_string(),
            visible: true,
            overlay: l.overlay,
            format,
            entries,
            custom_x: None,
            custom_y: None,
            shadow: None,
            show_shadow: None,
        }
    })
}

// Extract axes from ChartSpace.
