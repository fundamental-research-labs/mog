use std::collections::HashSet;

use domain_types::{ChartSpec, SheetData};

use super::live_source_ref;

/// Source range for a chart fingerprint, with a canonical worksheet name.
#[derive(Debug, Clone)]
pub struct ChartSourceRange {
    pub sheet_name: String,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

impl ChartSourceRange {
    pub fn contains(&self, row: u32, col: u32) -> bool {
        (self.start_row..=self.end_row).contains(&row)
            && (self.start_col..=self.end_col).contains(&col)
    }
}

type CellVisitor<'a> = dyn FnMut(&str, u32, u32, &str, &value_types::CellValue) + 'a;

/// Recompute chart source authority from the actual value owner. The visitor
/// emits each existing cell in the requested ranges at most once; it need not
/// build another workbook-sized cell map.
pub fn refresh_chart_source_fingerprints(
    sheets: &mut [SheetData],
    mut visit: impl FnMut(&[SheetData], &[ChartSourceRange], &mut CellVisitor<'_>),
) {
    let updates =
        source_fingerprint_updates(sheets, &mut |ranges, emit| visit(sheets, ranges, emit));
    apply_source_fingerprints(sheets, updates);
}

pub(crate) fn finalize_standard_chart_source_fingerprints(sheets: &mut [SheetData]) {
    let updates = source_fingerprint_updates(sheets, &mut |ranges, emit| {
        for sheet in sheets.iter() {
            let name = canonical_chart_sheet_name(&sheet.name);
            for cell in &sheet.cells {
                if ranges
                    .iter()
                    .any(|range| range.sheet_name == name && range.contains(cell.row, cell.col))
                {
                    emit(
                        &name,
                        cell.row,
                        cell.col,
                        cell.formula.as_deref().unwrap_or_default(),
                        &cell.value,
                    );
                }
            }
        }
    });
    apply_source_fingerprints(sheets, updates);
}

fn source_fingerprint_updates(
    sheets: &[SheetData],
    visit: &mut impl FnMut(&[ChartSourceRange], &mut CellVisitor<'_>),
) -> Vec<(usize, usize, String)> {
    let mut updates = Vec::new();
    for (sheet_idx, sheet) in sheets.iter().enumerate() {
        for (chart_idx, chart) in sheet.charts.iter().enumerate() {
            if !chart.is_chart_ex {
                if let Some(fingerprint) =
                    standard_chart_source_fingerprint_from_source(chart, &sheet.name, visit)
                {
                    updates.push((sheet_idx, chart_idx, fingerprint));
                }
            }
        }
    }
    updates
}

fn apply_source_fingerprints(sheets: &mut [SheetData], updates: Vec<(usize, usize, String)>) {
    for (sheet_idx, chart_idx, fingerprint) in updates {
        let chart = &mut sheets[sheet_idx].charts[chart_idx];
        if let Some(provenance) = chart.standard_chart_provenance.as_mut() {
            provenance.source_fingerprint = Some(fingerprint.clone());
        }
        if let Some(authority) = chart.standard_chart_export_authority.as_mut() {
            authority.source_fingerprint = Some(fingerprint);
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
fn standard_chart_source_fingerprint_from_source(
    spec: &ChartSpec,
    owner_sheet_name: &str,
    visit: &mut impl FnMut(&[ChartSourceRange], &mut CellVisitor<'_>),
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
    let requested: Vec<_> = ranges
        .iter()
        .map(|(name, r0, c0, r1, c1)| ChartSourceRange {
            sheet_name: name.clone(),
            start_row: *r0,
            start_col: *c0,
            end_row: *r1,
            end_col: *c1,
        })
        .collect();
    let mut present_cells = Vec::new();
    visit(&requested, &mut |sheet_name, row, col, formula, value| {
        let formula = formula.trim_start_matches('=');
        let value = value.to_string();
        if !formula.is_empty() || !value.is_empty() {
            present_cells.push((
                canonical_chart_sheet_name(sheet_name),
                row,
                col,
                formula.to_string(),
                value,
            ));
        }
    });
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
