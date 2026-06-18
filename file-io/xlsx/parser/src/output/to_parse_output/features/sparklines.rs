use super::*;

// =============================================================================
// Domain conversions: Sparklines
// =============================================================================

/// Convert parser `SparklineGroup` items into domain `Sparkline` and `SparklineGroup` items.
///
/// Each OOXML `SparklineGroup` may contain multiple sparkline entries that share
/// the same visual settings. We produce:
/// - A flat list of `DtSparkline` values (one per entry, with numeric coordinates)
/// - A list of `DtSparklineGroup` values preserving group structure
///
/// A1 cell references are parsed into 0-based numeric `(row, col)` coordinates
/// using the parser's existing `parse_a1_cell` utility.
pub(crate) fn convert_sparkline_groups(
    groups: &[SparklineGroup],
    sheet_id: &str,
) -> (Vec<DtSparkline>, Vec<DtSparklineGroup>) {
    let mut sparklines = Vec::new();
    let mut sparkline_groups = Vec::new();
    let mut global_idx: usize = 0;

    for (group_idx, g) in groups.iter().enumerate() {
        let group_id = format!("group-{group_idx}");
        let sparkline_type = convert_sparkline_type(&g.sparkline_type);
        let visual = build_visual_settings(g);
        let axis = build_axis_settings(g);

        let mut sparkline_ids = Vec::with_capacity(g.sparklines.len());

        for entry in &g.sparklines {
            let spark_id = format!("sparkline-{global_idx}");
            global_idx += 1;

            let (cell_row, cell_col) = parse_sparkline_cell_ref(&entry.location);
            let data_range = parse_sparkline_range(&entry.data_range);

            sparklines.push(DtSparkline {
                id: spark_id.clone(),
                sheet_id: sheet_id.to_string(),
                cell: SparklineCellAddress {
                    sheet_id: sheet_id.to_string(),
                    row: cell_row,
                    col: cell_col,
                },
                data_range,
                sparkline_type: sparkline_type.clone(),
                data_in_rows: false, // OOXML default; no per-group attribute for this
                group_id: Some(group_id.clone()),
                visual: visual.clone(),
                axis: axis.clone(),
                created_at: None,
                updated_at: None,
            });

            sparkline_ids.push(spark_id);
        }

        sparkline_groups.push(DtSparklineGroup {
            id: group_id,
            sheet_id: sheet_id.to_string(),
            sparkline_ids,
            sparkline_type,
            visual,
            axis,
            created_at: None,
            updated_at: None,
        });
    }

    (sparklines, sparkline_groups)
}

/// Map OOXML `SparklineType` to domain `SparklineType`.
fn convert_sparkline_type(ooxml: &ooxml_types::sparklines::SparklineType) -> DtSparklineType {
    match ooxml {
        ooxml_types::sparklines::SparklineType::Line => DtSparklineType::Line,
        ooxml_types::sparklines::SparklineType::Column => DtSparklineType::Column,
        ooxml_types::sparklines::SparklineType::WinLoss => DtSparklineType::WinLoss,
    }
}

/// Build `SparklineVisualSettings` from an OOXML `SparklineGroup`.
fn build_visual_settings(g: &SparklineGroup) -> SparklineVisualSettings {
    let negative_color = sparkline_color_to_domain_color(&g.color_negative);
    let high_point_color = sparkline_color_to_domain_color(&g.color_high);
    let low_point_color = sparkline_color_to_domain_color(&g.color_low);
    let first_point_color = sparkline_color_to_domain_color(&g.color_first);
    let last_point_color = sparkline_color_to_domain_color(&g.color_last);

    SparklineVisualSettings {
        color: sparkline_color_to_domain_color(&g.color_series).unwrap_or_default(),
        show_negative_points: sparkline_flag_value(g.negative, negative_color.is_some()),
        negative_color,
        show_markers: if g.markers { Some(true) } else { None },
        marker_color: sparkline_color_to_domain_color(&g.color_markers),
        show_high_point: sparkline_flag_value(g.high, high_point_color.is_some()),
        high_point_color,
        show_low_point: sparkline_flag_value(g.low, low_point_color.is_some()),
        low_point_color,
        show_first_point: sparkline_flag_value(g.first, first_point_color.is_some()),
        first_point_color,
        show_last_point: sparkline_flag_value(g.last, last_point_color.is_some()),
        last_point_color,
        line_weight: g.line_weight,
        column_gap: None,
        bar_gap: None,
    }
}

fn sparkline_flag_value(enabled: bool, has_color: bool) -> Option<bool> {
    if enabled {
        Some(true)
    } else if has_color {
        Some(false)
    } else {
        None
    }
}

/// Build `SparklineAxisSettings` from an OOXML `SparklineGroup`.
fn build_axis_settings(g: &SparklineGroup) -> SparklineAxisSettings {
    use ooxml_types::sparklines::SparklineAxisType;

    let min_value = match g.min_axis_type {
        SparklineAxisType::Individual => AxisBound::Label(AxisBoundLabel::Auto),
        SparklineAxisType::Group => AxisBound::Label(AxisBoundLabel::Same),
        SparklineAxisType::Custom => match g.manual_min {
            Some(v) => AxisBound::Value(v),
            None => AxisBound::Label(AxisBoundLabel::Auto),
        },
    };
    let max_value = match g.max_axis_type {
        SparklineAxisType::Individual => AxisBound::Label(AxisBoundLabel::Auto),
        SparklineAxisType::Group => AxisBound::Label(AxisBoundLabel::Same),
        SparklineAxisType::Custom => match g.manual_max {
            Some(v) => AxisBound::Value(v),
            None => AxisBound::Label(AxisBoundLabel::Auto),
        },
    };

    let display_empty_cells = match g.display_empty_cells_as {
        ooxml_types::sparklines::DisplayEmptyCellsAs::Gap => EmptyCellDisplay::Gaps,
        ooxml_types::sparklines::DisplayEmptyCellsAs::Zero => EmptyCellDisplay::Zero,
        ooxml_types::sparklines::DisplayEmptyCellsAs::Span => EmptyCellDisplay::Connect,
    };

    SparklineAxisSettings {
        min_value,
        max_value,
        show_axis: if g.display_x_axis { Some(true) } else { None },
        axis_color: sparkline_color_to_domain_color(&g.color_axis),
        display_empty_cells,
        right_to_left: if g.right_to_left { Some(true) } else { None },
    }
}

// =============================================================================
// A1 reference parsing helpers for sparkline cell/range references
// =============================================================================

/// Parse a sparkline cell reference like `"B2"` or `"Sheet1!B2"` into 0-based `(row, col)`.
///
/// Strips any sheet prefix (everything before and including `!`), then delegates
/// to the parser's `parse_a1_cell` utility.
fn parse_sparkline_cell_ref(cell_ref: &str) -> (u32, u32) {
    let cell_part = cell_ref.rsplit('!').next().unwrap_or(cell_ref);
    crate::infra::a1::parse_a1_cell(cell_part).unwrap_or((0, 0))
}

/// Parse a sparkline data range like `"Sheet1!A1:A10"` into a `SparklineDataRange`.
///
/// Strips any sheet prefix, splits on `:`, and parses each cell reference.
/// For single-cell references (no `:`), start and end are the same cell.
fn parse_sparkline_range(range_ref: &str) -> SparklineDataRange {
    let range_part = range_ref.rsplit('!').next().unwrap_or(range_ref);
    let parts: Vec<&str> = range_part.split(':').collect();
    let (start_row, start_col) = crate::infra::a1::parse_a1_cell(parts[0]).unwrap_or((0, 0));
    let (end_row, end_col) = if parts.len() > 1 {
        crate::infra::a1::parse_a1_cell(parts[1]).unwrap_or((start_row, start_col))
    } else {
        (start_row, start_col)
    };
    SparklineDataRange {
        start_row,
        start_col,
        end_row,
        end_col,
    }
}

/// Extract a domain color string from an optional `SparklineColor`.
pub(crate) fn sparkline_color_to_domain_color(
    color: &Option<crate::domain::sparklines::read::SparklineColor>,
) -> Option<String> {
    color.as_ref().and_then(|c| {
        if let Some(ref rgb) = c.rgb {
            // Parser stores ARGB (e.g. "FF376092"), strip alpha prefix if 8 chars
            if rgb.len() == 8 {
                Some(format!("#{}", &rgb[2..]))
            } else {
                Some(format!("#{rgb}"))
            }
        } else if let Some(theme) = c.theme {
            let mut value = format!("theme:{theme}");
            if let Some(tint) = c.tint {
                value.push(':');
                value.push_str(&tint.to_string());
            }
            Some(value)
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sparkline_color_preserves_theme_and_tint_as_domain_color() {
        let color = Some(crate::domain::sparklines::read::SparklineColor {
            rgb: None,
            theme: Some(4),
            tint: Some(0.3999755851924192),
        });

        assert_eq!(
            sparkline_color_to_domain_color(&color).as_deref(),
            Some("theme:4:0.3999755851924192")
        );
    }

    #[test]
    fn sparkline_color_preserves_rgb_as_hex_domain_color() {
        let color = Some(crate::domain::sparklines::read::SparklineColor {
            rgb: Some("FF376092".to_string()),
            theme: None,
            tint: None,
        });

        assert_eq!(
            sparkline_color_to_domain_color(&color).as_deref(),
            Some("#376092")
        );
    }

    #[test]
    fn build_visual_settings_preserves_point_colors_without_display_flags() {
        let group = SparklineGroup {
            color_first: Some(crate::domain::sparklines::read::SparklineColor {
                rgb: None,
                theme: Some(4),
                tint: Some(0.3999755851924192),
            }),
            color_last: Some(crate::domain::sparklines::read::SparklineColor {
                rgb: None,
                theme: Some(4),
                tint: Some(0.3999755851924192),
            }),
            color_high: Some(crate::domain::sparklines::read::SparklineColor {
                rgb: None,
                theme: Some(4),
                tint: None,
            }),
            color_low: Some(crate::domain::sparklines::read::SparklineColor {
                rgb: None,
                theme: Some(4),
                tint: None,
            }),
            first: false,
            last: false,
            high: false,
            low: false,
            ..Default::default()
        };

        let visual = build_visual_settings(&group);

        assert_eq!(
            visual.first_point_color.as_deref(),
            Some("theme:4:0.3999755851924192")
        );
        assert_eq!(visual.show_first_point, Some(false));
        assert_eq!(
            visual.last_point_color.as_deref(),
            Some("theme:4:0.3999755851924192")
        );
        assert_eq!(visual.show_last_point, Some(false));
        assert_eq!(visual.high_point_color.as_deref(), Some("theme:4"));
        assert_eq!(visual.show_high_point, Some(false));
        assert_eq!(visual.low_point_color.as_deref(), Some("theme:4"));
        assert_eq!(visual.show_low_point, Some(false));
    }
}
