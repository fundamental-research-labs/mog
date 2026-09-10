//! XLSX-only chart source completion.
//!
//! `ParseOutput` is a semantic workbook projection; it should not have to
//! carry every OOXML render cache. The XLSX writer, however, must emit chart
//! formulas and caches that Excel can render without opening a blank chart.
//! This pass runs inside writer preflight so replay/reconstruction decisions
//! are based on the package we are actually about to serialize.

use std::collections::HashMap;

use domain_types::domain::chart::{
    ChartSeriesCategoryLevelCacheData, ChartSeriesCategoryLevelsCacheData, ChartSeriesData,
    ChartSeriesDimensionSourceKindData, ChartSeriesPointCacheData, ChartSeriesPointCachePointData,
    apply_explicit_chart_source_ranges, synthesize_chart_series_from_data_range,
};
use domain_types::{ParseOutput, SheetData};
use formula_types::{CellRef, RangeType};

use super::chart_replay;

type WorkbookCellText = HashMap<String, HashMap<(u32, u32), String>>;
type WorkbookCellState = HashMap<String, HashMap<(u32, u32), WorkbookCellStateValue>>;

#[derive(Debug, Clone)]
struct WorkbookCellStateValue {
    formula: String,
    value: String,
}

const SOURCE_STALE_REASON: &str = "chart source cells changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ParsedLocalRange {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedWorkbookRange {
    sheet_name: String,
    range: ParsedLocalRange,
}

pub(super) fn complete_chart_sources_for_xlsx_export(output: &mut ParseOutput) {
    let cell_text = workbook_cell_text(output);
    let cell_state = workbook_cell_state(output);
    for sheet_data in &mut output.sheets {
        complete_chart_sources_for_sheet(sheet_data, &cell_text, &cell_state);
    }
}

fn complete_chart_sources_for_sheet(
    sheet_data: &mut SheetData,
    cell_text: &WorkbookCellText,
    cell_state: &WorkbookCellState,
) {
    if sheet_data.charts.is_empty() {
        return;
    }
    let sheet_name = sheet_data.name.clone();
    for chart in &mut sheet_data.charts {
        if chart.is_chart_ex {
            continue;
        }
        refresh_chart_source_authority(chart, &sheet_name, cell_state);
        if !chart_replay::should_complete_sources_for_xlsx_export(chart) {
            continue;
        }
        if chart.series.is_empty() {
            chart.series = chart
                .data_range
                .as_deref()
                .and_then(|data_range| {
                    synthesize_chart_series_from_data_range(&chart.chart_type, data_range)
                })
                .unwrap_or_default();
        }
        // Explicit chart-level ranges are authoritative even when the
        // imported chart already carried series objects. Applying them here
        // keeps category/name formulas aligned before their caches refresh.
        let category_range =
            valid_explicit_source_range(chart.category_range.as_deref(), &sheet_name);
        let series_range = valid_explicit_source_range(chart.series_range.as_deref(), &sheet_name);
        apply_explicit_chart_source_ranges(&mut chart.series, category_range, series_range);
        refresh_chart_text_caches(chart, &sheet_name, |sheet_name, row, col| {
            cell_text
                .get(sheet_name)
                .and_then(|sheet| sheet.get(&(row, col)))
                .cloned()
        });
        complete_series_live_ref_caches(&mut chart.series, &sheet_name, |sheet_name, row, col| {
            cell_text
                .get(sheet_name)
                .and_then(|sheet| sheet.get(&(row, col)))
                .cloned()
        });
        complete_series_name_refs_from_data_range(
            chart.data_range.as_deref(),
            &mut chart.series,
            &sheet_name,
            |sheet_name, row, col| {
                cell_text
                    .get(sheet_name)
                    .and_then(|sheet| sheet.get(&(row, col)))
                    .cloned()
            },
        );
    }
}

/// Refresh scalar chart text that is backed by a live worksheet reference.
///
/// The source parser deliberately returns `None` for unsupported formulas
/// (`#REF!`, unknown names, structured references, and similar expressions).
/// In that case this helper leaves the imported cache untouched. A parsed
/// reference with an empty source cell returns `Some(None)`, allowing a valid
/// edit that clears a title or series name to clear its old cache as well.
fn refresh_chart_text_caches(
    chart: &mut domain_types::ChartSpec,
    sheet_name: &str,
    mut cell_text: impl FnMut(&str, u32, u32) -> Option<String>,
) {
    if let Some(title_formula) = chart
        .title_formula
        .as_deref()
        .filter(|formula| !formula.trim().is_empty())
        && let Some(title) = live_source_first_cell_text(title_formula, sheet_name, &mut cell_text)
    {
        chart.title = title.filter(|value| !value.is_empty());
    }

    for series in &mut chart.series {
        let Some(name_ref) = series
            .name_ref
            .as_deref()
            .filter(|name_ref| !name_ref.trim().is_empty())
        else {
            continue;
        };
        if let Some(name) = live_source_first_cell_text(name_ref, sheet_name, &mut cell_text) {
            series.name = name.filter(|value| !value.is_empty());
        }
    }
}

/// Resolve the first cell of a live scalar reference.
///
/// Chart title and series-name formulas are scalar in OOXML even when a
/// malformed or hand-authored package gives them a multi-cell range. Using
/// the first cell keeps the writer deterministic while retaining the
/// conservative no-op behavior for references that cannot be parsed at all.
fn live_source_first_cell_text(
    reference: &str,
    default_sheet_name: &str,
    cell_text: &mut impl FnMut(&str, u32, u32) -> Option<String>,
) -> Option<Option<String>> {
    let range = parse_workbook_a1_range(reference, default_sheet_name)?;
    Some(cell_text(
        &range.sheet_name,
        range.range.start_row,
        range.range.start_col,
    ))
}

fn valid_explicit_source_range<'a>(
    reference: Option<&'a str>,
    default_sheet_name: &str,
) -> Option<&'a str> {
    reference
        .map(str::trim)
        .filter(|reference| !reference.is_empty())
        .filter(|reference| parse_workbook_a1_range(reference, default_sheet_name).is_some())
}

fn workbook_cell_text(output: &ParseOutput) -> WorkbookCellText {
    output
        .sheets
        .iter()
        .map(|sheet_data| {
            (
                sheet_data.name.clone(),
                sheet_data
                    .cells
                    .iter()
                    .map(|cell| ((cell.row, cell.col), cell.value.to_string()))
                    .collect(),
            )
        })
        .collect()
}

fn workbook_cell_state(output: &ParseOutput) -> WorkbookCellState {
    output
        .sheets
        .iter()
        .map(|sheet_data| {
            (
                canonical_chart_sheet_name(&sheet_data.name),
                sheet_data
                    .cells
                    .iter()
                    .map(|cell| {
                        (
                            (cell.row, cell.col),
                            WorkbookCellStateValue {
                                formula: cell
                                    .formula
                                    .as_deref()
                                    .unwrap_or_default()
                                    .trim_start_matches('=')
                                    .to_string(),
                                value: cell.value.to_string(),
                            },
                        )
                    })
                    .collect(),
            )
        })
        .collect()
}

fn refresh_chart_source_authority(
    chart: &mut domain_types::ChartSpec,
    owner_sheet_name: &str,
    cell_state: &WorkbookCellState,
) {
    let Some(expected) = chart
        .standard_chart_export_authority
        .as_ref()
        .and_then(|authority| authority.source_fingerprint.as_deref())
        .or_else(|| {
            chart
                .standard_chart_provenance
                .as_ref()
                .and_then(|provenance| provenance.source_fingerprint.as_deref())
        })
    else {
        return;
    };
    let expected = expected.to_string();
    let Some(current) = chart_source_fingerprint(chart, owner_sheet_name, cell_state) else {
        return;
    };
    let Some(authority) = chart.standard_chart_export_authority.as_mut() else {
        return;
    };

    if current != expected {
        if authority.stale_reason.as_deref() != Some(SOURCE_STALE_REASON) {
            authority.chart_part_revision = authority.chart_part_revision.saturating_add(1);
        }
        authority.validity = domain_types::chart::StandardChartAuthorityValidity::Stale;
        authority.stale_reason = Some(SOURCE_STALE_REASON.to_string());
    } else if authority.stale_reason.as_deref() == Some(SOURCE_STALE_REASON) {
        // An edit can be undone before export. Replaying is safe again once
        // the dependency snapshot is back at its import state.
        authority.validity = domain_types::chart::StandardChartAuthorityValidity::Current;
        authority.stale_reason = None;
    }
}

fn chart_source_fingerprint(
    chart: &domain_types::ChartSpec,
    owner_sheet_name: &str,
    cell_state: &WorkbookCellState,
) -> Option<String> {
    let mut references = Vec::new();
    for reference in [
        chart.data_range.as_deref(),
        chart.series_range.as_deref(),
        chart.category_range.as_deref(),
        chart.title_formula.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        references.push(reference);
    }
    for series in &chart.series {
        if let Some(reference) = series.name_ref.as_deref() {
            references.push(reference);
        }
        if live_chart_source_ref(series.values.as_deref(), series.value_source_kind)
            && let Some(reference) = series.values.as_deref()
        {
            references.push(reference);
        }
        if live_chart_source_ref(series.categories.as_deref(), series.category_source_kind)
            && let Some(reference) = series.categories.as_deref()
        {
            references.push(reference);
        }
        if live_chart_source_ref(
            series.bubble_size.as_deref(),
            series.bubble_size_source_kind,
        ) && let Some(reference) = series.bubble_size.as_deref()
        {
            references.push(reference);
        }
    }

    let mut ranges = Vec::new();
    for reference in references {
        let trimmed = reference.trim().trim_start_matches('=').trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed = parse_workbook_a1_range(trimmed, owner_sheet_name)?;
        ranges.push((
            canonical_chart_sheet_name(&parsed.sheet_name),
            parsed.range.start_row,
            parsed.range.start_col,
            parsed.range.end_row,
            parsed.range.end_col,
        ));
    }
    if ranges.is_empty() {
        return None;
    }
    ranges.sort_unstable();
    ranges.dedup();

    let mut fingerprint = SourceFnv1a64::default();
    fingerprint.write_str(&canonical_chart_sheet_name(owner_sheet_name));
    for (sheet_name, start_row, start_col, end_row, end_col) in &ranges {
        fingerprint.write_str(&format!(
            "range:{sheet_name}:{start_row}:{start_col}:{end_row}:{end_col}"
        ));
    }
    let mut present_cells = Vec::new();
    for (sheet_name, cells) in cell_state {
        for ((row, col), state) in cells {
            if ranges
                .iter()
                .any(|(range_sheet, start_row, start_col, end_row, end_col)| {
                    range_sheet == sheet_name
                        && (*start_row..=*end_row).contains(row)
                        && (*start_col..=*end_col).contains(col)
                })
            {
                if state.formula.is_empty() && state.value.is_empty() {
                    continue;
                }
                present_cells.push((
                    sheet_name.clone(),
                    *row,
                    *col,
                    state.formula.clone(),
                    state.value.clone(),
                ));
            }
        }
    }
    present_cells.sort_unstable();
    for (sheet_name, row, col, formula, value) in present_cells {
        fingerprint.write_str(&format!("cell:{sheet_name}:{row}:{col}"));
        fingerprint.write_str(&formula);
        fingerprint.write_str(&value);
    }
    Some(format!("{:016x}", fingerprint.finish()))
}

fn canonical_chart_sheet_name(name: &str) -> String {
    name.replace("''", "'").to_lowercase()
}

fn live_chart_source_ref(
    reference: Option<&str>,
    source_kind: Option<domain_types::chart::ChartSeriesDimensionSourceKindData>,
) -> bool {
    reference.is_some_and(|reference| !reference.trim().is_empty())
        && matches!(
            source_kind,
            None | Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref)
        )
}

#[derive(Clone, Copy)]
struct SourceFnv1a64(u64);

impl Default for SourceFnv1a64 {
    fn default() -> Self {
        Self(0xcbf29ce484222325)
    }
}

impl SourceFnv1a64 {
    fn write_str(&mut self, value: &str) {
        for byte in value.as_bytes() {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
        self.0 ^= 0xff;
        self.0 = self.0.wrapping_mul(0x100000001b3);
    }

    fn finish(self) -> u64 {
        self.0
    }
}

fn complete_series_live_ref_caches(
    series: &mut [ChartSeriesData],
    sheet_name: &str,
    mut cell_text: impl FnMut(&str, u32, u32) -> Option<String>,
) {
    for series in series {
        if should_materialize_live_ref_cache(series.value_source_kind) {
            if let Some(reference) = non_empty_ref(series.values.as_deref()) {
                series.value_cache = None;
                if let Some(range) = parse_workbook_a1_range(reference, sheet_name)
                    && let Some(cache) =
                        point_cache_from_live_range(&range, Some("General"), &mut cell_text)
                {
                    series.value_cache = Some(cache);
                    series.value_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
                }
            }
        }

        if should_materialize_live_ref_cache(series.category_source_kind) {
            if let Some(reference) = non_empty_ref(series.categories.as_deref()) {
                series.category_cache = None;
                let had_category_levels = series.category_levels.take().is_some();
                if let Some(range) = parse_workbook_a1_range(reference, sheet_name) {
                    let category_levels = if had_category_levels {
                        category_levels_cache_from_live_range(&range, &mut cell_text)
                    } else {
                        None
                    };
                    if let Some(cache) = category_levels {
                        series.category_levels = Some(cache);
                        series.category_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
                    } else if let Some(cache) =
                        point_cache_from_live_range(&range, None, &mut cell_text)
                    {
                        series.category_cache = Some(cache);
                        series.category_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
                    }
                }
            }
        }

        if should_materialize_live_ref_cache(series.bubble_size_source_kind) {
            if let Some(reference) = non_empty_ref(series.bubble_size.as_deref()) {
                series.bubble_size_cache = None;
                if let Some(range) = parse_workbook_a1_range(reference, sheet_name)
                    && let Some(cache) =
                        point_cache_from_live_range(&range, Some("General"), &mut cell_text)
                {
                    series.bubble_size_cache = Some(cache);
                    series.bubble_size_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
                }
            }
        }
    }
}

fn non_empty_ref(reference: Option<&str>) -> Option<&str> {
    reference.map(str::trim).filter(|value| !value.is_empty())
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
    range: &ParsedWorkbookRange,
    format_code: Option<&str>,
    mut cell_text: impl FnMut(&str, u32, u32) -> Option<String>,
) -> Option<ChartSeriesPointCacheData> {
    let point_count = point_count(&range.range)?;
    let points = point_positions(&range.range)
        .into_iter()
        .enumerate()
        .filter_map(|(idx, (row, col))| {
            cell_text(&range.sheet_name, row, col).and_then(|value| {
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

fn category_levels_cache_from_live_range(
    range: &ParsedWorkbookRange,
    mut cell_text: impl FnMut(&str, u32, u32) -> Option<String>,
) -> Option<ChartSeriesCategoryLevelsCacheData> {
    let row_count = range
        .range
        .end_row
        .checked_sub(range.range.start_row)?
        .checked_add(1)?;
    let col_count = range
        .range
        .end_col
        .checked_sub(range.range.start_col)?
        .checked_add(1)?;
    if col_count < 2 {
        return None;
    }

    let levels = (0..col_count)
        .map(|level| {
            let col = range.range.start_col + level;
            let points = (0..row_count)
                .filter_map(|idx| {
                    let row = range.range.start_row + idx;
                    cell_text(&range.sheet_name, row, col).and_then(|value| {
                        (!value.trim().is_empty()).then_some(ChartSeriesPointCachePointData {
                            idx,
                            value,
                            format_code: None,
                        })
                    })
                })
                .collect();
            ChartSeriesCategoryLevelCacheData {
                level,
                point_count: Some(row_count),
                points,
            }
        })
        .collect();

    Some(ChartSeriesCategoryLevelsCacheData {
        point_count: Some(row_count),
        levels,
    })
}

fn complete_series_name_refs_from_data_range(
    data_range: Option<&str>,
    series: &mut [ChartSeriesData],
    sheet_name: &str,
    mut cell_text: impl FnMut(&str, u32, u32) -> Option<String>,
) {
    let Some(data_range) = data_range.and_then(|range| parse_workbook_a1_range(range, sheet_name))
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
            .and_then(|range| parse_workbook_a1_range(range, sheet_name))
        else {
            continue;
        };
        if !series_values_match_data_body_column(&data_range, &values) {
            continue;
        }

        if let Some(categories) = series
            .categories
            .as_deref()
            .and_then(|range| parse_workbook_a1_range(range, sheet_name))
            && !categories_match_data_body_category_column(&data_range, &categories)
        {
            continue;
        }

        let Some(header_text) = cell_text(
            &data_range.sheet_name,
            data_range.range.start_row,
            values.range.start_col,
        ) else {
            continue;
        };
        if header_text.trim() == series_name {
            series.name_ref = Some(qualified_cell_ref(
                &data_range.sheet_name,
                sheet_name,
                data_range.range.start_row,
                values.range.start_col,
            ));
        }
    }
}

fn series_values_match_data_body_column(
    data_range: &ParsedWorkbookRange,
    values: &ParsedWorkbookRange,
) -> bool {
    data_range.sheet_name == values.sheet_name
        && data_range.range.start_row < data_range.range.end_row
        && data_range.range.start_col < data_range.range.end_col
        && values.range.start_col == values.range.end_col
        && values.range.start_col > data_range.range.start_col
        && values.range.start_col <= data_range.range.end_col
        && values.range.start_row == data_range.range.start_row + 1
        && values.range.end_row == data_range.range.end_row
}

fn categories_match_data_body_category_column(
    data_range: &ParsedWorkbookRange,
    categories: &ParsedWorkbookRange,
) -> bool {
    data_range.sheet_name == categories.sheet_name
        && categories.range.start_col == data_range.range.start_col
        && categories.range.end_col == data_range.range.start_col
        && categories.range.start_row == data_range.range.start_row + 1
        && categories.range.end_row == data_range.range.end_row
}

fn parse_workbook_a1_range(
    reference: &str,
    default_sheet_name: &str,
) -> Option<ParsedWorkbookRange> {
    let trimmed = reference.trim().trim_start_matches('=').trim();
    let (sheet_prefix, body) = compute_parser::split_sheet_prefix(trimmed);
    let sheet_name = sheet_prefix
        .map(unescape_sheet_name)
        .unwrap_or_else(|| default_sheet_name.to_string());

    let range = compute_parser::parse_a1_range(body.trim())?;
    if range.range_type != RangeType::CellRange {
        return None;
    }

    let (start_row, start_col) = positional_cell(range.start)?;
    let (end_row, end_col) = positional_cell(range.end)?;
    Some(ParsedWorkbookRange {
        sheet_name,
        range: ParsedLocalRange {
            start_row: start_row.min(end_row),
            start_col: start_col.min(end_col),
            end_row: start_row.max(end_row),
            end_col: start_col.max(end_col),
        },
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

fn qualified_cell_ref(sheet_name: &str, default_sheet_name: &str, row: u32, col: u32) -> String {
    let cell_ref = crate::infra::a1::to_a1(row, col);
    if sheet_name == default_sheet_name {
        cell_ref
    } else {
        format!("{}!{cell_ref}", quote_sheet_name(sheet_name))
    }
}

fn quote_sheet_name(sheet_name: &str) -> String {
    if !sheet_name.is_empty()
        && sheet_name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        sheet_name.to_string()
    } else {
        format!("'{}'", sheet_name.replace('\'', "''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::{CellData, ParseOutput, SheetData};
    use value_types::{CellValue, FiniteF64};

    fn chart_text_cell(row: u32, col: u32, text: &str) -> CellData {
        CellData {
            row,
            col,
            value: CellValue::Text(text.into()),
            ..Default::default()
        }
    }

    fn chart_number_cell(row: u32, col: u32, number: f64) -> CellData {
        CellData {
            row,
            col,
            value: CellValue::Number(FiniteF64::must(number)),
            ..Default::default()
        }
    }

    fn series(value: serde_json::Value) -> ChartSeriesData {
        serde_json::from_value(value).expect("series json should match ChartSeriesData")
    }

    #[test]
    fn materializes_caches_from_sheet_cells_for_reconstructed_export() {
        let sheet = SheetData {
            name: "Sheet1".to_string(),
            cells: vec![
                chart_text_cell(0, 0, "Quarter"),
                chart_text_cell(0, 1, "Revenue"),
                chart_text_cell(1, 0, "Q1"),
                chart_number_cell(1, 1, 10.0),
                chart_text_cell(2, 0, "Q2"),
                chart_number_cell(2, 1, 20.0),
            ],
            charts: vec![
                serde_json::from_value(serde_json::json!({
                "chartType": "column",
                "title": "Revenue",
                "position": {
                    "anchorRow": 0,
                    "anchorCol": 0,
                    "anchorRowOffset": 0,
                    "anchorColOffset": 0,
                    "endRow": 12,
                    "endCol": 8,
                    "endRowOffset": 0,
                    "endColOffset": 0
                },
                "size": { "width": 400.0, "height": 300.0 },
                    "zIndex": 0,
                    "dataRange": "A1:B3",
                    "series": [{
                        "name": "Revenue",
                        "values": "B2:B3",
                        "categories": "A2:A3"
                    }]
                }))
                .expect("valid chart spec"),
            ],
            ..Default::default()
        };

        let mut output = ParseOutput {
            sheets: vec![sheet],
            ..Default::default()
        };
        complete_chart_sources_for_xlsx_export(&mut output);

        let series = &output.sheets[0].charts[0].series[0];
        assert_eq!(series.name_ref.as_deref(), Some("B1"));
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
    }

    #[test]
    fn preserves_non_live_series_caches() {
        let imported = ChartSeriesPointCacheData {
            point_count: Some(1),
            format_code: None,
            points: vec![ChartSeriesPointCachePointData {
                idx: 0,
                value: "cached".to_string(),
                format_code: None,
            }],
        };
        let mut series = vec![series(serde_json::json!({
            "values": "B2:B3",
            "categories": "A2:A3"
        }))];
        series[0].value_source_kind = Some(ChartSeriesDimensionSourceKindData::Literal);
        series[0].value_cache = Some(imported.clone());
        series[0].category_source_kind = Some(ChartSeriesDimensionSourceKindData::CacheFallback);
        series[0].category_cache = Some(imported.clone());

        complete_series_live_ref_caches(&mut series, "Sheet1", |_, _, _| Some("live".to_string()));

        assert_eq!(series[0].value_cache, Some(imported.clone()));
        assert_eq!(series[0].category_cache, Some(imported));
    }

    #[test]
    fn refreshes_stale_multi_level_category_cache_from_sheet_cells() {
        let stale_levels = ChartSeriesCategoryLevelsCacheData {
            point_count: Some(2),
            levels: vec![ChartSeriesCategoryLevelCacheData {
                level: 0,
                point_count: Some(2),
                points: vec![ChartSeriesPointCachePointData {
                    idx: 0,
                    value: "Stale".to_string(),
                    format_code: None,
                }],
            }],
        };
        let mut series = vec![series(serde_json::json!({
            "categories": "A2:B3"
        }))];
        series[0].category_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
        series[0].category_levels = Some(stale_levels);

        complete_series_live_ref_caches(&mut series, "Sheet1", |_, row, col| match (row, col) {
            (1, 0) => Some("North".to_string()),
            (1, 1) => Some("Q1".to_string()),
            (2, 0) => Some("South".to_string()),
            (2, 1) => Some("Q2".to_string()),
            _ => None,
        });

        let levels = series[0]
            .category_levels
            .as_ref()
            .expect("refreshed category levels");
        assert_eq!(levels.point_count, Some(2));
        assert!(series[0].category_cache.is_none());
        assert_eq!(
            levels.levels[0]
                .points
                .iter()
                .map(|point| point.value.as_str())
                .collect::<Vec<_>>(),
            vec!["North", "South"]
        );
        assert_eq!(
            levels.levels[1]
                .points
                .iter()
                .map(|point| point.value.as_str())
                .collect::<Vec<_>>(),
            vec!["Q1", "Q2"]
        );
    }

    #[test]
    fn stale_multi_level_category_cache_falls_back_to_point_cache_for_single_column_ref() {
        let stale_levels = ChartSeriesCategoryLevelsCacheData {
            point_count: Some(2),
            levels: vec![ChartSeriesCategoryLevelCacheData {
                level: 0,
                point_count: Some(2),
                points: vec![ChartSeriesPointCachePointData {
                    idx: 0,
                    value: "Stale".to_string(),
                    format_code: None,
                }],
            }],
        };
        let mut series = vec![series(serde_json::json!({
            "categories": "A2:A3"
        }))];
        series[0].category_source_kind = Some(ChartSeriesDimensionSourceKindData::Ref);
        series[0].category_levels = Some(stale_levels);

        complete_series_live_ref_caches(&mut series, "Sheet1", |_, row, col| match (row, col) {
            (1, 0) => Some("North".to_string()),
            (2, 0) => Some("South".to_string()),
            _ => None,
        });

        assert!(series[0].category_levels.is_none());
        assert_eq!(
            series[0]
                .category_cache
                .as_ref()
                .expect("refreshed category cache")
                .points
                .iter()
                .map(|point| point.value.as_str())
                .collect::<Vec<_>>(),
            vec!["North", "South"]
        );
    }
}
