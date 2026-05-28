use domain_types::domain::floating_object::{
    FloatingObjectAnchor, FloatingObjectData, ShapeOoxmlProps,
};

/// Extract the `anchor_index` from a `FloatingObjectData` variant's ooxml props.
pub(super) fn get_anchor_index(data: &FloatingObjectData) -> Option<usize> {
    match data {
        FloatingObjectData::Picture(d) => d
            .ooxml
            .as_ref()
            .and_then(|p| p.anchor_index)
            .map(|i| i as usize),
        FloatingObjectData::Shape(d) => d
            .ooxml
            .as_ref()
            .and_then(|p| p.anchor_index)
            .map(|i| i as usize),
        FloatingObjectData::Textbox(d) => d
            .ooxml
            .as_ref()
            .and_then(|p| p.anchor_index)
            .map(|i| i as usize),
        FloatingObjectData::Connector(d) => d
            .ooxml
            .as_ref()
            .and_then(|p| p.anchor_index)
            .map(|i| i as usize),
        _ => None,
    }
}

/// Extract common anchor-level ooxml props needed for building a DrawingAnchor.
pub(super) struct AnchorOoxmlProps {
    pub(super) extent_emu: Option<(i64, i64)>,
    pub(super) edit_as: Option<String>,
    pub(super) mc_alternate_content_raw_xml: Option<String>,
    pub(super) client_data_locks_with_sheet: Option<bool>,
    pub(super) client_data_prints_with_sheet: Option<bool>,
}

pub(super) fn get_shape_ooxml(data: &FloatingObjectData) -> Option<&ShapeOoxmlProps> {
    match data {
        FloatingObjectData::Shape(d) => d.ooxml.as_ref(),
        FloatingObjectData::Textbox(d) => d.ooxml.as_ref(),
        _ => None,
    }
}

pub(super) fn get_anchor_ooxml_props(
    data: &FloatingObjectData,
    anchor: &FloatingObjectAnchor,
) -> AnchorOoxmlProps {
    if let FloatingObjectData::Picture(d) = data {
        if let Some(p) = d.ooxml.as_ref() {
            return AnchorOoxmlProps {
                extent_emu: p
                    .extent_emu_cx
                    .zip(p.extent_emu_cy)
                    .or_else(|| anchor.extent_cx.zip(anchor.extent_cy)),
                edit_as: p.edit_as.clone(),
                mc_alternate_content_raw_xml: p.mc_alternate_content_raw_xml.clone(),
                client_data_locks_with_sheet: p.client_data_locks_with_sheet,
                client_data_prints_with_sheet: p.client_data_prints_with_sheet,
            };
        }
    }

    if let Some(p) = get_shape_ooxml(data) {
        return AnchorOoxmlProps {
            extent_emu: p
                .extent_emu_cx
                .zip(p.extent_emu_cy)
                .or_else(|| anchor.extent_cx.zip(anchor.extent_cy)),
            edit_as: p.edit_as.clone(),
            mc_alternate_content_raw_xml: p.mc_alternate_content_raw_xml.clone(),
            client_data_locks_with_sheet: p.client_data_locks_with_sheet,
            client_data_prints_with_sheet: p.client_data_prints_with_sheet,
        };
    }

    if let FloatingObjectData::Connector(d) = data {
        if let Some(p) = d.ooxml.as_ref() {
            return AnchorOoxmlProps {
                extent_emu: p
                    .extent_emu_cx
                    .zip(p.extent_emu_cy)
                    .or_else(|| anchor.extent_cx.zip(anchor.extent_cy)),
                edit_as: p.edit_as.clone(),
                mc_alternate_content_raw_xml: p.mc_alternate_content_raw_xml.clone(),
                client_data_locks_with_sheet: p.client_data_locks_with_sheet,
                client_data_prints_with_sheet: p.client_data_prints_with_sheet,
            };
        }
    }

    AnchorOoxmlProps {
        extent_emu: anchor.extent_cx.zip(anchor.extent_cy),
        edit_as: None,
        mc_alternate_content_raw_xml: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
    }
}
