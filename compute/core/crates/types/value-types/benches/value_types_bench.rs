//! Criterion benchmark suite for the value-types crate.
//!
//! Run with: cargo bench -p value-types
//! View HTML reports in: target/criterion/report/index.html

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use std::sync::Arc;

use value_types::date_serial::{
    serial_to_ymd, try_parse_date, try_parse_datetime, try_parse_time, ymd_to_serial,
};
use value_types::precision::{
    cmp_15_significant_digits, excel_round_to_decimal_places, snap_to_15_significant_digits,
};
use value_types::{
    CellArray, CellError, CellValue, Color, DenseColumn, F64x2, FiniteF64, KahanSum, format_number,
};

// ===========================================================================
// Date parsing benchmarks
// ===========================================================================

fn bench_date_parsing(c: &mut Criterion) {
    let mut group = c.benchmark_group("date_parsing");

    // try_parse_date -- various formats
    group.bench_function("try_parse_date/iso_2024-01-15", |b| {
        b.iter(|| try_parse_date(black_box("2024-01-15")))
    });
    group.bench_function("try_parse_date/us_01/15/2024", |b| {
        b.iter(|| try_parse_date(black_box("01/15/2024")))
    });
    group.bench_function("try_parse_date/text_Jan_15_2024", |b| {
        b.iter(|| try_parse_date(black_box("Jan 15, 2024")))
    });
    group.bench_function("try_parse_date/dmy_15-Jan-2024", |b| {
        b.iter(|| try_parse_date(black_box("15-Jan-2024")))
    });

    // try_parse_time
    group.bench_function("try_parse_time/12h_3:45:30_PM", |b| {
        b.iter(|| try_parse_time(black_box("3:45:30 PM")))
    });
    group.bench_function("try_parse_time/24h_15:30:00", |b| {
        b.iter(|| try_parse_time(black_box("15:30:00")))
    });

    // try_parse_datetime
    group.bench_function("try_parse_datetime/2024-01-15_3:45_PM", |b| {
        b.iter(|| try_parse_datetime(black_box("2024-01-15 3:45 PM")))
    });

    group.finish();
}

// ===========================================================================
// Date serial <-> YMD conversion benchmarks
// ===========================================================================

fn bench_date_serial(c: &mut Criterion) {
    let mut group = c.benchmark_group("date_serial");

    // serial_to_ymd with various serials
    group.bench_function("serial_to_ymd/1", |b| {
        b.iter(|| serial_to_ymd(black_box(1.0)))
    });
    group.bench_function("serial_to_ymd/60_lotus_bug", |b| {
        b.iter(|| serial_to_ymd(black_box(60.0)))
    });
    group.bench_function("serial_to_ymd/44927_2023", |b| {
        b.iter(|| serial_to_ymd(black_box(44927.0)))
    });
    group.bench_function("serial_to_ymd/100000_far_future", |b| {
        b.iter(|| serial_to_ymd(black_box(100_000.0)))
    });

    // ymd_to_serial
    group.bench_function("ymd_to_serial/2024_1_15", |b| {
        b.iter(|| ymd_to_serial(black_box(2024), black_box(1), black_box(15)))
    });

    group.finish();
}

// ===========================================================================
// Chrono comparison -- same inputs, head-to-head
// ===========================================================================

fn bench_chrono_comparison(c: &mut Criterion) {
    let mut group = c.benchmark_group("chrono_vs_custom");

    let inputs: &[(&str, &str, &str)] = &[
        ("iso", "2024-01-15", "%Y-%m-%d"),
        ("us", "01/15/2024", "%m/%d/%Y"),
        ("text", "Jan 15, 2024", "%b %d, %Y"),
    ];

    for &(label, input, chrono_fmt) in inputs {
        group.bench_function(format!("custom/{label}"), |b| {
            b.iter(|| try_parse_date(black_box(input)))
        });
        group.bench_function(format!("chrono/{label}"), |b| {
            b.iter(|| chrono::NaiveDate::parse_from_str(black_box(input), chrono_fmt))
        });
    }

    group.finish();
}

// ===========================================================================
// Precision benchmarks
// ===========================================================================

fn bench_precision(c: &mut Criterion) {
    let mut group = c.benchmark_group("precision");

    group.bench_function("snap_15/clean_42", |b| {
        b.iter(|| snap_to_15_significant_digits(black_box(42.0)))
    });
    group.bench_function("snap_15/dirty_28.4999", |b| {
        b.iter(|| snap_to_15_significant_digits(black_box(28.499999999999996)))
    });

    group.bench_function("excel_round/1.275_2dp", |b| {
        b.iter(|| excel_round_to_decimal_places(black_box(1.275), black_box(2)))
    });

    group.bench_function("cmp_15/equal", |b| {
        b.iter(|| cmp_15_significant_digits(black_box(42.0), black_box(42.0)))
    });
    group.bench_function("cmp_15/different", |b| {
        b.iter(|| cmp_15_significant_digits(black_box(42.0), black_box(43.0)))
    });

    group.finish();
}

// ===========================================================================
// FiniteF64 benchmarks
// ===========================================================================

fn bench_finite_f64(c: &mut Criterion) {
    let mut group = c.benchmark_group("finite_f64");

    group.bench_function("new/42.0", |b| b.iter(|| FiniteF64::new(black_box(42.0))));
    group.bench_function("try_from/42.0", |b| {
        b.iter(|| FiniteF64::try_from(black_box(42.0)))
    });

    group.finish();
}

// ===========================================================================
// CellValue construction benchmarks
// ===========================================================================

fn bench_cell_value_construction(c: &mut Criterion) {
    let mut group = c.benchmark_group("cell_value_construction");

    group.bench_function("CellValue::number(finite)", |b| {
        b.iter(|| CellValue::number(black_box(42.5)))
    });
    group.bench_function("CellValue::number(NaN)", |b| {
        b.iter(|| CellValue::number(black_box(f64::NAN)))
    });
    group.bench_function("CellValue::from(f64)", |b| {
        b.iter(|| CellValue::from(black_box(3.125_f64)))
    });
    group.bench_function("CellValue::from(&str)", |b| {
        b.iter(|| CellValue::from(black_box("hello")))
    });

    group.finish();
}

// ===========================================================================
// format_number benchmarks
// ===========================================================================

fn bench_format_number(c: &mut Criterion) {
    let mut group = c.benchmark_group("format_number");

    group.bench_function("integer", |b| b.iter(|| format_number(black_box(42.0))));
    group.bench_function("decimal", |b| {
        b.iter(|| format_number(black_box(std::f64::consts::PI)))
    });
    group.bench_function("large", |b| {
        b.iter(|| format_number(black_box(1.23456789e15)))
    });
    group.bench_function("small", |b| b.iter(|| format_number(black_box(1.23e-10))));

    group.finish();
}

// ===========================================================================
// CellValue benchmarks
// ===========================================================================

fn bench_cell_value(c: &mut Criterion) {
    let mut group = c.benchmark_group("cell_value");

    // coerce_to_number from various sources
    let num_val = CellValue::Number(FiniteF64::new(42.5).unwrap());
    let text_num = CellValue::Text(Arc::from("42.5"));
    let text_date = CellValue::Text(Arc::from("Jan 15, 2024"));
    let text_bool = CellValue::Text(Arc::from("TRUE"));
    let bool_val = CellValue::Boolean(true);

    group.bench_function("coerce_to_number/from_number", |b| {
        b.iter(|| black_box(&num_val).coerce_to_number())
    });
    group.bench_function("coerce_to_number/from_text_42.5", |b| {
        b.iter(|| black_box(&text_num).coerce_to_number())
    });
    group.bench_function("coerce_to_number/from_text_date", |b| {
        b.iter(|| black_box(&text_date).coerce_to_number())
    });
    group.bench_function("coerce_to_number/from_bool", |b| {
        b.iter(|| black_box(&bool_val).coerce_to_number())
    });

    // coerce_to_string from number
    group.bench_function("coerce_to_string/from_number", |b| {
        b.iter(|| black_box(&num_val).coerce_to_string())
    });

    // coerce_to_bool
    group.bench_function("coerce_to_bool/from_bool", |b| {
        b.iter(|| black_box(&bool_val).coerce_to_bool())
    });
    group.bench_function("coerce_to_bool/from_text_TRUE", |b| {
        b.iter(|| black_box(&text_bool).coerce_to_bool())
    });

    // Serde roundtrip
    let serde_values: Vec<(&str, CellValue)> = vec![
        ("number", CellValue::Number(FiniteF64::new(42.5).unwrap())),
        ("text", CellValue::Text(Arc::from("hello world"))),
        ("error", CellValue::Error(CellError::Na, None)),
    ];
    for (label, val) in &serde_values {
        group.bench_function(format!("serde_roundtrip/{label}"), |b| {
            b.iter(|| {
                let json = serde_json::to_string(black_box(val)).unwrap();
                let _: CellValue = serde_json::from_str(&json).unwrap();
            })
        });
    }

    group.finish();
}

// ===========================================================================
// CellArray benchmarks
// ===========================================================================

fn bench_cell_array(c: &mut Criterion) {
    let mut group = c.benchmark_group("cell_array");

    // Construction: 1000 elements, single column
    group.bench_function("new/1000_elements", |b| {
        b.iter(|| {
            let data: Vec<CellValue> = (0..1000)
                .map(|i| CellValue::Number(FiniteF64::new(i as f64).unwrap()))
                .collect();
            CellArray::new(black_box(data), 1)
        })
    });

    // from_rows: 100x10 grid
    group.bench_function("from_rows/100x10", |b| {
        b.iter(|| {
            let rows: Vec<Vec<CellValue>> = (0..100)
                .map(|r| {
                    (0..10)
                        .map(|c| CellValue::Number(FiniteF64::new((r * 10 + c) as f64).unwrap()))
                        .collect()
                })
                .collect();
            CellArray::from_rows(black_box(rows))
        })
    });

    // Iteration: rows_iter on 1000x10 array
    let large_data: Vec<CellValue> = (0..10_000)
        .map(|i| CellValue::Number(FiniteF64::new(i as f64).unwrap()))
        .collect();
    let large_array = CellArray::new(large_data, 10);

    group.bench_function("rows_iter/1000x10", |b| {
        b.iter(|| black_box(&large_array).rows_iter().count())
    });

    group.finish();
}

// ===========================================================================
// DenseColumn benchmarks
// ===========================================================================

fn bench_dense_column(c: &mut Criterion) {
    let mut group = c.benchmark_group("dense_column");

    // Build a 10000-element dense column
    let values: Vec<f64> = (0..10_000).map(|i| i as f64 * 0.1).collect();
    let dense = DenseColumn::new(values.clone(), 10_000, 0, Vec::new());

    group.bench_function("sum_range/10000", |b| {
        b.iter(|| dense.sum_range(black_box(0), black_box(9999)))
    });

    group.bench_function("count_range/10000", |b| {
        b.iter(|| dense.count_range(black_box(0), black_box(9999)))
    });

    group.bench_function("min_range/10000", |b| {
        b.iter(|| dense.min_range(black_box(0), black_box(9999)))
    });

    group.bench_function("max_range/10000", |b| {
        b.iter(|| dense.max_range(black_box(0), black_box(9999)))
    });

    // DenseColumn with errors for first_error_in_range
    let errors: Vec<(u32, CellError)> = (0..100).map(|i| (i * 100, CellError::Value)).collect();
    let dense_with_errors = DenseColumn::new(values, 9_900, 0, errors);

    group.bench_function("first_error_in_range/sorted_100_errors", |b| {
        b.iter(|| dense_with_errors.first_error_in_range(black_box(5000), black_box(5100)))
    });

    group.finish();
}

// ===========================================================================
// Color benchmarks
// ===========================================================================

fn bench_color(c: &mut Criterion) {
    let mut group = c.benchmark_group("color");

    group.bench_function("from_hex/6digit", |b| {
        b.iter(|| Color::from_hex(black_box("#ff8000")))
    });

    group.finish();
}

// ===========================================================================
// KahanSum benchmarks
// ===========================================================================

fn bench_kahan_sum(c: &mut Criterion) {
    let mut group = c.benchmark_group("kahan_sum");

    group.bench_function("sum_10000x0.1", |b| {
        b.iter(|| {
            let mut acc = KahanSum::new();
            for _ in 0..10_000 {
                acc.add(black_box(0.1));
            }
            acc.total()
        })
    });

    group.finish();
}

// ===========================================================================
// F64x2 (double-double) benchmarks
// ===========================================================================

fn bench_f64x2(c: &mut Criterion) {
    let mut group = c.benchmark_group("f64x2");

    // Addition chain: 1000 F64x2 additions
    group.bench_function("add_chain/1000", |b| {
        b.iter(|| {
            let mut acc = F64x2::from(0.0);
            for i in 0..1000 {
                acc = acc + F64x2::from(black_box(i as f64));
            }
            acc
        })
    });

    // Catastrophic cancellation: 1e15 + 1.0 - 1e15
    group.bench_function("catastrophic_cancellation", |b| {
        b.iter(|| {
            let a = F64x2::from(black_box(1e15));
            let b = F64x2::from(black_box(1.0));
            let c = F64x2::from(black_box(1e15));
            (a + b) - c
        })
    });

    group.finish();
}

// ===========================================================================
// Group and main
// ===========================================================================

criterion_group!(
    benches,
    bench_cell_value_construction,
    bench_format_number,
    bench_date_parsing,
    bench_date_serial,
    bench_chrono_comparison,
    bench_precision,
    bench_finite_f64,
    bench_cell_value,
    bench_cell_array,
    bench_dense_column,
    bench_color,
    bench_kahan_sum,
    bench_f64x2,
);
criterion_main!(benches);
