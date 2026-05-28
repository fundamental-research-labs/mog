use super::bench_helpers::{cell_id, init_snapshot, sheet_id};
use super::cell_fixtures::{
    countifs_snapshot, index_snapshot, match_snapshot, numeric_column_snapshot, small_snapshot,
    sum_snapshot, vlookup_snapshot,
};
use super::support::{cell_uuid, sheet_uuid};
use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::mirror::dense::DenseColumnCache;
use compute_core::scheduler::ComputeCore;
use criterion::{BenchmarkId, Criterion, black_box};
use std::time::Duration;

pub(crate) fn bench_sum_column(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_sum");

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

pub(crate) fn bench_match(c: &mut Criterion) {
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

pub(crate) fn bench_index(c: &mut Criterion) {
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

pub(crate) fn bench_vlookup(c: &mut Criterion) {
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

pub(crate) fn bench_countifs(c: &mut Criterion) {
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

pub(crate) fn bench_dense_cache_materialize(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_dense_cache");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("materialize", "100k"), |b| {
        let snapshot = numeric_column_snapshot(100_000);
        let (_core, mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);

        b.iter(|| {
            let mut cache = DenseColumnCache::new();
            let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
            cache.materialize(&sheet_id, 0, sheet_mirror);
            black_box(&cache);
        });
    });

    group.finish();
}

pub(crate) fn bench_col_version_bump(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_col_version");
    group.sample_size(20);

    group.bench_function("col_version_read_10k", |b| {
        let snapshot = small_snapshot();
        let (_core, mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);

        b.iter(|| {
            for col in 0..10_000u32 {
                black_box(mirror.col_version(&sheet_id, col));
            }
        });
    });

    group.bench_function("cell_edit_10k", |b| {
        let snapshot = small_snapshot();
        let (mut core, mut mirror) = init_snapshot(snapshot);
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

pub(crate) fn bench_eval_only(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_baseline_eval_only");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("eval_sum", "100k"), |b| {
        let snapshot = sum_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 0);
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

    group.bench_function(BenchmarkId::new("eval_match", "100k"), |b| {
        let snapshot = match_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 0);
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

    group.bench_function(BenchmarkId::new("eval_index", "100k"), |b| {
        let snapshot = index_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 0);
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

    group.bench_function(BenchmarkId::new("eval_vlookup", "100k"), |b| {
        let snapshot = vlookup_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 0);
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

    group.bench_function(BenchmarkId::new("eval_countifs", "100k"), |b| {
        let snapshot = countifs_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 0);
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
