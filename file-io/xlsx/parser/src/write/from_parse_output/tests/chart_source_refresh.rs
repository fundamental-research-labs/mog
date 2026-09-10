use super::super::chart_replay;
use super::super::chart_source_completion::complete_chart_sources_for_xlsx_export;
use super::make_chart;
use domain_types::domain::chart::{
    ChartSeriesCategorySourceTypeData, ChartSeriesData, ChartSeriesDimensionSourceKindData,
    ChartSeriesPointCacheData, ChartSeriesPointCachePointData,
};
use domain_types::{CellData, CellValue, ChartType, ParseOutput, SheetData};
use std::sync::Arc;
use value_types::FiniteF64;

fn text_cell(row: u32, col: u32, value: &str) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Text(Arc::from(value)),
        ..Default::default()
    }
}

fn number_cell(row: u32, col: u32, value: f64) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Number(FiniteF64::must(value)),
        ..Default::default()
    }
}

fn stale_cache(value: &str) -> ChartSeriesPointCacheData {
    ChartSeriesPointCacheData {
        point_count: Some(2),
        format_code: None,
        points: vec![ChartSeriesPointCachePointData {
            idx: 0,
            value: value.to_string(),
            format_code: None,
        }],
    }
}

#[test]
fn refreshes_title_name_and_explicit_category_caches_for_live_sources() {
    let mut chart = make_chart(ChartType::Column, "");
    chart.title = Some("Stale title".to_string());
    chart.title_formula = Some("A1".to_string());
    chart.series_range = Some("B1:B1".to_string());
    chart.category_range = Some("A2:A3".to_string());
    chart.series = vec![ChartSeriesData {
        name: Some("Stale series".to_string()),
        name_ref: Some("B1".to_string()),
        values: Some("B2:B3".to_string()),
        value_source_kind: Some(ChartSeriesDimensionSourceKindData::Ref),
        value_cache: Some(stale_cache("old value")),
        categories: Some("OldCategories".to_string()),
        category_source_kind: Some(ChartSeriesDimensionSourceKindData::Ref),
        category_source_type: Some(ChartSeriesCategorySourceTypeData::String),
        category_cache: Some(stale_cache("old category")),
        ..Default::default()
    }];
    assert!(chart_replay::should_complete_sources_for_xlsx_export(
        &chart
    ));

    let mut output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![
                text_cell(0, 0, "Updated title"),
                text_cell(0, 1, "Updated series"),
                text_cell(1, 0, "Q1"),
                number_cell(1, 1, 10.0),
                text_cell(2, 0, "Q2"),
                number_cell(2, 1, 20.0),
            ],
            charts: vec![chart],
            ..Default::default()
        }],
        ..Default::default()
    };

    complete_chart_sources_for_xlsx_export(&mut output);

    let chart = &output.sheets[0].charts[0];
    assert_eq!(chart.title.as_deref(), Some("Updated title"));
    let series = &chart.series[0];
    assert_eq!(series.name.as_deref(), Some("Updated series"));
    assert_eq!(series.categories.as_deref(), Some("A2:A3"));
    assert_eq!(
        series
            .category_cache
            .as_ref()
            .expect("category cache")
            .points
            .iter()
            .map(|point| point.value.as_str())
            .collect::<Vec<_>>(),
        vec!["Q1", "Q2"]
    );
    assert_eq!(
        series
            .value_cache
            .as_ref()
            .expect("value cache")
            .points
            .iter()
            .map(|point| point.value.as_str())
            .collect::<Vec<_>>(),
        vec!["10", "20"]
    );
}

#[test]
fn preserves_literal_caches_and_unresolved_chart_text_references() {
    let cached = ChartSeriesPointCacheData {
        point_count: Some(1),
        format_code: None,
        points: vec![ChartSeriesPointCachePointData {
            idx: 0,
            value: "literal cache".to_string(),
            format_code: None,
        }],
    };
    let mut chart = make_chart(ChartType::Column, "");
    chart.title = Some("Imported title".to_string());
    chart.title_formula = Some("#REF!".to_string());
    chart.category_range = Some("#REF!".to_string());
    chart.series_range = Some("#NAME?".to_string());
    chart.series = vec![ChartSeriesData {
        name: Some("Imported series".to_string()),
        name_ref: Some("#NAME?".to_string()),
        values: Some("B2:B2".to_string()),
        value_source_kind: Some(ChartSeriesDimensionSourceKindData::Literal),
        value_cache: Some(cached.clone()),
        categories: Some("A2:A2".to_string()),
        category_source_kind: Some(ChartSeriesDimensionSourceKindData::Literal),
        category_cache: Some(cached.clone()),
        ..Default::default()
    }];
    assert!(chart_replay::should_complete_sources_for_xlsx_export(
        &chart
    ));

    let mut output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![text_cell(0, 0, "Current title")],
            charts: vec![chart],
            ..Default::default()
        }],
        ..Default::default()
    };
    complete_chart_sources_for_xlsx_export(&mut output);

    let chart = &output.sheets[0].charts[0];
    assert_eq!(chart.title.as_deref(), Some("Imported title"));
    let series = &chart.series[0];
    assert_eq!(series.name.as_deref(), Some("Imported series"));
    assert_eq!(series.value_cache, Some(cached.clone()));
    assert_eq!(series.category_cache, Some(cached));
    assert_eq!(series.categories.as_deref(), Some("A2:A2"));
}
