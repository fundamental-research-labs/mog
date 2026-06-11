use domain_types::{
    ChartDefinition,
    chart::{AxisData, ChartSpec, ChartType as DomainChartType, SingleAxisData},
};
use ooxml_types::charts::{
    self, AxisCrosses, AxisType, ChartAxis, ChartAxisPosition, ChartLines, CrossBetween,
    LabelAlignment, NumFmt, Orientation, Scaling, TickLabelPosition, TickMark, TimeUnit,
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
        let original_axes = &chart_space.chart.plot_area.axes;
        if !original_axes.is_empty() {
            return build_axes_from_original(axes_data, original_axes);
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
    if modeled_series_needs_secondary_axis(spec) {
        let default_axis = default_visible_axis();
        if axes_data.secondary_category_axis.is_none() {
            let axis_type = if matches!(
                spec.chart_type,
                DomainChartType::Scatter | DomainChartType::Bubble
            ) {
                AxisType::Value
            } else {
                AxisType::Category
            };
            axes.push(build_single_axis_with_ids(
                &default_axis,
                axis_type,
                333333333,
                444444444,
            ));
        }
        if axes_data.secondary_value_axis.is_none() {
            axes.push(build_single_axis_with_ids(
                &default_axis,
                AxisType::Value,
                444444444,
                333333333,
            ));
        }
    }

    axes
}

pub(super) fn build_default_axes(spec: &ChartSpec) -> Vec<ChartAxis> {
    if !chart_type_requires_axes(&spec.chart_type) {
        return Vec::new();
    }

    let cat_id = 111111111u32;
    let val_id = 222222222u32;
    let default_axis = default_visible_axis();

    if matches!(
        spec.chart_type,
        DomainChartType::Scatter | DomainChartType::Bubble
    ) {
        let mut axes = vec![
            build_single_axis_with_ids(&default_axis, AxisType::Value, cat_id, val_id),
            build_single_axis_with_ids(&default_axis, AxisType::Value, val_id, cat_id),
        ];
        if modeled_series_needs_secondary_axis(spec) {
            axes.push(build_single_axis_with_ids(
                &default_axis,
                AxisType::Value,
                333333333,
                444444444,
            ));
            axes.push(build_single_axis_with_ids(
                &default_axis,
                AxisType::Value,
                444444444,
                333333333,
            ));
        }
        return axes;
    }

    let mut axes = vec![
        build_single_axis_with_ids(&default_axis, AxisType::Category, cat_id, val_id),
        build_single_axis_with_ids(&default_axis, AxisType::Value, val_id, cat_id),
    ];
    if modeled_series_needs_secondary_axis(spec) {
        axes.push(build_single_axis_with_ids(
            &default_axis,
            AxisType::Category,
            333333333,
            444444444,
        ));
        axes.push(build_single_axis_with_ids(
            &default_axis,
            AxisType::Value,
            444444444,
            333333333,
        ));
    }

    axes
}

fn default_visible_axis() -> SingleAxisData {
    SingleAxisData {
        visible: true,
        ..Default::default()
    }
}

fn modeled_series_needs_secondary_axis(spec: &ChartSpec) -> bool {
    spec.series
        .iter()
        .any(|series| series.y_axis_index == Some(1))
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

pub(super) fn build_axes_from_original(
    axes_data: &AxisData,
    original_axes: &[ChartAxis],
) -> Vec<ChartAxis> {
    let role_ids = original_axis_role_ids(original_axes);
    let default_sad = default_visible_axis();

    original_axes
        .iter()
        .map(|axis| {
            let sad = single_axis_data_for_original_axis(axes_data, &role_ids, axis)
                .unwrap_or(&default_sad);
            let cross_ax = if axis.cross_ax != 0 {
                axis.cross_ax
            } else {
                determine_cross_ax(
                    axis.ax_id,
                    axis.axis_type,
                    &original_axes
                        .iter()
                        .map(|original| original.ax_id)
                        .collect::<Vec<_>>(),
                )
            };
            let mut rebuilt = build_single_axis_with_ids(sad, axis.axis_type, axis.ax_id, cross_ax);
            apply_imported_axis_fidelity(&mut rebuilt, axis, sad);
            rebuilt
        })
        .collect()
}

fn apply_imported_axis_fidelity(
    rebuilt: &mut ChartAxis,
    original: &ChartAxis,
    sad: &SingleAxisData,
) {
    rebuilt.delete_explicit = sad.visible_explicit || !sad.visible;
    rebuilt.major_tick_mark_explicit = sad.tick_marks.is_some();
    rebuilt.minor_tick_mark_explicit = sad.minor_tick_marks.is_some();
    rebuilt.tick_lbl_pos_explicit = sad.tick_label_position.is_some();
    rebuilt.crosses_explicit =
        matches!(sad.crosses_at.as_deref(), Some("min" | "max" | "automatic"));
    rebuilt.raw_axis_type_attr = original.raw_axis_type_attr.clone();
}

#[derive(Default)]
struct OriginalAxisRoleIds {
    category: Option<u32>,
    secondary_category: Option<u32>,
    value: Option<u32>,
    secondary_value: Option<u32>,
    series: Option<u32>,
}

fn original_axis_role_ids(original_axes: &[ChartAxis]) -> OriginalAxisRoleIds {
    let mut roles = OriginalAxisRoleIds::default();
    let category_axes: Vec<&ChartAxis> = original_axes
        .iter()
        .filter(|axis| matches!(axis.axis_type, AxisType::Category | AxisType::Date))
        .collect();
    let value_axes: Vec<&ChartAxis> = original_axes
        .iter()
        .filter(|axis| axis.axis_type == AxisType::Value)
        .collect();

    roles.category = category_axes
        .iter()
        .find(|axis| is_primary_axis_position(axis.ax_pos))
        .or_else(|| category_axes.first())
        .map(|axis| axis.ax_id);
    roles.secondary_category = category_axes
        .iter()
        .find(|axis| Some(axis.ax_id) != roles.category && is_secondary_axis_position(axis.ax_pos))
        .or_else(|| {
            category_axes
                .iter()
                .find(|axis| Some(axis.ax_id) != roles.category)
        })
        .map(|axis| axis.ax_id);

    let has_horizontal_value_axis = value_axes.iter().any(|axis| {
        matches!(
            axis.ax_pos,
            ChartAxisPosition::Bottom | ChartAxisPosition::Top
        )
    });
    if has_horizontal_value_axis {
        roles.value = value_axes.first().map(|axis| axis.ax_id);
        roles.secondary_value = value_axes
            .iter()
            .find(|axis| Some(axis.ax_id) != roles.value)
            .map(|axis| axis.ax_id);
    } else {
        roles.value = value_axes
            .iter()
            .find(|axis| is_primary_axis_position(axis.ax_pos))
            .or_else(|| value_axes.first())
            .map(|axis| axis.ax_id);
        roles.secondary_value = value_axes
            .iter()
            .find(|axis| Some(axis.ax_id) != roles.value && is_secondary_axis_position(axis.ax_pos))
            .or_else(|| {
                value_axes
                    .iter()
                    .find(|axis| Some(axis.ax_id) != roles.value)
            })
            .map(|axis| axis.ax_id);
    }

    roles.series = original_axes
        .iter()
        .find(|axis| axis.axis_type == AxisType::Series)
        .map(|axis| axis.ax_id);
    roles
}

fn single_axis_data_for_original_axis<'a>(
    axes_data: &'a AxisData,
    role_ids: &OriginalAxisRoleIds,
    axis: &ChartAxis,
) -> Option<&'a SingleAxisData> {
    if Some(axis.ax_id) == role_ids.category {
        return axes_data.category_axis.as_ref();
    }
    if Some(axis.ax_id) == role_ids.secondary_category {
        return axes_data.secondary_category_axis.as_ref();
    }
    if Some(axis.ax_id) == role_ids.value {
        return axes_data.value_axis.as_ref();
    }
    if Some(axis.ax_id) == role_ids.secondary_value {
        return axes_data.secondary_value_axis.as_ref();
    }
    if Some(axis.ax_id) == role_ids.series {
        return axes_data.series_axis.as_ref();
    }
    None
}

fn is_primary_axis_position(position: ChartAxisPosition) -> bool {
    matches!(
        position,
        ChartAxisPosition::Bottom | ChartAxisPosition::Left
    )
}

fn is_secondary_axis_position(position: ChartAxisPosition) -> bool {
    matches!(position, ChartAxisPosition::Top | ChartAxisPosition::Right)
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
    let default_axis;
    let sad = if sad == &SingleAxisData::default() {
        default_axis = default_visible_axis();
        &default_axis
    } else {
        sad
    };

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

    let log_base = sad
        .log_base
        .or_else(|| matches!(sad.scale_type.as_deref(), Some("logarithmic")).then_some(10.0));

    let scaling = Scaling {
        orientation: if sad.reverse == Some(true) {
            Orientation::MaxMin
        } else {
            Orientation::MinMax
        },
        min: sad.min,
        max: sad.max,
        log_base,
        ..Default::default()
    };

    let title = sad
        .title
        .as_ref()
        .map(|t| build_title_element(t, sad.title_format.as_ref(), None));

    let num_fmt = sad.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: sad.link_number_format,
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

    let (crosses, crosses_at) = reconstruct_crossing(sad);

    let sp_pr = sad.format.as_ref().and_then(build_shape_properties);
    let tx_pr = sad.format.as_ref().and_then(build_text_body);

    // Display units
    let disp_units = build_display_units(sad);

    ChartAxis {
        axis_type: effective_type,
        ax_id,
        scaling,
        delete: !sad.visible,
        delete_explicit: true,
        ax_pos,
        major_gridlines,
        minor_gridlines,
        title,
        num_fmt,
        major_tick_mark,
        major_tick_mark_explicit: true,
        minor_tick_mark,
        minor_tick_mark_explicit: true,
        tick_lbl_pos,
        tick_lbl_pos_explicit: true,
        sp_pr,
        tx_pr,
        cross_ax,
        crosses,
        crosses_explicit: true,
        crosses_at,
        cross_between,
        tick_lbl_skip: sad.tick_label_spacing,
        tick_mark_skip: sad.tick_mark_spacing,
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

fn reconstruct_crossing(sad: &SingleAxisData) -> (AxisCrosses, Option<f64>) {
    match sad.crosses_at.as_deref() {
        Some("custom") => (AxisCrosses::AutoZero, sad.crosses_at_value),
        Some("min") => (AxisCrosses::Min, None),
        Some("max") => (AxisCrosses::Max, None),
        Some("automatic") | None => {
            if sad.crosses_at_value.is_some() {
                (AxisCrosses::AutoZero, sad.crosses_at_value)
            } else {
                (AxisCrosses::AutoZero, None)
            }
        }
        Some(_) => (AxisCrosses::AutoZero, None),
    }
}

pub(super) fn build_display_units(sad: &SingleAxisData) -> Option<charts::DisplayUnits> {
    let built_in = sad
        .display_unit
        .as_deref()
        .map(|s| charts::DisplayUnitKind::BuiltIn(charts::BuiltInUnit::from_ooxml(s)));
    let custom = sad.custom_display_unit.map(charts::DisplayUnitKind::Custom);
    let kind = built_in.or(custom);

    if kind.is_none()
        && sad.display_unit_label.is_none()
        && sad.display_unit_label_layout.is_none()
        && sad.display_unit_label_format.is_none()
    {
        return None;
    }

    let disp_units_lbl = if sad.display_unit_label.is_some()
        || sad.display_unit_label_layout.is_some()
        || sad.display_unit_label_format.is_some()
    {
        let tx = sad
            .display_unit_label
            .as_ref()
            .map(|text| build_chart_text_rich(text, None));
        let layout = sad
            .display_unit_label_layout
            .as_ref()
            .map(|layout| layout.clone().into());
        let sp_pr = sad
            .display_unit_label_format
            .as_ref()
            .and_then(build_shape_properties);
        let tx_pr = sad
            .display_unit_label_format
            .as_ref()
            .and_then(build_text_body);
        Some(charts::DisplayUnitsLabel {
            layout,
            tx,
            sp_pr,
            tx_pr,
        })
    } else {
        None
    };

    Some(charts::DisplayUnits {
        kind,
        disp_units_lbl,
        ..Default::default()
    })
}
