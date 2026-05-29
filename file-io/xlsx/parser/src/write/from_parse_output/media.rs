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
