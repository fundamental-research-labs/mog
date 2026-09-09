use std::collections::{HashMap, HashSet};

use domain_types::{ChartSpec, SheetData};

use super::live_source_ref;

type WorkbookChartCellState = HashMap<String, HashMap<(u32, u32), ChartCellState>>;

#[derive(Debug, Clone)]
struct ChartCellState {
    formula: String,
    value: String,
}

/// Complete source fingerprints after every worksheet has been converted.
///
/// Per-sheet chart conversion has only the current worksheet's parsed cells at
/// hand. A second pass over the assembled output fills cross-sheet source
/// dependencies, so export-time freshness checks cover ordinary A1 refs on
/// every worksheet as well as local refs.
pub(crate) fn finalize_standard_chart_source_fingerprints(sheets: &mut [SheetData]) {
    let workbook_state: WorkbookChartCellState = sheets
        .iter()
        .map(|sheet| {
            (
                canonical_chart_sheet_name(&sheet.name),
                sheet
                    .cells
                    .iter()
                    .filter_map(|cell| {
                        let formula = cell
                            .formula
                            .as_deref()
                            .unwrap_or_default()
                            .trim_start_matches('=');
                        let value = cell.value.to_string();
                        if formula.is_empty() && value.is_empty() {
                            None
                        } else {
                            Some((
                                (cell.row, cell.col),
                                ChartCellState {
                                    formula: formula.to_string(),
                                    value,
                                },
                            ))
                        }
                    })
                    .collect(),
            )
        })
        .collect();

    for sheet in sheets {
        let owner_sheet_name = sheet.name.clone();
        for chart in &mut sheet.charts {
            if chart.is_chart_ex {
                continue;
            }
            let Some(source_fingerprint) = standard_chart_source_fingerprint_from_state(
                chart,
                &owner_sheet_name,
                &workbook_state,
            ) else {
                continue;
            };
            if let Some(provenance) = chart.standard_chart_provenance.as_mut() {
                provenance.source_fingerprint = Some(source_fingerprint.clone());
            }
            if let Some(authority) = chart.standard_chart_export_authority.as_mut() {
                authority.source_fingerprint = Some(source_fingerprint);
            }
        }
    }
}

/// Build a snapshot of the worksheet state behind a standard chart's live
/// source references. The snapshot deliberately includes formulas as well as
/// displayed values: replacing a source formula with another formula that
/// currently returns the same value still changes the chart's dependency.
///
/// The parser converts one sheet at a time, so the per-sheet helper only
/// handles local references. The assembled-output pass below fills ordinary
/// cross-sheet A1 dependencies before the chart reaches the compute layer;
/// references that still cannot be represented as cell ranges remain on the
/// conservative mutation invalidation path.
pub(crate) fn standard_chart_source_fingerprint(
    spec: &ChartSpec,
    sheet_name: &str,
    cells: &[crate::output::results::FullCellData],
) -> Option<String> {
    let mut references = Vec::new();
    if let Some(reference) = spec.data_range.as_deref() {
        references.push(reference);
    }
    if let Some(reference) = spec.series_range.as_deref() {
        references.push(reference);
    }
    if let Some(reference) = spec.category_range.as_deref() {
        references.push(reference);
    }
    if let Some(reference) = spec.title_formula.as_deref() {
        references.push(reference);
    }
    for series in &spec.series {
        if let Some(reference) = series.name_ref.as_deref() {
            references.push(reference);
        }
        if live_source_ref(series.values.as_deref(), series.value_source_kind) {
            if let Some(reference) = series.values.as_deref() {
                references.push(reference);
            }
        }
        if live_source_ref(series.categories.as_deref(), series.category_source_kind) {
            if let Some(reference) = series.categories.as_deref() {
                references.push(reference);
            }
        }
        if live_source_ref(
            series.bubble_size.as_deref(),
            series.bubble_size_source_kind,
        ) {
            if let Some(reference) = series.bubble_size.as_deref() {
                references.push(reference);
            }
        }
    }

    let mut ranges = Vec::new();
    for reference in references {
        let trimmed = reference.trim().trim_start_matches('=').trim();
        if trimmed.is_empty() {
            continue;
        }
        let (sheet_prefix, body) = compute_parser::split_sheet_prefix(trimmed);
        let referenced_sheet = sheet_prefix
            .map(|name| name.replace("''", "'"))
            .unwrap_or_else(|| sheet_name.to_string());
        if !referenced_sheet.eq_ignore_ascii_case(sheet_name) {
            return None;
        }
        let range = compute_parser::parse_a1_range(body.trim())?;
        if range.range_type != formula_types::RangeType::CellRange {
            return None;
        }
        let (
            formula_types::CellRef::Positional {
                row: start_row,
                col: start_col,
                ..
            },
            formula_types::CellRef::Positional {
                row: end_row,
                col: end_col,
                ..
            },
        ) = (range.start, range.end)
        else {
            return None;
        };
        ranges.push((
            start_row.min(end_row),
            start_col.min(end_col),
            start_row.max(end_row),
            start_col.max(end_col),
        ));
    }
    if ranges.is_empty() {
        return None;
    }
    ranges.sort_unstable();
    ranges.dedup();

    let mut fingerprint = SourceFnv1a64::default();
    let canonical_sheet_name = canonical_chart_sheet_name(sheet_name);
    fingerprint.write_str(&canonical_sheet_name);
    for (start_row, start_col, end_row, end_col) in &ranges {
        fingerprint.write_str(&format!(
            "range:{canonical_sheet_name}:{start_row}:{start_col}:{end_row}:{end_col}"
        ));
    }
    let mut present_cells = HashSet::new();
    for cell in cells {
        if ranges
            .iter()
            .any(|(start_row, start_col, end_row, end_col)| {
                (*start_row..=*end_row).contains(&cell.row)
                    && (*start_col..=*end_col).contains(&cell.col)
            })
        {
            let formula = cell
                .formula
                .as_deref()
                .unwrap_or_default()
                .trim_start_matches('=');
            let value = cell
                .value
                .as_ref()
                .map(|value| value.to_string())
                .unwrap_or_default();
            if !formula.is_empty() || !value.is_empty() {
                present_cells.insert((cell.row, cell.col, formula.to_string(), value));
            }
        }
    }
    let mut present_cells: Vec<_> = present_cells.into_iter().collect();
    present_cells.sort_unstable();
    for (row, col, formula, value) in present_cells {
        fingerprint.write_str(&format!("cell:{canonical_sheet_name}:{row}:{col}"));
        fingerprint.write_str(&formula);
        fingerprint.write_str(&value);
    }
    Some(format!("{:016x}", fingerprint.finish()))
}

/// Compute a source fingerprint from the complete workbook cell projection.
/// This second-pass form is needed for cross-sheet chart references, which are
/// not available while an individual `FullParsedSheet` is being converted.
fn standard_chart_source_fingerprint_from_state(
    spec: &ChartSpec,
    owner_sheet_name: &str,
    workbook_state: &WorkbookChartCellState,
) -> Option<String> {
    let mut references = Vec::new();
    if let Some(reference) = spec.data_range.as_deref() {
        references.push(reference);
    }
    if let Some(reference) = spec.series_range.as_deref() {
        references.push(reference);
    }
    if let Some(reference) = spec.category_range.as_deref() {
        references.push(reference);
    }
    if let Some(reference) = spec.title_formula.as_deref() {
        references.push(reference);
    }
    for series in &spec.series {
        if let Some(reference) = series.name_ref.as_deref() {
            references.push(reference);
        }
        if live_source_ref(series.values.as_deref(), series.value_source_kind) {
            if let Some(reference) = series.values.as_deref() {
                references.push(reference);
            }
        }
        if live_source_ref(series.categories.as_deref(), series.category_source_kind) {
            if let Some(reference) = series.categories.as_deref() {
                references.push(reference);
            }
        }
        if live_source_ref(
            series.bubble_size.as_deref(),
            series.bubble_size_source_kind,
        ) {
            if let Some(reference) = series.bubble_size.as_deref() {
                references.push(reference);
            }
        }
    }

    let mut ranges = Vec::new();
    for reference in references {
        let trimmed = reference.trim().trim_start_matches('=').trim();
        if trimmed.is_empty() {
            continue;
        }
        let (sheet_prefix, body) = compute_parser::split_sheet_prefix(trimmed);
        let referenced_sheet = sheet_prefix
            .map(|name| name.replace("''", "'"))
            .unwrap_or_else(|| owner_sheet_name.to_string());
        let range = compute_parser::parse_a1_range(body.trim())?;
        if range.range_type != formula_types::RangeType::CellRange {
            return None;
        }
        let (
            formula_types::CellRef::Positional {
                row: start_row,
                col: start_col,
                ..
            },
            formula_types::CellRef::Positional {
                row: end_row,
                col: end_col,
                ..
            },
        ) = (range.start, range.end)
        else {
            return None;
        };
        ranges.push((
            canonical_chart_sheet_name(&referenced_sheet),
            start_row.min(end_row),
            start_col.min(end_col),
            start_row.max(end_row),
            start_col.max(end_col),
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
    for (sheet_name, cells) in workbook_state {
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
