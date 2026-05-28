//! Criterion benchmarks for the compute-pivot crate.

use compute_pivot::aggregator::{aggregate, get_aggregate_functions};
use compute_pivot::types::{PivotValueSource, PlacementId};
use compute_pivot::values::{cell_value_to_sort_key, kahan_sum};
use compute_pivot::{
    AggregateFunction, AxisPlacement, CellRange, DetectedDataType, FieldId, FilterPlacement,
    OutputLocation, PIVOT_CONFIG_SCHEMA_VERSION, PivotField, PivotFieldArea, PivotFieldPlacement,
    PivotTableConfig, PlacementBase, ValuePlacement, compute,
};
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use value_types::CellValue;

// ============================================================================
// Helpers
// ============================================================================

fn make_number_values(n: usize) -> Vec<CellValue> {
    (0..n).map(|i| CellValue::number(i as f64)).collect()
}

fn text(value: impl Into<std::sync::Arc<str>>) -> CellValue {
    CellValue::Text(value.into())
}

fn make_mixed_values(n: usize) -> Vec<CellValue> {
    (0..n)
        .map(|i| match i % 5 {
            0 => CellValue::number(i as f64),
            1 => text(format!("text_{i}")),
            2 => CellValue::Boolean(i % 2 == 0),
            3 => CellValue::Null,
            _ => CellValue::number(-(i as f64)),
        })
        .collect()
}

/// Generate tabular data with the given number of rows and a fixed schema:
/// [Region(text), Product(text), Category(text), Sales(number), Units(number)]
fn generate_sales_data(num_rows: usize) -> Vec<Vec<CellValue>> {
    let regions = ["East", "West", "North", "South"];
    let products = [
        "Widget",
        "Gadget",
        "Doohickey",
        "Thingamajig",
        "Whatchamacallit",
    ];
    let categories = ["A", "B", "C"];

    let mut data = Vec::with_capacity(num_rows + 1);
    // Header row
    data.push(vec![
        text("Region"),
        text("Product"),
        text("Category"),
        text("Sales"),
        text("Units"),
    ]);
    for i in 0..num_rows {
        data.push(vec![
            text(regions[i % regions.len()]),
            text(products[i % products.len()]),
            text(categories[i % categories.len()]),
            CellValue::number((i as f64) * 10.0 + 100.0),
            CellValue::number((i % 50) as f64 + 1.0),
        ]);
    }
    data
}

fn make_fields() -> Vec<PivotField> {
    vec![
        PivotField {
            id: FieldId::from("region"),
            name: "Region".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("product"),
            name: "Product".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("category"),
            name: "Category".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sales"),
            name: "Sales".to_string(),
            source_column: 3,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("units"),
            name: "Units".to_string(),
            source_column: 4,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ]
}

fn make_placement(
    field_id: &str,
    area: PivotFieldArea,
    position: usize,
    aggregate_function: Option<AggregateFunction>,
) -> PivotFieldPlacement {
    let fid = FieldId::from(field_id);
    let area_label = match area {
        PivotFieldArea::Row => "row",
        PivotFieldArea::Column => "column",
        PivotFieldArea::Value => "value",
        PivotFieldArea::Filter => "filter",
        _ => "unknown",
    };
    let placement_id = PlacementId::from(format!("{area_label}-{field_id}-{position}"));
    match area {
        PivotFieldArea::Row => PivotFieldPlacement::Row(AxisPlacement {
            base: PlacementBase {
                field_id: fid,
                placement_id,
                position,
                display_name: None,
            },
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
        }),
        PivotFieldArea::Column => PivotFieldPlacement::Column(AxisPlacement {
            base: PlacementBase {
                field_id: fid,
                placement_id,
                position,
                display_name: None,
            },
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
        }),
        PivotFieldArea::Value => PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: fid.clone(),
                placement_id,
                position,
                display_name: None,
            },
            source: PivotValueSource::Field { field_id: fid },
            aggregate_function: aggregate_function.unwrap_or(AggregateFunction::Sum),
            number_format: None,
            show_values_as: None,
        }),
        PivotFieldArea::Filter => PivotFieldPlacement::Filter(FilterPlacement {
            base: PlacementBase {
                field_id: fid,
                placement_id,
                position,
                display_name: None,
            },
        }),
        _ => unreachable!("unexpected PivotFieldArea variant"),
    }
}

fn make_config(num_rows: usize, placements: Vec<PivotFieldPlacement>) -> PivotTableConfig {
    PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id: "bench_pivot".to_string(),
        name: "Bench Pivot".to_string(),
        source_sheet_id: None,
        source_sheet_name: "sheet1".to_string(),
        source_range: CellRange::new(0, 0, num_rows as u32, 4),
        output_sheet_name: "sheet1".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: make_fields(),
        placements,
        filters: vec![],
        layout: None,
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_header_row: None,
        first_data_col: None,
        rows_per_page: None,
        cols_per_page: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    }
}

// ============================================================================
// Benchmark: aggregate() — all functions over 10K values
// ============================================================================

fn bench_aggregate(c: &mut Criterion) {
    let values = make_number_values(10_000);

    let mut group = c.benchmark_group("aggregate_10k");
    for func in get_aggregate_functions() {
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("{func:?}")),
            func,
            |b, func| {
                b.iter(|| aggregate(*func, &values));
            },
        );
    }
    group.finish();
}

// ============================================================================
// Benchmark: compute() end-to-end — 1-level and 3-level pivots at 10K rows
// ============================================================================

fn bench_compute_1_level(c: &mut Criterion) {
    let num_rows = 10_000;
    let data = generate_sales_data(num_rows);
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let config = make_config(num_rows, placements);

    c.bench_function("compute_1_level_10k_rows", |b| {
        b.iter(|| compute(&config, &data, None));
    });
}

fn bench_compute_3_level(c: &mut Criterion) {
    let num_rows = 10_000;
    let data = generate_sales_data(num_rows);
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement("product", PivotFieldArea::Row, 1, None),
        make_placement("category", PivotFieldArea::Row, 2, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
        make_placement(
            "units",
            PivotFieldArea::Value,
            1,
            Some(AggregateFunction::Average),
        ),
    ];
    let config = make_config(num_rows, placements);

    c.bench_function("compute_3_level_10k_rows", |b| {
        b.iter(|| compute(&config, &data, None));
    });
}

// ============================================================================
// Benchmark: kahan_sum over 100K values
// ============================================================================

fn bench_kahan_sum(c: &mut Criterion) {
    let values: Vec<f64> = (0..100_000).map(|i| i as f64 * 0.1).collect();

    c.bench_function("kahan_sum_100k", |b| {
        b.iter(|| kahan_sum(values.iter().copied()));
    });
}

// ============================================================================
// Benchmark: cell_value_to_sort_key over 10K mixed values
// ============================================================================

fn bench_sort_key(c: &mut Criterion) {
    let values = make_mixed_values(10_000);

    c.bench_function("cell_value_to_sort_key_10k_mixed", |b| {
        b.iter(|| {
            for v in &values {
                std::hint::black_box(cell_value_to_sort_key(v));
            }
        });
    });
}

// ============================================================================
// Wire up
// ============================================================================

criterion_group!(
    benches,
    bench_aggregate,
    bench_compute_1_level,
    bench_compute_3_level,
    bench_kahan_sum,
    bench_sort_key,
);
criterion_main!(benches);
