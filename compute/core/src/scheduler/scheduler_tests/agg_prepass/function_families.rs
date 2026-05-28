use super::super::*;
use super::helpers::*;

/// Test single-criteria functions: COUNTIF, SUMIF, AVERAGEIF.
#[test]
fn test_agg_prepass_single_criteria_functions() {
    let categories = [
        "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y",
        "X", "Y",
    ];
    let mut cells = Vec::new();
    let mut id_counter = 0x3000u128;

    for row in 0..20u32 {
        cells.push(text_cell(&mut id_counter, row, 0, categories[row as usize]));
        cells.push(number_cell(&mut id_counter, row, 1, (row + 1) as f64));
    }

    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };

        cells.push(text_cell(&mut id_counter, row, 2, cat));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            3,
            format!("=COUNTIF(A$1:A$20,C{})", row + 1),
        ));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            4,
            format!("=SUMIF(A$1:A$20,C{},B$1:B$20)", row + 1),
        ));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            5,
            format!("=AVERAGEIF(A$1:A$20,C{},B$1:B$20)", row + 1),
        ));
    }

    let (core, mirror) = init_core(single_sheet_snapshot("Sheet1", 20, 6, cells));
    let sheet_id = sid(1);

    for row in 0..10u32 {
        let (exp_count, exp_sum, exp_avg) = if row % 2 == 0 {
            (10.0, 100.0, 10.0)
        } else {
            (10.0, 110.0, 11.0)
        };

        assert_number_at(&core, &mirror, &sheet_id, row, 3, exp_count, "COUNTIF");
        assert_number_at(&core, &mirror, &sheet_id, row, 4, exp_sum, "SUMIF");
        assert_number_at(&core, &mirror, &sheet_id, row, 5, exp_avg, "AVERAGEIF");
    }
}

/// Test mixed static + dynamic criteria.
#[test]
fn test_agg_prepass_mixed_static_dynamic() {
    let mut cells = Vec::new();
    let mut id_counter = 0x6000u128;

    for row in 0..20u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };

        cells.push(text_cell(&mut id_counter, row, 0, cat));
        cells.push(number_cell(
            &mut id_counter,
            row,
            1,
            (row + 1) as f64 * 10.0,
        ));
    }

    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };

        cells.push(text_cell(&mut id_counter, row, 2, cat));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            3,
            format!("=COUNTIFS(A$1:A$20,C{},B$1:B$20,\">100\")", row + 1),
        ));
    }

    let (core, mirror) = init_core(single_sheet_snapshot("Sheet1", 20, 4, cells));
    let sheet_id = sid(1);

    for row in 0..10u32 {
        assert_number_at(
            &core,
            &mirror,
            &sheet_id,
            row,
            3,
            5.0,
            "Mixed criteria COUNTIFS",
        );
    }
}
