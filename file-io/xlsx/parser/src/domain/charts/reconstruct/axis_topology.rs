use domain_types::chart::ChartSpec;
use ooxml_types::charts::{AxisType, ChartAxis, ChartAxisPosition, ChartGroup, ChartType};

/// Repair chart-group axis references after groups and axes have been rebuilt
/// independently. Modeled fallback groups historically used synthetic IDs,
/// while imported axis definitions retained their authored IDs. That leaves a
/// standard chart with `<c:axId>` values that do not name any axis in the
/// plot area. Preserve a fully valid imported topology; derive only groups
/// whose references are missing from the actual axis definitions.
pub(super) fn reconcile_chart_group_axis_ids(
    groups: &mut [ChartGroup],
    axes: &[ChartAxis],
    spec: &ChartSpec,
) {
    if axes.is_empty() {
        return;
    }

    let topology = AxisTopology::from_axes(axes);
    for group in groups {
        if group.raw_chart_element_name.is_some() {
            continue;
        }

        let all_ids_are_defined = !group.ax_id.is_empty()
            && group
                .ax_id
                .iter()
                .all(|id| axes.iter().any(|axis| axis.ax_id == *id));
        let uses_secondary_axis = group_uses_secondary_axis(group, spec);
        if all_ids_are_defined {
            continue;
        }

        let expected = topology.axis_ids_for_group(group.chart_type, uses_secondary_axis);
        if expected.is_empty() {
            if is_axisless_chart_type(group.chart_type) {
                group.ax_id.clear();
            }
            continue;
        }
        if expected.len() < 2 {
            continue;
        }
        if expected
            .iter()
            .all(|id| axes.iter().any(|axis| axis.ax_id == *id))
        {
            group.ax_id = expected;
        }
    }
}

#[derive(Default)]
struct AxisTopology {
    primary_horizontal: Option<u32>,
    secondary_horizontal: Option<u32>,
    primary_vertical: Option<u32>,
    secondary_vertical: Option<u32>,
    primary_category: Option<u32>,
    secondary_category: Option<u32>,
    primary_value: Option<u32>,
    secondary_value: Option<u32>,
    series: Option<u32>,
}

impl AxisTopology {
    fn from_axes(axes: &[ChartAxis]) -> Self {
        let category_axes: Vec<_> = axes
            .iter()
            .filter(|axis| matches!(axis.axis_type, AxisType::Category | AxisType::Date))
            .collect();
        let value_axes: Vec<_> = axes
            .iter()
            .filter(|axis| axis.axis_type == AxisType::Value)
            .collect();

        let primary_category = preferred_axis_id(&category_axes, false);
        let secondary_category =
            preferred_axis_id_excluding(&category_axes, primary_category, true);
        let primary_value = primary_category
            .and_then(|id| crossing_axis_id(&value_axes, id, None))
            .or_else(|| preferred_axis_id(&value_axes, false));
        let secondary_value = secondary_category
            .and_then(|id| crossing_axis_id(&value_axes, id, primary_value))
            .or_else(|| preferred_axis_id_excluding(&value_axes, primary_value, true));

        let primary_horizontal = axis_at_position(&value_axes, ChartAxisPosition::Bottom, None)
            .or_else(|| value_axes.first().map(|axis| axis.ax_id));
        let secondary_horizontal =
            axis_at_position(&value_axes, ChartAxisPosition::Top, primary_horizontal);
        let primary_vertical =
            axis_at_position(&value_axes, ChartAxisPosition::Left, primary_horizontal)
                .or_else(|| {
                    primary_horizontal.and_then(|id| crossing_axis_id(&value_axes, id, None))
                })
                .or_else(|| preferred_axis_id_excluding(&value_axes, primary_horizontal, false))
                .or(primary_value);
        let secondary_vertical =
            axis_at_position(&value_axes, ChartAxisPosition::Right, primary_vertical).or_else(
                || {
                    secondary_horizontal
                        .and_then(|id| crossing_axis_id(&value_axes, id, primary_vertical))
                },
            );

        Self {
            primary_horizontal,
            secondary_horizontal,
            primary_vertical,
            secondary_vertical,
            primary_category,
            secondary_category,
            primary_value,
            secondary_value,
            series: axes
                .iter()
                .find(|axis| axis.axis_type == AxisType::Series)
                .map(|axis| axis.ax_id),
        }
    }

    fn axis_ids_for_group(&self, chart_type: ChartType, uses_secondary_axis: bool) -> Vec<u32> {
        if is_axisless_chart_type(chart_type) {
            return Vec::new();
        }

        if matches!(chart_type, ChartType::Scatter | ChartType::Bubble) {
            let horizontal = if uses_secondary_axis {
                self.secondary_horizontal.or(self.primary_horizontal)
            } else {
                self.primary_horizontal
            };
            let vertical = if uses_secondary_axis {
                self.secondary_vertical.or(self.primary_vertical)
            } else {
                self.primary_vertical
            };
            return [horizontal, vertical].into_iter().flatten().collect();
        }

        let category = if uses_secondary_axis {
            self.secondary_category.or(self.primary_category)
        } else {
            self.primary_category
        };
        let value = if uses_secondary_axis {
            self.secondary_value.or(self.primary_value)
        } else {
            self.primary_value
        };
        let mut ids: Vec<u32> = [category, value].into_iter().flatten().collect();
        if supports_series_axis(chart_type) {
            if let Some(series) = self.series {
                ids.push(series);
            }
        }
        ids
    }
}

fn preferred_axis_id(axes: &[&ChartAxis], secondary: bool) -> Option<u32> {
    axes.iter()
        .find(|axis| {
            if secondary {
                is_secondary_axis_position(axis.ax_pos)
            } else {
                is_primary_axis_position(axis.ax_pos)
            }
        })
        .or_else(|| axes.first())
        .map(|axis| axis.ax_id)
}

fn preferred_axis_id_excluding(
    axes: &[&ChartAxis],
    excluded: Option<u32>,
    secondary: bool,
) -> Option<u32> {
    axes.iter()
        .find(|axis| {
            Some(axis.ax_id) != excluded
                && if secondary {
                    is_secondary_axis_position(axis.ax_pos)
                } else {
                    is_primary_axis_position(axis.ax_pos)
                }
        })
        .or_else(|| axes.iter().find(|axis| Some(axis.ax_id) != excluded))
        .map(|axis| axis.ax_id)
}

fn axis_at_position(
    axes: &[&ChartAxis],
    position: ChartAxisPosition,
    excluded: Option<u32>,
) -> Option<u32> {
    axes.iter()
        .find(|axis| Some(axis.ax_id) != excluded && axis.ax_pos == position)
        .map(|axis| axis.ax_id)
}

fn crossing_axis_id(axes: &[&ChartAxis], crossed_id: u32, excluded: Option<u32>) -> Option<u32> {
    axes.iter()
        .find(|axis| Some(axis.ax_id) != excluded && axis.cross_ax == crossed_id)
        .map(|axis| axis.ax_id)
}

fn group_uses_secondary_axis(group: &ChartGroup, spec: &ChartSpec) -> bool {
    group.series.iter().any(|series| {
        spec.series
            .iter()
            .find(|candidate| candidate.idx == Some(series.idx))
            .is_some_and(|series| series.y_axis_index == Some(1))
    })
}

fn supports_series_axis(chart_type: ChartType) -> bool {
    matches!(
        chart_type,
        ChartType::Bar3D
            | ChartType::Line3D
            | ChartType::Area3D
            | ChartType::Surface
            | ChartType::Surface3D
    )
}

fn is_axisless_chart_type(chart_type: ChartType) -> bool {
    matches!(
        chart_type,
        ChartType::Pie | ChartType::Pie3D | ChartType::Doughnut | ChartType::OfPie
    )
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
