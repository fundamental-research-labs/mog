//! Baseline benchmarks for the Range refactor.
//!
//! Establishes the pre-Range performance floor across key operations:
//! - Large-column SUM (100k, 500k, 1M rows)
//! - MATCH, INDEX, VLOOKUP, COUNTIFS over 100k rows
//! - DenseColumnCache materialization
//! - Column version bump cost (via cell edit path)
//!
//! Run:
//!   cargo bench -p compute-core --bench range_baseline_bench
//!   cargo bench -p compute-core --bench range_baseline_bench -- --sample-size 10

use criterion::{BenchmarkId, Criterion, black_box, criterion_group, criterion_main};
use std::time::Duration;

use cell_types::{
    CellId, ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetId, SheetPos,
};
use compute_core::mirror::CellMirror;
use compute_core::mirror::dense::DenseColumnCache;
use compute_core::scheduler::ComputeCore;
use snapshot_types::{CellData, RangeData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// UUID helpers (same convention as eval_bench)
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("{:08x}{:08x}{:08x}00000000", sheet_idx, row, col)
}

// ---------------------------------------------------------------------------
// Snapshot builder (matches eval_bench pattern)
// ---------------------------------------------------------------------------

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
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/// Single-sheet snapshot with `rows` f64 values (1.0, 2.0, ...) in column A.
fn numeric_column_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

/// Single-sheet snapshot with f64 in col A and numeric values in col B.
#[allow(dead_code)]
fn two_column_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(2 * rows as usize);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
        c.push((row, 1, CellValue::number(((row + 1) * 10) as f64), None));
    }
    build_snapshot(vec![("Sheet1", rows, 3, c)])
}

/// Numeric column snapshot with a SUM formula in B1.
fn sum_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    // SUM formula in cell B1 (row 0, col 1)
    c.push((0, 1, CellValue::Null, Some(format!("SUM(A1:A{})", rows))));
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

/// Numeric column snapshot with a MATCH formula targeting the last value (exact match).
fn match_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize + 1);
    // Sorted ascending: 1.0, 2.0, ..., rows
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    // MATCH formula in B1 — exact match for the last value
    c.push((
        0,
        1,
        CellValue::Null,
        Some(format!("MATCH({},A1:A{},0)", rows, rows)),
    ));
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

/// Numeric column snapshot with an INDEX formula selecting the midpoint.
fn index_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    let midpoint = rows / 2;
    // INDEX formula in B1
    c.push((
        0,
        1,
        CellValue::Null,
        Some(format!("INDEX(A1:A{},{})", rows, midpoint)),
    ));
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

/// Two-column snapshot with a VLOOKUP formula.
fn vlookup_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> =
        Vec::with_capacity(2 * rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
        c.push((row, 1, CellValue::number(((row + 1) * 10) as f64), None));
    }
    // VLOOKUP formula in C1 — look up the last value
    c.push((
        0,
        2,
        CellValue::Null,
        Some(format!("VLOOKUP({},A1:B{},2,FALSE)", rows, rows)),
    ));
    build_snapshot(vec![("Sheet1", rows, 3, c)])
}

/// Deterministic column snapshot with a COUNTIFS formula.
/// Values: (row % 100) to make the distribution deterministic and predictable.
fn countifs_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row as f64) % 100.0), None));
    }
    // COUNTIFS formula in B1
    c.push((
        0,
        1,
        CellValue::Null,
        Some(format!("COUNTIFS(A1:A{},\">50\")", rows)),
    ));
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

/// Small snapshot for the col-version-bump benchmark: single cell for edit path.
fn small_snapshot() -> WorkbookSnapshot {
    let c = vec![(0u32, 0u32, CellValue::number(1.0), None)];
    build_snapshot(vec![("Sheet1", 100, 2, c)])
}

// ---------------------------------------------------------------------------
// Benchmark: SUM over large columns (100k, 500k, 1M)
// ---------------------------------------------------------------------------

fn bench_sum_column(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_sum");

    // 100k — default sample size
    group.sample_size(20);
    group.bench_function(BenchmarkId::new("sum_column", "100k"), |b| {
        b.iter_with_setup(
            || sum_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    // 500k — reduced sample size + longer measurement
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));
    group.bench_function(BenchmarkId::new("sum_column", "500k"), |b| {
        b.iter_with_setup(
            || sum_snapshot(500_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    // 1M — reduced sample size + longer measurement
    group.bench_function(BenchmarkId::new("sum_column", "1m"), |b| {
        b.iter_with_setup(
            || sum_snapshot(1_000_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: MATCH over 100k rows
// ---------------------------------------------------------------------------

fn bench_match(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_match");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("match_exact", "100k"), |b| {
        b.iter_with_setup(
            || match_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: INDEX over 100k rows
// ---------------------------------------------------------------------------

fn bench_index(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_index");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("index_midpoint", "100k"), |b| {
        b.iter_with_setup(
            || index_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: VLOOKUP over 100k rows
// ---------------------------------------------------------------------------

fn bench_vlookup(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_vlookup");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("vlookup_exact", "100k"), |b| {
        b.iter_with_setup(
            || vlookup_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: COUNTIFS over 100k rows
// ---------------------------------------------------------------------------

fn bench_countifs(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_countifs");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("countifs_gt50", "100k"), |b| {
        b.iter_with_setup(
            || countifs_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: DenseColumnCache::materialize over 100k rows
// ---------------------------------------------------------------------------

fn bench_dense_cache_materialize(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_dense_cache");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("materialize", "100k"), |b| {
        // Pre-build the mirror once; bench only the materialize step.
        let snapshot = numeric_column_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");

        b.iter(|| {
            let mut cache = DenseColumnCache::new();
            let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
            cache.materialize(&sheet_id, 0, sheet_mirror);
            black_box(&cache);
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Column version bump cost (via 10k cell edits)
// ---------------------------------------------------------------------------

fn bench_col_version_bump(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_col_version");
    group.sample_size(20);

    group.bench_function("col_version_read_10k", |b| {
        // Measure the overhead of reading col_version 10k times.
        // col_version() is public; bump is pub(super) so we proxy via reads.
        let snapshot = small_snapshot();
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");

        b.iter(|| {
            for col in 0..10_000u32 {
                black_box(mirror.col_version(&sheet_id, col));
            }
        });
    });

    group.bench_function("cell_edit_10k", |b| {
        // Measure the cost of 10k sequential cell edits, which internally
        // bump col_version on each write.
        let snapshot = small_snapshot();
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cell id");

        let mut toggle = true;
        b.iter(|| {
            for _ in 0..10_000 {
                let val = if toggle { "999" } else { "1" };
                toggle = !toggle;
                let _ = black_box(core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val));
            }
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Eval-only (recalc after cell edit) — isolates formula eval from
// mirror construction / dep-graph build overhead.
// ---------------------------------------------------------------------------

fn bench_eval_only(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_eval_only");
    group.sample_size(20);

    // --- SUM ---
    group.bench_function(BenchmarkId::new("eval_sum", "100k"), |b| {
        let snapshot = sum_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    // --- MATCH ---
    group.bench_function(BenchmarkId::new("eval_match", "100k"), |b| {
        let snapshot = match_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    // --- INDEX ---
    group.bench_function(BenchmarkId::new("eval_index", "100k"), |b| {
        let snapshot = index_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    // --- VLOOKUP ---
    group.bench_function(BenchmarkId::new("eval_vlookup", "100k"), |b| {
        let snapshot = vlookup_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    // --- COUNTIFS ---
    group.bench_function(BenchmarkId::new("eval_countifs", "100k"), |b| {
        let snapshot = countifs_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 0, val)
                    .unwrap(),
            )
        });
    });

    group.finish();
}

// ===========================================================================
// Range-backed helpers and benchmarks
// ===========================================================================

// ---------------------------------------------------------------------------
// Range-backed fixture helpers
// ---------------------------------------------------------------------------

/// Encode a slice of f64 values as little-endian bytes (PayloadEncoding::F64Le).
#[allow(dead_code)]
fn encode_f64_le(values: &[f64]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Deterministic UUID string for a RangeId.
fn range_uuid(idx: u32) -> String {
    format!("b0000000-0000-0000-0000-{:012x}", idx as u64)
}

/// Row ID matching `IdAllocator::new()` convention: row IDs start at 1.
fn yrs_row_id(row_index: usize) -> RowId {
    RowId::from_raw((row_index + 1) as u128)
}

/// Col ID matching `IdAllocator::new()` convention: col IDs start after all rows.
fn yrs_col_id(sheet_rows: usize, col_index: usize) -> ColId {
    ColId::from_raw((sheet_rows + col_index + 1) as u128)
}

/// Build a Range-backed WorkbookSnapshot.
///
/// - `rows`: number of data rows in the range
/// - `cols`: number of data columns in the range
/// - `value_fn`: `(row, col) -> f64` for the Range payload
/// - `formula_cells`: sparse formula cells overlaid on the snapshot (row, col, formula_text)
fn range_backed_snapshot(
    rows: u32,
    cols: u32,
    value_fn: impl Fn(u32, u32) -> f64,
    formula_cells: Vec<(u32, u32, String)>,
) -> WorkbookSnapshot {
    let sheet_rows = rows.max(1) as usize;
    // Reserve extra columns for formula cells
    let max_formula_col = formula_cells.iter().map(|(_, c, _)| *c).max().unwrap_or(0);
    let sheet_cols = (cols.max(1)).max(max_formula_col + 1) as usize;

    // Build payload in row-major order
    let mut payload = Vec::with_capacity(rows as usize * cols as usize * 8);
    for r in 0..rows {
        for c in 0..cols {
            payload.extend_from_slice(&value_fn(r, c).to_le_bytes());
        }
    }

    let row_ids: Vec<RowId> = (0..rows as usize).map(yrs_row_id).collect();
    let col_ids: Vec<ColId> = (0..cols as usize)
        .map(|i| yrs_col_id(sheet_rows, i))
        .collect();

    let range_data = RangeData {
        range_id: RangeId::from_uuid_str(&range_uuid(0)).unwrap(),
        kind: RangeKind::Data,
        anchor: RangeAnchor::Elastic {
            start_row: row_ids[0],
            end_row: row_ids[rows as usize - 1],
            start_col: col_ids[0],
            end_col: col_ids[cols as usize - 1],
        },
        encoding: PayloadEncoding::F64Le,
        payload,
        row_axis: None,
        col_axis: None,
        row_ids: row_ids.clone(),
        col_ids: col_ids.clone(),
    };

    // Formula cells go into CellData (they're separate from the range payload)
    let cells: Vec<CellData> = formula_cells
        .into_iter()
        .map(|(row, col, formula)| CellData {
            cell_id: cell_uuid(0, row, col),
            row,
            col,
            value: CellValue::Null,
            formula: Some(formula),
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: sheet_rows as u32,
            cols: sheet_cols as u32,
            cells,
            ranges: vec![range_data],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Range-backed two-column snapshot (col A and col B) with formula cells.
fn range_backed_two_col_snapshot(
    rows: u32,
    formula_cells: Vec<(u32, u32, String)>,
) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        2,
        |r, c| {
            if c == 0 {
                (r + 1) as f64
            } else {
                ((r + 1) * 10) as f64
            }
        },
        formula_cells,
    )
}

// ---------------------------------------------------------------------------
// Range-backed snapshot factories (mirror per-cell variants above)
// ---------------------------------------------------------------------------

fn range_sum_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        1,
        |r, _| (r + 1) as f64,
        vec![(0, 1, format!("SUM(A1:A{})", rows))],
    )
}

fn range_match_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        1,
        |r, _| (r + 1) as f64,
        vec![(0, 1, format!("MATCH({},A1:A{},0)", rows, rows))],
    )
}

fn range_index_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        1,
        |r, _| (r + 1) as f64,
        vec![(0, 1, format!("INDEX(A1:A{},{})", rows, rows / 2))],
    )
}

fn range_vlookup_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_two_col_snapshot(
        rows,
        vec![(0, 2, format!("VLOOKUP({},A1:B{},2,FALSE)", rows, rows))],
    )
}

fn range_countifs_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(
        rows,
        1,
        |r, _| (r as f64) % 100.0,
        vec![(0, 1, format!("COUNTIFS(A1:A{},\">50\")", rows))],
    )
}

/// Range-backed numeric column (no formula cells) for mirror/cache tests.
fn range_numeric_column_snapshot(rows: u32) -> WorkbookSnapshot {
    range_backed_snapshot(rows, 1, |r, _| (r + 1) as f64, vec![])
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed SUM (init-based, 1M)
// ---------------------------------------------------------------------------

fn bench_range_backed_sum(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_sum");

    group.sample_size(20);
    group.bench_function(BenchmarkId::new("sum_column", "100k"), |b| {
        b.iter_with_setup(
            || range_sum_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.sample_size(10);
    group.measurement_time(Duration::from_secs(30));
    group.bench_function(BenchmarkId::new("sum_column", "1m"), |b| {
        b.iter_with_setup(
            || range_sum_snapshot(1_000_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed MATCH (init-based, 100k)
// ---------------------------------------------------------------------------

fn bench_range_backed_match(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_match");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("match_exact", "100k"), |b| {
        b.iter_with_setup(
            || range_match_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed INDEX (init-based, 100k)
// ---------------------------------------------------------------------------

fn bench_range_backed_index(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_index");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("index_midpoint", "100k"), |b| {
        b.iter_with_setup(
            || range_index_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed VLOOKUP (init-based, 100k)
// ---------------------------------------------------------------------------

fn bench_range_backed_vlookup(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_vlookup");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("vlookup_exact", "100k"), |b| {
        b.iter_with_setup(
            || range_vlookup_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed COUNTIFS (init-based, 100k)
// ---------------------------------------------------------------------------

fn bench_range_backed_countifs(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_countifs");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("countifs_gt50", "100k"), |b| {
        b.iter_with_setup(
            || range_countifs_snapshot(100_000),
            |snapshot| {
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                black_box(core.init_from_snapshot(&mut mirror, snapshot).unwrap())
            },
        );
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed point read (get_cell_value_at on Range-resident cell)
// ---------------------------------------------------------------------------

fn bench_range_backed_point_read(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_point_read");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("point_read", "100k"), |b| {
        let snapshot = range_numeric_column_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let midpoint = SheetPos::new(50_000, 0);

        b.iter(|| {
            black_box(mirror.get_cell_value_at(&sheet_id, midpoint));
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed column slice (cold + warm)
// ---------------------------------------------------------------------------

fn bench_range_backed_col_slice(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_col_slice");
    group.sample_size(20);

    // Cold: re-init each iteration so col_data is freshly populated
    group.bench_function(BenchmarkId::new("cold", "100k"), |b| {
        b.iter_with_setup(
            || {
                let snapshot = range_numeric_column_snapshot(100_000);
                let mut core = ComputeCore::new();
                let mut mirror = CellMirror::new();
                core.init_from_snapshot(&mut mirror, snapshot).unwrap();
                let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
                (mirror, sheet_id)
            },
            |(mirror, sheet_id)| {
                let sheet = mirror.get_sheet(&sheet_id).unwrap();
                black_box(sheet.get_column_slice(0));
            },
        );
    });

    // Warm: same mirror, repeated reads
    group.bench_function(BenchmarkId::new("warm", "100k"), |b| {
        let snapshot = range_numeric_column_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");

        b.iter(|| {
            let sheet = mirror.get_sheet(&sheet_id).unwrap();
            black_box(sheet.get_column_slice(0));
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed DenseColumnCache::materialize
// ---------------------------------------------------------------------------

fn bench_range_backed_dense_cache(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_dense_cache");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("materialize", "100k"), |b| {
        let snapshot = range_numeric_column_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");

        b.iter(|| {
            let mut cache = DenseColumnCache::new();
            let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
            cache.materialize(&sheet_id, 0, sheet_mirror);
            black_box(&cache);
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: Range-backed eval-only (edit → recalc, 100k)
// ---------------------------------------------------------------------------

fn bench_range_backed_eval_only(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_eval_only");
    group.sample_size(20);

    // --- SUM ---
    group.bench_function(BenchmarkId::new("eval_sum", "100k"), |b| {
        let snapshot = range_sum_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            // Edit the SUM formula cell itself to trigger recalc
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 1, val)
                    .unwrap(),
            )
        });
    });

    // --- MATCH ---
    group.bench_function(BenchmarkId::new("eval_match", "100k"), |b| {
        let snapshot = range_match_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 1, val)
                    .unwrap(),
            )
        });
    });

    // --- INDEX ---
    group.bench_function(BenchmarkId::new("eval_index", "100k"), |b| {
        let snapshot = range_index_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 1, val)
                    .unwrap(),
            )
        });
    });

    // --- VLOOKUP ---
    group.bench_function(BenchmarkId::new("eval_vlookup", "100k"), |b| {
        let snapshot = range_vlookup_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 2)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 2, val)
                    .unwrap(),
            )
        });
    });

    // --- COUNTIFS ---
    group.bench_function(BenchmarkId::new("eval_countifs", "100k"), |b| {
        let snapshot = range_countifs_snapshot(100_000);
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        core.init_from_snapshot(&mut mirror, snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sheet id");
        let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("cell id");
        let mut toggle = true;

        b.iter(|| {
            let val = if toggle { "999" } else { "1" };
            toggle = !toggle;
            black_box(
                core.set_cell(&mut mirror, &sheet_id, cell_id, 0, 1, val)
                    .unwrap(),
            )
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

criterion_group!(
    benches,
    bench_sum_column,
    bench_match,
    bench_index,
    bench_vlookup,
    bench_countifs,
    bench_dense_cache_materialize,
    bench_col_version_bump,
    bench_eval_only,
);

criterion_group!(
    range_benches,
    bench_range_backed_sum,
    bench_range_backed_match,
    bench_range_backed_index,
    bench_range_backed_vlookup,
    bench_range_backed_countifs,
    bench_range_backed_point_read,
    bench_range_backed_col_slice,
    bench_range_backed_dense_cache,
    bench_range_backed_eval_only,
);

criterion_main!(benches, range_benches);
