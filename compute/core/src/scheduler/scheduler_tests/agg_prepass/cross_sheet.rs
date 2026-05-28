use super::super::*;
use super::helpers::*;

/// Build a snapshot with data and report sheets for cross-sheet aggregation formulas.
fn agg_cross_sheet_snapshot() -> WorkbookSnapshot {
    let categories = ["Red", "Blue", "Green"];
    let mut data_cells = Vec::new();
    let mut report_cells = Vec::new();
    let mut id_counter = 0x2000u128;

    for row in 0..20u32 {
        let cat = categories[(row % 3) as usize];

        data_cells.push(text_cell(&mut id_counter, row, 0, cat));
        data_cells.push(number_cell(&mut id_counter, row, 1, (row + 1) as f64 * 5.0));
    }

    for row in 0..10u32 {
        let cat = categories[(row % 3) as usize];

        report_cells.push(text_cell(&mut id_counter, row, 0, cat));
        report_cells.push(formula_cell(
            &mut id_counter,
            row,
            1,
            format!("=COUNTIFS(Data!A$1:A$20,A{})", row + 1),
        ));
        report_cells.push(formula_cell(
            &mut id_counter,
            row,
            2,
            format!("=SUMIFS(Data!B$1:B$20,Data!A$1:A$20,A{})", row + 1),
        ));
    }

    workbook_snapshot(vec![
        SheetSnapshot {
            id: cell_id(1),
            name: "Data".to_string(),
            rows: 20,
            cols: 2,
            cells: data_cells,
            ranges: vec![],
        },
        SheetSnapshot {
            id: cell_id(2),
            name: "Report".to_string(),
            rows: 10,
            cols: 3,
            cells: report_cells,
            ranges: vec![],
        },
    ])
}

#[test]
fn test_agg_prepass_cross_sheet_countifs() {
    let (core, mirror) = init_core(agg_cross_sheet_snapshot());
    let report_sid = sid(2);
    let expected_counts = [7.0, 7.0, 6.0, 7.0, 7.0, 6.0, 7.0, 7.0, 6.0, 7.0];

    for row in 0..10u32 {
        assert_number_at(
            &core,
            &mirror,
            &report_sid,
            row,
            1,
            expected_counts[row as usize],
            "Cross-sheet COUNTIFS",
        );
    }
}

#[test]
fn test_agg_prepass_cross_sheet_sumifs() {
    let (core, mirror) = init_core(agg_cross_sheet_snapshot());
    let report_sid = sid(2);
    let expected_sums = [
        350.0, 385.0, 315.0, 350.0, 385.0, 315.0, 350.0, 385.0, 315.0, 350.0,
    ];

    for row in 0..10u32 {
        assert_number_at(
            &core,
            &mirror,
            &report_sid,
            row,
            2,
            expected_sums[row as usize],
            "Cross-sheet SUMIFS",
        );
    }
}
