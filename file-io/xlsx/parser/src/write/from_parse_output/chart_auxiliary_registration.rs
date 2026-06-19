use super::assembly::ChartAuxiliaryRelationshipGraphEntry;
use super::{chart_auxiliary, chart_replay};
use crate::write::package_graph::PackageGraphBuilder;
use crate::write::write_error::WriteError;

pub(super) fn register_generated_chart_color_style(
    package_graph_builder: &mut PackageGraphBuilder,
    registered_chart_auxiliary_parts: &mut std::collections::BTreeSet<String>,
    chart_auxiliary_relationships: &mut Vec<ChartAuxiliaryRelationshipGraphEntry>,
    chart_spec: &domain_types::ChartSpec,
    chart_path: &str,
) -> Result<bool, WriteError> {
    if chart_replay::chart_allows_current_auxiliary_replay(chart_spec, chart_path) {
        return Ok(false);
    }
    let Some(color_style) =
        chart_auxiliary::generated_chart_color_style_data(chart_spec, chart_path)
    else {
        return Ok(false);
    };
    if registered_chart_auxiliary_parts.insert(color_style.path.clone()) {
        crate::write::package_graph::register_chart_auxiliary_part(
            package_graph_builder,
            &color_style.path,
        )?;
    }
    chart_auxiliary_relationships.push(ChartAuxiliaryRelationshipGraphEntry {
        chart_path: chart_path.to_string(),
        rel_type: color_style.relationship_type.to_string(),
        target_path: color_style.path,
        relationship_id_hint: color_style.relationship_id_hint.to_string(),
    });
    Ok(true)
}
