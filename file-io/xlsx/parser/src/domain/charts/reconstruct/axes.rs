use domain_types::{
    ChartDefinition,
    chart::{AxisData, ChartSpec, ChartType as DomainChartType, SingleAxisData},
};
use ooxml_types::charts::{
    self, AxisType, ChartAxis, ChartAxisPosition, ChartLines, CrossBetween, LabelAlignment, NumFmt,
    Orientation, Scaling, TickLabelPosition, TickMark, TimeUnit,
};
use ooxml_types::drawings::ShapeProperties;

use super::{
    elements::{build_chart_text_rich, build_title_element},
    formatting::{build_outline, build_shape_properties, build_text_body},
};

// =============================================================================
// Axes
// =============================================================================

pub(super) fn build_axes(spec: &ChartSpec) -> Vec<ChartAxis> {
    if let (Some(ChartDefinition::Chart(chart_space)), Some(axes_data)) =
        (spec.definition.as_ref(), spec.axes.as_ref())
    {
        let axes_ordered: Vec<_> = chart_space
            .chart
            .plot_area
            .axes
            .iter()
            .map(|axis| axis.ax_id)
            .collect();
        if !axes_ordered.is_empty() {
            return build_axes_from_ordered(axes_data, &axes_ordered);
        }
    }

    // Fallback: build axes from AxisData in standard order
    let Some(axes_data) = spec.axes.as_ref() else {
        return build_default_axes(spec);
    };

    let mut axes = Vec::new();
    let cat_id = 111111111u32;
    let val_id = 222222222u32;

    if let Some(ref cat) = axes_data.category_axis {
        axes.push(build_single_axis(cat, AxisType::Category, cat_id, val_id));
    }
    if let Some(ref val) = axes_data.value_axis {
        axes.push(build_single_axis(val, AxisType::Value, val_id, cat_id));
    }
    if let Some(ref scat) = axes_data.secondary_category_axis {
        axes.push(build_single_axis(
            scat,
            AxisType::Category,
            333333333,
            444444444,
        ));
    }
    if let Some(ref sval) = axes_data.secondary_value_axis {
        axes.push(build_single_axis(
            sval,
            AxisType::Value,
            444444444,
            333333333,
        ));
    }
    if let Some(ref ser) = axes_data.series_axis {
        axes.push(build_single_axis(ser, AxisType::Series, 555555555, cat_id));
    }

    axes
}

pub(super) fn build_default_axes(spec: &ChartSpec) -> Vec<ChartAxis> {
    if !chart_type_requires_axes(&spec.chart_type) {
        return Vec::new();
    }

    let cat_id = 111111111u32;
    let val_id = 222222222u32;
    let default_axis = SingleAxisData::default();

    if matches!(
        spec.chart_type,
        DomainChartType::Scatter | DomainChartType::Bubble
    ) {
        return vec![
            build_single_axis_with_ids(&default_axis, AxisType::Value, cat_id, val_id),
            build_single_axis_with_ids(&default_axis, AxisType::Value, val_id, cat_id),
        ];
    }

    vec![
        build_single_axis_with_ids(&default_axis, AxisType::Category, cat_id, val_id),
        build_single_axis_with_ids(&default_axis, AxisType::Value, val_id, cat_id),
    ]
}

pub(super) fn chart_type_requires_axes(chart_type: &DomainChartType) -> bool {
    !matches!(
        chart_type,
        DomainChartType::Pie
            | DomainChartType::Pie3D
            | DomainChartType::Doughnut
            | DomainChartType::OfPie
    )
}

pub(super) fn build_axes_from_ordered(axes_data: &AxisData, ordered_ids: &[u32]) -> Vec<ChartAxis> {
    // Map axis IDs to their axis data by convention:
    // First pair: cat+val, second pair: secondary cat+val, fifth: series axis
    let all: Vec<(u32, Option<&SingleAxisData>, AxisType)> = ordered_ids
        .iter()
        .enumerate()
        .filter_map(|(i, &id)| {
            let (axis_data, axis_type) = match i {
                0 => (axes_data.category_axis.as_ref(), AxisType::Category),
                1 => (axes_data.value_axis.as_ref(), AxisType::Value),
                2 => (
                    axes_data.secondary_category_axis.as_ref(),
                    AxisType::Category,
                ),
                3 => (axes_data.secondary_value_axis.as_ref(), AxisType::Value),
                4 => (axes_data.series_axis.as_ref(), AxisType::Series),
                _ => return None,
            };
            Some((id, axis_data, axis_type))
        })
        .collect();

    // Pair axes for cross_ax
    let ids: Vec<u32> = all.iter().map(|(id, _, _)| *id).collect();
    let default_sad = SingleAxisData::default();
    all.iter()
        .map(|(id, data, axis_type)| {
            // Determine cross axis ID
            let cross_ax = determine_cross_ax(*id, *axis_type, &ids);
            let sad = data.unwrap_or(&default_sad);
            build_single_axis_with_ids(sad, *axis_type, *id, cross_ax)
        })
        .collect()
}

pub(super) fn determine_cross_ax(id: u32, _axis_type: AxisType, ids: &[u32]) -> u32 {
    // Find the partner axis (cat<->val pairing)
    let idx = ids.iter().position(|&i| i == id).unwrap_or(0);
    match idx {
        0 => ids.get(1).copied().unwrap_or(0),
        1 => ids.first().copied().unwrap_or(0),
        2 => ids.get(3).copied().unwrap_or(0),
        3 => ids.get(2).copied().unwrap_or(0),
        4 => ids.first().copied().unwrap_or(0), // series axis crosses cat
        _ => 0,
    }
}

pub(super) fn build_single_axis(
    sad: &SingleAxisData,
    axis_type: AxisType,
    ax_id: u32,
    cross_ax: u32,
) -> ChartAxis {
    build_single_axis_with_ids(sad, axis_type, ax_id, cross_ax)
}

pub(super) fn build_single_axis_with_ids(
    sad: &SingleAxisData,
    axis_type: AxisType,
    ax_id: u32,
    cross_ax: u32,
) -> ChartAxis {
    // Determine axis type from explicit field or use the parameter
    let effective_type = sad
        .axis_type
        .as_deref()
        .map(|s| match s {
            "catAx" | "category" => AxisType::Category,
            "valAx" | "value" => AxisType::Value,
            "dateAx" | "date" => AxisType::Date,
            "serAx" | "series" => AxisType::Series,
            _ => axis_type,
        })
        .unwrap_or(axis_type);

    let scaling = Scaling {
        orientation: if sad.reverse == Some(true) {
            Orientation::MaxMin
        } else {
            Orientation::MinMax
        },
        min: sad.min,
        max: sad.max,
        log_base: sad.log_base,
        ..Default::default()
    };

    let title = sad
        .title
        .as_ref()
        .map(|t| build_title_element(t, sad.title_format.as_ref()));

    let num_fmt = sad.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: Some(false),
    });

    let major_gridlines = sad.grid_lines.and_then(|show| {
        if show {
            Some(ChartLines {
                sp_pr: sad.gridline_format.as_ref().map(|lf| ShapeProperties {
                    ln: Some(build_outline(lf)),
                    ..Default::default()
                }),
            })
        } else {
            None
        }
    });

    let minor_gridlines = sad.minor_grid_lines.and_then(|show| {
        if show {
            Some(ChartLines {
                sp_pr: sad
                    .minor_gridline_format
                    .as_ref()
                    .map(|lf| ShapeProperties {
                        ln: Some(build_outline(lf)),
                        ..Default::default()
                    }),
            })
        } else {
            None
        }
    });

    let major_tick_mark = sad
        .tick_marks
        .as_deref()
        .map(TickMark::from_ooxml)
        .unwrap_or(TickMark::Cross);

    let minor_tick_mark = sad
        .minor_tick_marks
        .as_deref()
        .map(TickMark::from_ooxml)
        .unwrap_or(TickMark::Cross);

    let tick_lbl_pos = sad
        .tick_label_position
        .as_deref()
        .map(TickLabelPosition::from_ooxml)
        .unwrap_or_default();

    let ax_pos = sad
        .position
        .as_deref()
        .map(ChartAxisPosition::from_ooxml)
        .unwrap_or_else(|| match effective_type {
            AxisType::Category | AxisType::Date => ChartAxisPosition::Bottom,
            AxisType::Value => ChartAxisPosition::Left,
            AxisType::Series => ChartAxisPosition::Bottom,
        });

    let cross_between = sad.cross_between.as_deref().map(CrossBetween::from_ooxml);

    let lbl_algn = sad
        .label_alignment
        .as_deref()
        .map(LabelAlignment::from_ooxml);

    let base_time_unit = sad.base_time_unit.as_deref().map(TimeUnit::from_ooxml);
    let major_time_unit = sad.major_time_unit.as_deref().map(TimeUnit::from_ooxml);
    let minor_time_unit = sad.minor_time_unit.as_deref().map(TimeUnit::from_ooxml);

    let sp_pr = sad.format.as_ref().and_then(build_shape_properties);
    let tx_pr = sad.format.as_ref().and_then(build_text_body);

    // Display units
    let disp_units = build_display_units(sad);

    ChartAxis {
        axis_type: effective_type,
        ax_id,
        scaling,
        delete: !sad.visible,
        ax_pos,
        major_gridlines,
        minor_gridlines,
        title,
        num_fmt,
        major_tick_mark,
        minor_tick_mark,
        tick_lbl_pos,
        sp_pr,
        tx_pr,
        cross_ax,
        cross_between,
        major_unit: sad.major_unit,
        minor_unit: sad.minor_unit,
        disp_units,
        lbl_algn,
        lbl_offset: sad.label_offset,
        no_multi_lvl_lbl: sad.no_multi_level_labels,
        base_time_unit,
        major_time_unit,
        minor_time_unit,
        ..Default::default()
    }
}

pub(super) fn build_display_units(sad: &SingleAxisData) -> Option<charts::DisplayUnits> {
    let built_in = sad
        .display_unit
        .as_deref()
        .map(|s| charts::DisplayUnitKind::BuiltIn(charts::BuiltInUnit::from_ooxml(s)));
    let custom = sad.custom_display_unit.map(charts::DisplayUnitKind::Custom);
    let kind = built_in.or(custom);

    if kind.is_none() && sad.display_unit_label.is_none() {
        return None;
    }

    let disp_units_lbl = sad
        .display_unit_label
        .as_ref()
        .map(|text| charts::DisplayUnitsLabel {
            tx: Some(build_chart_text_rich(text, None)),
            ..Default::default()
        });

    Some(charts::DisplayUnits {
        kind,
        disp_units_lbl,
        ..Default::default()
    })
}
