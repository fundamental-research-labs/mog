use super::super::*;
use super::helpers::*;

#[test]
fn mixed_criteria_aggregates_reuse_masks_and_refresh_after_edits() {
    let mut cells = Vec::new();
    let mut id = 0xC000;
    let mut data: Vec<(u32, bool, f64)> = (0..256)
        .map(|row| (row % 16, row % 3 != 0, (row + 1) as f64))
        .collect();
    for (row, &(key, keep, value)) in data.iter().enumerate() {
        cells.push(number_cell(&mut id, row as u32, 0, key as f64));
        cells.push(text_cell(
            &mut id,
            row as u32,
            1,
            if keep { "keep" } else { "skip" },
        ));
        cells.push(number_cell(&mut id, row as u32, 2, value));
    }
    for key in 0..16 {
        cells.push(number_cell(&mut id, key, 5, key as f64));
        for (offset, function) in ["SUMIFS", "COUNTIFS", "AVERAGEIFS", "MINIFS", "MAXIFS"]
            .into_iter()
            .enumerate()
        {
            let values = if function == "COUNTIFS" {
                ""
            } else {
                "C1:C256,"
            };
            // A calculated criterion uses ordinary evaluation instead of the
            // prepass's direct-reference pattern, exercising partial masks.
            cells.push(formula_cell(
                &mut id,
                key,
                6 + offset as u32,
                format!(
                    "={function}({values}A1:A256,$F{}+0,B1:B256,\"<>skip\")",
                    key + 1
                ),
            ));
        }
    }
    let (mut core, mut cell_store) = init_core(single_sheet_snapshot("Sheet1", 260, 12, cells));
    let sheet = sid(1);
    let check = |core: &ComputeCore, cell_store: &CellStore, data: &[(u32, bool, f64)]| {
        for key in 0..16 {
            let values: Vec<f64> = data
                .iter()
                .filter(|&&(group, keep, _)| group == key && keep)
                .map(|&(_, _, value)| value)
                .collect();
            let sum: f64 = values.iter().sum();
            let expected = [
                sum,
                values.len() as f64,
                sum / values.len() as f64,
                values.iter().copied().reduce(f64::min).unwrap(),
                values.iter().copied().reduce(f64::max).unwrap(),
            ];
            for (offset, value) in expected.into_iter().enumerate() {
                assert_number_at(
                    core,
                    cell_store,
                    &sheet,
                    key,
                    6 + offset as u32,
                    value,
                    "mixed criteria aggregate",
                );
            }
        }
    };
    check(&core, &cell_store, &data);
    #[cfg(feature = "native")]
    {
        let stats = core.workbook_cache.stats_snapshot();
        assert!(stats.bitmask.rebuilds > 0, "exact filters must build masks");
        assert!(
            stats.bitmask.hits > 0,
            "aggregates must reuse exact filters"
        );
    }
    for (row, col, input) in [(1, 0, "2"), (2, 1, "skip"), (4, 2, "777")] {
        match col {
            0 => data[row as usize].0 = 2,
            1 => data[row as usize].1 = false,
            2 => data[row as usize].2 = 777.0,
            _ => unreachable!(),
        }
        let cell_id = cell_store
            .resolve_cell_id(&sheet, cell_types::SheetPos::new(row, col))
            .unwrap();
        core.set_cell(&mut cell_store, &sheet, cell_id, row, col, input)
            .unwrap();
        check(&core, &cell_store, &data);
    }
}

#[test]
fn mixed_criteria_masks_preserve_missing_null_rows() {
    let mut id = 0xD000;
    let mut cells = vec![number_cell(&mut id, 0, 0, 9.0)];
    for row in 0..5 {
        cells.push(text_cell(&mut id, row, 1, "keep"));
        cells.push(number_cell(&mut id, row, 2, (1 << row) as f64));
    }
    for (row, formula) in [
        "=SUMIFS(C1:C5,A1:A5,\"\",B1:B5,\"<>skip\")",
        "=COUNTIFS(A1:A5,\"\",B1:B5,\"<>skip\")",
        "=SUMIFS(C2:C5,A2:A5,\"\",B2:B5,\"<>skip\")",
    ]
    .into_iter()
    .enumerate()
    {
        cells.push(formula_cell(&mut id, row as u32, 4, formula.into()));
    }
    let (core, cell_store) = init_core(single_sheet_snapshot("Sheet1", 5, 5, cells));
    for (row, expected) in [30.0, 4.0, 30.0].into_iter().enumerate() {
        assert_number_at(
            &core,
            &cell_store,
            &sid(1),
            row as u32,
            4,
            expected,
            "Null tail",
        );
    }
}

#[test]
fn mixed_criteria_masks_preserve_numeric_tolerance_and_first_error() {
    let mut id = 0xE000;
    let mut cells = Vec::new();
    for (row, key) in [1.0, 1.0 + 0.5e-10, 1.0 + 1.5e-10].into_iter().enumerate() {
        cells.push(number_cell(&mut id, row as u32, 0, key));
    }
    cells.push(text_cell(&mut id, 3, 0, "1"));
    let mut boolean = number_cell(&mut id, 4, 0, 0.0);
    boolean.value = CellValue::Boolean(true);
    cells.push(boolean);
    for row in 0..5 {
        cells.push(text_cell(&mut id, row, 1, "keep"));
        cells.push(number_cell(&mut id, row, 2, (1 << row) as f64));
        let mut error = number_cell(&mut id, row, 3, 0.0);
        error.value = CellValue::Error(
            if row == 0 {
                CellError::Div0
            } else {
                CellError::Na
            },
            None,
        );
        cells.push(error);
    }
    for (row, formula) in [
        "=SUMIFS(C1:C5,A1:A5,1,B1:B5,\"<>skip\")",
        "=COUNTIFS(A1:A5,1,B1:B5,\"<>skip\")",
        "=SUMIFS(D1:D5,A1:A5,1,B1:B5,\"<>skip\")",
    ]
    .into_iter()
    .enumerate()
    {
        cells.push(formula_cell(&mut id, row as u32, 5, formula.into()));
    }
    let (core, cell_store) = init_core(single_sheet_snapshot("Sheet1", 5, 6, cells));
    assert_number_at(
        &core,
        &cell_store,
        &sid(1),
        0,
        5,
        11.0,
        "tolerant numeric sum",
    );
    assert_number_at(
        &core,
        &cell_store,
        &sid(1),
        1,
        5,
        3.0,
        "tolerant numeric count",
    );
    assert_error_at(
        &core,
        &cell_store,
        &sid(1),
        2,
        5,
        CellError::Div0,
        "first matching error",
    );
}
