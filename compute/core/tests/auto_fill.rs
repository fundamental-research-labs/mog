//! Integration tests for the autofill engine (`compute_fill`).
//!
//! These tests exercise `compute_fill::engine::compute_fill()` directly with
//! constructed `FillInput` data, testing the same logic that the bridge layer
//! invokes after gathering data from storage.

use std::collections::BTreeSet;

use cell_types::CellId;
use compute_fill::engine::compute_fill;
use compute_fill::types::*;
use domain_types::CellFormat;
use formula_types::{IdentityCellRef, IdentityFormula, IdentityFormulaRef};
use value_types::{CellValue, FiniteF64};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn num(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::new(v).unwrap())
}

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn make_source(row: u32, col: u32, value: CellValue) -> SourceCell {
    SourceCell {
        row,
        col,
        value,
        formula: None,
        format: None,
        ref_positions: vec![],
    }
}

fn make_formatted_source(row: u32, col: u32, value: CellValue) -> SourceCell {
    SourceCell {
        row,
        col,
        value,
        formula: None,
        format: Some(CellFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ref_positions: vec![],
    }
}

fn make_formula_source(
    row: u32,
    col: u32,
    template: &str,
    refs: Vec<IdentityFormulaRef>,
    ref_positions: Vec<(u32, u32)>,
) -> SourceCell {
    SourceCell {
        row,
        col,
        value: num(0.0),
        formula: Some(IdentityFormula {
            template: template.into(),
            refs,
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }),
        format: None,
        ref_positions: ref_positions
            .into_iter()
            .map(|(r, c)| compute_fill::formula_adjust::RefPosition::Cell { row: r, col: c })
            .collect(),
    }
}

fn cell_ref(row_absolute: bool, col_absolute: bool) -> IdentityFormulaRef {
    IdentityFormulaRef::Cell(IdentityCellRef {
        id: CellId::from_raw(0),
        row_absolute,
        col_absolute,
    })
}

fn range(sr: u32, sc: u32, er: u32, ec: u32) -> FillRangeSpec {
    FillRangeSpec {
        start_row: sr,
        start_col: sc,
        end_row: er,
        end_col: ec,
    }
}

fn default_input(
    source_cells: Vec<SourceCell>,
    source_range: FillRangeSpec,
    target_range: FillRangeSpec,
    direction: FillDirection,
    mode: FillMode,
) -> FillInput {
    FillInput {
        request: FillRequest {
            source_range,
            target_range,
            direction,
            mode,
            include_formulas: true,
            include_values: true,
            include_formats: true,
            step_value: 1.0,
        },
        source_cells,
        merges: vec![],
        hidden_rows: BTreeSet::new(),
        hidden_cols: BTreeSet::new(),
        custom_lists: vec![],
        locale: LocaleNames::default(),
    }
}

fn extract_values(result: &FillResult) -> Vec<(u32, u32, CellValue)> {
    result
        .updates
        .iter()
        .filter_map(|u| match u {
            FillUpdate::Value { row, col, value } => Some((*row, *col, value.clone())),
            _ => None,
        })
        .collect()
}

fn extract_formulas(result: &FillResult) -> Vec<(u32, u32, Vec<AdjustedRef>)> {
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

fn count_format_updates(result: &FillResult) -> usize {
    result
        .updates
        .iter()
        .filter(|u| matches!(u, FillUpdate::Format { .. }))
        .count()
}

fn count_value_updates(result: &FillResult) -> usize {
    result
        .updates
        .iter()
        .filter(|u| matches!(u, FillUpdate::Value { .. }))
        .count()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Linear series fill down
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn linear_series_fill_down() {
    // Use values outside date serial range to avoid date detection
    let cells = vec![
        make_source(0, 0, num(3_000_001.0)),
        make_source(1, 0, num(3_000_002.0)),
        make_source(2, 0, num(3_000_003.0)),
    ];
    let input = default_input(
        cells,
        range(0, 0, 2, 0),
        range(3, 0, 8, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    assert_eq!(
        result.detected_pattern.pattern_type,
        FillPatternType::Linear
    );
    let values = extract_values(&result);
    assert_eq!(values.len(), 6);
    // Step = 1, last source = 3_000_003, so next = 3_000_004, 3_000_005, ...
    for (i, (row, col, val)) in values.iter().enumerate() {
        assert_eq!(*row, 3 + i as u32);
        assert_eq!(*col, 0);
        assert_eq!(*val, num(3_000_004.0 + i as f64));
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Copy fill right
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn copy_fill_right() {
    let cells = vec![make_source(0, 0, text("A")), make_source(0, 1, text("B"))];
    let input = default_input(
        cells,
        range(0, 0, 0, 1),
        range(0, 2, 0, 5),
        FillDirection::Right,
        FillMode::Copy,
    );
    let result = compute_fill(&input);

    assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
    let values = extract_values(&result);
    assert_eq!(values.len(), 4);
    // Cyclic copy: A, B, A, B
    assert_eq!(values[0], (0, 2, text("A")));
    assert_eq!(values[1], (0, 3, text("B")));
    assert_eq!(values[2], (0, 4, text("A")));
    assert_eq!(values[3], (0, 5, text("B")));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Date fill down (day-by-day)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn date_fill_down() {
    // Jan 1 2024 = serial 45292.0 (Excel convention)
    // Use ymd_to_serial for accuracy.
    let jan1 = value_types::date_serial::ymd_to_serial(2024, 1, 1);
    let cells = vec![make_source(0, 0, num(jan1))];
    // Single date serial → detected as Linear step 1 (dates are serials).
    // For explicit date fill, use FillMode::Days.
    let input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 5, 0),
        FillDirection::Down,
        FillMode::Days,
    );
    let result = compute_fill(&input);

    assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Date);
    let values = extract_values(&result);
    assert_eq!(values.len(), 5);
    // Jan 2-6 serials
    for (i, (row, col, val)) in values.iter().enumerate() {
        assert_eq!(*row, 1 + i as u32);
        assert_eq!(*col, 0);
        assert_eq!(*val, num(jan1 + (i as f64 + 1.0)));
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. Growth fill
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn growth_fill() {
    // [2,4,8] → multiplier=2.0, growth from last (8): 16, 32, 64
    // But these are in date serial range, so date detection may trigger first.
    // Use large values to avoid date detection.
    let cells = vec![
        make_source(0, 0, num(3_000_000.0)),
        make_source(1, 0, num(6_000_000.0)),
        make_source(2, 0, num(12_000_000.0)),
    ];
    let input = default_input(
        cells,
        range(0, 0, 2, 0),
        range(3, 0, 5, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    assert_eq!(
        result.detected_pattern.pattern_type,
        FillPatternType::Growth
    );
    let values = extract_values(&result);
    assert_eq!(values.len(), 3);
    // multiplier=2: 12M*2=24M, 24M*2=48M, 48M*2=96M
    assert_eq!(values[0], (3, 0, num(24_000_000.0)));
    assert_eq!(values[1], (4, 0, num(48_000_000.0)));
    assert_eq!(values[2], (5, 0, num(96_000_000.0)));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. Weekday names
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn weekday_names_fill() {
    let cells = vec![
        make_source(0, 0, text("Monday")),
        make_source(1, 0, text("Tuesday")),
    ];
    let input = default_input(
        cells,
        range(0, 0, 1, 0),
        range(2, 0, 6, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    assert_eq!(
        result.detected_pattern.pattern_type,
        FillPatternType::Weekday
    );
    let values = extract_values(&result);
    assert_eq!(values.len(), 5);
    assert_eq!(values[0].2, text("Wednesday"));
    assert_eq!(values[1].2, text("Thursday"));
    assert_eq!(values[2].2, text("Friday"));
    assert_eq!(values[3].2, text("Saturday"));
    assert_eq!(values[4].2, text("Sunday"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. Month names
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn month_names_fill() {
    let cells = vec![
        make_source(0, 0, text("January")),
        make_source(1, 0, text("February")),
        make_source(2, 0, text("March")),
    ];
    let input = default_input(
        cells,
        range(0, 0, 2, 0),
        range(3, 0, 5, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Month);
    let values = extract_values(&result);
    assert_eq!(values.len(), 3);
    assert_eq!(values[0].2, text("April"));
    assert_eq!(values[1].2, text("May"));
    assert_eq!(values[2].2, text("June"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. Simple relative formula shift
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn formula_relative_ref_shift_down() {
    // Source cell at (0, 1) has formula referencing (0, 1) with relative row+col.
    // ref_positions = [(0, 1)] — where the ref currently points.
    let cells = vec![make_formula_source(
        0,
        1,
        "{0}+1",
        vec![cell_ref(false, false)],
        vec![(0, 1)],
    )];
    let input = default_input(
        cells,
        range(0, 1, 0, 1),
        range(1, 1, 1, 1),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    let formulas = extract_formulas(&result);
    assert_eq!(formulas.len(), 1);
    let (row, col, adj) = &formulas[0];
    assert_eq!(*row, 1);
    assert_eq!(*col, 1);
    assert_eq!(adj.len(), 1);
    // Source at (0,1), target at (1,1): delta_row=+1, delta_col=0.
    // Original ref position (0,1) → (0+1, 1+0) = (1, 1).
    assert_eq!(adj[0].target_row, 1);
    assert_eq!(adj[0].target_col, 1);
    assert!(!adj[0].out_of_bounds);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. Absolute formula preserved ($A$1)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn formula_absolute_ref_no_shift() {
    // Source cell at (0, 1) with $A$1 ref → both row and col absolute.
    // ref_positions = [(0, 0)].
    let cells = vec![make_formula_source(
        0,
        1,
        "{0}*2",
        vec![cell_ref(true, true)],
        vec![(0, 0)],
    )];
    let input = default_input(
        cells,
        range(0, 1, 0, 1),
        range(1, 1, 3, 1),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    let formulas = extract_formulas(&result);
    assert_eq!(formulas.len(), 3);
    // All adjusted refs should stay at (0, 0) since both components are absolute.
    for (_, _, adj) in &formulas {
        assert_eq!(adj.len(), 1);
        assert_eq!(adj[0].target_row, 0);
        assert_eq!(adj[0].target_col, 0);
        assert!(!adj[0].out_of_bounds);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. Mixed ref ($A1: col absolute, row relative)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn formula_mixed_ref_col_absolute_row_relative() {
    // Source at (0, 1) referencing position (0, 0) with col_absolute=true, row_absolute=false.
    let cells = vec![make_formula_source(
        0,
        1,
        "{0}",
        vec![cell_ref(false, true)], // row relative, col absolute
        vec![(0, 0)],
    )];
    let input = default_input(
        cells,
        range(0, 1, 0, 1),
        range(1, 1, 2, 1),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    let formulas = extract_formulas(&result);
    assert_eq!(formulas.len(), 2);
    // Row shifts by delta, col stays fixed.
    // Target (1, 1): row delta = 1 → row = 0+1 = 1, col stays = 0.
    assert_eq!(formulas[0].2[0].target_row, 1);
    assert_eq!(formulas[0].2[0].target_col, 0);
    // Target (2, 1): row delta = 2 → row = 0+2 = 2, col stays = 0.
    assert_eq!(formulas[1].2[0].target_row, 2);
    assert_eq!(formulas[1].2[0].target_col, 0);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. Copy mode ignores pattern
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn copy_mode_ignores_linear_pattern() {
    // Source [3M+1, 3M+2, 3M+3] would be linear, but Copy mode overrides.
    let cells = vec![
        make_source(0, 0, num(3_000_001.0)),
        make_source(1, 0, num(3_000_002.0)),
        make_source(2, 0, num(3_000_003.0)),
    ];
    let input = default_input(
        cells,
        range(0, 0, 2, 0),
        range(3, 0, 8, 0),
        FillDirection::Down,
        FillMode::Copy,
    );
    let result = compute_fill(&input);

    assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
    let values = extract_values(&result);
    assert_eq!(values.len(), 6);
    // Cyclic copy: 3M+1, 3M+2, 3M+3, 3M+1, 3M+2, 3M+3
    assert_eq!(values[0].2, num(3_000_001.0));
    assert_eq!(values[1].2, num(3_000_002.0));
    assert_eq!(values[2].2, num(3_000_003.0));
    assert_eq!(values[3].2, num(3_000_001.0));
    assert_eq!(values[4].2, num(3_000_002.0));
    assert_eq!(values[5].2, num(3_000_003.0));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. Formats-only mode
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn formats_only_mode_emits_no_values() {
    let cells = vec![make_formatted_source(0, 0, num(42.0))];
    let input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 3, 0),
        FillDirection::Down,
        FillMode::Formats,
    );
    let result = compute_fill(&input);

    assert_eq!(count_value_updates(&result), 0);
    assert_eq!(count_format_updates(&result), 3);
    // Verify format content
    for update in &result.updates {
        if let FillUpdate::Format { format, .. } = update {
            assert_eq!(format.bold, Some(true));
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. Values mode — no format updates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn values_mode_no_format_updates() {
    let cells = vec![make_formatted_source(0, 0, num(42.0))];
    let input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 3, 0),
        FillDirection::Down,
        FillMode::Values,
    );
    let result = compute_fill(&input);

    assert_eq!(count_format_updates(&result), 0);
    assert_eq!(count_value_updates(&result), 3);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 13. Empty source
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn empty_source_returns_empty_result() {
    let input = default_input(
        vec![],
        range(0, 0, 0, 0),
        range(1, 0, 5, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    assert!(result.updates.is_empty());
    assert_eq!(result.filled_cell_count, 0);
    assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 14. Hidden rows skipped
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn hidden_rows_skipped() {
    let cells = vec![make_source(0, 0, num(3_000_000.0))];
    let mut input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 5, 0),
        FillDirection::Down,
        FillMode::Copy,
    );
    input.hidden_rows = [3, 4].into();

    let result = compute_fill(&input);

    let values = extract_values(&result);
    // 5 target rows (1-5), 2 hidden (3,4) → 3 updates
    assert_eq!(values.len(), 3);
    let rows: Vec<u32> = values.iter().map(|(r, _, _)| *r).collect();
    assert!(!rows.contains(&3));
    assert!(!rows.contains(&4));
    assert!(rows.contains(&1));
    assert!(rows.contains(&2));
    assert!(rows.contains(&5));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 15. Merged cells — non-origin cells skipped
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn merged_cells_non_origin_skipped() {
    let cells = vec![make_source(0, 0, num(3_000_000.0))];
    let mut input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 5, 0),
        FillDirection::Down,
        FillMode::Copy,
    );
    // Merge at rows 3-4, col 0 — origin at (3, 0), non-origin at (4, 0).
    input.merges.push(MergeRegion {
        start_row: 3,
        start_col: 0,
        end_row: 4,
        end_col: 0,
    });

    let result = compute_fill(&input);

    let values = extract_values(&result);
    let rows: Vec<u32> = values.iter().map(|(r, _, _)| *r).collect();
    // (4, 0) is non-origin in merge → skipped
    assert!(!rows.contains(&4));
    // (3, 0) is origin → filled
    assert!(rows.contains(&3));
    // Should have warning about merges in target
    assert!(
        result
            .warnings
            .iter()
            .any(|w| matches!(w.kind, FillWarningKind::MergedCellsInTarget))
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 16. All four directions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn fill_direction_down() {
    let cells = vec![make_source(0, 0, num(3_000_000.0))];
    let input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 2, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);
    let values = extract_values(&result);
    assert_eq!(values.len(), 2);
    // Single value in Auto mode → Copy (repeat constant)
    assert_eq!(values[0], (1, 0, num(3_000_000.0)));
    assert_eq!(values[1], (2, 0, num(3_000_000.0)));
}

#[test]
fn fill_direction_up() {
    let cells = vec![make_source(5, 0, num(3_000_000.0))];
    let input = default_input(
        cells,
        range(5, 0, 5, 0),
        range(3, 0, 4, 0),
        FillDirection::Up,
        FillMode::Auto,
    );
    let result = compute_fill(&input);
    let values = extract_values(&result);
    assert_eq!(values.len(), 2);
    // Single value in Auto mode → Copy (repeat constant)
    assert_eq!(values[0], (3, 0, num(3_000_000.0)));
    assert_eq!(values[1], (4, 0, num(3_000_000.0)));
}

#[test]
fn fill_direction_right() {
    let cells = vec![make_source(0, 0, num(3_000_000.0))];
    let input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(0, 1, 0, 2),
        FillDirection::Right,
        FillMode::Auto,
    );
    let result = compute_fill(&input);
    let values = extract_values(&result);
    assert_eq!(values.len(), 2);
    // Single value in Auto mode → Copy (repeat constant)
    assert_eq!(values[0], (0, 1, num(3_000_000.0)));
    assert_eq!(values[1], (0, 2, num(3_000_000.0)));
}

#[test]
fn fill_direction_left() {
    let cells = vec![make_source(0, 5, num(3_000_000.0))];
    let input = default_input(
        cells,
        range(0, 5, 0, 5),
        range(0, 3, 0, 4),
        FillDirection::Left,
        FillMode::Auto,
    );
    let result = compute_fill(&input);
    let values = extract_values(&result);
    assert_eq!(values.len(), 2);
    // Single value in Auto mode → Copy (repeat constant)
    assert_eq!(values[0], (0, 3, num(3_000_000.0)));
    assert_eq!(values[1], (0, 4, num(3_000_000.0)));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 17. Single cell source — repeats constant (Auto mode)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn single_cell_source_copies_constant() {
    let cells = vec![make_source(0, 0, num(5_000_000.0))];
    let input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 5, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
    let values = extract_values(&result);
    assert_eq!(values.len(), 5);
    // Single constant repeats: all 5M
    for (i, (row, col, val)) in values.iter().enumerate() {
        assert_eq!(*row, 1 + i as u32);
        assert_eq!(*col, 0);
        assert_eq!(*val, num(5_000_000.0));
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 17b. Single cell zero — must NOT increment (regression for MOG_14_1)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn single_cell_zero_repeats_not_increments() {
    let cells = vec![make_source(0, 0, num(0.0))];
    let input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 5, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    assert_eq!(result.detected_pattern.pattern_type, FillPatternType::Copy);
    let values = extract_values(&result);
    assert_eq!(values.len(), 5);
    // All zeros — must NOT produce 0,1,2,3,4
    for (i, (row, col, val)) in values.iter().enumerate() {
        assert_eq!(*row, 1 + i as u32);
        assert_eq!(*col, 0);
        assert_eq!(*val, num(0.0));
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 17c. LinearTrend mode still increments single number
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn linear_trend_mode_single_cell_still_increments() {
    let cells = vec![make_source(0, 0, num(5_000_000.0))];
    let input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(1, 0, 3, 0),
        FillDirection::Down,
        FillMode::LinearTrend,
    );
    let result = compute_fill(&input);

    assert_eq!(
        result.detected_pattern.pattern_type,
        FillPatternType::Linear
    );
    let values = extract_values(&result);
    assert_eq!(values.len(), 3);
    // LinearTrend explicitly requested → 5M+1, 5M+2, 5M+3
    for (i, (row, col, val)) in values.iter().enumerate() {
        assert_eq!(*row, 1 + i as u32);
        assert_eq!(*col, 0);
        assert_eq!(*val, num(5_000_001.0 + i as f64));
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 18. Hidden columns skipped (bonus)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn hidden_cols_skipped() {
    let cells = vec![make_source(0, 0, num(3_000_000.0))];
    let mut input = default_input(
        cells,
        range(0, 0, 0, 0),
        range(0, 1, 0, 4),
        FillDirection::Right,
        FillMode::Copy,
    );
    input.hidden_cols = [2].into();

    let result = compute_fill(&input);
    let values = extract_values(&result);
    // 4 target cols (1-4), 1 hidden (2) → 3 updates
    assert_eq!(values.len(), 3);
    let cols: Vec<u32> = values.iter().map(|(_, c, _)| *c).collect();
    assert!(!cols.contains(&2));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 19. Multi-row linear series with step=2 (bonus)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn linear_series_step_2() {
    let cells = vec![
        make_source(0, 0, num(3_000_000.0)),
        make_source(1, 0, num(3_000_002.0)),
    ];
    let input = default_input(
        cells,
        range(0, 0, 1, 0),
        range(2, 0, 4, 0),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    assert_eq!(
        result.detected_pattern.pattern_type,
        FillPatternType::Linear
    );
    let values = extract_values(&result);
    assert_eq!(values.len(), 3);
    // step=2, last=3M+2: 3M+4, 3M+6, 3M+8
    assert_eq!(values[0].2, num(3_000_004.0));
    assert_eq!(values[1].2, num(3_000_006.0));
    assert_eq!(values[2].2, num(3_000_008.0));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 20. Filled cell count tracking (bonus)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn filled_cell_count_is_accurate() {
    let cells = vec![
        make_source(0, 0, num(3_000_000.0)),
        make_formula_source(0, 1, "{0}", vec![cell_ref(false, false)], vec![(0, 0)]),
    ];
    let input = default_input(
        cells,
        range(0, 0, 0, 1),
        range(1, 0, 3, 1),
        FillDirection::Down,
        FillMode::Auto,
    );
    let result = compute_fill(&input);

    // 3 target rows * 2 cols = 6 total, 3 values + 3 formulas
    assert_eq!(result.filled_cell_count, 6);
}
