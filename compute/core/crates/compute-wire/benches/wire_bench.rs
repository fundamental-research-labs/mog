//! Criterion benchmarks for compute-wire hot-path serialization functions.

#![allow(clippy::pedantic, clippy::all, missing_docs)]

use std::collections::HashMap;

use criterion::{BenchmarkId, Criterion, black_box, criterion_group, criterion_main};

use compute_wire::palette::FormatPalette;
use compute_wire::types::*;
use compute_wire::viewport::serialize_viewport_binary;
use compute_wire::{flags as render_flags, mutation::serialize_mutation_result};
use domain_types::{CellFormat, FontSize};
use ooxml_types::styles::{HorizontalAlign, UnderlineStyle};
use snapshot_types::{CellChange, RecalcResult};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Helper: build a realistic format palette with ~10 unique formats
// ---------------------------------------------------------------------------

fn make_format_palette() -> Vec<CellFormat> {
    vec![
        // 0: default
        CellFormat::default(),
        // 1: bold
        CellFormat {
            bold: Some(true),
            ..Default::default()
        },
        // 2: italic
        CellFormat {
            italic: Some(true),
            ..Default::default()
        },
        // 3: bold + italic + font size
        CellFormat {
            bold: Some(true),
            italic: Some(true),
            font_size: Some(FontSize::from_points(14.0)),
            ..Default::default()
        },
        // 4: number format (currency)
        CellFormat {
            number_format: Some("$#,##0.00".to_string()),
            ..Default::default()
        },
        // 5: number format (percent)
        CellFormat {
            number_format: Some("0.00%".to_string()),
            ..Default::default()
        },
        // 6: colored background
        CellFormat {
            background_color: Some("#FF0000".to_string()),
            ..Default::default()
        },
        // 7: font color + size
        CellFormat {
            font_color: Some("#0000FF".to_string()),
            font_size: Some(FontSize::from_points(12.0)),
            ..Default::default()
        },
        // 8: wrap text + alignment
        CellFormat {
            wrap_text: Some(true),
            horizontal_align: Some(HorizontalAlign::Center),
            vertical_align: Some(domain_types::CellVerticalAlign::Middle),
            ..Default::default()
        },
        // 9: strikethrough + underline
        CellFormat {
            strikethrough: Some(true),
            underline_type: Some(UnderlineStyle::Single),
            ..Default::default()
        },
    ]
}

// ---------------------------------------------------------------------------
// Helper: build ViewportRenderData at a given grid size
// ---------------------------------------------------------------------------

fn make_viewport_data(rows: u32, cols: u32) -> ViewportRenderData {
    let palette = make_format_palette();
    let format_count = palette.len() as u16;
    let cell_count = (rows * cols) as usize;

    let mut cells = Vec::with_capacity(cell_count);
    for r in 0..rows {
        for c in 0..cols {
            let idx = (r * cols + c) as usize;
            let cell = match idx % 7 {
                // Numbers (most common)
                0 => ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: (idx as u16) % format_count,
                    flags: render_flags::VALUE_TYPE_NUMBER,
                    number_value: idx as f64 * 1.5,
                    formatted: Some(format!("{:.2}", idx as f64 * 1.5)),
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
                1 => ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: (idx as u16) % format_count,
                    flags: render_flags::VALUE_TYPE_NUMBER | render_flags::HAS_FORMULA,
                    number_value: (idx as f64).sqrt(),
                    formatted: Some(format!("{:.4}", (idx as f64).sqrt())),
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
                // Text
                2 => ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: (idx as u16) % format_count,
                    flags: render_flags::VALUE_TYPE_TEXT,
                    number_value: f64::NAN,
                    formatted: Some(format!("Cell R{}C{}", r, c)),
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
                // Boolean
                3 => ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: 0,
                    flags: render_flags::VALUE_TYPE_BOOL,
                    number_value: if idx % 2 == 0 { 1.0 } else { 0.0 },
                    formatted: Some(if idx % 2 == 0 {
                        "TRUE".to_string()
                    } else {
                        "FALSE".to_string()
                    }),
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
                // Error
                4 => ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: 0,
                    flags: render_flags::VALUE_TYPE_ERROR,
                    number_value: f64::NAN,
                    formatted: None,
                    error: Some("#DIV/0!".to_string()),
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
                // Number with CF color overrides
                5 => ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: (idx as u16) % format_count,
                    flags: render_flags::VALUE_TYPE_NUMBER,
                    number_value: idx as f64,
                    formatted: Some(format!("{}", idx)),
                    error: None,
                    bg_color_override: 0xFF_00_80_FF,   // red-ish
                    font_color_override: 0xFF_FF_FF_FF, // white
                    cf_extras: None,
                },
                // Empty/null
                _ => ViewportRenderCell {
                    row: r,
                    col: c,
                    format_idx: 0,
                    flags: render_flags::VALUE_TYPE_NULL,
                    number_value: f64::NAN,
                    formatted: None,
                    error: None,
                    bg_color_override: 0,
                    font_color_override: 0,
                    cf_extras: None,
                },
            };
            cells.push(cell);
        }
    }

    // A few merges (roughly 1 per 100 cells)
    let merge_count = (cell_count / 100).max(1).min(20);
    let merges: Vec<RenderViewportMerge> = (0..merge_count as u32)
        .map(|i| {
            let sr = (i * 3) % rows;
            let sc = (i * 2) % cols;
            RenderViewportMerge {
                start_row: sr,
                start_col: sc,
                end_row: (sr + 1).min(rows - 1),
                end_col: (sc + 1).min(cols - 1),
            }
        })
        .collect();

    // Row dimensions for every row
    let row_dimensions: Vec<RenderRowDimension> = (0..rows)
        .map(|r| RenderRowDimension {
            row: r,
            height: if r % 5 == 0 { 30.0 } else { 20.0 },
            hidden: r % 50 == 49,
        })
        .collect();

    // Column dimensions for every column
    let col_dimensions: Vec<RenderColDimension> = (0..cols)
        .map(|c| RenderColDimension {
            col: c,
            width: 80.0 + (c % 5) as f32 * 20.0,
            hidden: c % 30 == 29,
        })
        .collect();

    // Row/col positions — length = rows + 1 / cols + 1 (with trailing sentinel)
    let mut row_positions = Vec::with_capacity(rows as usize + 1);
    let mut acc = 0.0_f64;
    for rd in &row_dimensions {
        row_positions.push(acc);
        acc += rd.height as f64;
    }
    if !row_dimensions.is_empty() {
        row_positions.push(acc); // sentinel: top edge of the row past the range
    }

    let mut col_positions = Vec::with_capacity(cols as usize + 1);
    acc = 0.0;
    for cd in &col_dimensions {
        col_positions.push(acc);
        acc += cd.width as f64;
    }
    if !col_dimensions.is_empty() {
        col_positions.push(acc); // sentinel: left edge of the col past the range
    }

    ViewportRenderData {
        cells,
        format_palette: palette,
        merges,
        row_dimensions,
        col_dimensions,
        viewport_rows: rows,
        viewport_cols: cols,
        start_row: 0,
        start_col: 0,
        row_positions,
        col_positions,
    }
}

// ---------------------------------------------------------------------------
// Helper: build RecalcResult with N changed cells
// ---------------------------------------------------------------------------

fn make_recalc_result(n: usize) -> RecalcResult {
    let mut changed_cells = Vec::with_capacity(n);
    for i in 0..n {
        let cell = match i % 5 {
            0 => CellChange {
                cell_id: format!("c{}", i),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition {
                    row: (i / 10) as u32,
                    col: (i % 10) as u32,
                }),
                value: CellValue::number(i as f64 * 3.14),
                display_text: Some(format!("{:.2}", i as f64 * 3.14)),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: Some((i % 10) as u16),
                extra_flags: 0,
                old_value: None,
            },
            1 => CellChange {
                cell_id: format!("c{}", i),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition {
                    row: (i / 10) as u32,
                    col: (i % 10) as u32,
                }),
                value: CellValue::Text(format!("Result for row {}", i).into()),
                display_text: Some(format!("Result for row {}", i)),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: Some(0),
                extra_flags: 0,
                old_value: None,
            },
            2 => CellChange {
                cell_id: format!("c{}", i),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition {
                    row: (i / 10) as u32,
                    col: (i % 10) as u32,
                }),
                value: CellValue::Boolean(i % 2 == 0),
                display_text: Some(if i % 2 == 0 {
                    "TRUE".into()
                } else {
                    "FALSE".into()
                }),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            3 => CellChange {
                cell_id: format!("c{}", i),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition {
                    row: (i / 10) as u32,
                    col: (i % 10) as u32,
                }),
                value: CellValue::Error(CellError::Div0, None),
                display_text: None,
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            _ => CellChange {
                cell_id: format!("c{}", i),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition {
                    row: (i / 10) as u32,
                    col: (i % 10) as u32,
                }),
                value: CellValue::number(i as f64),
                display_text: Some(format!("{}", i)),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: Some(1),
                extra_flags: render_flags::HAS_FORMULA,
                old_value: None,
            },
        };
        changed_cells.push(cell);
    }
    RecalcResult {
        changed_cells,
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    }
}

// ---------------------------------------------------------------------------
// Benchmark: serialize_viewport_binary at different scales
// ---------------------------------------------------------------------------

fn bench_viewport_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("viewport_serialize");

    let cases: &[(u32, u32, &str)] = &[
        (10, 10, "100_cells_10x10"),
        (50, 20, "1000_cells_50x20"),
        (100, 100, "10000_cells_100x100"),
    ];

    for &(rows, cols, label) in cases {
        let data = make_viewport_data(rows, cols);
        group.bench_with_input(BenchmarkId::new("full", label), &data, |b, data| {
            b.iter(|| serialize_viewport_binary(black_box(data), 0, false, 0));
        });
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: FormatPalette::intern
// ---------------------------------------------------------------------------

fn bench_palette_intern(c: &mut Criterion) {
    let mut group = c.benchmark_group("palette_intern");

    // 100 unique formats
    group.bench_function("100_unique", |b| {
        let formats: Vec<CellFormat> = (0..100)
            .map(|i| CellFormat {
                font_size: Some(FontSize::from_points(8.0 + i as f64 * 0.1)),
                bold: if i % 3 == 0 { Some(true) } else { None },
                italic: if i % 5 == 0 { Some(true) } else { None },
                number_format: if i % 4 == 0 {
                    Some(format!("fmt_{}", i))
                } else {
                    None
                },
                ..Default::default()
            })
            .collect();
        b.iter(|| {
            let mut palette = FormatPalette::new();
            for fmt in &formats {
                black_box(palette.intern(fmt).unwrap());
            }
        });
    });

    // High dedup ratio: 1000 cells, only 5 unique formats
    group.bench_function("1000_cells_5_unique", |b| {
        let unique_formats: Vec<CellFormat> = vec![
            CellFormat::default(),
            CellFormat {
                bold: Some(true),
                ..Default::default()
            },
            CellFormat {
                italic: Some(true),
                ..Default::default()
            },
            CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
            CellFormat {
                font_size: Some(FontSize::from_points(14.0)),
                bold: Some(true),
                ..Default::default()
            },
        ];
        b.iter(|| {
            let mut palette = FormatPalette::new();
            for i in 0..1000 {
                let fmt = &unique_formats[i % 5];
                black_box(palette.intern(fmt).unwrap());
            }
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: serialize_mutation_result at different scales
// ---------------------------------------------------------------------------

fn bench_mutation_serialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("mutation_serialize");

    // Small mutation: 10 changed cells
    {
        let result = make_recalc_result(10);
        group.bench_function("10_cells", |b| {
            b.iter(|| {
                serialize_mutation_result(black_box(&result), black_box("sheet-uuid-1234"), 0, None)
            });
        });
    }

    // Large mutation: 1000 changed cells
    {
        let result = make_recalc_result(1000);
        group.bench_function("1000_cells", |b| {
            b.iter(|| {
                serialize_mutation_result(black_box(&result), black_box("sheet-uuid-1234"), 0, None)
            });
        });
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: deserialize_viewport at different scales
// ---------------------------------------------------------------------------

fn bench_viewport_deserialization(c: &mut Criterion) {
    let mut group = c.benchmark_group("viewport_deserialize");

    let cases: &[(u32, u32, &str)] = &[
        (10, 10, "100_cells_10x10"),
        (50, 20, "1000_cells_50x20"),
        (100, 100, "10000_cells_100x100"),
    ];

    for &(rows, cols, label) in cases {
        let data = make_viewport_data(rows, cols);
        let buf = serialize_viewport_binary(&data, 0, false, 0);
        group.bench_with_input(BenchmarkId::new("full", label), &buf, |b, buf| {
            b.iter(|| compute_wire::deserialize::deserialize_viewport(black_box(buf)));
        });
    }

    group.finish();
}

// ---------------------------------------------------------------------------
// Benchmark: JSON baseline comparison for viewport data
// ---------------------------------------------------------------------------

fn bench_viewport_json_baseline(c: &mut Criterion) {
    let mut group = c.benchmark_group("viewport_json_baseline");

    let cases: &[(u32, u32, &str)] = &[
        (10, 10, "100_cells_10x10"),
        (50, 20, "1000_cells_50x20"),
        (100, 100, "10000_cells_100x100"),
    ];

    for &(rows, cols, label) in cases {
        let data = make_viewport_data(rows, cols);
        group.bench_with_input(BenchmarkId::new("serde_json", label), &data, |b, data| {
            b.iter(|| serde_json::to_vec(black_box(data)).unwrap());
        });
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_viewport_serialization,
    bench_viewport_deserialization,
    bench_viewport_json_baseline,
    bench_palette_intern,
    bench_mutation_serialization,
);
criterion_main!(benches);
