use super::super::*;
use super::helpers::*;

/// Test MAXIFS and MINIFS extrema for matching rows.
#[test]
fn test_agg_prepass_maxifs_minifs() {
    let mut cells = Vec::new();
    let mut id_counter = 0x4000u128;

    for row in 0..15u32 {
        let cat = if row % 2 == 0 { "A" } else { "B" };

        cells.push(text_cell(&mut id_counter, row, 0, cat));
        cells.push(number_cell(
            &mut id_counter,
            row,
            1,
            (row + 1) as f64 * 10.0,
        ));
    }

    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "A" } else { "B" };

        cells.push(text_cell(&mut id_counter, row, 2, cat));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            3,
            format!("=MAXIFS(B$1:B$15,A$1:A$15,C{})", row + 1),
        ));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            4,
            format!("=MINIFS(B$1:B$15,A$1:A$15,C{})", row + 1),
        ));
    }

    let (core, mirror) = init_core(single_sheet_snapshot("Sheet1", 15, 5, cells));
    let sheet_id = sid(1);

    for row in 0..10u32 {
        let (exp_max, exp_min) = if row % 2 == 0 {
            (150.0, 10.0)
        } else {
            (140.0, 20.0)
        };

        assert_number_at(&core, &mirror, &sheet_id, row, 3, exp_max, "MAXIFS");
        assert_number_at(&core, &mirror, &sheet_id, row, 4, exp_min, "MINIFS");
    }
}

/// Test AVERAGEIFS returns #DIV/0! when no rows match the criteria.
#[test]
fn test_agg_prepass_averageifs_no_match_div0() {
    let mut cells = Vec::new();
    let mut id_counter = 0x5000u128;

    for row in 0..10u32 {
        cells.push(text_cell(&mut id_counter, row, 0, "Exists"));
        cells.push(number_cell(&mut id_counter, row, 1, (row + 1) as f64));
    }

    for row in 0..10u32 {
        cells.push(text_cell(&mut id_counter, row, 2, "Missing"));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            3,
            format!("=AVERAGEIFS(B$1:B$10,A$1:A$10,C{})", row + 1),
        ));
    }

    let (core, mirror) = init_core(single_sheet_snapshot("Sheet1", 10, 4, cells));
    let sheet_id = sid(1);

    for row in 0..10u32 {
        assert_error_at(
            &core,
            &mirror,
            &sheet_id,
            row,
            3,
            CellError::Div0,
            "AVERAGEIFS no-match",
        );
    }
}
