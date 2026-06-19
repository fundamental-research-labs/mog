use domain_types::chart::{ChartBorderData, ChartColorData, ChartLineData};

pub(super) fn point_border_from_line(line: &ChartLineData) -> Option<ChartBorderData> {
    let color = match line.color.as_ref() {
        Some(ChartColorData::Hex(hex)) => Some(hex.clone()),
        _ => None,
    };
    let style = line
        .dash_style
        .as_ref()
        .map(chart_dash_style_to_border_style);

    if color.is_none() && line.width.is_none() && style.is_none() {
        return None;
    }

    Some(ChartBorderData {
        color,
        width: line.width,
        style,
    })
}

fn chart_dash_style_to_border_style(style: &domain_types::chart::ChartDashStyle) -> String {
    serde_json::to_value(style)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| format!("{style:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::chart::{ChartColorData, ChartDashStyle};

    #[test]
    fn point_border_uses_line_alias_fields() {
        let border = point_border_from_line(&ChartLineData {
            color: Some(ChartColorData::Hex("A5A5A5".to_string())),
            width: Some(2.0),
            dash_style: Some(ChartDashStyle::LongDashDotDot),
            transparency: None,
            no_fill: None,
        })
        .expect("border");

        assert_eq!(border.color.as_deref(), Some("A5A5A5"));
        assert_eq!(border.width, Some(2.0));
        assert_eq!(border.style.as_deref(), Some("longDashDotDot"));
    }
}
