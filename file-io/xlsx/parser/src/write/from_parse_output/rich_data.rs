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

    if rich_data.parts.is_empty() {
        return Vec::new();
    }
    if metadata_preserves_rich_data_cluster(output)
        || output
            .sheets
            .iter()
            .any(|sheet| sheet.cells.iter().any(|cell| cell.vm.is_some()))
    {
        return rich_data.parts.clone();
    }

    Vec::new()
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

fn metadata_preserves_rich_data_cluster(output: &ParseOutput) -> bool {
    output.metadata.as_ref().is_some_and(|metadata| {
        super::metadata::imported_metadata_xml_is_current(output, metadata)
            || (!metadata.value_metadata.is_empty() && metadata.imported_metadata_xml.is_none())
    })
}
