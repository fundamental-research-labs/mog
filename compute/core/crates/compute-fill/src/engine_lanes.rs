use std::collections::BTreeMap;

use value_types::CellValue;

use crate::engine_policy::{copy_pattern, determine_lane_pattern};
use crate::helpers::count_visible_cells_on_lane;
use crate::series::generate_series_values;
use crate::types::*;

pub(crate) struct LanePlan {
    pub(crate) pattern: FillPattern,
    pub(crate) series: Vec<CellValue>,
    pub(crate) consumed: usize,
}

pub(crate) struct LanePlans {
    pub(crate) is_vertical: bool,
    pub(crate) plans: BTreeMap<u32, LanePlan>,
}

impl LanePlans {
    pub(crate) fn detected_pattern(&self) -> FillPattern {
        self.plans
            .values()
            .next()
            .map(|plan| plan.pattern.clone())
            .unwrap_or_else(copy_pattern)
    }

    pub(crate) fn next_value(&mut self, lane: u32) -> Option<CellValue> {
        let plan = self.plans.get_mut(&lane)?;
        if !plan.series.is_empty() && plan.consumed < plan.series.len() {
            let value = plan.series[plan.consumed].clone();
            plan.consumed += 1;
            Some(value)
        } else {
            if !plan.series.is_empty() {
                plan.consumed += 1;
            }
            None
        }
    }
}

pub(crate) fn build_lane_plans(input: &FillInput) -> LanePlans {
    let direction = input.request.direction;
    let is_vertical = matches!(direction, FillDirection::Down | FillDirection::Up);
    let direction_mult = match direction {
        FillDirection::Down | FillDirection::Right => 1,
        FillDirection::Up | FillDirection::Left => -1,
    };

    let lane_values = group_value_cells_by_lane(&input.source_cells, is_vertical);
    let mut plans = BTreeMap::new();

    for (lane, values) in &lane_values {
        let pattern = determine_lane_pattern(
            input.request.mode,
            values,
            &input.request,
            &input.custom_lists,
            &input.locale,
        );
        let series =
            generate_lane_series(input, *lane, is_vertical, direction_mult, &pattern, values);
        plans.insert(
            *lane,
            LanePlan {
                pattern,
                series,
                consumed: 0,
            },
        );
    }

    tile_lane_plans(input, is_vertical, direction_mult, &lane_values, &mut plans);

    LanePlans { is_vertical, plans }
}

fn group_value_cells_by_lane(
    source_cells: &[SourceCell],
    is_vertical: bool,
) -> BTreeMap<u32, Vec<CellValue>> {
    let mut lane_values: BTreeMap<u32, Vec<CellValue>> = BTreeMap::new();
    for cell in source_cells.iter().filter(|cell| cell.formula.is_none()) {
        let lane = if is_vertical { cell.col } else { cell.row };
        lane_values
            .entry(lane)
            .or_default()
            .push(cell.value.clone());
    }
    lane_values
}

fn generate_lane_series(
    input: &FillInput,
    lane: u32,
    is_vertical: bool,
    direction_mult: i32,
    pattern: &FillPattern,
    values: &[CellValue],
) -> Vec<CellValue> {
    if values.is_empty() || pattern.pattern_type == FillPatternType::Copy {
        return Vec::new();
    }

    let total_visible = count_visible_cells_on_lane(
        &input.request.target_range,
        lane,
        is_vertical,
        &input.hidden_rows,
        &input.hidden_cols,
    );
    let overlap_count = visible_overlap_count_on_lane(input, lane, is_vertical);
    let visible_count = total_visible.saturating_sub(overlap_count);

    generate_series_values(
        pattern,
        values,
        visible_count,
        direction_mult,
        &input.locale,
        &input.custom_lists,
    )
}

fn tile_lane_plans(
    input: &FillInput,
    is_vertical: bool,
    direction_mult: i32,
    lane_values: &BTreeMap<u32, Vec<CellValue>>,
    plans: &mut BTreeMap<u32, LanePlan>,
) {
    let source = &input.request.source_range;
    let target = &input.request.target_range;
    let source_height = source.end_row - source.start_row + 1;
    let source_width = source.end_col - source.start_col + 1;

    if is_vertical {
        let tile_start = source.start_col.max(target.start_col);
        for target_lane in tile_start..=target.end_col {
            if plans.contains_key(&target_lane) {
                continue;
            }
            let offset = (target_lane - source.start_col) % source_width;
            let source_lane = source.start_col + offset;
            insert_tiled_plan(
                input,
                is_vertical,
                direction_mult,
                lane_values,
                plans,
                source_lane,
                target_lane,
            );
        }
    } else {
        let tile_start = source.start_row.max(target.start_row);
        for target_lane in tile_start..=target.end_row {
            if plans.contains_key(&target_lane) {
                continue;
            }
            let offset = (target_lane - source.start_row) % source_height;
            let source_lane = source.start_row + offset;
            insert_tiled_plan(
                input,
                is_vertical,
                direction_mult,
                lane_values,
                plans,
                source_lane,
                target_lane,
            );
        }
    }
}

fn insert_tiled_plan(
    input: &FillInput,
    is_vertical: bool,
    direction_mult: i32,
    lane_values: &BTreeMap<u32, Vec<CellValue>>,
    plans: &mut BTreeMap<u32, LanePlan>,
    source_lane: u32,
    target_lane: u32,
) {
    let Some(source_plan) = plans.get(&source_lane) else {
        return;
    };

    let pattern = source_plan.pattern.clone();
    let values = lane_values.get(&source_lane).cloned().unwrap_or_default();
    let series = generate_lane_series(
        input,
        target_lane,
        is_vertical,
        direction_mult,
        &pattern,
        &values,
    );

    plans.insert(
        target_lane,
        LanePlan {
            pattern,
            series,
            consumed: 0,
        },
    );
}

fn visible_overlap_count_on_lane(input: &FillInput, lane: u32, is_vertical: bool) -> usize {
    let source = &input.request.source_range;
    let target = &input.request.target_range;

    let overlap_row_start = source.start_row.max(target.start_row);
    let overlap_row_end = source.end_row.min(target.end_row);
    let overlap_col_start = source.start_col.max(target.start_col);
    let overlap_col_end = source.end_col.min(target.end_col);
    if overlap_row_start > overlap_row_end || overlap_col_start > overlap_col_end {
        return 0;
    }

    if is_vertical {
        if lane < source.start_col || lane > source.end_col {
            return 0;
        }
        (overlap_row_start..=overlap_row_end)
            .filter(|row| !input.hidden_rows.contains(row))
            .count()
    } else {
        if lane < source.start_row || lane > source.end_row {
            return 0;
        }
        (overlap_col_start..=overlap_col_end)
            .filter(|col| !input.hidden_cols.contains(col))
            .count()
    }
}
