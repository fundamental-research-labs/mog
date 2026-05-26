// Regression test: formula cells must be filled with adjusted references.
// Bug: build_adjusted_formula creates CellIds unknown to the mirror,
// causing to_a1_display to produce #REF! instead of valid A1 references.
// This test documents the expected engine-level behavior.
//
// The pure fill engine (compute-fill crate) correctly produces
// FillUpdate::Formula entries with proper AdjustedRef positions. The bug
// is in the storage layer (mutation_auto_fill in engine/mod.rs) where:
//   1. build_adjusted_formula creates new CellIds via grid_id_alloc.next_cell_id()
//   2. These CellIds are registered in grid_indexes but NOT in the CellMirror
//   3. to_a1_display uses MirrorPositionLookup which returns None for unknown CellIds
//   4. format_ref in a1_display.rs produces "#REF!" for None positions
//   5. The formula string ends up as "=#REF!" — never correctly applied

use std::collections::BTreeSet;

use cell_types::CellId;
use compute_fill::engine::compute_fill;
use compute_fill::types::*;
use formula_types::{IdentityCellRef, IdentityFormula, IdentityFormulaRef};
use value_types::{CellValue, FiniteF64};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn num(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::new(v).unwrap())
}

fn cell_ref(row_absolute: bool, col_absolute: bool) -> IdentityFormulaRef {
    IdentityFormulaRef::Cell(IdentityCellRef {
        id: CellId::from_raw(0),
        row_absolute,
        col_absolute,
    })
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Regression tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Filling a formula down 3 rows must produce 3 FillUpdate::Formula entries
/// with adjusted refs that shift the row by the correct delta.
///
/// This proves the engine output is correct — the storage layer bug is in
/// how these AdjustedRef positions are converted back to A1 strings via
/// CellIds that the mirror doesn't know about.
#[test]
fn regression_formula_fill_down_produces_valid_adjusted_refs() {
    // =A1+1 at B1, fill down to B2:B4
    let source = make_formula_source(0, 1, "{0}+1", vec![cell_ref(false, false)], vec![(0, 0)]);
    let input = default_input(
        vec![source],
        range(0, 1, 0, 1),
        range(1, 1, 3, 1),
        FillDirection::Down,
        FillMode::Auto,
    );

    let result = compute_fill(&input);
    let formulas = extract_formulas(&result);

    assert_eq!(
        formulas.len(),
        3,
        "must produce one formula update per target row"
    );

    // Each adjusted ref must point to the correct shifted position
    let expected: Vec<(u32, u32, u32, u32)> = vec![
        (1, 1, 1, 0), // target (1,1) → ref at (1,0)
        (2, 1, 2, 0), // target (2,1) → ref at (2,0)
        (3, 1, 3, 0), // target (3,1) → ref at (3,0)
    ];

    for (i, (exp_row, exp_col, exp_ref_row, exp_ref_col)) in expected.iter().enumerate() {
        let (row, col, refs) = &formulas[i];
        assert_eq!(*row, *exp_row, "formula update {} wrong row", i);
        assert_eq!(*col, *exp_col, "formula update {} wrong col", i);
        assert_eq!(refs.len(), 1, "formula update {} should have 1 ref", i);
        assert_eq!(
            refs[0].target_row, *exp_ref_row,
            "formula update {} ref row: expected {} got {}",
            i, exp_ref_row, refs[0].target_row
        );
        assert_eq!(
            refs[0].target_col, *exp_ref_col,
            "formula update {} ref col: expected {} got {}",
            i, exp_ref_col, refs[0].target_col
        );
        assert!(
            !refs[0].out_of_bounds,
            "formula update {} ref must not be out_of_bounds",
            i
        );
    }
}

/// Filling a formula with multiple refs must adjust ALL refs, not just the first.
#[test]
fn regression_multi_ref_formula_all_refs_adjusted() {
    // =A2+B2 at C2, fill down to C3:C4
    let source = make_formula_source(
        1,
        2,
        "{0}+{1}",
        vec![cell_ref(false, false), cell_ref(false, false)],
        vec![(1, 0), (1, 1)],
    );
    let input = default_input(
        vec![source],
        range(1, 2, 1, 2),
        range(2, 2, 3, 2),
        FillDirection::Down,
        FillMode::Auto,
    );

    let result = compute_fill(&input);
    let formulas = extract_formulas(&result);

    assert_eq!(formulas.len(), 2);

    // Row 2: refs should be (2,0) and (2,1)
    assert_eq!(formulas[0].2.len(), 2, "must have 2 adjusted refs");
    assert_eq!(formulas[0].2[0].target_row, 2);
    assert_eq!(formulas[0].2[0].target_col, 0);
    assert_eq!(formulas[0].2[1].target_row, 2);
    assert_eq!(formulas[0].2[1].target_col, 1);

    // Row 3: refs should be (3,0) and (3,1)
    assert_eq!(formulas[1].2.len(), 2, "must have 2 adjusted refs");
    assert_eq!(formulas[1].2[0].target_row, 3);
    assert_eq!(formulas[1].2[0].target_col, 0);
    assert_eq!(formulas[1].2[1].target_row, 3);
    assert_eq!(formulas[1].2[1].target_col, 1);
}

/// Filling right must adjust column positions, not row positions.
#[test]
fn regression_formula_fill_right_adjusts_columns() {
    // =B1*2 at A1, fill right to B1:D1
    let source = make_formula_source(0, 0, "{0}*2", vec![cell_ref(false, false)], vec![(0, 1)]);
    let input = default_input(
        vec![source],
        range(0, 0, 0, 0),
        range(0, 1, 0, 3),
        FillDirection::Right,
        FillMode::Auto,
    );

    let result = compute_fill(&input);
    let formulas = extract_formulas(&result);

    assert_eq!(formulas.len(), 3);

    // Each target col shifts the ref col by the same delta
    assert_eq!(formulas[0].2[0].target_col, 2); // col 1 → ref col 2
    assert_eq!(formulas[0].2[0].target_row, 0); // row unchanged
    assert_eq!(formulas[1].2[0].target_col, 3); // col 2 → ref col 3
    assert_eq!(formulas[2].2[0].target_col, 4); // col 3 → ref col 4
}

// Full storage-level integration tests that exercise YrsComputeEngine::mutation_auto_fill
// are in auto_fill_integration.rs — they reproduce the #REF! bug (Bug #3) and source
// overwrite bug (Bug #2) through the complete engine pipeline.
