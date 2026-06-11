use super::formatting::{
    extract_chart_format, extract_chart_line, extract_chart_rich_text, extract_title_chart_format,
};
use super::text::{extract_chart_text_string, extract_title_text_from_title};

pub(super) fn extract_axes_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Option<domain_types::chart::AxisData> {
    use ooxml_types::charts::AxisType;

    let plot_area = &cs.chart.plot_area;
    let axes = &plot_area.axes;
    if axes.is_empty() {
        return None;
    }

    // Collect axes by type. The chart-group-aware pass below handles combo
    // charts; these buckets preserve the previous ordered fallback behavior.
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

    let combo_axis_ids = if plot_area.chart_groups.len() > 1 {
        resolve_combo_axis_role_ids(axes, &plot_area.chart_groups)
    } else {
        ComboAxisRoleIds::default()
    };

    // Category axis: first catAx or first dateAx as fallback.
    let fallback_primary_cat = cat_axes
        .first()
        .copied()
        .or_else(|| date_axes.first().copied());
    let primary_cat = combo_axis_ids
        .primary_category
        .and_then(|id| find_category_axis_by_id(axes, id))
        .or(fallback_primary_cat);

    let fallback_secondary_cat = cat_axes.get(1).copied().or_else(|| {
        if cat_axes.is_empty() {
            date_axes.get(1).copied()
        } else {
            date_axes.first().copied()
        }
    });
    let secondary_cat = combo_axis_ids
        .secondary_category
        .and_then(|id| find_category_axis_by_id(axes, id))
        .or(fallback_secondary_cat)
        .filter(|ax| !same_axis(Some(*ax), primary_cat));

    let primary_val = combo_axis_ids
        .primary_value
        .and_then(|id| find_axis_by_id_and_type(axes, id, AxisType::Value))
        .or_else(|| val_axes.first().copied());
    let secondary_val = combo_axis_ids
        .secondary_value
        .and_then(|id| find_axis_by_id_and_type(axes, id, AxisType::Value))
        .or_else(|| {
            val_axes
                .iter()
                .copied()
                .find(|ax| !same_axis(Some(*ax), primary_val))
        });

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

#[derive(Default)]
struct ComboAxisRoleIds {
    primary_category: Option<u32>,
    secondary_category: Option<u32>,
    primary_value: Option<u32>,
    secondary_value: Option<u32>,
}

#[derive(Default)]
struct GroupAxisRoleIds {
    category: Option<u32>,
    value: Option<u32>,
}

fn resolve_combo_axis_role_ids(
    axes: &[ooxml_types::charts::ChartAxis],
    groups: &[ooxml_types::charts::ChartGroup],
) -> ComboAxisRoleIds {
    let mut role_ids = ComboAxisRoleIds::default();

    for group in groups {
        let group_ids = resolve_group_axis_role_ids(axes, group);
        if let Some(id) = group_ids.category {
            record_distinct_axis_id(
                &mut role_ids.primary_category,
                &mut role_ids.secondary_category,
                id,
            );
        }
        if let Some(id) = group_ids.value {
            record_distinct_axis_id(
                &mut role_ids.primary_value,
                &mut role_ids.secondary_value,
                id,
            );
        }
    }

    (role_ids.primary_category, role_ids.secondary_category) = normalize_axis_role_ids_by_position(
        axes,
        role_ids.primary_category,
        role_ids.secondary_category,
    );
    (role_ids.primary_value, role_ids.secondary_value) =
        normalize_axis_role_ids_by_position(axes, role_ids.primary_value, role_ids.secondary_value);

    role_ids
}

pub(super) fn resolve_group_y_axis_index(
    axes: &[ooxml_types::charts::ChartAxis],
    groups: &[ooxml_types::charts::ChartGroup],
    group: &ooxml_types::charts::ChartGroup,
) -> Option<u8> {
    if groups.len() <= 1 {
        return None;
    }

    let group_value_id = resolve_group_axis_role_ids(axes, group).value?;
    let role_ids = resolve_combo_axis_role_ids(axes, groups);

    if Some(group_value_id) == role_ids.secondary_value {
        Some(1)
    } else if Some(group_value_id) == role_ids.primary_value {
        Some(0)
    } else {
        None
    }
}

fn resolve_group_axis_role_ids(
    axes: &[ooxml_types::charts::ChartAxis],
    group: &ooxml_types::charts::ChartGroup,
) -> GroupAxisRoleIds {
    use ooxml_types::charts::AxisType;

    let mut category_ids = Vec::new();
    let mut value_ids = Vec::new();

    for id in &group.ax_id {
        let Some(axis) = find_axis_by_id(axes, *id) else {
            continue;
        };

        match axis.axis_type {
            AxisType::Category | AxisType::Date => category_ids.push(*id),
            AxisType::Value => value_ids.push(*id),
            AxisType::Series => {}
        }
    }

    GroupAxisRoleIds {
        category: category_ids.first().copied(),
        // OOXML chart type groups list the category/X axis before the value/Y
        // axis. For scatter/bubble both are valAx, so the final value axis is
        // still the Y axis binding that a later yAxisIndex mapper needs.
        value: value_ids.last().copied(),
    }
}

fn record_distinct_axis_id(primary: &mut Option<u32>, secondary: &mut Option<u32>, id: u32) {
    if *primary == Some(id) || *secondary == Some(id) {
        return;
    }
    if primary.is_none() {
        *primary = Some(id);
    } else if secondary.is_none() {
        *secondary = Some(id);
    }
}

fn normalize_axis_role_ids_by_position(
    axes: &[ooxml_types::charts::ChartAxis],
    primary: Option<u32>,
    secondary: Option<u32>,
) -> (Option<u32>, Option<u32>) {
    let (Some(primary_id), Some(secondary_id)) = (primary, secondary) else {
        return (primary, secondary);
    };

    let Some(primary_axis) = find_axis_by_id(axes, primary_id) else {
        return (primary, secondary);
    };
    let Some(secondary_axis) = find_axis_by_id(axes, secondary_id) else {
        return (primary, secondary);
    };

    if is_secondary_axis_position(primary_axis.ax_pos)
        && is_primary_axis_position(secondary_axis.ax_pos)
    {
        (secondary, primary)
    } else {
        (primary, secondary)
    }
}

fn is_primary_axis_position(position: ooxml_types::charts::ChartAxisPosition) -> bool {
    use ooxml_types::charts::ChartAxisPosition;
    matches!(
        position,
        ChartAxisPosition::Bottom | ChartAxisPosition::Left
    )
}

fn is_secondary_axis_position(position: ooxml_types::charts::ChartAxisPosition) -> bool {
    use ooxml_types::charts::ChartAxisPosition;
    matches!(position, ChartAxisPosition::Top | ChartAxisPosition::Right)
}

fn find_axis_by_id(
    axes: &[ooxml_types::charts::ChartAxis],
    id: u32,
) -> Option<&ooxml_types::charts::ChartAxis> {
    axes.iter().find(|axis| axis.ax_id == id)
}

fn find_axis_by_id_and_type(
    axes: &[ooxml_types::charts::ChartAxis],
    id: u32,
    axis_type: ooxml_types::charts::AxisType,
) -> Option<&ooxml_types::charts::ChartAxis> {
    axes.iter()
        .find(|axis| axis.ax_id == id && axis.axis_type == axis_type)
}

fn find_category_axis_by_id(
    axes: &[ooxml_types::charts::ChartAxis],
    id: u32,
) -> Option<&ooxml_types::charts::ChartAxis> {
    use ooxml_types::charts::AxisType;

    axes.iter().find(|axis| {
        axis.ax_id == id && matches!(axis.axis_type, AxisType::Category | AxisType::Date)
    })
}

fn same_axis(
    a: Option<&ooxml_types::charts::ChartAxis>,
    b: Option<&ooxml_types::charts::ChartAxis>,
) -> bool {
    matches!((a, b), (Some(a), Some(b)) if a.ax_id == b.ax_id && a.axis_type == b.axis_type)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::charts::{
        AxisCrosses, AxisType, BarChartConfig, Chart, ChartAxis, ChartAxisPosition, ChartGroup,
        ChartSpace, ChartText, ChartType, ChartTypeConfig, CrossBetween, DisplayUnitKind,
        DisplayUnits, DisplayUnitsLabel, LineChartConfig, ManualLayout, NumFmt, PlotArea, Scaling,
        TickLabelPosition, TickMark,
    };
    use ooxml_types::drawings::{StAngle, TextBody, TextBodyProperties};

    fn axis(
        axis_type: AxisType,
        ax_id: u32,
        cross_ax: u32,
        ax_pos: ChartAxisPosition,
        min: f64,
    ) -> ChartAxis {
        ChartAxis {
            axis_type,
            ax_id,
            cross_ax,
            ax_pos,
            scaling: Scaling {
                min: Some(min),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn group(chart_type: ChartType, config: ChartTypeConfig, ax_id: Vec<u32>) -> ChartGroup {
        ChartGroup {
            chart_type,
            config,
            series: Vec::new(),
            d_lbls: None,
            ax_id,
            raw_chart_type_attr: None,
            raw_chart_element_name: None,
            raw_chart_group_xml: None,
        }
    }

    #[test]
    fn extraction_projects_explicit_axis_defaults_into_domain_model() {
        let cs = ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    axes: vec![ChartAxis {
                        axis_type: AxisType::Category,
                        ax_id: 10,
                        cross_ax: 20,
                        ax_pos: ChartAxisPosition::Bottom,
                        delete: false,
                        delete_explicit: true,
                        major_tick_mark: TickMark::Cross,
                        major_tick_mark_explicit: true,
                        minor_tick_mark: TickMark::Cross,
                        minor_tick_mark_explicit: true,
                        tick_lbl_pos: TickLabelPosition::NextTo,
                        tick_lbl_pos_explicit: true,
                        crosses: AxisCrosses::AutoZero,
                        crosses_explicit: true,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let axes = extract_axes_from_chart_space(&cs).expect("axes");
        let category = axes.category_axis.expect("category axis");

        assert!(category.visible);
        assert!(category.visible_explicit);
        assert_eq!(category.tick_marks.as_deref(), Some("cross"));
        assert_eq!(category.minor_tick_marks.as_deref(), Some("cross"));
        assert_eq!(category.tick_label_position.as_deref(), Some("nextTo"));
        assert_eq!(category.crosses_at.as_deref(), Some("automatic"));
    }

    #[test]
    fn extraction_preserves_omitted_axis_defaults_as_domain_none() {
        let cs = ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    axes: vec![ChartAxis {
                        axis_type: AxisType::Category,
                        ax_id: 10,
                        cross_ax: 20,
                        ax_pos: ChartAxisPosition::Bottom,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let axes = extract_axes_from_chart_space(&cs).expect("axes");
        let category = axes.category_axis.expect("category axis");

        assert!(category.visible);
        assert!(!category.visible_explicit);
        assert_eq!(category.tick_marks, None);
        assert_eq!(category.minor_tick_marks, None);
        assert_eq!(category.tick_label_position, None);
        assert_eq!(category.crosses_at, None);
    }

    #[test]
    fn combo_axes_use_chart_group_axis_ids_not_axis_encounter_order() {
        let cs = ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    chart_groups: vec![
                        group(
                            ChartType::Bar,
                            ChartTypeConfig::Bar(BarChartConfig::default()),
                            vec![10, 30],
                        ),
                        group(
                            ChartType::Line,
                            ChartTypeConfig::Line(LineChartConfig::default()),
                            vec![10, 20],
                        ),
                    ],
                    axes: vec![
                        axis(AxisType::Category, 10, 30, ChartAxisPosition::Bottom, 1.0),
                        axis(AxisType::Value, 20, 10, ChartAxisPosition::Right, 20.0),
                        axis(AxisType::Value, 30, 10, ChartAxisPosition::Left, 30.0),
                    ],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let axes = extract_axes_from_chart_space(&cs).expect("axes");

        assert_eq!(
            axes.category_axis.as_ref().and_then(|axis| axis.min),
            Some(1.0)
        );
        assert!(axes.secondary_category_axis.is_none());
        assert_eq!(
            axes.value_axis.as_ref().and_then(|axis| axis.min),
            Some(30.0)
        );
        assert_eq!(
            axes.secondary_value_axis.as_ref().and_then(|axis| axis.min),
            Some(20.0)
        );
    }

    #[test]
    fn combo_axis_roles_are_normalized_by_axis_position() {
        let cs = ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    chart_groups: vec![
                        group(
                            ChartType::Line,
                            ChartTypeConfig::Line(LineChartConfig::default()),
                            vec![10, 20],
                        ),
                        group(
                            ChartType::Bar,
                            ChartTypeConfig::Bar(BarChartConfig::default()),
                            vec![10, 30],
                        ),
                    ],
                    axes: vec![
                        axis(AxisType::Category, 10, 30, ChartAxisPosition::Bottom, 1.0),
                        axis(AxisType::Value, 20, 10, ChartAxisPosition::Right, 20.0),
                        axis(AxisType::Value, 30, 10, ChartAxisPosition::Left, 30.0),
                    ],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let axes = extract_axes_from_chart_space(&cs).expect("axes");

        assert_eq!(
            axes.value_axis.as_ref().and_then(|axis| axis.min),
            Some(30.0)
        );
        assert_eq!(
            axes.secondary_value_axis.as_ref().and_then(|axis| axis.min),
            Some(20.0)
        );
    }

    #[test]
    fn extraction_projects_axis_render_contract_fields() {
        let cs = ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    axes: vec![
                        ChartAxis {
                            axis_type: AxisType::Category,
                            ax_id: 10,
                            cross_ax: 20,
                            ax_pos: ChartAxisPosition::Bottom,
                            crosses: AxisCrosses::Min,
                            tick_lbl_skip: Some(2),
                            tick_mark_skip: Some(3),
                            ..Default::default()
                        },
                        ChartAxis {
                            axis_type: AxisType::Value,
                            ax_id: 20,
                            cross_ax: 10,
                            ax_pos: ChartAxisPosition::Left,
                            scaling: Scaling {
                                log_base: Some(10.0),
                                ..Default::default()
                            },
                            crosses: AxisCrosses::Max,
                            crosses_at: Some(7.5),
                            num_fmt: Some(NumFmt {
                                format_code: "$#,##0".to_string(),
                                source_linked: Some(true),
                            }),
                            disp_units: Some(DisplayUnits {
                                kind: Some(DisplayUnitKind::Custom(2500.0)),
                                disp_units_lbl: Some(DisplayUnitsLabel {
                                    layout: Some(ManualLayout {
                                        x: Some(0.25),
                                        ..Default::default()
                                    }),
                                    tx: Some(ChartText::Rich(TextBody::default())),
                                    tx_pr: Some(TextBody {
                                        body_props: TextBodyProperties {
                                            rot: Some(StAngle::new(5400000)),
                                            ..Default::default()
                                        },
                                        ..Default::default()
                                    }),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            }),
                            cross_between: Some(CrossBetween::MidCat),
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let axes = extract_axes_from_chart_space(&cs).expect("axes");
        let category = axes.category_axis.expect("category axis");
        let value = axes.value_axis.expect("value axis");

        assert_eq!(category.crosses_at.as_deref(), Some("min"));
        assert_eq!(category.tick_label_spacing, Some(2));
        assert_eq!(category.tick_mark_spacing, Some(3));

        assert_eq!(value.crosses_at.as_deref(), Some("custom"));
        assert_eq!(value.crosses_at_value, Some(7.5));
        assert_eq!(value.link_number_format, Some(true));
        assert_eq!(value.scale_type.as_deref(), Some("logarithmic"));
        assert_eq!(value.cross_between.as_deref(), Some("midCat"));
        assert_eq!(value.is_between_categories, Some(false));
        assert_eq!(value.custom_display_unit, Some(2500.0));
        assert_eq!(
            value
                .display_unit_label_layout
                .as_ref()
                .and_then(|layout| layout.x),
            Some(0.25),
        );
        assert_eq!(
            value
                .display_unit_label_format
                .as_ref()
                .and_then(|format| format.text_rotation),
            Some(90.0),
        );
    }

    #[test]
    fn extraction_preserves_horizontal_axis_label_rotation() {
        let cs = ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    axes: vec![
                        ChartAxis {
                            axis_type: AxisType::Category,
                            ax_id: 10,
                            cross_ax: 20,
                            ax_pos: ChartAxisPosition::Bottom,
                            tx_pr: Some(TextBody {
                                body_props: TextBodyProperties {
                                    rot: Some(StAngle::new(-2700000)),
                                    vert: Some(ooxml_types::drawings::TextVerticalType::Horizontal),
                                    ..Default::default()
                                },
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        ChartAxis {
                            axis_type: AxisType::Value,
                            ax_id: 20,
                            cross_ax: 10,
                            ax_pos: ChartAxisPosition::Left,
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let axes = extract_axes_from_chart_space(&cs).expect("axes");
        let category = axes.category_axis.expect("category axis");
        let format = category.format.expect("category axis format");

        assert_eq!(format.text_rotation, Some(-45.0));
        assert_eq!(
            format.text_vertical_type,
            Some(domain_types::chart::ChartTextVerticalType::Horizontal)
        );
        assert_eq!(category.text_orientation, None);
    }

    #[test]
    fn secondary_date_axis_is_projected_as_secondary_category_axis() {
        let cs = ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    axes: vec![
                        axis(AxisType::Date, 10, 20, ChartAxisPosition::Bottom, 1.0),
                        axis(AxisType::Value, 20, 10, ChartAxisPosition::Left, 20.0),
                        axis(AxisType::Date, 30, 20, ChartAxisPosition::Top, 30.0),
                    ],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let axes = extract_axes_from_chart_space(&cs).expect("axes");

        assert_eq!(
            axes.category_axis.as_ref().and_then(|axis| axis.min),
            Some(1.0)
        );
        assert_eq!(
            axes.secondary_category_axis
                .as_ref()
                .and_then(|axis| axis.min),
            Some(30.0)
        );
    }
}

/// Extract a single axis to SingleAxisData.
fn extract_single_axis(ax: &ooxml_types::charts::ChartAxis) -> domain_types::chart::SingleAxisData {
    use ooxml_types::charts::{AxisCrosses, CrossBetween, DisplayUnitKind, Orientation, TickMark};

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
        TickMark::Cross if !ax.major_tick_mark_explicit => None, // default
        other => Some(other.to_ooxml().to_string()),
    };
    let minor_tick_marks = match ax.minor_tick_mark {
        TickMark::Cross if !ax.minor_tick_mark_explicit => None,
        other => Some(other.to_ooxml().to_string()),
    };

    let number_format = ax.num_fmt.as_ref().map(|nf| nf.format_code.clone());
    let link_number_format = ax.num_fmt.as_ref().and_then(|nf| nf.source_linked);

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
    let (
        display_unit,
        custom_display_unit,
        display_unit_label,
        display_unit_label_layout,
        display_unit_label_format,
    ) = ax
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
            let label_layout = du
                .disp_units_lbl
                .as_ref()
                .and_then(|lbl| lbl.layout.as_ref())
                .map(Into::into);
            let label_format = du
                .disp_units_lbl
                .as_ref()
                .and_then(|lbl| extract_chart_format(lbl.sp_pr.as_ref(), lbl.tx_pr.as_ref()));
            (bu, cu, label, label_layout, label_format)
        })
        .unwrap_or((None, None, None, None, None));

    // Formatting
    let format = extract_chart_format(ax.sp_pr.as_ref(), ax.tx_pr.as_ref());
    let title_format = ax.title.as_ref().and_then(extract_title_chart_format);
    let title_rich_text = ax
        .title
        .as_ref()
        .and_then(|title| match title.tx.as_ref()? {
            ooxml_types::charts::ChartText::Rich(body) => extract_chart_rich_text(body),
            ooxml_types::charts::ChartText::StrRef(_) => None,
        });
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
    let is_between_categories = ax.cross_between.map(|cb| match cb {
        CrossBetween::Between => true,
        CrossBetween::MidCat => false,
    });

    let (crosses_at, crosses_at_value) = if let Some(value) = ax.crosses_at {
        (Some("custom".to_string()), Some(value))
    } else if ax.crosses_explicit || ax.crosses != AxisCrosses::AutoZero {
        let crosses = match ax.crosses {
            AxisCrosses::AutoZero => "automatic",
            AxisCrosses::Min => "min",
            AxisCrosses::Max => "max",
        };
        (Some(crosses.to_string()), None)
    } else {
        (None, None)
    };

    let scale_type = log_base
        .filter(|base| base.is_finite() && *base > 1.0)
        .map(|_| "logarithmic".to_string());

    // Tick label position
    let tick_label_position = {
        let tlp = ax.tick_lbl_pos;
        match tlp {
            ooxml_types::charts::TickLabelPosition::NextTo if !ax.tick_lbl_pos_explicit => None,
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
        visible_explicit: ax.delete_explicit,
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
        title_rich_text,
        gridline_format,
        minor_gridline_format,
        cross_between,
        tick_label_position,
        base_time_unit,
        major_time_unit,
        minor_time_unit,
        custom_display_unit,
        display_unit_label,
        display_unit_label_layout,
        display_unit_label_format,
        label_alignment,
        label_offset,
        no_multi_level_labels,
        tick_label_spacing: ax.tick_lbl_skip,
        tick_mark_spacing: ax.tick_mark_skip,
        link_number_format,
        scale_type,
        crosses_at,
        crosses_at_value,
        is_between_categories,
        ..Default::default()
    }
}

// Extract scalar chart-level fields from the first chart group's config.
// Returns (gap_width, overlap, doughnut_hole_size, first_slice_angle, bubble_scale, split_type, split_value).
