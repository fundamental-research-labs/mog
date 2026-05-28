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

use criterion::{criterion_group, criterion_main};

use range_baseline::cell_benches::{
    bench_col_version_bump, bench_countifs, bench_dense_cache_materialize, bench_eval_only,
    bench_index, bench_match, bench_sum_column, bench_vlookup,
};
use range_baseline::range_benches::{
    bench_range_backed_col_slice, bench_range_backed_countifs, bench_range_backed_dense_cache,
    bench_range_backed_eval_only, bench_range_backed_index, bench_range_backed_match,
    bench_range_backed_point_read, bench_range_backed_sum, bench_range_backed_vlookup,
};

mod range_baseline;

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
