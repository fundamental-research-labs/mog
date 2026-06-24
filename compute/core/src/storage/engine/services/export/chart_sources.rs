//! Chart object extraction for semantic export.
//!
//! This layer exports the runtime chart object model into `SheetData.charts`.
//! XLSX-specific source formula qualification and cache materialization happens
//! in the XLSX writer preflight, where the final chart-space replay versus
//! reconstruction decision is made.

use domain_types::ChartSpec;
use domain_types::domain::floating_object::{FloatingObject, FloatingObjectData};

pub(super) fn split_charts_for_sheet_export(
    floating_objects: Vec<FloatingObject>,
) -> (Vec<ChartSpec>, Vec<FloatingObject>) {
    let mut charts = Vec::new();
    let mut non_chart_objects = Vec::new();
    for floating_object in floating_objects {
        if matches!(&floating_object.data, FloatingObjectData::Chart(_)) {
            if let Some(spec) = ChartSpec::from_floating_object(&floating_object) {
                charts.push(spec);
            }
        } else {
            non_chart_objects.push(floating_object);
        }
    }
    charts.sort_by_key(|chart| chart.z_index);
    (charts, non_chart_objects)
}
