//! Performance benchmarks for the recalc engine.
//!
//! Plan items:
//!   B2c - Dense aggregate: SUM over large columns
//!   B3d - Indexed VLOOKUP: 1000 VLOOKUPs x 100K rows
//!   B6f - Vectorized: 1M row derived column via shared formula pattern
//!   C2  - End-to-end combined: realistic data table scenario
//!
//! Run:
//!   cargo bench -p compute-core --bench eval_bench
//!   cargo bench -p compute-core --bench eval_bench -- --sample-size 10

use criterion::{BenchmarkId, Criterion, black_box, criterion_group, criterion_main};
use std::time::Duration;

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

const NUM_ROWS_1M: u32 = 1_000_000;
const NUM_ROWS_100K: u32 = 100_000;

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!(
        "c{:07x}-{:04x}-{:04x}-0000-000000000000",
        sheet_idx, row, col
    )
}

fn build_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<String>)>)>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula,
                    identity_formula: None,
                    array_ref: None,
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows,
                cols,
                cells: cell_data,
                ranges: vec![],
            }
        })
        .collect();
    WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

fn snapshot_sum_clean(n: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(n as usize + 1);
    for row in 0..n {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    c.push((0, 1, CellValue::Null, Some(format!("SUM(A1:A{})", n))));
    build_snapshot(vec![("Sheet1", n + 1, 2, c)])
}

fn snapshot_sum_with_dirty(n: u32, n_dirty: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(n as usize + 1);
    let step = if n_dirty > 0 { n / n_dirty } else { n + 1 };
    for row in 0..n {
        if n_dirty > 0 && step > 0 && row % step == 0 && (row / step) < n_dirty {
            c.push((row, 0, CellValue::Null, Some(format!("{}*1", row + 1))));
        } else {
            c.push((row, 0, CellValue::number((row + 1) as f64), None));
        }
    }
    c.push((0, 1, CellValue::Null, Some(format!("SUM(A1:A{})", n))));
    build_snapshot(vec![("Sheet1", n + 1, 2, c)])
}

fn snapshot_vectorized_multiply(n: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(2 * n as usize);
    for row in 0..n {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
        c.push((row, 1, CellValue::Null, Some(format!("A{}*2", row + 1))));
    }
    build_snapshot(vec![("Sheet1", n, 2, c)])
}

fn snapshot_vectorized_with_sum(n: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(2 * n as usize + 1);
    for row in 0..n {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
        c.push((row, 1, CellValue::Null, Some(format!("A{}*2", row + 1))));
    }
    c.push((0, 2, CellValue::Null, Some(format!("SUM(B1:B{})", n))));
    build_snapshot(vec![("Sheet1", n, 3, c)])
}

fn snapshot_e2e_data_table(n: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(3 * n as usize + 6);
    for row in 0..n {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
        c.push((row, 1, CellValue::Null, Some(format!("A{}*1.1", row + 1))));
        c.push((
            row,
            2,
            CellValue::Null,
            Some(format!("A{}+B{}", row + 1, row + 1)),
        ));
    }
    c.push((0, 3, CellValue::Null, Some(format!("SUM(A1:A{})", n))));
    c.push((1, 3, CellValue::Null, Some(format!("SUM(B1:B{})", n))));
    c.push((2, 3, CellValue::Null, Some(format!("SUM(C1:C{})", n))));
    c.push((3, 3, CellValue::Null, Some(format!("AVERAGE(A1:A{})", n))));
    c.push((4, 3, CellValue::Null, Some(format!("MIN(A1:A{})", n))));
    c.push((5, 3, CellValue::Null, Some(format!("MAX(A1:A{})", n))));
    build_snapshot(vec![("Sheet1", n, 4, c)])
}

/// Build a snapshot with 100K rows of data in columns A-B and `n_lookups`
/// VLOOKUP formulas in column C. Each VLOOKUP does an exact match on column A
/// and returns column B's value.
///
/// Layout:
///   A1:A{n}     = key data   (1, 2, 3, ..., n)
///   B1:B{n}     = value data (key * 10)
///   C1:C{n_lkp} = VLOOKUP(lookup_val, $A$1:$B${n}, 2, FALSE)
///
/// Lookup values are spread uniformly across the key range.
fn snapshot_vlookup(n_data_rows: u32, n_lookups: u32) -> WorkbookSnapshot {
    let total = n_data_rows as usize + n_lookups as usize;
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(2 * total);

    // Data columns A and B
    for row in 0..n_data_rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
        c.push((row, 1, CellValue::number(((row + 1) * 10) as f64), None));
    }

    // VLOOKUP formulas in column C (on rows 0..n_lookups)
    let step = if n_lookups > 0 {
        n_data_rows / n_lookups
    } else {
        1
    };
    for i in 0..n_lookups {
        let lookup_val = (i * step + 1).min(n_data_rows);
        c.push((
            i,
            2,
            CellValue::Null,
            Some(format!(
                "VLOOKUP({},A1:B{},2,FALSE)",
                lookup_val, n_data_rows
            )),
        ));
    }

    build_snapshot(vec![("Sheet1", n_data_rows, 3, c)])
}

fn bench_vlookup(c: &mut Criterion) {
    let mut group = c.benchmark_group("B3d_vlookup");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));

    // Init with 1000 VLOOKUPs x 100K data rows
    group.bench_function(BenchmarkId::new("1000_vlookups_init", "100k_rows"), |b| {
        b.iter_with_setup(
            || snapshot_vlookup(NUM_ROWS_100K, 1000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    // Partial recalc: change one data cell, triggers re-evaluation of dependent VLOOKUPs
    group.bench_function(
        BenchmarkId::new("1000_vlookups_partial_recalc", "100k_rows"),
        |b| {
            let snapshot = snapshot_vlookup(NUM_ROWS_100K, 1000);
            let mut core = ComputeCore::new();
            let mut mirror = CellMirror::new();
            core.init_from_snapshot(&mut mirror, snapshot).unwrap();
            let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
            // Change data cell A1 (row 0, col 0) — affects lookups targeting key=1
            let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cid");
            let mut toggle = true;
            b.iter(|| {
                let val = if toggle { "999999" } else { "1" };
                toggle = !toggle;
                black_box(
                    core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                        .unwrap(),
                )
            });
        },
    );

    // Larger: 1000 VLOOKUPs on column B (value column changed) — all lookups re-evaluated
    group.bench_function(
        BenchmarkId::new("1000_vlookups_value_col_recalc", "100k_rows"),
        |b| {
            let snapshot = snapshot_vlookup(NUM_ROWS_100K, 1000);
            let mut core = ComputeCore::new();
            let mut mirror = CellMirror::new();
            core.init_from_snapshot(&mut mirror, snapshot).unwrap();
            let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
            // Change value cell B1 (row 0, col 1) — affects all lookups via table range dependency
            let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("cid");
            let mut toggle = true;
            b.iter(|| {
                let val = if toggle { "99" } else { "10" };
                toggle = !toggle;
                black_box(
                    core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 1, val)
                        .unwrap(),
                )
            });
        },
    );

    group.finish();
}

fn bench_sum_clean_column(c: &mut Criterion) {
    let mut group = c.benchmark_group("B2c_dense_aggregate");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));

    group.bench_function(BenchmarkId::new("sum_clean_init", "100k"), |b| {
        b.iter_with_setup(
            || snapshot_sum_clean(NUM_ROWS_100K),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(BenchmarkId::new("sum_clean_partial_recalc", "100k"), |b| {
        let snapshot = snapshot_sum_clean(NUM_ROWS_100K);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cid");
        let mut toggle = true;
        b.iter(|| {
            let val = if toggle { "999999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    group.bench_function(BenchmarkId::new("sum_clean_init", "1m"), |b| {
        b.iter_with_setup(
            || snapshot_sum_clean(NUM_ROWS_1M),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(BenchmarkId::new("sum_clean_partial_recalc", "1m"), |b| {
        let snapshot = snapshot_sum_clean(NUM_ROWS_1M);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cid");
        let mut toggle = true;
        b.iter(|| {
            let val = if toggle { "999999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    group.finish();
}

fn bench_sum_with_dirty_cells(c: &mut Criterion) {
    let mut group = c.benchmark_group("B2c_dense_aggregate_dirty");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));

    group.bench_function(BenchmarkId::new("sum_50_dirty_init", "100k"), |b| {
        b.iter_with_setup(
            || snapshot_sum_with_dirty(NUM_ROWS_100K, 50),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(
        BenchmarkId::new("sum_50_dirty_partial_recalc", "100k"),
        |b| {
            let snapshot = snapshot_sum_with_dirty(NUM_ROWS_100K, 50);
            let mut core = ComputeCore::new();
            let mut mirror = CellMirror::new();
            core.init_from_snapshot(&mut mirror, snapshot).unwrap();
            let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
            let cell_id = CellId::from_uuid_str(&cell_uuid(0, 1, 0)).expect("cid");
            let mut toggle = true;
            b.iter(|| {
                let val = if toggle { "999999" } else { "2" };
                toggle = !toggle;
                black_box(
                    core.set_cell(&mut mirror, &sheet_id, cell_id, 1, 0, val)
                        .unwrap(),
                )
            });
        },
    );

    group.bench_function(BenchmarkId::new("sum_50_dirty_init", "1m"), |b| {
        b.iter_with_setup(
            || snapshot_sum_with_dirty(NUM_ROWS_1M, 50),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(BenchmarkId::new("sum_50_dirty_partial_recalc", "1m"), |b| {
        let snapshot = snapshot_sum_with_dirty(NUM_ROWS_1M, 50);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 1, 0)).expect("cid");
        let mut toggle = true;
        b.iter(|| {
            let val = if toggle { "999999" } else { "2" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 1, 0, val)
                    .unwrap(),
            )
        });
    });

    group.finish();
}

fn bench_vectorized_multiply(c: &mut Criterion) {
    let mut group = c.benchmark_group("B6f_vectorized");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));

    group.bench_function(BenchmarkId::new("multiply_init", "100k"), |b| {
        b.iter_with_setup(
            || snapshot_vectorized_multiply(NUM_ROWS_100K),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(BenchmarkId::new("multiply_partial_recalc", "100k"), |b| {
        let snapshot = snapshot_vectorized_multiply(NUM_ROWS_100K);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cid");
        let mut toggle = true;
        b.iter(|| {
            let val = if toggle { "999999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    group.bench_function(BenchmarkId::new("multiply_init", "1m"), |b| {
        b.iter_with_setup(
            || snapshot_vectorized_multiply(NUM_ROWS_1M),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(BenchmarkId::new("multiply_partial_recalc", "1m"), |b| {
        let snapshot = snapshot_vectorized_multiply(NUM_ROWS_1M);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cid");
        let mut toggle = true;
        b.iter(|| {
            let val = if toggle { "999999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    group.finish();
}

fn bench_vectorized_with_downstream_sum(c: &mut Criterion) {
    let mut group = c.benchmark_group("B6f_vectorized_with_sum");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));

    group.bench_function(BenchmarkId::new("vec_plus_sum_init", "100k"), |b| {
        b.iter_with_setup(
            || snapshot_vectorized_with_sum(NUM_ROWS_100K),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(
        BenchmarkId::new("vec_plus_sum_partial_recalc", "100k"),
        |b| {
            let snapshot = snapshot_vectorized_with_sum(NUM_ROWS_100K);
            let mut core = ComputeCore::new();
            let mut mirror = CellMirror::new();
            core.init_from_snapshot(&mut mirror, snapshot).unwrap();
            let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
            let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cid");
            let mut toggle = true;
            b.iter(|| {
                let val = if toggle { "999999" } else { "1" };
                toggle = !toggle;
                black_box(
                    core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                        .unwrap(),
                )
            });
        },
    );

    group.bench_function(BenchmarkId::new("vec_plus_sum_init", "1m"), |b| {
        b.iter_with_setup(
            || snapshot_vectorized_with_sum(NUM_ROWS_1M),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(BenchmarkId::new("vec_plus_sum_partial_recalc", "1m"), |b| {
        let snapshot = snapshot_vectorized_with_sum(NUM_ROWS_1M);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cid");
        let mut toggle = true;
        b.iter(|| {
            let val = if toggle { "999999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    group.finish();
}

fn bench_e2e_data_table(c: &mut Criterion) {
    let mut group = c.benchmark_group("C2_e2e_data_table");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(60));

    group.bench_function(BenchmarkId::new("data_table_init", "100k"), |b| {
        b.iter_with_setup(
            || snapshot_e2e_data_table(NUM_ROWS_100K),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.bench_function(
        BenchmarkId::new("data_table_partial_recalc_single", "100k"),
        |b| {
            let snapshot = snapshot_e2e_data_table(NUM_ROWS_100K);
            let mut core = ComputeCore::new();
            let mut mirror = CellMirror::new();
            core.init_from_snapshot(&mut mirror, snapshot).unwrap();
            let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
            let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cid");
            let mut toggle = true;
            b.iter(|| {
                let val = if toggle { "999999" } else { "1" };
                toggle = !toggle;
                black_box(
                    core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                        .unwrap(),
                )
            });
        },
    );

    group.finish();
}

criterion_group!(
    benches,
    bench_sum_clean_column,
    bench_sum_with_dirty_cells,
    bench_vlookup,
    bench_vectorized_multiply,
    bench_vectorized_with_downstream_sum,
    bench_e2e_data_table
);
criterion_main!(benches);
