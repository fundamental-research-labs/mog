use super::assembly::WorksheetDrawingGraphEntry;
use crate::write::REL_DRAWING;

pub(super) fn relationships_for_export(
    round_trip_ctx: Option<&domain_types::RoundTripContext>,
    output: &domain_types::ParseOutput,
) -> Vec<WorksheetDrawingGraphEntry> {
    let Some(ctx) = round_trip_ctx else {
        return Vec::new();
    };

    ctx.opaque_package_subgraphs
        .iter()
        .filter_map(|subgraph| {
            if subgraph.ownership != domain_types::OpaquePackageOwnership::CleanImported {
                return None;
            }
            if subgraph.owner_relationship.relationship_type != REL_DRAWING {
                return None;
            }
            let domain_types::OpaquePackageOwner::Worksheet { index, .. } =
                &subgraph.owner_relationship.owner
            else {
                return None;
            };
            if sheet_has_modeled_drawing_content(output, *index) {
                return None;
            }
            let domain_types::OpaqueRelationshipTarget::InternalPart { path } =
                &subgraph.owner_relationship.target
            else {
                return None;
            };

            Some(WorksheetDrawingGraphEntry {
                sheet_idx: *index,
                path: path.trim_start_matches('/').to_string(),
                target: worksheet_relative_target(path),
                relationship_id_hint: subgraph.owner_relationship.relationship_id_hint.clone(),
            })
        })
        .collect()
}

fn worksheet_relative_target(zip_path: &str) -> String {
    let path = zip_path.trim_start_matches('/');
    path.strip_prefix("xl/")
        .map(|rest| format!("../{rest}"))
        .unwrap_or_else(|| path.to_string())
}

fn sheet_has_modeled_drawing_content(output: &domain_types::ParseOutput, sheet_idx: usize) -> bool {
    output
        .sheets
        .get(sheet_idx)
        .is_some_and(|sheet| !sheet.charts.is_empty() || !sheet.floating_objects.is_empty())
}
