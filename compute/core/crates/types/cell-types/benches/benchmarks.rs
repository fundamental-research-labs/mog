use std::hint::black_box;
use std::sync::Arc;

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};

use cell_types::{
    CellId, IdAllocator, RangePos, SheetId, SheetPos, SheetRange, col_to_letter, letter_to_col,
};

// ---------------------------------------------------------------------------
// IdAllocator benchmarks
// ---------------------------------------------------------------------------

fn bench_id_allocator(c: &mut Criterion) {
    let mut group = c.benchmark_group("id_allocator");

    group.bench_function("next_cell_id_single_thread", |b| {
        let alloc = IdAllocator::new();
        b.iter(|| black_box(alloc.next_cell_id()));
    });

    group.bench_function("next_cell_id_4_threads", |b| {
        b.iter_custom(|iters| {
            let alloc = Arc::new(IdAllocator::new());
            let per_thread = iters / 4;
            let start = std::time::Instant::now();
            let handles: Vec<_> = (0..4)
                .map(|_| {
                    let a = Arc::clone(&alloc);
                    std::thread::spawn(move || {
                        for _ in 0..per_thread {
                            black_box(a.next_cell_id());
                        }
                    })
                })
                .collect();
            for h in handles {
                h.join().unwrap();
            }
            start.elapsed()
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Column conversion benchmarks
// ---------------------------------------------------------------------------

fn bench_col_conversion(c: &mut Criterion) {
    let mut group = c.benchmark_group("col_conversion");

    // col_to_letter for representative column indices
    let cases: &[(&str, u32)] = &[
        ("A", 0),
        ("Z", 25),
        ("AA", 26),
        ("ZZ", 701),
        ("AAA", 702),
        ("XFD", 16383),
    ];

    for &(label, col) in cases {
        group.bench_with_input(BenchmarkId::new("col_to_letter", label), &col, |b, &col| {
            b.iter(|| black_box(col_to_letter(black_box(col))));
        });
    }

    // letter_to_col for the same representative labels
    let letter_cases: &[&str] = &["A", "Z", "AA", "ZZ", "AAA", "XFD"];

    for &letters in letter_cases {
        group.bench_with_input(
            BenchmarkId::new("letter_to_col", letters),
            &letters,
            |b, &letters| {
                b.iter(|| black_box(letter_to_col(black_box(letters))));
            },
        );
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Identity (CellId) benchmarks
// ---------------------------------------------------------------------------

fn bench_identity(c: &mut Criterion) {
    let mut group = c.benchmark_group("identity");

    let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
    let id = CellId::from_uuid_str(uuid_str).unwrap();

    group.bench_function("from_uuid_str", |b| {
        b.iter(|| black_box(CellId::from_uuid_str(black_box(uuid_str)).unwrap()));
    });

    group.bench_function("to_uuid_string", |b| {
        b.iter(|| black_box(black_box(id).to_uuid_string()));
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// RangePos benchmarks
// ---------------------------------------------------------------------------

fn bench_range_ops(c: &mut Criterion) {
    let mut group = c.benchmark_group("range_ops");

    let sheet = SheetId::from_raw(1);

    // Small range: 10x10
    let small = RangePos::new(sheet, 0, 0, 9, 9);
    // Large range: 1000x100
    let large = RangePos::new(sheet, 0, 0, 999, 99);

    // contains — hit (middle of range)
    group.bench_function("contains/small_hit", |b| {
        b.iter(|| black_box(small.contains(black_box(5), black_box(5))));
    });

    group.bench_function("contains/small_miss", |b| {
        b.iter(|| black_box(small.contains(black_box(20), black_box(20))));
    });

    group.bench_function("contains/large_hit", |b| {
        b.iter(|| black_box(large.contains(black_box(500), black_box(50))));
    });

    // intersection — overlapping ranges
    let overlapping = RangePos::new(sheet, 5, 5, 14, 14);
    group.bench_function("intersection/small_overlap", |b| {
        b.iter(|| black_box(small.intersection(black_box(&overlapping))));
    });

    let large_overlap = RangePos::new(sheet, 500, 50, 1500, 150);
    group.bench_function("intersection/large_overlap", |b| {
        b.iter(|| black_box(large.intersection(black_box(&large_overlap))));
    });

    // intersection — disjoint (returns None)
    let disjoint = RangePos::new(sheet, 2000, 2000, 3000, 3000);
    group.bench_function("intersection/disjoint", |b| {
        b.iter(|| black_box(large.intersection(black_box(&disjoint))));
    });

    // iter_positions — measure full iteration
    group.bench_function("iter_positions/10x10", |b| {
        b.iter(|| {
            let mut count = 0u32;
            for pos in small.iter_positions() {
                black_box(pos);
                count += 1;
            }
            black_box(count)
        });
    });

    let medium = RangePos::new(sheet, 0, 0, 99, 99);
    group.bench_function("iter_positions/100x100", |b| {
        b.iter(|| {
            let mut count = 0u32;
            for pos in medium.iter_positions() {
                black_box(pos);
                count += 1;
            }
            black_box(count)
        });
    });

    group.bench_function("iter_positions/1000x100", |b| {
        b.iter(|| {
            let mut count = 0u32;
            for pos in large.iter_positions() {
                black_box(pos);
                count += 1;
            }
            black_box(count)
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Serde benchmarks
// ---------------------------------------------------------------------------

fn bench_serde(c: &mut Criterion) {
    let mut group = c.benchmark_group("serde");

    // CellId JSON roundtrip
    let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
    group.bench_function("cell_id_json_roundtrip", |b| {
        b.iter(|| {
            let json = serde_json::to_string(black_box(&cell_id)).unwrap();
            let _: CellId = serde_json::from_str(black_box(&json)).unwrap();
        });
    });

    // CellId::from_uuid_str parsing
    group.bench_function("cell_id_from_uuid_str", |b| {
        b.iter(|| {
            black_box(
                CellId::from_uuid_str(black_box("550e8400-e29b-41d4-a716-446655440000")).unwrap(),
            );
        });
    });

    // RangePos JSON roundtrip
    let sheet = SheetId::from_raw(1);
    let range_pos = RangePos::new(sheet, 0, 0, 99, 25);
    group.bench_function("range_pos_json_roundtrip", |b| {
        b.iter(|| {
            let json = serde_json::to_string(black_box(&range_pos)).unwrap();
            let _: RangePos = serde_json::from_str(black_box(&json)).unwrap();
        });
    });

    // SheetRange JSON roundtrip
    let sheet_range = SheetRange::new(0, 0, 99, 25);
    group.bench_function("sheet_range_json_roundtrip", |b| {
        b.iter(|| {
            let json = serde_json::to_string(black_box(&sheet_range)).unwrap();
            let _: SheetRange = serde_json::from_str(black_box(&json)).unwrap();
        });
    });

    // SheetPos JSON roundtrip
    let sheet_pos = SheetPos::new(50, 12);
    group.bench_function("sheet_pos_json_roundtrip", |b| {
        b.iter(|| {
            let json = serde_json::to_string(black_box(&sheet_pos)).unwrap();
            let _: SheetPos = serde_json::from_str(black_box(&json)).unwrap();
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_id_allocator,
    bench_col_conversion,
    bench_identity,
    bench_range_ops,
    bench_serde,
);
criterion_main!(benches);
