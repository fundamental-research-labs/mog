use domain_types::{ParseOutput, RoundTripContext};

pub(super) fn metadata_xml_for_export(
    output: &ParseOutput,
    round_trip_ctx: Option<&RoundTripContext>,
) -> Option<Vec<u8>> {
    let raw = round_trip_ctx?.raw_metadata_xml.as_ref()?;
    if !output_references_metadata(output) || !raw_metadata_supports_current_refs(output, raw) {
        return None;
    }
    Some(raw.clone())
}

fn output_references_metadata(output: &ParseOutput) -> bool {
    output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.cells.iter())
        .any(|cell| cell.cm || cell.vm.is_some())
}

fn raw_metadata_supports_current_refs(output: &ParseOutput, raw: &[u8]) -> bool {
    let Ok(xml) = std::str::from_utf8(raw) else {
        return false;
    };

    let needs_cell_metadata = output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.cells.iter())
        .any(|cell| cell.cm);
    let needs_value_metadata = output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.cells.iter())
        .any(|cell| cell.vm.is_some());

    (!needs_cell_metadata || section_has_block(xml, "cellMetadata"))
        && (!needs_value_metadata || section_has_block(xml, "valueMetadata"))
}

fn section_has_block(xml: &str, section_name: &str) -> bool {
    let open = format!("<{section_name}");
    let close = format!("</{section_name}>");
    let Some(start) = xml.find(&open) else {
        return false;
    };
    let Some(end) = xml[start..].find(&close) else {
        return false;
    };
    let section = &xml[start..start + end];
    section.contains("<bk>") || section.contains("<bk ")
}
