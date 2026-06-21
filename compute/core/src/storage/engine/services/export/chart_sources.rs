//! Chart source-reference completion for XLSX export.
//!
//! Public chart APIs allow callers to provide explicit series while also
//! retaining a chart-level data range. XLSX has no chart-level source range;
//! the source contract is represented by per-series references. Complete the
//! missing series-name references at export time when the live worksheet data
//! proves the literal series name is the header cell for that value column.

use cell_types::SheetId;
use domain_types::domain::{
    chart::{
        ChartSeriesData, ChartSeriesDimensionSourceKindData, ChartSeriesPointCacheData,
        ChartSeriesPointCachePointData, ChartSpec,
    },
    floating_object::{FloatingObject, FloatingObjectData},
};
use formula_types::{CellRef, RangeType};

use crate::mirror::CellMirror;
use crate::range_manager::pos_to_a1;
use crate::storage::cells::values as cell_values;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ParsedLocalRange {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

pub(super) fn complete_chart_series_source_refs_for_export(
    spec: &mut ChartSpec,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    sheet_name: &str,
) {
    complete_series_live_ref_caches(&mut spec.series, sheet_name, |row, col| {
        cell_values::get_effective_value(mirror, sheet_id, row, col).map(|value| value.to_string())
    });
    complete_series_name_refs_from_data_range(
        spec.data_range.as_deref(),
        &mut spec.series,
        sheet_name,
        |row, col| {
            cell_values::get_effective_value(mirror, sheet_id, row, col)
                .map(|value| value.to_string())
        },
    );
}

fn complete_series_live_ref_caches(
    series: &mut [ChartSeriesData],
    sheet_name: &str,
    mut cell_text: impl FnMut(u32, u32) -> Option<String>,
) {
    for series in series {
        if should_materialize_live_ref_cache(series.value_source_kind)
            && let Some(range) = series
                .values
                .as_deref()
                .and_then(|range| parse_local_a1_range(range, sheet_name))
            && let Some(cache) =
                point_cache_from_live_range(&range, Some("General"), &mut cell_text)
        {
            series.value_cache = Some(cache);
            series.value_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
        }

        if should_materialize_live_ref_cache(series.category_source_kind)
            && series.category_levels.is_none()
            && let Some(range) = series
                .categories
                .as_deref()
                .and_then(|range| parse_local_a1_range(range, sheet_name))
            && let Some(cache) = point_cache_from_live_range(&range, None, &mut cell_text)
        {
            series.category_cache = Some(cache);
            series.category_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
        }

        if should_materialize_live_ref_cache(series.bubble_size_source_kind)
            && let Some(range) = series
                .bubble_size
                .as_deref()
                .and_then(|range| parse_local_a1_range(range, sheet_name))
            && let Some(cache) =
                point_cache_from_live_range(&range, Some("General"), &mut cell_text)
        {
            series.bubble_size_cache = Some(cache);
            series.bubble_size_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
        }
    }
}

fn should_materialize_live_ref_cache(
    source_kind: Option<ChartSeriesDimensionSourceKindData>,
) -> bool {
    matches!(
        source_kind,
        None | Some(ChartSeriesDimensionSourceKindData::Ref)
    )
}

fn point_cache_from_live_range(
    range: &ParsedLocalRange,
    format_code: Option<&str>,
    mut cell_text: impl FnMut(u32, u32) -> Option<String>,
) -> Option<ChartSeriesPointCacheData> {
    let point_count = point_count(range)?;
    let points = point_positions(range)
        .into_iter()
        .enumerate()
        .filter_map(|(idx, (row, col))| {
            cell_text(row, col).and_then(|value| {
                (!value.trim().is_empty()).then_some(ChartSeriesPointCachePointData {
                    idx: idx as u32,
                    value,
                    format_code: None,
                })
            })
        })
        .collect();

    Some(ChartSeriesPointCacheData {
        point_count: Some(point_count),
        format_code: format_code.map(str::to_string),
        points,
    })
}

fn point_count(range: &ParsedLocalRange) -> Option<u32> {
    let row_count = range.end_row.checked_sub(range.start_row)?.checked_add(1)?;
    let col_count = range.end_col.checked_sub(range.start_col)?.checked_add(1)?;
    row_count.checked_mul(col_count)
}

fn point_positions(range: &ParsedLocalRange) -> Vec<(u32, u32)> {
    let mut positions = Vec::new();
    if range.start_col == range.end_col {
        for row in range.start_row..=range.end_row {
            positions.push((row, range.start_col));
        }
        return positions;
    }
    if range.start_row == range.end_row {
        for col in range.start_col..=range.end_col {
            positions.push((range.start_row, col));
        }
        return positions;
    }
    for row in range.start_row..=range.end_row {
        for col in range.start_col..=range.end_col {
            positions.push((row, col));
        }
    }
    positions
}

pub(super) fn split_charts_for_sheet_export(
    floating_objects: Vec<FloatingObject>,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    sheet_name: &str,
) -> (Vec<ChartSpec>, Vec<FloatingObject>) {
    let mut charts = Vec::new();
    let mut non_chart_objects = Vec::new();
    for floating_object in floating_objects {
        if matches!(&floating_object.data, FloatingObjectData::Chart(_)) {
            if let Some(mut spec) = ChartSpec::from_floating_object(&floating_object) {
                complete_chart_series_source_refs_for_export(
                    &mut spec, mirror, sheet_id, sheet_name,
                );
                charts.push(spec);
            }
        } else {
            non_chart_objects.push(floating_object);
        }
    }
    charts.sort_by_key(|chart| chart.z_index);
    (charts, non_chart_objects)
}

fn complete_series_name_refs_from_data_range(
    data_range: Option<&str>,
    series: &mut [ChartSeriesData],
    sheet_name: &str,
    mut cell_text: impl FnMut(u32, u32) -> Option<String>,
) {
    let Some(data_range) = data_range.and_then(|range| parse_local_a1_range(range, sheet_name))
    else {
        return;
    };

    for series in series {
        if series
            .name_ref
            .as_deref()
            .is_some_and(|name_ref| !name_ref.trim().is_empty())
        {
            continue;
        }
        let Some(series_name) = series
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            continue;
        };

        let Some(values) = series
            .values
            .as_deref()
            .and_then(|range| parse_local_a1_range(range, sheet_name))
        else {
            continue;
        };
        if !series_values_match_data_body_column(&data_range, &values) {
            continue;
        }

        if let Some(categories) = series
            .categories
            .as_deref()
            .and_then(|range| parse_local_a1_range(range, sheet_name))
            && !categories_match_data_body_category_column(&data_range, &categories)
        {
            continue;
        }

        let Some(header_text) = cell_text(data_range.start_row, values.start_col) else {
            continue;
        };
        if header_text.trim() == series_name {
            series.name_ref = Some(pos_to_a1(data_range.start_row, values.start_col));
        }
    }
}

fn series_values_match_data_body_column(
    data_range: &ParsedLocalRange,
    values: &ParsedLocalRange,
) -> bool {
    data_range.start_row < data_range.end_row
        && data_range.start_col < data_range.end_col
        && values.start_col == values.end_col
        && values.start_col > data_range.start_col
        && values.start_col <= data_range.end_col
        && values.start_row == data_range.start_row + 1
        && values.end_row == data_range.end_row
}

fn categories_match_data_body_category_column(
    data_range: &ParsedLocalRange,
    categories: &ParsedLocalRange,
) -> bool {
    categories.start_col == data_range.start_col
        && categories.end_col == data_range.start_col
        && categories.start_row == data_range.start_row + 1
        && categories.end_row == data_range.end_row
}

fn parse_local_a1_range(reference: &str, sheet_name: &str) -> Option<ParsedLocalRange> {
    let trimmed = reference.trim();
    let (sheet_prefix, body) = compute_parser::split_sheet_prefix(trimmed);
    if let Some(prefix) = sheet_prefix
        && unescape_sheet_name(prefix) != sheet_name
    {
        return None;
    }

    let range = compute_parser::parse_a1_range(body.trim())?;
    if range.range_type != RangeType::CellRange {
        return None;
    }

    let (start_row, start_col) = positional_cell(range.start)?;
    let (end_row, end_col) = positional_cell(range.end)?;
    Some(ParsedLocalRange {
        start_row: start_row.min(end_row),
        start_col: start_col.min(end_col),
        end_row: start_row.max(end_row),
        end_col: start_col.max(end_col),
    })
}

fn positional_cell(cell: CellRef) -> Option<(u32, u32)> {
    match cell {
        CellRef::Positional { row, col, .. } => Some((row, col)),
        CellRef::Resolved(_) => None,
    }
}

fn unescape_sheet_name(sheet_name: &str) -> String {
    sheet_name.replace("''", "'")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn series(value: serde_json::Value) -> ChartSeriesData {
        serde_json::from_value(value).expect("series json should match ChartSeriesData")
    }

    fn complete(data_range: &str, series: &mut [ChartSeriesData], headers: &[((u32, u32), &str)]) {
        let headers: HashMap<_, _> = headers.iter().copied().collect();
        complete_series_name_refs_from_data_range(
            Some(data_range),
            series,
            "Sheet1",
            |row, col| headers.get(&(row, col)).map(|value| (*value).to_string()),
        );
    }

    fn complete_caches(series: &mut [ChartSeriesData], cells: &[((u32, u32), &str)]) {
        let cells: HashMap<_, _> = cells.iter().copied().collect();
        complete_series_live_ref_caches(series, "Sheet1", |row, col| {
            cells.get(&(row, col)).map(|value| (*value).to_string())
        });
    }

    fn point_values(cache: &ChartSeriesPointCacheData) -> Vec<(u32, String)> {
        cache
            .points
            .iter()
            .map(|point| (point.idx, point.value.clone()))
            .collect()
    }

    fn cache(points: &[&str]) -> ChartSeriesPointCacheData {
        ChartSeriesPointCacheData {
            point_count: Some(points.len() as u32),
            format_code: None,
            points: points
                .iter()
                .enumerate()
                .map(|(idx, value)| ChartSeriesPointCachePointData {
                    idx: idx as u32,
                    value: (*value).to_string(),
                    format_code: None,
                })
                .collect(),
        }
    }

    #[test]
    fn materializes_live_ref_caches_for_exported_series_ranges() {
        let mut series = vec![series(json!({
            "values": "B2:B4",
            "categories": "A2:A4",
            "bubbleSize": "C2:C4"
        }))];

        complete_caches(
            &mut series,
            &[
                ((1, 0), "North"),
                ((2, 0), "South"),
                ((3, 0), "West"),
                ((1, 1), "10"),
                ((2, 1), "20"),
                ((3, 1), "30"),
                ((1, 2), "5"),
                ((2, 2), "6"),
                ((3, 2), "7"),
            ],
        );

        let value_cache = series[0].value_cache.as_ref().unwrap();
        assert_eq!(value_cache.point_count, Some(3));
        assert_eq!(value_cache.format_code.as_deref(), Some("General"));
        assert_eq!(
            point_values(value_cache),
            vec![
                (0, "10".to_string()),
                (1, "20".to_string()),
                (2, "30".to_string())
            ]
        );
        assert_eq!(
            series[0].value_source_kind,
            Some(ChartSeriesDimensionSourceKindData::Ref)
        );

        let category_cache = series[0].category_cache.as_ref().unwrap();
        assert_eq!(category_cache.point_count, Some(3));
        assert_eq!(category_cache.format_code, None);
        assert_eq!(
            point_values(category_cache),
            vec![
                (0, "North".to_string()),
                (1, "South".to_string()),
                (2, "West".to_string())
            ]
        );
        assert_eq!(
            series[0].category_source_kind,
            Some(ChartSeriesDimensionSourceKindData::Ref)
        );

        let bubble_cache = series[0].bubble_size_cache.as_ref().unwrap();
        assert_eq!(bubble_cache.point_count, Some(3));
        assert_eq!(bubble_cache.format_code.as_deref(), Some("General"));
        assert_eq!(
            point_values(bubble_cache),
            vec![
                (0, "5".to_string()),
                (1, "6".to_string()),
                (2, "7".to_string())
            ]
        );
        assert_eq!(
            series[0].bubble_size_source_kind,
            Some(ChartSeriesDimensionSourceKindData::Ref)
        );
    }

    #[test]
    fn preserves_non_live_series_caches() {
        let imported = cache(&["9", "8"]);
        let mut series = vec![series(json!({"values": "B2:B3", "categories": "A2:A3"}))];
        series[0].value_source_kind = Some(ChartSeriesDimensionSourceKindData::Literal);
        series[0].value_cache = Some(imported.clone());
        series[0].category_source_kind = Some(ChartSeriesDimensionSourceKindData::CacheFallback);
        series[0].category_cache = Some(imported.clone());

        complete_caches(
            &mut series,
            &[
                ((1, 0), "North"),
                ((2, 0), "South"),
                ((1, 1), "10"),
                ((2, 1), "20"),
            ],
        );

        assert_eq!(series[0].value_cache, Some(imported.clone()));
        assert_eq!(series[0].category_cache, Some(imported));
    }

    #[test]
    fn adds_header_name_refs_for_explicit_series_matching_data_range_headers() {
        let mut series = vec![
            series(json!({"name": "Revenue", "values": "B2:B4", "categories": "A2:A4"})),
            series(json!({"name": "Profit", "values": "C2:C4", "categories": "A2:A4"})),
        ];

        complete(
            "A1:C4",
            &mut series,
            &[((0, 1), "Revenue"), ((0, 2), "Profit")],
        );

        assert_eq!(series[0].name_ref.as_deref(), Some("B1"));
        assert_eq!(series[1].name_ref.as_deref(), Some("C1"));
    }

    #[test]
    fn keeps_custom_literal_series_names_unbound() {
        let mut series = vec![series(
            json!({"name": "Run-rate", "values": "B2:B4", "categories": "A2:A4"}),
        )];

        complete("A1:C4", &mut series, &[((0, 1), "Revenue")]);

        assert_eq!(series[0].name_ref, None);
    }

    #[test]
    fn preserves_explicit_series_name_ref() {
        let mut series = vec![series(json!({
            "name": "Revenue",
            "nameRef": "Z9",
            "values": "B2:B4",
            "categories": "A2:A4"
        }))];

        complete("A1:C4", &mut series, &[((0, 1), "Revenue")]);

        assert_eq!(series[0].name_ref.as_deref(), Some("Z9"));
    }

    #[test]
    fn skips_values_that_do_not_match_data_body_column() {
        let mut series = vec![series(
            json!({"name": "Revenue", "values": "B3:B4", "categories": "A2:A4"}),
        )];

        complete("A1:C4", &mut series, &[((0, 1), "Revenue")]);

        assert_eq!(series[0].name_ref, None);
    }

    #[test]
    fn accepts_current_sheet_qualified_references() {
        let mut series = vec![series(json!({
            "name": "Revenue",
            "values": "Sheet1!B2:B4",
            "categories": "Sheet1!A2:A4"
        }))];

        complete("Sheet1!A1:C4", &mut series, &[((0, 1), "Revenue")]);

        assert_eq!(series[0].name_ref.as_deref(), Some("B1"));
    }

    #[test]
    fn skips_references_to_other_sheets() {
        let mut series = vec![series(json!({
            "name": "Revenue",
            "values": "Other!B2:B4",
            "categories": "Other!A2:A4"
        }))];

        complete("Other!A1:C4", &mut series, &[((0, 1), "Revenue")]);

        assert_eq!(series[0].name_ref, None);
    }
}
