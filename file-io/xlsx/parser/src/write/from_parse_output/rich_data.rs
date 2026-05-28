use std::collections::BTreeSet;

use domain_types::{ParseOutput, RichDataPart};

use super::WriteError;

pub(super) fn parts_for_export(output: &ParseOutput) -> Vec<RichDataPart> {
    let Some(rich_data) = output
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.rich_data.as_ref())
    else {
        return Vec::new();
    };

    let referenced_vm = referenced_value_metadata_indices(output);
    if referenced_vm.is_empty() {
        return Vec::new();
    }

    rich_data.parts.clone()
}

pub(super) fn register_parts(
    graph: &mut crate::write::package_graph::PackageGraphBuilder,
    parts: &[RichDataPart],
) -> Result<(), WriteError> {
    for part in parts {
        graph.register_part(crate::write::package_graph::modeled_part(
            &part.path,
            &part.content_type,
        ))?;
    }
    Ok(())
}

fn referenced_value_metadata_indices(output: &ParseOutput) -> BTreeSet<u32> {
    output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.cells.iter().filter_map(|cell| cell.vm))
        .collect()
}
