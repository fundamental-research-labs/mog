//! Chart source-reference completion for XLSX export.
//!
//! Public chart APIs allow callers to provide explicit series while also
//! retaining a chart-level data range. XLSX has no chart-level source range;
//! the source contract is represented by per-series references. Complete the
//! missing series-name references at export time when the live worksheet data
//! proves the literal series name is the header cell for that value column.

use cell_types::SheetId;
use domain_types::domain::{
    chart::{ChartSeriesData, ChartSpec},
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
