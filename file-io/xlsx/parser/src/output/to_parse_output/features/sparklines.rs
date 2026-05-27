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
    SparklineVisualSettings {
        color: sparkline_color_to_hex(&g.color_series).unwrap_or_default(),
        negative_color: sparkline_color_to_hex(&g.color_negative),
        show_markers: if g.markers { Some(true) } else { None },
        marker_color: sparkline_color_to_hex(&g.color_markers),
        high_point_color: if g.high {
            sparkline_color_to_hex(&g.color_high)
        } else {
            None
        },
        low_point_color: if g.low {
            sparkline_color_to_hex(&g.color_low)
        } else {
            None
        },
        first_point_color: if g.first {
            sparkline_color_to_hex(&g.color_first)
        } else {
            None
        },
        last_point_color: if g.last {
            sparkline_color_to_hex(&g.color_last)
        } else {
            None
        },
        line_weight: g.line_weight,
        column_gap: None,
        bar_gap: None,
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
        axis_color: sparkline_color_to_hex(&g.color_axis),
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

/// Extract a hex color string from an optional `SparklineColor`.
pub(crate) fn sparkline_color_to_hex(
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
        } else {
            // Theme-based color — would need theme resolution, return None for now
            None
        }
    })
}
