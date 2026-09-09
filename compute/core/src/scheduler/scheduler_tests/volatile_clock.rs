use super::*;

use crate::snapshot::{CellData, RecalcOptions, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

const SHEET_ID: &str = "00000000-0000-0000-0000-000000000001";
const FIRST_CELL_SUFFIX: u128 = 0x1000;
const COMPOSITION_FIRST_CELL_SUFFIX: u128 = 0x2000;
const FIXED_TIMESTAMP: f64 = 46_273.75;
const COMPOSITION_TIMESTAMP: f64 = 45_292.75;

fn composition_cell_id(index: usize) -> CellId {
    CellId::from_uuid_str(&format!(
        "00000000-0000-0000-0000-{:012x}",
        COMPOSITION_FIRST_CELL_SUFFIX + index as u128
    ))
    .unwrap()
}

fn volatile_snapshot(count: usize) -> WorkbookSnapshot {
    let cells = (0..count)
        .map(|index| CellData {
            cell_id: format!(
                "00000000-0000-0000-0000-{:012x}",
                FIRST_CELL_SUFFIX + index as u128
            ),
            row: index as u32,
            col: 0,
            value: CellValue::Null,
            formula: Some(if index % 2 == 0 {
                "=NOW()".to_string()
            } else {
                "=TODAY()".to_string()
            }),
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: vec![],
            row_axis: None,
            col_axis: None,
            id: SHEET_ID.to_string(),
            name: "Sheet1".to_string(),
            rows: count as u32,
            cols: 1,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
        ..Default::default()
    }
}

fn date_composition_snapshot(date1904: bool) -> WorkbookSnapshot {
    let january_first = if date1904 { 43_830.0 } else { 45_292.0 };
    let february_first = if date1904 { 43_861.0 } else { 45_323.0 };
    let formulas = [
        "=NOW()".to_string(),
        "=TODAY()".to_string(),
        "=YEAR(NOW())".to_string(),
        "=MONTH(TODAY())".to_string(),
        "=DAY(TODAY())".to_string(),
        "=DATE(2024,1,1)".to_string(),
        "=DATEVALUE(\"2024-01-01\")".to_string(),
        "=EPOCHTODATE(0)".to_string(),
        format!("=YEAR({{{january_first};{february_first}}})"),
        format!("=MONTH({{{january_first};{february_first}}})"),
        "=DATE({2024;2024},{1;2},1)".to_string(),
        "=DATEVALUE({\"2024-01-01\";\"2024-02-01\"})".to_string(),
        "=EPOCHTODATE({0;86400})".to_string(),
    ];
    let formula_count = formulas.len();
    let cells = formulas
        .into_iter()
        .enumerate()
        .map(|(index, formula)| CellData {
            cell_id: composition_cell_id(index).to_uuid_string(),
            row: 0,
            col: index as u32,
            value: CellValue::Null,
            formula: Some(formula),
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: vec![],
            row_axis: None,
            col_axis: None,
            id: SHEET_ID.to_string(),
            name: "Sheet1".to_string(),
            rows: 2,
            cols: formula_count as u32,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
        ..Default::default()
    }
}

fn recalc_options() -> RecalcOptions {
    RecalcOptions {
        iterative: None,
        max_iterations: None,
        max_change: None,
        timestamp_serial: Some(FiniteF64::must(FIXED_TIMESTAMP)),
    }
}

fn run_fixed_recalc(
    count: usize,
    date1904: bool,
) -> (ComputeCore, CellMirror, snapshot_types::RecalcResult) {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, volatile_snapshot(count))
        .expect("volatile snapshot should initialize");
    mirror.date1904 = date1904;
    let result = core
        .full_recalc_with_options(&mut mirror, &recalc_options())
        .expect("fixed-clock recalc should succeed");
    (core, mirror, result)
}

fn run_session_recalc(
    count: usize,
    date1904: bool,
) -> (ComputeCore, CellMirror, snapshot_types::RecalcResult) {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, volatile_snapshot(count))
        .expect("volatile snapshot should initialize");
    mirror.date1904 = date1904;
    let result = core
        .full_recalc(&mut mirror)
        .expect("session-clock recalc should succeed");
    (core, mirror, result)
}

fn volatile_values(mirror: &CellMirror, count: usize) -> Vec<CellValue> {
    (0..count)
        .map(|index| {
            let cell_id = CellId::from_uuid_str(&format!(
                "00000000-0000-0000-0000-{:012x}",
                FIRST_CELL_SUFFIX + index as u128
            ))
            .unwrap();
            mirror.get_cell_value(&cell_id).cloned().unwrap()
        })
        .collect()
}

fn composition_values(mirror: &CellMirror) -> Vec<CellValue> {
    (0..13)
        .map(|index| {
            mirror
                .get_cell_value_raw(&composition_cell_id(index))
                .cloned()
                .unwrap()
        })
        .collect()
}

#[test]
fn fixed_clock_makes_sequential_and_parallel_now_today_equivalent() {
    for date1904 in [false, true] {
        let (_sequential_core, sequential_mirror, sequential_result) =
            run_fixed_recalc(8, date1904);
        let (_parallel_core, parallel_mirror, parallel_result) = run_fixed_recalc(600, date1904);

        assert_eq!(sequential_result.metrics.levels_parallel, 0);
        assert!(parallel_result.metrics.levels_parallel > 0);

        let sequential = volatile_values(&sequential_mirror, 8);
        let parallel = volatile_values(&parallel_mirror, 600);
        let timestamp = if date1904 {
            FIXED_TIMESTAMP - crate::eval::clock::DATE_SYSTEM_1904_OFFSET
        } else {
            FIXED_TIMESTAMP
        };
        for (index, value) in sequential.iter().enumerate() {
            let expected = if index % 2 == 0 {
                CellValue::number(timestamp)
            } else {
                CellValue::number(timestamp.floor())
            };
            assert_eq!(value, &expected, "sequential volatile cell {index}");
            assert_eq!(parallel[index], expected, "parallel volatile cell {index}");
        }
    }
}

#[test]
fn fixed_clock_date_functions_compose_in_both_workbook_date_systems() {
    for date1904 in [false, true] {
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, date_composition_snapshot(date1904))
            .expect("date composition snapshot should initialize");
        mirror.date1904 = date1904;
        core.full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: None,
                max_iterations: None,
                max_change: None,
                timestamp_serial: Some(FiniteF64::must(COMPOSITION_TIMESTAMP)),
            },
        )
        .expect("date composition recalc should succeed");

        let values = composition_values(&mirror);
        let timestamp = if date1904 {
            COMPOSITION_TIMESTAMP - crate::eval::clock::DATE_SYSTEM_1904_OFFSET
        } else {
            COMPOSITION_TIMESTAMP
        };
        let january_first = if date1904 { 43_830.0 } else { 45_292.0 };
        let february_first = if date1904 { 43_861.0 } else { 45_323.0 };
        assert_eq!(values[0], CellValue::number(timestamp));
        assert_eq!(values[1], CellValue::number(timestamp.floor()));
        assert_eq!(values[2], CellValue::number(2024.0));
        assert_eq!(values[3], CellValue::number(1.0));
        assert_eq!(values[4], CellValue::number(1.0));
        assert_eq!(values[5], CellValue::number(january_first));
        assert_eq!(values[6], CellValue::number(january_first));
        assert_eq!(
            values[7],
            CellValue::number(if date1904 { 24_107.0 } else { 25_569.0 })
        );
        assert_eq!(
            values[8],
            CellValue::from_rows(vec![
                vec![CellValue::number(2024.0)],
                vec![CellValue::number(2024.0)],
            ])
        );
        assert_eq!(
            values[9],
            CellValue::from_rows(vec![
                vec![CellValue::number(1.0)],
                vec![CellValue::number(2.0)],
            ])
        );
        assert_eq!(
            values[10],
            CellValue::from_rows(vec![
                vec![CellValue::number(january_first)],
                vec![CellValue::number(february_first)],
            ])
        );
        assert_eq!(
            values[11],
            CellValue::from_rows(vec![
                vec![CellValue::number(january_first)],
                vec![CellValue::number(february_first)],
            ])
        );
        assert_eq!(
            values[12],
            CellValue::from_rows(vec![
                vec![CellValue::number(if date1904 {
                    24_107.0
                } else {
                    25_569.0
                })],
                vec![CellValue::number(if date1904 {
                    24_108.0
                } else {
                    25_570.0
                })],
            ])
        );
    }
}

#[cfg(feature = "native")]
#[test]
fn injected_session_clock_reaches_parallel_workers() {
    crate::eval::clock::set_current_time(FIXED_TIMESTAMP);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        [false, true]
            .into_iter()
            .map(|date1904| {
                let (_core, mirror, result) = run_session_recalc(600, date1904);
                (
                    date1904,
                    volatile_values(&mirror, 600),
                    result.metrics.levels_parallel,
                )
            })
            .collect::<Vec<_>>()
    }));
    crate::eval::clock::set_current_time(0.0);

    for (date1904, values, parallel_levels) in
        result.expect("session-clock recalc should not panic")
    {
        assert!(parallel_levels > 0);
        let timestamp = if date1904 {
            FIXED_TIMESTAMP - crate::eval::clock::DATE_SYSTEM_1904_OFFSET
        } else {
            FIXED_TIMESTAMP
        };
        for (index, value) in values.iter().enumerate() {
            let expected = if index % 2 == 0 {
                CellValue::number(timestamp)
            } else {
                CellValue::number(timestamp.floor())
            };
            assert_eq!(value, &expected, "session volatile cell {index}");
        }
    }
}

#[test]
fn explicit_zero_clock_is_valid_in_both_workbook_date_systems() {
    for date1904 in [false, true] {
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, volatile_snapshot(2))
            .expect("volatile snapshot should initialize");
        mirror.date1904 = date1904;
        core.full_recalc_with_options(
            &mut mirror,
            &RecalcOptions {
                iterative: None,
                max_iterations: None,
                max_change: None,
                timestamp_serial: Some(FiniteF64::must(0.0)),
            },
        )
        .expect("zero timestamp recalc should succeed");

        let values = volatile_values(&mirror, 2);
        let expected_now = if date1904 {
            -crate::eval::clock::DATE_SYSTEM_1904_OFFSET
        } else {
            0.0
        };
        assert_eq!(values[0], CellValue::number(expected_now));
        assert_eq!(values[1], CellValue::number(expected_now.floor()));
    }
}

#[test]
fn invalid_session_clock_values_do_not_poison_or_clear_a_valid_override() {
    crate::eval::clock::set_current_time(FIXED_TIMESTAMP);
    crate::eval::clock::set_current_time(f64::NAN);
    assert_eq!(
        crate::eval::clock::injected_serial_timestamp(),
        Some(FIXED_TIMESTAMP)
    );
    crate::eval::clock::set_current_time(f64::INFINITY);
    assert_eq!(
        crate::eval::clock::injected_serial_timestamp(),
        Some(FIXED_TIMESTAMP)
    );

    // Zero remains the documented compatibility clear operation.
    crate::eval::clock::set_current_time(0.0);
    assert_eq!(crate::eval::clock::injected_serial_timestamp(), None);
}
