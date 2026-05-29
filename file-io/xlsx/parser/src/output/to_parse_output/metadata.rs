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
                ghost_row: mt.ghost_row,
                ghost_col: mt.ghost_col,
                edit: mt.edit,
                delete: mt.delete,
                paste_formulas: mt.paste_formulas,
                paste_formats: mt.paste_formats,
                paste_comments: mt.paste_comments,
                paste_data_validation: mt.paste_data_validation,
                paste_borders: mt.paste_borders,
                paste_col_widths: mt.paste_col_widths,
                paste_number_formats: mt.paste_number_formats,
                split_all: mt.split_all,
                clear_all: mt.clear_all,
                clear_contents: mt.clear_contents,
                adjust: mt.adjust,
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
        value_metadata: metadata
            .value_metadata
            .iter()
            .map(|block| domain_types::ValueMetadataBlock {
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
        rich_data: None,
        imported_metadata_xml: None,
        feature_properties: Default::default(),
    };

    (!result.is_empty()).then_some(result)
}
