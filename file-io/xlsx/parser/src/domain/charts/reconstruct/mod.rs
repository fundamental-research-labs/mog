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

#[cfg(test)]
mod tests;
