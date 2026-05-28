use domain_types::{ChartDefinition, chart::ChartSpec};
use ooxml_types::charts::{ChartSpace, ExtensionEntry};

use super::{
    chart::build_chart,
    formatting::{build_shape_properties, build_text_body},
};

// =============================================================================
// Top-level entry point
// =============================================================================

/// Reconstruct a ChartSpace from ChartSpec for XLSX export.
pub(super) fn build_chart_space(spec: &ChartSpec) -> ChartSpace {
    let imported = match spec.definition.as_ref() {
        Some(ChartDefinition::Chart(chart_space)) => Some(chart_space),
        _ => None,
    };

    ChartSpace {
        date1904: imported.and_then(|chart_space| chart_space.date1904),
        lang: imported.and_then(|chart_space| chart_space.lang.clone()),
        rounded_corners: spec.rounded_corners,
        style: spec.style,
        style_alternate_content: imported
            .and_then(|chart_space| chart_space.style_alternate_content.clone()),
        style_after_chart: imported
            .map(|chart_space| chart_space.style_after_chart)
            .unwrap_or(false),
        clr_map_ovr: imported.and_then(|chart_space| chart_space.clr_map_ovr.clone()),
        protection: imported.and_then(|chart_space| chart_space.protection.clone()),
        chart: build_chart(spec),
        sp_pr: spec.chart_format.as_ref().and_then(build_shape_properties),
        tx_pr: spec.chart_format.as_ref().and_then(build_text_body),
        external_data: spec
            .definition
            .as_ref()
            .and_then(|definition| match definition {
                ChartDefinition::Chart(chart_space) => chart_space.external_data.clone(),
                ChartDefinition::ChartEx(_) => None,
            }),
        pivot_source: imported.and_then(|chart_space| chart_space.pivot_source.clone()),
        user_shapes: spec
            .definition
            .as_ref()
            .and_then(|definition| match definition {
                ChartDefinition::Chart(chart_space) => chart_space.user_shapes.clone(),
                ChartDefinition::ChartEx(_) => None,
            }),
        print_settings: imported.and_then(|chart_space| chart_space.print_settings.clone()),
        extensions: imported
            .map(|chart_space| clean_chart_extensions(&chart_space.extensions))
            .unwrap_or_default(),
    }
}

pub(super) fn clean_chart_extensions(extensions: &[ExtensionEntry]) -> Vec<ExtensionEntry> {
    extensions
        .iter()
        .filter(|extension| !crate::infra::xml::raw_xml_contains_relationship_attr(&extension.xml))
        .cloned()
        .collect()
}
