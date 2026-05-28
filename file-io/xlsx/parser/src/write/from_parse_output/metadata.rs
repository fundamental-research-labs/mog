use domain_types::{MetadataCellReference, ParseOutput, WorkbookMetadata};

pub(super) fn metadata_xml_for_export(output: &ParseOutput) -> Option<Vec<u8>> {
    let metadata = output.metadata.as_ref()?;
    if imported_metadata_xml_is_current(output, metadata) {
        return metadata
            .imported_metadata_xml
            .as_ref()
            .map(|imported| imported.bytes.clone());
    }
    has_metadata_xml_state(metadata)
        .then(|| crate::domain::metadata::spreadsheet_xml::write_metadata_model_xml(metadata))
}

fn has_metadata_xml_state(metadata: &WorkbookMetadata) -> bool {
    !metadata.metadata_types.is_empty()
        || !metadata.future_metadata.is_empty()
        || !metadata.cell_metadata.is_empty()
        || !metadata.value_metadata.is_empty()
}

pub(super) fn imported_metadata_xml_is_current(
    output: &ParseOutput,
    metadata: &WorkbookMetadata,
) -> bool {
    let Some(imported) = metadata.imported_metadata_xml.as_ref() else {
        return false;
    };
    if imported.bytes.is_empty() {
        return false;
    }
    if crate::domain::metadata::spreadsheet_xml::write_metadata_model_xml(metadata)
        != imported.generated_at_import
    {
        return false;
    }
    collect_cell_refs(output, |cell| cell.cell_metadata_index) == imported.cell_metadata_refs
        && collect_cell_refs(output, |cell| cell.vm) == imported.value_metadata_refs
}

fn collect_cell_refs(
    output: &ParseOutput,
    index_of: impl Fn(&domain_types::CellData) -> Option<u32>,
) -> Vec<MetadataCellReference> {
    let index_of = &index_of;
    let mut refs: Vec<_> = output
        .sheets
        .iter()
        .enumerate()
        .flat_map(|(sheet_index, sheet)| {
            sheet.cells.iter().filter_map(move |cell| {
                index_of(cell).map(|index| MetadataCellReference {
                    sheet_index: sheet_index as u32,
                    row: cell.row,
                    col: cell.col,
                    index,
                })
            })
        })
        .collect();
    refs.sort_by_key(|reference| {
        (
            reference.sheet_index,
            reference.row,
            reference.col,
            reference.index,
        )
    });
    refs
}
