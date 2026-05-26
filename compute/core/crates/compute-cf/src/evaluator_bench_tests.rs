use super::*;
use crate::stats::compute_range_stats;
use crate::types::*;
use std::time::Instant;
use value_types::{CellValue, Color};

/// Build `count` numeric CellValues.
/// Values cycle through a deterministic sin-based pattern to give varied data.
fn build_values(count: u32) -> Vec<CellValue> {
    (0..count)
        .map(|i| {
            let v = ((i as f64) * 7.3 + 1.1).sin() * 500.0 + 250.0;
            CellValue::number(v)
        })
        .collect()
}

/// Create 5 CF rules of different types.
fn build_rules() -> Vec<CFRule> {
    vec![
        CFRule {
            priority: 1,
            stop_if_true: false,
            ranges: vec![],
            style: Some(CfRenderStyle {
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                bold: Some(true),
                ..Default::default()
            }),
            kind: CFRuleKind::CellValue {
                comparison: CellValueComparison::Single {
                    operator: CellValueSingleOp::GreaterThan,
                    threshold: CellValueThreshold {
                        text: "300".to_string(),
                        number: Some(300.0),
                    },
                },
            },
        },
        CFRule {
            priority: 2,
            stop_if_true: false,
            ranges: vec![],
            style: Some(CfRenderStyle {
                font_color: Some(Color::from_hex("#00FF00").unwrap()),
                ..Default::default()
            }),
            kind: CFRuleKind::Top10 {
                rank: 10,
                percent: false,
                bottom: false,
            },
        },
        CFRule {
            priority: 3,
            stop_if_true: false,
            ranges: vec![],
            style: Some(CfRenderStyle {
                italic: Some(true),
                ..Default::default()
            }),
            kind: CFRuleKind::AboveAverage {
                above: true,
                equal_average: false,
                std_dev: 0,
            },
        },
        CFRule {
            priority: 4,
            stop_if_true: false,
            ranges: vec![],
            style: None,
            kind: CFRuleKind::ColorScale(CFColorScale {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::from_hex("#FF0000").unwrap(),
                },
                mid_point: None,
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::from_hex("#00FF00").unwrap(),
                },
            }),
        },
        CFRule {
            priority: 5,
            stop_if_true: false,
            ranges: vec![],
            style: None,
            kind: CFRuleKind::DataBar(CFDataBar {
                min_point: CFColorPoint {
                    value_type: CFValueType::Min,
                    value: None,
                    color: Color::BLACK,
                },
                max_point: CFColorPoint {
                    value_type: CFValueType::Max,
                    value: None,
                    color: Color::BLACK,
                },
                positive_color: Color::from_hex("#638EC6").unwrap(),
                negative_color: None,
                border_color: None,
                negative_border_color: None,
                show_border: false,
                gradient: true,
                direction: CFDataBarDirection::LeftToRight,
                axis_position: CFDataBarAxisPosition::Automatic,
                axis_color: None,
                show_value: true,
                min_length: 10,
                max_length: 90,
                match_positive_fill_color: false,
                match_positive_border_color: false,
            }),
        },
    ]
}

/// Run the benchmark for `count` cells: build values, compute stats,
/// then evaluate all 5 rules on every cell. Returns elapsed time.
fn run_bench(count: u32) -> std::time::Duration {
    let values = build_values(count);
    let rules = build_rules();
    let now = chrono::NaiveDate::from_ymd_opt(2026, 1, 15).unwrap();

    let start = Instant::now();
    let stats = compute_range_stats(&values);

    let mut match_count: u64 = 0;
    for cell_value in &values {
        if let Some(result) = evaluate_rules(cell_value, &rules, &stats, &[], now) {
            if result.has_any() {
                match_count += 1;
            }
        }
    }

    let elapsed = start.elapsed();
    eprintln!(
        "  {} cells x 5 rules: {:?} ({} matches, {:.0} cells/sec)",
        count,
        elapsed,
        match_count,
        count as f64 / elapsed.as_secs_f64(),
    );
    elapsed
}

#[test]
#[ignore]
fn bench_cf_1k_cells_5_rules() {
    eprintln!("\n=== CF Evaluation Benchmark: 1K cells ===");
    let elapsed = run_bench(1_000);
    assert!(
        elapsed.as_secs() < 2,
        "1K cells took too long: {:?}",
        elapsed
    );
}

#[test]
#[ignore]
fn bench_cf_10k_cells_5_rules() {
    eprintln!("\n=== CF Evaluation Benchmark: 10K cells ===");
    let elapsed = run_bench(10_000);
    assert!(
        elapsed.as_secs() < 5,
        "10K cells took too long: {:?}",
        elapsed
    );
}

#[test]
#[ignore]
fn bench_cf_100k_cells_5_rules() {
    eprintln!("\n=== CF Evaluation Benchmark: 100K cells ===");
    let elapsed = run_bench(100_000);
    assert!(
        elapsed.as_secs() < 30,
        "100K cells took too long: {:?}",
        elapsed
    );
}
