//! Reconstruct ChartSpace from ChartSpec for XLSX export.
//!
//! This is the inverse of extraction: given ChartSpec typed fields,
//! build the ooxml_types::charts::ChartSpace that serializes to valid OOXML.
//!
//! Design principles:
//! - Imported `ChartDefinition` stores the OOXML chart model for features that
//!   do not yet have a dedicated API surface.
//! - Fields from ChartSpec typed fields reconstruct API-visible content.
//! - `..Default::default()` is used extensively to avoid listing every optional field.

mod axes;
mod chart;
mod chart_groups;
mod chart_space;
mod elements;
mod formatting;
mod ranges;
mod series;

use domain_types::chart::ChartSpec;
use ooxml_types::charts::ChartSpace;

/// Reconstruct a ChartSpace from ChartSpec for XLSX export.
pub fn reconstruct_chart_space(spec: &ChartSpec) -> ChartSpace {
    chart_space::build_chart_space(spec)
}

/// Reconstruct a ChartSpace for a chart hosted on `sheet_name`.
///
/// Chart parts live outside worksheet XML, so sheet-local public API references
/// like `A1:C5` must be serialized as sheet-qualified chart formulas.
pub fn reconstruct_chart_space_for_sheet(spec: &ChartSpec, sheet_name: &str) -> ChartSpace {
    let mut qualified = spec.clone();
    qualify_chart_formula_references(&mut qualified, sheet_name);
    reconstruct_chart_space(&qualified)
}

fn qualify_chart_formula_references(spec: &mut ChartSpec, sheet_name: &str) {
    qualify_optional_a1_reference(&mut spec.data_range, sheet_name);
    qualify_optional_a1_reference(&mut spec.title_formula, sheet_name);

    for series in &mut spec.series {
        qualify_optional_a1_reference(&mut series.name_ref, sheet_name);
        qualify_optional_a1_reference(&mut series.categories, sheet_name);
        qualify_optional_a1_reference(&mut series.values, sheet_name);
        qualify_optional_a1_reference(&mut series.bubble_size, sheet_name);

        if let Some(labels) = series.data_labels.as_mut() {
            qualify_data_label_reference(labels, sheet_name);
        }
        if let Some(points) = series.points.as_mut() {
            for point in points {
                if let Some(label) = point.data_label.as_mut() {
                    qualify_data_label_reference(label, sheet_name);
                }
            }
        }
        qualify_error_bar_reference(series.error_bars.as_mut(), sheet_name);
        qualify_error_bar_reference(series.x_error_bars.as_mut(), sheet_name);
        qualify_error_bar_reference(series.y_error_bars.as_mut(), sheet_name);
    }

    if let Some(labels) = spec.data_labels.as_mut() {
        qualify_data_label_reference(labels, sheet_name);
    }
}

fn qualify_data_label_reference(label: &mut domain_types::chart::DataLabelData, sheet_name: &str) {
    qualify_optional_a1_reference(&mut label.formula, sheet_name);
}

fn qualify_error_bar_reference(
    error_bars: Option<&mut domain_types::chart::ErrorBarData>,
    sheet_name: &str,
) {
    let Some(error_bars) = error_bars else {
        return;
    };
    if let Some(source) = error_bars.plus_source.as_mut() {
        qualify_optional_a1_reference(&mut source.formula, sheet_name);
    }
    if let Some(source) = error_bars.minus_source.as_mut() {
        qualify_optional_a1_reference(&mut source.formula, sheet_name);
    }
}

fn qualify_optional_a1_reference(reference: &mut Option<String>, sheet_name: &str) {
    let Some(value) = reference.as_deref() else {
        return;
    };
    if let Some(qualified) = qualify_a1_reference(value, sheet_name) {
        *reference = Some(qualified);
    }
}

fn qualify_a1_reference(value: &str, sheet_name: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('=') || contains_unquoted_bang(trimmed) {
        return None;
    }
    if !looks_like_a1_reference(trimmed) {
        return None;
    }
    Some(format!(
        "{}!{trimmed}",
        quote_sheet_name_if_needed(sheet_name)
    ))
}

fn contains_unquoted_bang(value: &str) -> bool {
    let mut in_quote = false;
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\'' => {
                if in_quote && matches!(chars.peek(), Some('\'')) {
                    chars.next();
                } else {
                    in_quote = !in_quote;
                }
            }
            '!' if !in_quote => return true,
            _ => {}
        }
    }
    false
}

fn looks_like_a1_reference(value: &str) -> bool {
    let mut parts = value.split(':');
    let Some(first) = parts.next() else {
        return false;
    };
    if !looks_like_a1_cell(first) {
        return false;
    }
    let Some(second) = parts.next() else {
        return true;
    };
    parts.next().is_none() && looks_like_a1_cell(second)
}

fn looks_like_a1_cell(value: &str) -> bool {
    let mut saw_col = false;
    let mut saw_row = false;
    for ch in value.chars().filter(|ch| *ch != '$') {
        if ch.is_ascii_alphabetic() && !saw_row {
            saw_col = true;
        } else if ch.is_ascii_digit() {
            saw_row = true;
        } else {
            return false;
        }
    }
    saw_col && saw_row
}

fn quote_sheet_name_if_needed(sheet_name: &str) -> String {
    if !sheet_name.is_empty()
        && sheet_name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        return sheet_name.to_string();
    }
    format!("'{}'", sheet_name.replace('\'', "''"))
}

#[cfg(test)]
mod tests;
