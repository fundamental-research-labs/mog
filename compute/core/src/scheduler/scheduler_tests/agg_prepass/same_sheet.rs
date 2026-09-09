use super::super::*;
use super::helpers::*;

/// Build a snapshot for same-sheet COUNTIFS testing.
///
/// Single sheet with 20 data rows + 10 formula rows:
///   Col A: category, Col B: region, Col C: value, Col D: criteria,
///   Col E: COUNTIFS, Col F: SUMIFS, Col G: AVERAGEIFS.
fn agg_same_sheet_snapshot() -> WorkbookSnapshot {
    let categories = ["Alpha", "Beta", "Gamma", "Delta"];
    let mut cells = Vec::new();
    let mut id_counter = 0x1000u128;

    for row in 0..20u32 {
        let cat = categories[(row % 4) as usize];
        let region = if row % 2 == 0 { "East" } else { "West" };

        cells.push(text_cell(&mut id_counter, row, 0, cat));
        cells.push(text_cell(&mut id_counter, row, 1, region));
        cells.push(number_cell(
            &mut id_counter,
            row,
            2,
            (row + 1) as f64 * 10.0,
        ));
    }

    for row in 0..10u32 {
        let cat = categories[(row % 4) as usize];

        cells.push(text_cell(&mut id_counter, row, 3, cat));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            4,
            format!("=COUNTIFS(A$1:A$20,D{})", row + 1),
        ));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            5,
            format!("=SUMIFS(C$1:C$20,A$1:A$20,D{})", row + 1),
        ));
        cells.push(formula_cell(
            &mut id_counter,
            row,
            6,
            format!("=AVERAGEIFS(C$1:C$20,A$1:A$20,D{})", row + 1),
        ));
    }

    single_sheet_snapshot("Sheet1", 20, 7, cells)
}

fn expected_agg_values() -> Vec<(f64, f64, f64)> {
    let counts = [5.0; 10];
    let sums = [
        450.0, 500.0, 550.0, 600.0, 450.0, 500.0, 550.0, 600.0, 450.0, 500.0,
    ];
    let avgs = [
        90.0, 100.0, 110.0, 120.0, 90.0, 100.0, 110.0, 120.0, 90.0, 100.0,
    ];

    (0..10).map(|i| (counts[i], sums[i], avgs[i])).collect()
}

#[test]
fn test_agg_prepass_same_sheet_countifs() {
    let (core, mirror) = init_core(agg_same_sheet_snapshot());
    let expected = expected_agg_values();
    let sheet_id = sid(1);

    for row in 0..10u32 {
        assert_number_at(
            &core,
            &mirror,
            &sheet_id,
            row,
            4,
            expected[row as usize].0,
            "COUNTIFS",
        );
    }
}

#[test]
fn test_agg_prepass_same_sheet_sumifs() {
    let (core, mirror) = init_core(agg_same_sheet_snapshot());
    let expected = expected_agg_values();
    let sheet_id = sid(1);

    for row in 0..10u32 {
        assert_number_at(
            &core,
            &mirror,
            &sheet_id,
            row,
            5,
            expected[row as usize].1,
            "SUMIFS",
        );
    }
}

#[test]
fn test_agg_prepass_same_sheet_averageifs() {
    let (core, mirror) = init_core(agg_same_sheet_snapshot());
    let expected = expected_agg_values();
    let sheet_id = sid(1);

    for row in 0..10u32 {
        assert_number_at(
            &core,
            &mirror,
            &sheet_id,
            row,
            6,
            expected[row as usize].2,
            "AVERAGEIFS",
        );
    }
}

#[test]
fn test_agg_prepass_return_boundary_flushes_subnormal() {
    // Eight matching rows sum to MIN_POSITIVE / 2.0, so the prepass return
    // itself is subnormal and must be normalized by run_agg_prepass.
    let subnormal = f64::MIN_POSITIVE / 16.0;
    let mut cells = Vec::new();
    let mut id_counter = 0x7000u128;

    for row in 0..8u32 {
        cells.push(text_cell(&mut id_counter, row, 0, "X"));
        cells.push(number_cell(&mut id_counter, row, 1, subnormal));
        cells.push(text_cell(&mut id_counter, row, 2, "X"));
    }
    for row in 0..8u32 {
        cells.push(formula_cell(
            &mut id_counter,
            row,
            3,
            format!("=SUMIFS(B$1:B$8,A$1:A$8,C{})", row + 1),
        ));
    }

    let (mut core, mirror) = init_core(single_sheet_snapshot("Sheet1", 8, 4, cells));
    let sheet_id = sid(1);
    let dirty = (0..8u32)
        .map(|row| {
            mirror
                .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
                .expect("SUMIFS formula cell")
        })
        .collect::<rustc_hash::FxHashSet<_>>();
    let already_evaluated = rustc_hash::FxHashSet::default();
    let epoch = core.begin_sumifs_cache_epoch();
    let (results, _) = core.run_agg_prepass(&mirror, &dirty, &already_evaluated, epoch);

    assert_eq!(results.len(), 8);
    assert!(
        results
            .iter()
            .all(|(_, value)| *value == CellValue::number(0.0))
    );
}
