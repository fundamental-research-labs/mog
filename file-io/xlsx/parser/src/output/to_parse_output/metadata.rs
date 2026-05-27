pub(super) fn metadata_to_domain(
    metadata: &crate::output::results::MetadataOutput,
) -> Option<domain_types::WorkbookMetadata> {
    let result = domain_types::WorkbookMetadata {
        metadata_types: metadata
            .metadata_types
            .iter()
            .map(|mt| domain_types::MetadataType {
                name: mt.name.clone(),
                min_supported_version: mt.min_supported_version,
                copy: mt.copy,
                paste_all: mt.paste_all,
                paste_values: mt.paste_values,
                merge: mt.merge,
                split_first: mt.split_first,
                row_col_shift: mt.row_col_shift,
                clear_formats: mt.clear_formats,
                clear_comments: mt.clear_comments,
                assign: mt.assign,
                coerce: mt.coerce,
                cell_meta: mt.cell_meta,
            })
            .collect(),
        future_metadata: metadata
            .future_metadata
            .iter()
            .map(|group| domain_types::FutureMetadataGroup {
                name: group.name.clone(),
                blocks: group
                    .blocks
                    .iter()
                    .map(|block| domain_types::FutureMetadataBlock {
                        raw_xml: block.raw_xml.clone(),
                    })
                    .collect(),
            })
            .collect(),
        cell_metadata: metadata
            .cell_metadata
            .iter()
            .map(|block| domain_types::CellMetadataBlock {
                records: block
                    .records
                    .iter()
                    .map(|record| domain_types::CellMetadataRecord {
                        t: record.t,
                        v: record.v,
                    })
                    .collect(),
            })
            .collect(),
    };

    (!result.is_empty()).then_some(result)
}
