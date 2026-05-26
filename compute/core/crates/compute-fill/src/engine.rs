//! Fill engine — orchestrates pattern detection, series generation, formula
//! adjustment, and format copying into a unified [`FillResult`].
//!
//! Pure function — no mutation, no storage access. The caller provides all
//! needed data via [`FillInput`].

use std::collections::BTreeMap;

use value_types::CellValue;

use crate::formula_adjust::calculate_adjusted_positions;
use crate::helpers::*;
use crate::patterns::detect_fill_pattern;
use crate::series::generate_series_values;
use crate::types::*;

/// Compute all fill updates. Pure function — no mutation, no storage access.
/// The caller provides all needed data via [`FillInput`].
pub fn compute_fill(input: &FillInput) -> FillResult {
    let direction = input.request.direction;
    let mode = input.request.mode;
    let source = &input.request.source_range;
    let target = &input.request.target_range;

    // Early exit: no source cells
    if input.source_cells.is_empty() {
        return FillResult {
            updates: Vec::new(),
            detected_pattern: copy_pattern(),
            filled_cell_count: 0,
            warnings: Vec::new(),
        };
    }

    // ── Separate source cells into value cells and formula cells ──────
    let value_cells: Vec<&SourceCell> = input
        .source_cells
        .iter()
        .filter(|c| c.formula.is_none())
        .collect();

    // ── Determine include flags based on mode ────────────────────────
    let (include_values, include_formulas, include_formats) = mode_flags(mode, &input.request);

    // ── Per-lane pattern detection and series generation ─────────────
    let is_vertical = matches!(direction, FillDirection::Down | FillDirection::Up);

    // Group value cells by lane (column for vertical, row for horizontal)
    let mut lane_values: BTreeMap<u32, Vec<CellValue>> = BTreeMap::new();
    for cell in &value_cells {
        let lane = if is_vertical { cell.col } else { cell.row };
        lane_values
            .entry(lane)
            .or_default()
            .push(cell.value.clone());
    }

    // Per-lane pattern + series
    let direction_mult = match direction {
        FillDirection::Down | FillDirection::Right => 1,
        FillDirection::Up | FillDirection::Left => -1,
    };

    // Compute overlap between source and target ranges. Target cells inside
    // the source range are skipped during filling, so the series must be sized
    // to the non-overlapping portion of the target only.
    let overlap_row_start = source.start_row.max(target.start_row);
    let overlap_row_end = source.end_row.min(target.end_row);
    let overlap_col_start = source.start_col.max(target.start_col);
    let overlap_col_end = source.end_col.min(target.end_col);
    let has_overlap = overlap_row_start <= overlap_row_end && overlap_col_start <= overlap_col_end;

    let mut lane_series: BTreeMap<u32, (FillPattern, Vec<CellValue>)> = BTreeMap::new();
    for (lane, values) in &lane_values {
        let mut pattern = determine_pattern(mode, values, &input.custom_lists, &input.locale);
        // When mode is Series (explicit fill-series command), promote Copy patterns
        // to Linear so the step_value is applied. A single numeric cell auto-detects
        // as Copy, but fillSeries explicitly requests a series — honour that.
        if mode == FillMode::Series && pattern.pattern_type == FillPatternType::Copy {
            let has_numeric = values.iter().any(|v| matches!(v, CellValue::Number(_)));
            if has_numeric {
                pattern.pattern_type = FillPatternType::Linear;
                pattern.step = Some(input.request.step_value);
            }
        } else if input.request.step_value != 1.0 && pattern.pattern_type == FillPatternType::Linear
        {
            // Override step with explicit step_value from request (when not the default 1.0)
            pattern.step = Some(input.request.step_value);
        }
        let series = if !values.is_empty() && pattern.pattern_type != FillPatternType::Copy {
            let total_visible = count_visible_cells_on_lane(
                target,
                *lane,
                is_vertical,
                &input.hidden_rows,
                &input.hidden_cols,
            );
            // Subtract overlapping source cells that will be skipped
            let overlap_count = if has_overlap {
                if is_vertical {
                    // Lane is a column; check if it falls within the source col range
                    if *lane >= source.start_col && *lane <= source.end_col {
                        (overlap_row_start..=overlap_row_end)
                            .filter(|r| !input.hidden_rows.contains(r))
                            .count()
                    } else {
                        0
                    }
                } else {
                    // Lane is a row; check if it falls within the source row range
                    if *lane >= source.start_row && *lane <= source.end_row {
                        (overlap_col_start..=overlap_col_end)
                            .filter(|c| !input.hidden_cols.contains(c))
                            .count()
                    } else {
                        0
                    }
                }
            } else {
                0
            };
            let visible_count = total_visible.saturating_sub(overlap_count);
            generate_series_values(
                &pattern,
                values,
                visible_count,
                direction_mult,
                &input.locale,
                &input.custom_lists,
            )
        } else {
            Vec::new()
        };
        lane_series.insert(*lane, (pattern, series));
    }

    // ── Tile lane series to cover extra target lanes (multi-dimension value fills) ──
    // When the target is wider/taller than the source, extra lanes need series data
    // cloned from the corresponding source lane (cyclically mapped).
    // Only tile forward: rightward for vertical fills, downward for horizontal fills.
    let source_height = source.end_row - source.start_row + 1;
    let source_width = source.end_col - source.start_col + 1;
    if is_vertical {
        // Only tile columns at or right of source start (skip leftward extension)
        let tile_start = source.start_col.max(target.start_col);
        for target_lane in tile_start..=target.end_col {
            if lane_series.contains_key(&target_lane) {
                continue; // Already has a series from source
            }
            // Map this target lane back to the source lane cyclically
            let offset = (target_lane - source.start_col) % source_width;
            let source_lane = source.start_col + offset;
            if let Some((pattern, _)) = lane_series.get(&source_lane) {
                let cloned_pattern = pattern.clone();
                let values_for_lane = lane_values.get(&source_lane).cloned().unwrap_or_default();
                let total_visible = count_visible_cells_on_lane(
                    target,
                    target_lane,
                    is_vertical,
                    &input.hidden_rows,
                    &input.hidden_cols,
                );
                // Subtract overlapping source cells that will be skipped
                let overlap_count = if has_overlap {
                    if target_lane >= source.start_col && target_lane <= source.end_col {
                        (overlap_row_start..=overlap_row_end)
                            .filter(|r| !input.hidden_rows.contains(r))
                            .count()
                    } else {
                        0
                    }
                } else {
                    0
                };
                let visible_count = total_visible.saturating_sub(overlap_count);
                let new_series = generate_series_values(
                    &cloned_pattern,
                    &values_for_lane,
                    visible_count,
                    direction_mult,
                    &input.locale,
                    &input.custom_lists,
                );
                lane_series.insert(target_lane, (cloned_pattern, new_series));
            }
        }
    } else {
        // Only tile rows at or below source start (skip upward extension)
        let tile_start = source.start_row.max(target.start_row);
        for target_lane in tile_start..=target.end_row {
            if lane_series.contains_key(&target_lane) {
                continue;
            }
            let offset = (target_lane - source.start_row) % source_height;
            let source_lane = source.start_row + offset;
            if let Some((pattern, _)) = lane_series.get(&source_lane) {
                let cloned_pattern = pattern.clone();
                let values_for_lane = lane_values.get(&source_lane).cloned().unwrap_or_default();
                let total_visible = count_visible_cells_on_lane(
                    target,
                    target_lane,
                    is_vertical,
                    &input.hidden_rows,
                    &input.hidden_cols,
                );
                let overlap_count = if has_overlap {
                    if target_lane >= source.start_row && target_lane <= source.end_row {
                        (overlap_col_start..=overlap_col_end)
                            .filter(|c| !input.hidden_cols.contains(c))
                            .count()
                    } else {
                        0
                    }
                } else {
                    0
                };
                let visible_count = total_visible.saturating_sub(overlap_count);
                let new_series = generate_series_values(
                    &cloned_pattern,
                    &values_for_lane,
                    visible_count,
                    direction_mult,
                    &input.locale,
                    &input.custom_lists,
                );
                lane_series.insert(target_lane, (cloned_pattern, new_series));
            }
        }
    }

    // detected_pattern: use first lane's pattern, or Copy if no lanes
    let detected_pattern = lane_series
        .values()
        .next()
        .map(|(p, _)| p.clone())
        .unwrap_or_else(copy_pattern);

    // ── Iterate over target cells and produce updates ─────────────────
    let mut updates: Vec<FillUpdate> = Vec::new();
    let mut warnings: Vec<FillWarning> = Vec::new();
    let mut lane_indices: BTreeMap<u32, usize> = BTreeMap::new();
    let mut filled_count: u32 = 0;

    // Track whether target has merges (for a single warning)
    let has_merges_in_target = input.merges.iter().any(|m| {
        !(m.end_row < target.start_row
            || m.start_row > target.end_row
            || m.end_col < target.start_col
            || m.start_col > target.end_col)
    });
    if has_merges_in_target {
        warnings.push(FillWarning {
            row: target.start_row,
            col: target.start_col,
            kind: FillWarningKind::MergedCellsInTarget,
        });
    }

    // Build iteration order: for Up/Left, iterate in reverse so that series
    // values are consumed starting from the cell nearest the source.
    let rows: Vec<u32> = if direction == FillDirection::Up {
        (target.start_row..=target.end_row).rev().collect()
    } else {
        (target.start_row..=target.end_row).collect()
    };
    let cols: Vec<u32> = if direction == FillDirection::Left {
        (target.start_col..=target.end_col).rev().collect()
    } else {
        (target.start_col..=target.end_col).collect()
    };

    for &row in &rows {
        if input.hidden_rows.contains(&row) {
            continue;
        }
        for &col in &cols {
            if input.hidden_cols.contains(&col) {
                continue;
            }
            // Skip cells that fall within the source range — source cells must
            // never be overwritten. This handles the case where the caller passes
            // a target range that overlaps with the source (e.g. source=A1:A2,
            // target=A1:A10 should only fill A3:A10).
            if row >= source.start_row
                && row <= source.end_row
                && col >= source.start_col
                && col <= source.end_col
            {
                continue;
            }
            if is_non_origin_merged_cell(&input.merges, row, col) {
                continue;
            }

            let (src_row, src_col) = map_target_to_source(row, col, source, direction);

            // Find the matching source cell
            let source_cell = match input
                .source_cells
                .iter()
                .find(|c| c.row == src_row && c.col == src_col)
            {
                Some(c) => c,
                None => continue, // No source cell at this position
            };

            // ── Formula cell ─────────────────────────────────────────
            if let Some(ref formula) = source_cell.formula {
                if include_formulas {
                    let adjusted_refs = calculate_adjusted_positions(
                        formula,
                        (src_row, src_col),
                        (row, col),
                        &source_cell.ref_positions,
                    );

                    // Check for out-of-bounds refs
                    for adj in &adjusted_refs {
                        if adj.out_of_bounds {
                            warnings.push(FillWarning {
                                row,
                                col,
                                kind: FillWarningKind::FormulaRefOutOfBounds {
                                    ref_index: adj.ref_index,
                                },
                            });
                        }
                    }

                    updates.push(FillUpdate::Formula {
                        row,
                        col,
                        source_formula: formula.clone(),
                        adjusted_refs,
                    });
                    filled_count += 1;
                }
            }
            // ── Value cell ───────────────────────────────────────────
            else if include_values {
                let lane = if is_vertical { col } else { row };
                let idx = lane_indices.entry(lane).or_insert(0);
                let value = if let Some((_, series)) = lane_series.get(&lane) {
                    if !series.is_empty() && *idx < series.len() {
                        let v = series[*idx].clone();
                        *idx += 1;
                        v
                    } else {
                        // Copy mode or series exhausted: copy source value cyclically
                        if !series.is_empty() {
                            *idx += 1;
                        }
                        source_cell.value.clone()
                    }
                } else {
                    // No lane series (e.g. lane had no value cells in source)
                    source_cell.value.clone()
                };
                updates.push(FillUpdate::Value { row, col, value });
                filled_count += 1;
            }

            // ── Format ───────────────────────────────────────────────
            if include_formats && let Some(ref format) = source_cell.format {
                updates.push(FillUpdate::Format {
                    row,
                    col,
                    format: format.clone(),
                });
            }
        }
    }

    // Sort updates into canonical row-major order so callers never depend on
    // the internal iteration order (which reverses for Up/Left fills).
    updates.sort_by_key(|u| match u {
        FillUpdate::Value { row, col, .. }
        | FillUpdate::Formula { row, col, .. }
        | FillUpdate::Format { row, col, .. }
        | FillUpdate::Clear { row, col } => (*row, *col),
    });

    FillResult {
        updates,
        detected_pattern,
        filled_cell_count: filled_count,
        warnings,
    }
}

/// Build a Copy pattern.
fn copy_pattern() -> FillPattern {
    FillPattern {
        pattern_type: FillPatternType::Copy,
        step: None,
        multiplier: None,
        date_unit: None,
        time_unit: None,
        start_index: None,
        prefix: None,
        num_digits: None,
        list_id: None,
    }
}

/// Determine the fill pattern based on mode and source values.
fn determine_pattern(
    mode: FillMode,
    source_values: &[CellValue],
    custom_lists: &[CustomList],
    locale: &LocaleNames,
) -> FillPattern {
    match mode {
        FillMode::Copy => copy_pattern(),
        FillMode::Days => FillPattern {
            pattern_type: FillPatternType::Date,
            date_unit: Some(DateUnit::Day),
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::Weekdays => FillPattern {
            pattern_type: FillPatternType::Date,
            date_unit: Some(DateUnit::Weekday),
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::Months => FillPattern {
            pattern_type: FillPatternType::Date,
            date_unit: Some(DateUnit::Month),
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::Years => FillPattern {
            pattern_type: FillPatternType::Date,
            date_unit: Some(DateUnit::Year),
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::LinearTrend => FillPattern {
            pattern_type: FillPatternType::Linear,
            step: Some(1.0),
            ..copy_pattern()
        },
        FillMode::GrowthTrend => FillPattern {
            pattern_type: FillPatternType::Growth,
            multiplier: Some(2.0),
            ..copy_pattern()
        },
        FillMode::Auto | FillMode::Series => {
            if source_values.is_empty() {
                copy_pattern()
            } else {
                detect_fill_pattern(source_values, custom_lists, locale)
            }
        }
        // Formats, Values, WithoutFormats use Auto detection for the pattern
        FillMode::Formats | FillMode::Values | FillMode::WithoutFormats => {
            if source_values.is_empty() {
                copy_pattern()
            } else {
                detect_fill_pattern(source_values, custom_lists, locale)
            }
        }
    }
}

/// Compute include flags from mode, falling back to request flags.
fn mode_flags(mode: FillMode, request: &FillRequest) -> (bool, bool, bool) {
    match mode {
        FillMode::Formats => (false, false, true),
        FillMode::Values => (true, true, false),
        FillMode::WithoutFormats => (true, true, false),
        _ => (
            request.include_values,
            request.include_formulas,
            request.include_formats,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula_adjust::RefPosition;
    use domain_types::CellFormat;
    use formula_types::IdentityFormula;
    use std::collections::BTreeSet;
    use value_types::{CellValue, FiniteF64};

    // ── Test helpers ─────────────────────────────────────────────────

    fn make_value_cell(row: u32, col: u32, value: f64) -> SourceCell {
        SourceCell {
            row,
            col,
            value: CellValue::Number(FiniteF64::new(value).unwrap()),
            formula: None,
            format: None,
            ref_positions: vec![],
        }
    }

    fn make_text_cell(row: u32, col: u32, text: &str) -> SourceCell {
        SourceCell {
            row,
            col,
            value: CellValue::Text(text.into()),
            formula: None,
            format: None,
            ref_positions: vec![],
        }
    }

    fn make_formula_cell(row: u32, col: u32, template: &str, refs: Vec<(u32, u32)>) -> SourceCell {
        SourceCell {
            row,
            col,
            value: CellValue::Number(FiniteF64::new(0.0).unwrap()),
            formula: Some(IdentityFormula {
                template: template.into(),
                refs: refs
                    .iter()
                    .map(|_| {
                        formula_types::IdentityFormulaRef::Cell(formula_types::IdentityCellRef {
                            id: cell_types::CellId::from_raw(0),
                            row_absolute: false,
                            col_absolute: false,
                        })
                    })
                    .collect(),
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
            format: None,
            ref_positions: refs
                .into_iter()
                .map(|(r, c)| RefPosition::Cell { row: r, col: c })
                .collect(),
        }
    }

    fn make_formatted_cell(row: u32, col: u32, value: f64) -> SourceCell {
        SourceCell {
            row,
            col,
            value: CellValue::Number(FiniteF64::new(value).unwrap()),
            formula: None,
            format: Some(CellFormat {
                bold: Some(true),
                ..Default::default()
            }),
            ref_positions: vec![],
        }
    }

    fn range(sr: u32, sc: u32, er: u32, ec: u32) -> FillRangeSpec {
        FillRangeSpec {
            start_row: sr,
            start_col: sc,
            end_row: er,
            end_col: ec,
        }
    }

    fn default_request(
        source: FillRangeSpec,
        target: FillRangeSpec,
        direction: FillDirection,
        mode: FillMode,
    ) -> FillRequest {
        FillRequest {
            source_range: source,
            target_range: target,
            direction,
            mode,
            include_formulas: true,
            include_values: true,
            include_formats: true,
            step_value: 1.0,
        }
    }

    fn default_input(request: FillRequest, source_cells: Vec<SourceCell>) -> FillInput {
        FillInput {
            request,
            source_cells,
            merges: vec![],
            hidden_rows: BTreeSet::new(),
            hidden_cols: BTreeSet::new(),
            custom_lists: vec![],
            locale: LocaleNames::default(),
        }
    }

    fn count_value_updates(result: &FillResult) -> usize {
        result
            .updates
            .iter()
            .filter(|u| matches!(u, FillUpdate::Value { .. }))
            .count()
    }

    fn count_formula_updates(result: &FillResult) -> usize {
        result
            .updates
            .iter()
            .filter(|u| matches!(u, FillUpdate::Formula { .. }))
            .count()
    }

    fn count_format_updates(result: &FillResult) -> usize {
        result
            .updates
            .iter()
            .filter(|u| matches!(u, FillUpdate::Format { .. }))
            .count()
    }

    fn get_value_at(result: &FillResult, row: u32, col: u32) -> Option<&CellValue> {
        result.updates.iter().find_map(|u| match u {
            FillUpdate::Value {
                row: r,
                col: c,
                value,
            } if *r == row && *c == col => Some(value),
            _ => None,
        })
    }

    // ── Empty source ─────────────────────────────────────────────────

    #[test]
    fn empty_source_returns_empty_result() {
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 3, 0),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, vec![]);
        let result = compute_fill(&input);
        assert!(result.updates.is_empty());
        assert_eq!(result.filled_cell_count, 0);
        assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
    }

    // ── Simple value fill down ───────────────────────────────────────

    #[test]
    fn simple_copy_fill_down() {
        let cells = vec![
            make_value_cell(0, 0, 1.0),
            make_value_cell(1, 0, 2.0),
            make_value_cell(2, 0, 3.0),
        ];
        let req = default_request(
            range(0, 0, 2, 0),
            range(3, 0, 5, 0),
            FillDirection::Down,
            FillMode::Copy,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
        assert_eq!(count_value_updates(&result), 3);
        assert_eq!(result.filled_cell_count, 3);

        // Copy mode: values repeat cyclically
        assert_eq!(
            get_value_at(&result, 3, 0),
            Some(&CellValue::Number(FiniteF64::new(1.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 4, 0),
            Some(&CellValue::Number(FiniteF64::new(2.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 5, 0),
            Some(&CellValue::Number(FiniteF64::new(3.0).unwrap()))
        );
    }

    // ── Linear series fill down ──────────────────────────────────────

    #[test]
    fn linear_series_fill_down() {
        // Use large numbers that won't be detected as date serials
        let cells = vec![
            make_value_cell(0, 0, 3_000_000.0),
            make_value_cell(1, 0, 3_000_001.0),
        ];
        let req = default_request(
            range(0, 0, 1, 0),
            range(2, 0, 4, 0),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        // Should detect linear pattern (step=1)
        assert_eq!(
            result.detected_pattern.pattern_type,
            FillPatternType::Linear
        );
        assert_eq!(count_value_updates(&result), 3);
        assert_eq!(result.filled_cell_count, 3);

        // Series should continue: 3000002, 3000003, 3000004
        assert_eq!(
            get_value_at(&result, 2, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_002.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 3, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_003.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 4, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_004.0).unwrap()))
        );
    }

    // ── Copy mode overrides pattern detection ────────────────────────

    #[test]
    fn copy_mode_overrides_pattern() {
        // Even with linear values, Copy mode should just repeat
        let cells = vec![make_value_cell(0, 0, 1.0), make_value_cell(1, 0, 2.0)];
        let req = default_request(
            range(0, 0, 1, 0),
            range(2, 0, 3, 0),
            FillDirection::Down,
            FillMode::Copy,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
        // Copy: 1, 2, 1, 2 — target gets 1, 2
        assert_eq!(
            get_value_at(&result, 2, 0),
            Some(&CellValue::Number(FiniteF64::new(1.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 3, 0),
            Some(&CellValue::Number(FiniteF64::new(2.0).unwrap()))
        );
    }

    // ── Formula fill ─────────────────────────────────────────────────

    #[test]
    fn formula_fill_down() {
        // Formula at (0, 1) referencing (0, 0)
        let cells = vec![make_formula_cell(0, 1, "{0}+1", vec![(0, 0)])];
        let req = default_request(
            range(0, 1, 0, 1),
            range(1, 1, 2, 1),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_formula_updates(&result), 2);
        assert_eq!(result.filled_cell_count, 2);

        // Check that formula updates have adjusted refs
        for update in &result.updates {
            if let FillUpdate::Formula {
                row,
                col,
                adjusted_refs,
                ..
            } = update
            {
                assert_eq!(*col, 1);
                assert_eq!(adjusted_refs.len(), 1);
                // Ref should shift down by (row - 0)
                assert_eq!(adjusted_refs[0].target_row, *row);
                assert_eq!(adjusted_refs[0].target_col, 0);
            }
        }
    }

    // ── Fill through merged cells ────────────────────────────────────

    #[test]
    fn fill_skips_non_origin_merged_cells() {
        let cells = vec![make_value_cell(0, 0, 42.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 3, 1),
            FillDirection::Down,
            FillMode::Copy,
        );
        let mut input = default_input(req, cells);
        // Merge spanning rows 1-2, cols 0-1, origin at (1, 0)
        input.merges.push(MergeRegion {
            start_row: 1,
            start_col: 0,
            end_row: 2,
            end_col: 1,
        });

        let result = compute_fill(&input);

        // (1, 0) is origin -> filled
        // (1, 1) is non-origin -> skipped
        // (2, 0) is non-origin -> skipped
        // (2, 1) is non-origin -> skipped
        // (3, 0) -> filled, (3, 1) -> no source cell at col 1 (source only has col 0)
        // Source is single cell at (0,0), target cols 0-1.
        // map_target_to_source for (3,1): source_width=1, col_offset=1%1=0 -> source_col=0
        // So (3,1) maps to source (0,0) -> filled
        let value_updates: Vec<_> = result
            .updates
            .iter()
            .filter(|u| matches!(u, FillUpdate::Value { .. }))
            .collect();

        // Should have: (1,0), (3,0), (3,1) = 3 value updates
        assert_eq!(value_updates.len(), 3);
        // Should have a merge warning
        assert!(
            result
                .warnings
                .iter()
                .any(|w| matches!(w.kind, FillWarningKind::MergedCellsInTarget))
        );
    }

    // ── Fill skipping hidden rows ────────────────────────────────────

    #[test]
    fn fill_skips_hidden_rows() {
        let cells = vec![make_value_cell(0, 0, 1.0), make_value_cell(1, 0, 2.0)];
        let req = default_request(
            range(0, 0, 1, 0),
            range(2, 0, 5, 0),
            FillDirection::Down,
            FillMode::Auto,
        );
        let mut input = default_input(req, cells);
        input.hidden_rows = [3].into();

        let result = compute_fill(&input);

        // 4 target rows, 1 hidden -> 3 visible cells
        assert_eq!(count_value_updates(&result), 3);

        // Row 3 should NOT have an update
        assert!(get_value_at(&result, 3, 0).is_none());
    }

    // ── Fill skipping hidden cols ────────────────────────────────────

    #[test]
    fn fill_skips_hidden_cols() {
        let cells = vec![make_value_cell(0, 0, 10.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(0, 1, 0, 3),
            FillDirection::Right,
            FillMode::Copy,
        );
        let mut input = default_input(req, cells);
        input.hidden_cols = [2].into();

        let result = compute_fill(&input);
        assert_eq!(count_value_updates(&result), 2); // cols 1, 3 (not 2)
    }

    // ── Format copying ───────────────────────────────────────────────

    #[test]
    fn fill_copies_formats() {
        let cells = vec![make_formatted_cell(0, 0, 5.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::Copy,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_format_updates(&result), 2);
        for update in &result.updates {
            if let FillUpdate::Format { format, .. } = update {
                assert_eq!(format.bold, Some(true));
            }
        }
    }

    // ── Mixed content: values and formulas ───────────────────────────

    #[test]
    fn mixed_values_and_formulas() {
        let cells = vec![
            make_value_cell(0, 0, 10.0),
            make_formula_cell(0, 1, "{0}*2", vec![(0, 0)]),
        ];
        let req = default_request(
            range(0, 0, 0, 1),
            range(1, 0, 2, 1),
            FillDirection::Down,
            FillMode::Copy,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        // 2 target rows * 1 value col = 2 value updates
        assert_eq!(count_value_updates(&result), 2);
        // 2 target rows * 1 formula col = 2 formula updates
        assert_eq!(count_formula_updates(&result), 2);
        assert_eq!(result.filled_cell_count, 4);
    }

    // ── Fill Right ───────────────────────────────────────────────────

    #[test]
    fn fill_right() {
        // Use large numbers that won't be detected as date serials
        let cells = vec![
            make_value_cell(0, 0, 3_000_000.0),
            make_value_cell(0, 1, 3_000_001.0),
        ];
        let req = default_request(
            range(0, 0, 0, 1),
            range(0, 2, 0, 4),
            FillDirection::Right,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(
            result.detected_pattern.pattern_type,
            FillPatternType::Linear
        );
        assert_eq!(count_value_updates(&result), 3);
        assert_eq!(
            get_value_at(&result, 0, 2),
            Some(&CellValue::Number(FiniteF64::new(3_000_002.0).unwrap()))
        );
    }

    // ── Fill Up ──────────────────────────────────────────────────────

    #[test]
    fn fill_up() {
        // Use large numbers that won't be detected as date serials
        let cells = vec![
            make_value_cell(5, 0, 3_000_010.0),
            make_value_cell(6, 0, 3_000_008.0),
        ];
        let req = default_request(
            range(5, 0, 6, 0),
            range(3, 0, 4, 0),
            FillDirection::Up,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(
            result.detected_pattern.pattern_type,
            FillPatternType::Linear
        );
        assert_eq!(count_value_updates(&result), 2);
        // Step is -2, direction_mult is -1 => series continues upward: 3000010, 3000012
        // Iteration is reversed for Up: row 4 first (series[0]), row 3 second (series[1])
        assert_eq!(
            get_value_at(&result, 4, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_010.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 3, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_012.0).unwrap()))
        );
    }

    // ── Fill Left ────────────────────────────────────────────────────

    #[test]
    fn fill_left() {
        let cells = vec![make_value_cell(0, 5, 10.0)];
        let req = default_request(
            range(0, 5, 0, 5),
            range(0, 3, 0, 4),
            FillDirection::Left,
            FillMode::Copy,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_value_updates(&result), 2);
        assert_eq!(
            get_value_at(&result, 0, 3),
            Some(&CellValue::Number(FiniteF64::new(10.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 0, 4),
            Some(&CellValue::Number(FiniteF64::new(10.0).unwrap()))
        );
    }

    // ── Days mode forces date pattern ────────────────────────────────

    #[test]
    fn days_mode_forces_date_pattern() {
        let cells = vec![make_value_cell(0, 0, 1.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::Days,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Date);
        assert_eq!(result.detected_pattern.date_unit, Some(DateUnit::Day));
    }

    // ── Months mode forces date pattern ──────────────────────────────

    #[test]
    fn months_mode_forces_date_pattern() {
        let cells = vec![make_value_cell(0, 0, 1.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::Months,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Date);
        assert_eq!(result.detected_pattern.date_unit, Some(DateUnit::Month));
    }

    // ── LinearTrend mode forces linear pattern ───────────────────────

    #[test]
    fn linear_trend_mode_forces_pattern() {
        let cells = vec![make_text_cell(0, 0, "hello")];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::LinearTrend,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(
            result.detected_pattern.pattern_type,
            FillPatternType::Linear
        );
    }

    // ── GrowthTrend mode forces growth pattern ───────────────────────

    #[test]
    fn growth_trend_mode_forces_pattern() {
        let cells = vec![make_value_cell(0, 0, 2.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::GrowthTrend,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(
            result.detected_pattern.pattern_type,
            FillPatternType::Growth
        );
    }

    // ── Formats-only mode ────────────────────────────────────────────

    #[test]
    fn formats_only_mode() {
        let cells = vec![make_formatted_cell(0, 0, 5.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::Formats,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        // No value or formula updates
        assert_eq!(count_value_updates(&result), 0);
        assert_eq!(count_formula_updates(&result), 0);
        // Only format updates
        assert_eq!(count_format_updates(&result), 2);
    }

    // ── Values mode: no format updates ───────────────────────────────

    #[test]
    fn values_mode_no_formats() {
        let cells = vec![make_formatted_cell(0, 0, 5.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::Values,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_value_updates(&result), 2);
        assert_eq!(count_format_updates(&result), 0);
    }

    // ── WithoutFormats mode ──────────────────────────────────────────

    #[test]
    fn without_formats_mode() {
        let cells = vec![make_formatted_cell(0, 0, 5.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::WithoutFormats,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_value_updates(&result), 2);
        assert_eq!(count_format_updates(&result), 0);
    }

    // ── Single value auto fill copies ────────────────────────────────

    #[test]
    fn single_value_auto_copies_constant() {
        // Single numeric value in Auto mode → Copy (repeat constant).
        // Excel repeats; series only with 2+ source values or explicit mode.
        let cells = vec![make_value_cell(0, 0, 42.0)];
        let req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 3, 0),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
        assert_eq!(count_value_updates(&result), 3);
        // All 42 (repeated constant)
        assert_eq!(
            get_value_at(&result, 1, 0),
            Some(&CellValue::Number(FiniteF64::new(42.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 2, 0),
            Some(&CellValue::Number(FiniteF64::new(42.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 3, 0),
            Some(&CellValue::Number(FiniteF64::new(42.0).unwrap()))
        );
    }

    // ── Formulas only (no value cells) still works ───────────────────

    #[test]
    fn all_formula_source_cells() {
        let cells = vec![
            make_formula_cell(0, 0, "{0}", vec![(0, 1)]),
            make_formula_cell(1, 0, "{0}", vec![(1, 1)]),
        ];
        let req = default_request(
            range(0, 0, 1, 0),
            range(2, 0, 3, 0),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_formula_updates(&result), 2);
        assert_eq!(count_value_updates(&result), 0);
        assert_eq!(result.filled_cell_count, 2);
    }

    // ── include_formulas=false skips formula updates ──────────────────

    #[test]
    fn include_formulas_false_skips_formulas() {
        let cells = vec![make_formula_cell(0, 0, "{0}", vec![(0, 1)])];
        let mut req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::Auto,
        );
        req.include_formulas = false;
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_formula_updates(&result), 0);
        assert_eq!(result.filled_cell_count, 0);
    }

    // ── include_values=false skips value updates ─────────────────────

    #[test]
    fn include_values_false_skips_values() {
        let cells = vec![make_value_cell(0, 0, 1.0)];
        let mut req = default_request(
            range(0, 0, 0, 0),
            range(1, 0, 2, 0),
            FillDirection::Down,
            FillMode::Auto,
        );
        req.include_values = false;
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_value_updates(&result), 0);
    }

    // ── No source cell at mapped position ────────────────────────────

    #[test]
    fn missing_source_cell_skipped() {
        // Source range is 2 cols wide, but only 1 source cell provided
        let cells = vec![make_value_cell(0, 0, 1.0)];
        let req = default_request(
            range(0, 0, 0, 1),
            range(1, 0, 1, 1),
            FillDirection::Down,
            FillMode::Copy,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        // (1, 0) maps to (0, 0) -> found -> filled
        // (1, 1) maps to (0, 1) -> not found -> skipped
        assert_eq!(count_value_updates(&result), 1);
        assert_eq!(result.filled_cell_count, 1);
    }

    // ── Filled cell count ────────────────────────────────────────────

    #[test]
    fn filled_cell_count_tracks_all_types() {
        let cells = vec![
            make_value_cell(0, 0, 1.0),
            make_formula_cell(0, 1, "{0}", vec![(0, 0)]),
        ];
        let req = default_request(
            range(0, 0, 0, 1),
            range(1, 0, 1, 1),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        // 1 value + 1 formula = 2 filled
        assert_eq!(result.filled_cell_count, 2);
    }

    // ── Reproduction tests: multi-column fill bug ────────────────────
    //
    // Bug: compute_fill flattens all source value cells into a single list,
    // detects one pattern, and shares a single series_index across all columns.
    // This means only the first column gets correct series values; subsequent
    // columns consume from the wrong position in the shared series.
    //
    // Correct behavior: each column (or row, for horizontal fill) should
    // independently detect its own pattern and generate its own series.

    #[test]
    fn multi_column_linear_series_fill_down() {
        // Col 0: [3000000, 3000001, 3000002] — step 1
        // Col 1: [3000100, 3000200, 3000300] — step 100
        let cells = vec![
            make_value_cell(0, 0, 3_000_000.0),
            make_value_cell(1, 0, 3_000_001.0),
            make_value_cell(2, 0, 3_000_002.0),
            make_value_cell(0, 1, 3_000_100.0),
            make_value_cell(1, 1, 3_000_200.0),
            make_value_cell(2, 1, 3_000_300.0),
        ];
        let req = default_request(
            range(0, 0, 2, 1),
            range(3, 0, 5, 1),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_value_updates(&result), 6);

        // Col 0 should continue: 3000003, 3000004, 3000005
        assert_eq!(
            get_value_at(&result, 3, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_003.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 4, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_004.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 5, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_005.0).unwrap()))
        );

        // Col 1 should continue: 3000400, 3000500, 3000600
        assert_eq!(
            get_value_at(&result, 3, 1),
            Some(&CellValue::Number(FiniteF64::new(3_000_400.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 4, 1),
            Some(&CellValue::Number(FiniteF64::new(3_000_500.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 5, 1),
            Some(&CellValue::Number(FiniteF64::new(3_000_600.0).unwrap()))
        );
    }

    #[test]
    fn multi_column_mixed_patterns_fill_down() {
        // Col 0: [3000000, 3000002] — step 2
        // Col 1: [3000000, 3000005] — step 5
        let cells = vec![
            make_value_cell(0, 0, 3_000_000.0),
            make_value_cell(1, 0, 3_000_002.0),
            make_value_cell(0, 1, 3_000_000.0),
            make_value_cell(1, 1, 3_000_005.0),
        ];
        let req = default_request(
            range(0, 0, 1, 1),
            range(2, 0, 3, 1),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_value_updates(&result), 4);

        // Col 0 should continue with step 2: 3000004, 3000006
        assert_eq!(
            get_value_at(&result, 2, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_004.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 3, 0),
            Some(&CellValue::Number(FiniteF64::new(3_000_006.0).unwrap()))
        );

        // Col 1 should continue with step 5: 3000010, 3000015
        assert_eq!(
            get_value_at(&result, 2, 1),
            Some(&CellValue::Number(FiniteF64::new(3_000_010.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 3, 1),
            Some(&CellValue::Number(FiniteF64::new(3_000_015.0).unwrap()))
        );
    }

    #[test]
    fn multi_row_linear_series_fill_right() {
        // Row 0: [3000000, 3000001, 3000002] — step 1
        // Row 1: [3000100, 3000200, 3000300] — step 100
        let cells = vec![
            make_value_cell(0, 0, 3_000_000.0),
            make_value_cell(0, 1, 3_000_001.0),
            make_value_cell(0, 2, 3_000_002.0),
            make_value_cell(1, 0, 3_000_100.0),
            make_value_cell(1, 1, 3_000_200.0),
            make_value_cell(1, 2, 3_000_300.0),
        ];
        let req = default_request(
            range(0, 0, 1, 2),
            range(0, 3, 1, 5),
            FillDirection::Right,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_value_updates(&result), 6);

        // Row 0 should continue: 3000003, 3000004, 3000005
        assert_eq!(
            get_value_at(&result, 0, 3),
            Some(&CellValue::Number(FiniteF64::new(3_000_003.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 0, 4),
            Some(&CellValue::Number(FiniteF64::new(3_000_004.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 0, 5),
            Some(&CellValue::Number(FiniteF64::new(3_000_005.0).unwrap()))
        );

        // Row 1 should continue: 3000400, 3000500, 3000600
        assert_eq!(
            get_value_at(&result, 1, 3),
            Some(&CellValue::Number(FiniteF64::new(3_000_400.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 1, 4),
            Some(&CellValue::Number(FiniteF64::new(3_000_500.0).unwrap()))
        );
        assert_eq!(
            get_value_at(&result, 1, 5),
            Some(&CellValue::Number(FiniteF64::new(3_000_600.0).unwrap()))
        );
    }

    // ── Formula fill regression tests ───────────────────────────────
    //
    // These tests prove that the pure fill engine produces correct
    // FillUpdate::Formula entries with properly adjusted refs.
    //
    // Bug context: the storage layer's mutation_auto_fill creates new CellIds
    // via grid_id_alloc that are NOT registered in the CellMirror, causing
    // to_a1_display to produce #REF! instead of valid A1 references. The bug
    // is in the storage integration, NOT in compute_fill itself. These tests
    // document that the engine output is correct.

    fn get_formula_updates(result: &FillResult) -> Vec<(u32, u32, Vec<AdjustedRef>)> {
        result
            .updates
            .iter()
            .filter_map(|u| match u {
                FillUpdate::Formula {
                    row,
                    col,
                    adjusted_refs,
                    ..
                } => Some((*row, *col, adjusted_refs.clone())),
                _ => None,
            })
            .collect()
    }

    fn make_formula_cell_with_absolute(
        row: u32,
        col: u32,
        template: &str,
        refs: Vec<(u32, u32)>,
        row_absolute: bool,
        col_absolute: bool,
    ) -> SourceCell {
        SourceCell {
            row,
            col,
            value: CellValue::Number(FiniteF64::new(0.0).unwrap()),
            formula: Some(IdentityFormula {
                template: template.into(),
                refs: refs
                    .iter()
                    .map(|_| {
                        formula_types::IdentityFormulaRef::Cell(formula_types::IdentityCellRef {
                            id: cell_types::CellId::from_raw(0),
                            row_absolute,
                            col_absolute,
                        })
                    })
                    .collect(),
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
            format: None,
            ref_positions: refs
                .into_iter()
                .map(|(r, c)| RefPosition::Cell { row: r, col: c })
                .collect(),
        }
    }

    #[test]
    fn formula_fill_down_produces_correct_adjusted_refs() {
        // Source: formula cell at (0, 1) with template "{0}+1" referencing (0, 0)
        // Target: rows 1-3, col 1
        let cells = vec![make_formula_cell(0, 1, "{0}+1", vec![(0, 0)])];
        let req = default_request(
            range(0, 1, 0, 1),
            range(1, 1, 3, 1),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        let formula_updates = get_formula_updates(&result);
        assert_eq!(
            formula_updates.len(),
            3,
            "should produce 3 formula updates (one per target row)"
        );

        // Each should have exactly 1 adjusted ref
        for (row, col, refs) in &formula_updates {
            assert_eq!(*col, 1);
            assert_eq!(
                refs.len(),
                1,
                "each formula update should have exactly 1 adjusted ref"
            );
            assert!(
                !refs[0].out_of_bounds,
                "ref at row {} should not be out of bounds",
                row
            );
        }

        // Row 1 → ref at (1, 0)
        assert_eq!(formula_updates[0].0, 1);
        assert_eq!(formula_updates[0].2[0].target_row, 1);
        assert_eq!(formula_updates[0].2[0].target_col, 0);

        // Row 2 → ref at (2, 0)
        assert_eq!(formula_updates[1].0, 2);
        assert_eq!(formula_updates[1].2[0].target_row, 2);
        assert_eq!(formula_updates[1].2[0].target_col, 0);

        // Row 3 → ref at (3, 0)
        assert_eq!(formula_updates[2].0, 3);
        assert_eq!(formula_updates[2].2[0].target_row, 3);
        assert_eq!(formula_updates[2].2[0].target_col, 0);
    }

    #[test]
    fn formula_fill_right_adjusts_cols() {
        // Source: formula cell at (0, 0) with template "{0}*2" referencing (0, 1)
        // Target: row 0, cols 1-3. FillDirection::Right.
        let cells = vec![make_formula_cell(0, 0, "{0}*2", vec![(0, 1)])];
        let req = default_request(
            range(0, 0, 0, 0),
            range(0, 1, 0, 3),
            FillDirection::Right,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        let formula_updates = get_formula_updates(&result);
        assert_eq!(
            formula_updates.len(),
            3,
            "should produce 3 formula updates (one per target col)"
        );

        // col 1 → ref at (0, 2)
        assert_eq!(formula_updates[0].0, 0);
        assert_eq!(formula_updates[0].1, 1);
        assert_eq!(formula_updates[0].2[0].target_row, 0);
        assert_eq!(formula_updates[0].2[0].target_col, 2);
        assert!(!formula_updates[0].2[0].out_of_bounds);

        // col 2 → ref at (0, 3)
        assert_eq!(formula_updates[1].1, 2);
        assert_eq!(formula_updates[1].2[0].target_row, 0);
        assert_eq!(formula_updates[1].2[0].target_col, 3);
        assert!(!formula_updates[1].2[0].out_of_bounds);

        // col 3 → ref at (0, 4)
        assert_eq!(formula_updates[2].1, 3);
        assert_eq!(formula_updates[2].2[0].target_row, 0);
        assert_eq!(formula_updates[2].2[0].target_col, 4);
        assert!(!formula_updates[2].2[0].out_of_bounds);
    }

    #[test]
    fn formula_with_absolute_row_only_adjusts_col() {
        // Source: formula cell at (0, 1) with template "{0}" where the ref has
        // row_absolute: true, col_absolute: false, referencing (0, 0).
        // Fill down to rows 1-2.
        //
        // Since row_absolute=true, the row component does NOT shift.
        // Since col_absolute=false and we're filling down (col_delta=0),
        // the col also stays at 0.
        // The adjusted ref target_row should remain 0 for both targets.
        let cells = vec![make_formula_cell_with_absolute(
            0,
            1,
            "{0}",
            vec![(0, 0)],
            true,
            false,
        )];
        let req = default_request(
            range(0, 1, 0, 1),
            range(1, 1, 2, 1),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        let formula_updates = get_formula_updates(&result);
        assert_eq!(formula_updates.len(), 2);

        // Row absolute: target_row stays at 0 even though we filled down
        assert_eq!(formula_updates[0].0, 1); // target cell is row 1
        assert_eq!(formula_updates[0].2[0].target_row, 0); // but ref row stays at 0
        assert_eq!(formula_updates[0].2[0].target_col, 0);
        assert!(!formula_updates[0].2[0].out_of_bounds);

        assert_eq!(formula_updates[1].0, 2); // target cell is row 2
        assert_eq!(formula_updates[1].2[0].target_row, 0); // but ref row stays at 0
        assert_eq!(formula_updates[1].2[0].target_col, 0);
        assert!(!formula_updates[1].2[0].out_of_bounds);
    }

    #[test]
    fn multi_formula_refs_all_adjusted() {
        // Source: formula cell at (1, 2) with template "{0}+{1}" referencing [(1, 0), (1, 1)]
        // Fill down to rows 2-3.
        let cells = vec![make_formula_cell(1, 2, "{0}+{1}", vec![(1, 0), (1, 1)])];
        let req = default_request(
            range(1, 2, 1, 2),
            range(2, 2, 3, 2),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        let formula_updates = get_formula_updates(&result);
        assert_eq!(formula_updates.len(), 2, "should produce 2 formula updates");

        // Row 2: both refs shifted down by 1
        assert_eq!(formula_updates[0].0, 2);
        assert_eq!(formula_updates[0].2.len(), 2, "should have 2 adjusted refs");
        assert_eq!(formula_updates[0].2[0].target_row, 2);
        assert_eq!(formula_updates[0].2[0].target_col, 0);
        assert_eq!(formula_updates[0].2[1].target_row, 2);
        assert_eq!(formula_updates[0].2[1].target_col, 1);

        // Row 3: both refs shifted down by 2
        assert_eq!(formula_updates[1].0, 3);
        assert_eq!(formula_updates[1].2.len(), 2, "should have 2 adjusted refs");
        assert_eq!(formula_updates[1].2[0].target_row, 3);
        assert_eq!(formula_updates[1].2[0].target_col, 0);
        assert_eq!(formula_updates[1].2[1].target_row, 3);
        assert_eq!(formula_updates[1].2[1].target_col, 1);
    }

    // ── Overlapping source/target: source cells must never be overwritten ─

    #[test]
    fn overlapping_target_does_not_overwrite_source_cells() {
        // Source: A1:A2 (rows 0-1), values [1, 2]
        // Target: A1:A10 (rows 0-9) — overlaps source at rows 0-1
        // Expected: only rows 2-9 get filled; rows 0-1 are skipped
        let cells = vec![make_value_cell(0, 0, 1.0), make_value_cell(1, 0, 2.0)];
        let req = default_request(
            range(0, 0, 1, 0),
            range(0, 0, 9, 0),
            FillDirection::Down,
            FillMode::Copy,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        // Should produce updates ONLY for non-source rows (2-9 = 8 cells)
        assert_eq!(
            count_value_updates(&result),
            8,
            "must not produce updates for source cells (rows 0-1)"
        );
        assert_eq!(result.filled_cell_count, 8);

        // Verify no update exists for source rows
        assert!(
            get_value_at(&result, 0, 0).is_none(),
            "source cell A1 must not be overwritten"
        );
        assert!(
            get_value_at(&result, 1, 0).is_none(),
            "source cell A2 must not be overwritten"
        );

        // Target cells should have values
        assert!(get_value_at(&result, 2, 0).is_some(), "A3 should be filled");
        assert!(
            get_value_at(&result, 9, 0).is_some(),
            "A10 should be filled"
        );
    }

    #[test]
    fn overlapping_target_linear_series_produces_correct_values() {
        // Source: A1:A2 (rows 0-1), values [1, 2] — linear step=1
        // Target: A1:A10 (rows 0-9)
        // Expected: A3=3, A4=4, ..., A10=10 (8 values)
        let cells = vec![make_value_cell(0, 0, 1.0), make_value_cell(1, 0, 2.0)];
        let req = default_request(
            range(0, 0, 1, 0),
            range(0, 0, 9, 0),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        // 8 non-source target cells
        assert_eq!(count_value_updates(&result), 8);

        // Verify the linear series values: 3, 4, 5, ..., 10
        for i in 2u32..=9 {
            let expected = CellValue::Number(FiniteF64::new((i + 1) as f64).unwrap());
            assert_eq!(
                get_value_at(&result, i, 0),
                Some(&expected),
                "row {} should have value {}",
                i,
                i + 1
            );
        }
    }

    #[test]
    fn non_overlapping_ranges_still_work() {
        // Sanity check: non-overlapping source/target still works as before
        let cells = vec![make_value_cell(0, 0, 1.0), make_value_cell(1, 0, 2.0)];
        let req = default_request(
            range(0, 0, 1, 0),
            range(2, 0, 4, 0),
            FillDirection::Down,
            FillMode::Copy,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(count_value_updates(&result), 3);
        assert_eq!(result.filled_cell_count, 3);
    }

    #[test]
    fn overlapping_formula_cells_not_overwritten() {
        // Source: B1 has formula =A1+1, target: B1:B4 (overlaps B1)
        // Expected: only B2:B4 get formula updates; B1 is preserved
        let cells = vec![make_formula_cell(0, 1, "{0}+1", vec![(0, 0)])];
        let req = default_request(
            range(0, 1, 0, 1),
            range(0, 1, 3, 1),
            FillDirection::Down,
            FillMode::Auto,
        );
        let input = default_input(req, cells);
        let result = compute_fill(&input);

        assert_eq!(
            count_formula_updates(&result),
            3,
            "should produce formulas for B2:B4 only, not B1"
        );

        // Verify no formula update at the source position (row 0, col 1)
        let has_source_formula = result.updates.iter().any(|u| match u {
            FillUpdate::Formula { row, col, .. } => *row == 0 && *col == 1,
            _ => false,
        });
        assert!(
            !has_source_formula,
            "source cell B1 must not have a formula update"
        );
    }
}
