use super::bench_helpers::{cell_id, init_snapshot, sheet_id};
use super::range_fixtures::{
    range_countifs_snapshot, range_index_snapshot, range_match_snapshot,
    range_numeric_column_snapshot, range_sum_snapshot, range_vlookup_snapshot,
};
use cell_types::SheetPos;
use compute_core::mirror::CellMirror;
use compute_core::mirror::dense::DenseColumnCache;
use compute_core::scheduler::ComputeCore;
use criterion::{BenchmarkId, Criterion, black_box};
use std::time::Duration;

pub(crate) fn bench_range_backed_sum(c: &mut Criterion) {
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

pub(crate) fn bench_range_backed_match(c: &mut Criterion) {
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

pub(crate) fn bench_range_backed_index(c: &mut Criterion) {
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

pub(crate) fn bench_range_backed_vlookup(c: &mut Criterion) {
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

pub(crate) fn bench_range_backed_countifs(c: &mut Criterion) {
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

pub(crate) fn bench_range_backed_point_read(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_point_read");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("point_read", "100k"), |b| {
        let snapshot = range_numeric_column_snapshot(100_000);
        let (_core, mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let midpoint = SheetPos::new(50_000, 0);

        b.iter(|| {
            black_box(mirror.get_cell_value_at(&sheet_id, midpoint));
        });
    });

    group.finish();
}

pub(crate) fn bench_range_backed_col_slice(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_col_slice");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("cold", "100k"), |b| {
        b.iter_with_setup(
            || {
                let snapshot = range_numeric_column_snapshot(100_000);
                let (_core, mirror) = init_snapshot(snapshot);
                let sheet_id = sheet_id(0);
                (mirror, sheet_id)
            },
            |(mirror, sheet_id)| {
                let sheet = mirror.get_sheet(&sheet_id).unwrap();
                black_box(sheet.get_column_slice(0));
            },
        );
    });

    group.bench_function(BenchmarkId::new("warm", "100k"), |b| {
        let snapshot = range_numeric_column_snapshot(100_000);
        let (_core, mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);

        b.iter(|| {
            let sheet = mirror.get_sheet(&sheet_id).unwrap();
            black_box(sheet.get_column_slice(0));
        });
    });

    group.finish();
}

pub(crate) fn bench_range_backed_dense_cache(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_dense_cache");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("materialize", "100k"), |b| {
        let snapshot = range_numeric_column_snapshot(100_000);
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

pub(crate) fn bench_range_backed_eval_only(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_backed_eval_only");
    group.sample_size(20);

    group.bench_function(BenchmarkId::new("eval_sum", "100k"), |b| {
        let snapshot = range_sum_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 1);
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

    group.bench_function(BenchmarkId::new("eval_match", "100k"), |b| {
        let snapshot = range_match_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 1);
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

    group.bench_function(BenchmarkId::new("eval_index", "100k"), |b| {
        let snapshot = range_index_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 1);
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

    group.bench_function(BenchmarkId::new("eval_vlookup", "100k"), |b| {
        let snapshot = range_vlookup_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 2);
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

    group.bench_function(BenchmarkId::new("eval_countifs", "100k"), |b| {
        let snapshot = range_countifs_snapshot(100_000);
        let (mut core, mut mirror) = init_snapshot(snapshot);
        let sheet_id = sheet_id(0);
        let cell_id = cell_id(0, 0, 1);
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
