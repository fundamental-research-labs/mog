use super::formatting::{extract_chart_format, extract_chart_line};
use super::text::{extract_chart_text_string, extract_title_text_from_title};

pub(super) fn extract_axes_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Option<domain_types::chart::AxisData> {
    use ooxml_types::charts::AxisType;

    let axes = &cs.chart.plot_area.axes;
    if axes.is_empty() {
        return None;
    }

    // Collect axes by type. For multi-axis charts, we pick the first of each type
    // as primary and subsequent as secondary.
    let mut cat_axes: Vec<&ooxml_types::charts::ChartAxis> = Vec::new();
    let mut val_axes: Vec<&ooxml_types::charts::ChartAxis> = Vec::new();
    let mut date_axes: Vec<&ooxml_types::charts::ChartAxis> = Vec::new();
    let mut ser_axes: Vec<&ooxml_types::charts::ChartAxis> = Vec::new();

    for ax in axes {
        match ax.axis_type {
            AxisType::Category => cat_axes.push(ax),
            AxisType::Value => val_axes.push(ax),
            AxisType::Date => date_axes.push(ax),
            AxisType::Series => ser_axes.push(ax),
        }
    }

    // Category axis: first catAx or first dateAx as fallback
    let primary_cat = cat_axes
        .first()
        .copied()
        .or_else(|| date_axes.first().copied());
    let secondary_cat = cat_axes.get(1).copied().or_else(|| {
        if cat_axes.is_empty() {
            date_axes.get(1).copied()
        } else {
            date_axes.first().copied()
        }
    });

    let primary_val = val_axes.first().copied();
    let secondary_val = val_axes.get(1).copied();
    let series_axis = ser_axes.first().copied();

    let category_axis = primary_cat.map(|ax| extract_single_axis(ax));
    let value_axis = primary_val.map(|ax| extract_single_axis(ax));
    let secondary_category_axis = secondary_cat.map(|ax| extract_single_axis(ax));
    let secondary_value_axis = secondary_val.map(|ax| extract_single_axis(ax));
    let series_axis = series_axis.map(|ax| extract_single_axis(ax));

    Some(domain_types::chart::AxisData {
        category_axis,
        value_axis,
        secondary_category_axis,
        secondary_value_axis,
        series_axis,
    })
}

/// Extract a single axis to SingleAxisData.
fn extract_single_axis(ax: &ooxml_types::charts::ChartAxis) -> domain_types::chart::SingleAxisData {
    use ooxml_types::charts::{DisplayUnitKind, Orientation, TickMark};

    let title = ax
        .title
        .as_ref()
        .and_then(|t| extract_title_text_from_title(t));

    let visible = !ax.delete;

    let min = ax.scaling.min;
    let max = ax.scaling.max;
    let major_unit = ax.major_unit;
    let minor_unit = ax.minor_unit;
    let log_base = ax.scaling.log_base;

    let reverse = if ax.scaling.orientation == Orientation::MaxMin {
        Some(true)
    } else {
        None
    };

    let position = Some(ax.ax_pos.to_ooxml().to_string());

    let tick_marks = match ax.major_tick_mark {
        TickMark::Cross => None, // default
        other => Some(other.to_ooxml().to_string()),
    };
    let minor_tick_marks = match ax.minor_tick_mark {
        TickMark::Cross => None,
        other => Some(other.to_ooxml().to_string()),
    };

    let number_format = ax.num_fmt.as_ref().map(|nf| nf.format_code.clone());

    let axis_type = Some(ax.axis_type.to_ooxml().to_string());

    let grid_lines = if ax.major_gridlines.is_some() {
        Some(true)
    } else {
        None
    };
    let minor_grid_lines = if ax.minor_gridlines.is_some() {
        Some(true)
    } else {
        None
    };

    // Display units
    let (display_unit, custom_display_unit, display_unit_label) = ax
        .disp_units
        .as_ref()
        .map(|du| {
            let (bu, cu) = match &du.kind {
                Some(DisplayUnitKind::BuiltIn(b)) => (Some(b.to_ooxml().to_string()), None),
                Some(DisplayUnitKind::Custom(v)) => (None, Some(*v)),
                None => (None, None),
            };
            let label = du
                .disp_units_lbl
                .as_ref()
                .and_then(|lbl| lbl.tx.as_ref().and_then(|tx| extract_chart_text_string(tx)));
            (bu, cu, label)
        })
        .unwrap_or((None, None, None));

    // Formatting
    let format = extract_chart_format(ax.sp_pr.as_ref(), ax.tx_pr.as_ref());
    let title_format = ax
        .title
        .as_ref()
        .and_then(|t| extract_chart_format(t.sp_pr.as_ref(), t.tx_pr.as_ref()));
    let gridline_format = ax
        .major_gridlines
        .as_ref()
        .and_then(|gl| gl.sp_pr.as_ref())
        .and_then(|sp| sp.ln.as_ref())
        .map(|ln| extract_chart_line(ln));
    let minor_gridline_format = ax
        .minor_gridlines
        .as_ref()
        .and_then(|gl| gl.sp_pr.as_ref())
        .and_then(|sp| sp.ln.as_ref())
        .map(|ln| extract_chart_line(ln));

    // Cross between
    let cross_between = ax.cross_between.map(|cb| cb.to_ooxml().to_string());

    // Tick label position
    let tick_label_position = {
        let tlp = ax.tick_lbl_pos;
        match tlp {
            ooxml_types::charts::TickLabelPosition::NextTo => None, // default
            other => Some(other.to_ooxml().to_string()),
        }
    };

    // Time units (dateAx)
    let base_time_unit = ax.base_time_unit.map(|tu| tu.to_ooxml().to_string());
    let major_time_unit = ax.major_time_unit.map(|tu| tu.to_ooxml().to_string());
    let minor_time_unit = ax.minor_time_unit.map(|tu| tu.to_ooxml().to_string());

    // Label alignment (catAx)
    let label_alignment = ax.lbl_algn.map(|la| la.to_ooxml().to_string());
    let label_offset = ax.lbl_offset;
    let no_multi_level_labels = ax.no_multi_lvl_lbl;

    domain_types::chart::SingleAxisData {
        title,
        visible,
        min,
        max,
        axis_type,
        grid_lines,
        minor_grid_lines,
        major_unit,
        minor_unit,
        tick_marks,
        minor_tick_marks,
        number_format,
        reverse,
        position,
        log_base,
        display_unit,
        format,
        title_format,
        gridline_format,
        minor_gridline_format,
        cross_between,
        tick_label_position,
        base_time_unit,
        major_time_unit,
        minor_time_unit,
        custom_display_unit,
        display_unit_label,
        label_alignment,
        label_offset,
        no_multi_level_labels,
        ..Default::default()
    }
}

// Extract scalar chart-level fields from the first chart group's config.
// Returns (gap_width, overlap, doughnut_hole_size, first_slice_angle, bubble_scale, split_type, split_value).
