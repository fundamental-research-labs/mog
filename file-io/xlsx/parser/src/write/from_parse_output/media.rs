use crate::write::package_graph::PackageGraphBuilder;
use crate::write::write_error::WriteError;

pub(super) fn register_image_blob_parts(
    graph: &mut PackageGraphBuilder,
    image_blobs: &[(String, Vec<u8>)],
) -> Result<(), WriteError> {
    let mut registered = std::collections::BTreeSet::new();
    for (path, bytes) in image_blobs {
        if registered.insert(path.as_str()) {
            crate::write::package_graph::register_media_part_with_bytes(graph, path, bytes)?;
        }
    }
    Ok(())
}

pub(super) fn resolve_drawing_image_target(
    drawing_path: &str,
    image_target: &str,
) -> Result<String, WriteError> {
    crate::infra::opc::resolve_relationship_target(Some(drawing_path), image_target).map_err(
        |err| {
            WriteError::PackageIntegrity(format!(
                "invalid drawing image target for {}: {} ({:?})",
                drawing_path, image_target, err
            ))
        },
    )
}
