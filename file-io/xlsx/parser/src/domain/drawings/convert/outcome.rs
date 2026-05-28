//! Structured drawing conversion outcomes and relationship dependency discovery.

use super::{read, write};
use crate::domain::drawings::reader::raw::relationship_ids_in_raw;
use ooxml_types::drawings as ooxml;

/// Structured result of converting parsed drawing content into writer input.
#[derive(Debug, Clone)]
pub struct DrawingConversionOutcome {
    pub object: Option<write::DrawingObject>,
    pub status: ConversionStatus,
    pub relationship_ids: Vec<String>,
}

/// Whether conversion produced structured writer input, opaque passthrough, or
/// an explicit unsupported result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversionStatus {
    Emitted,
    OpaquePassthrough,
    Unsupported(&'static str),
}

impl DrawingConversionOutcome {
    pub(crate) fn emitted(object: write::DrawingObject, relationship_ids: Vec<String>) -> Self {
        Self {
            object: Some(object),
            status: ConversionStatus::Emitted,
            relationship_ids,
        }
    }

    pub(crate) fn opaque(object: write::DrawingObject, relationship_ids: Vec<String>) -> Self {
        Self {
            object: Some(object),
            status: ConversionStatus::OpaquePassthrough,
            relationship_ids,
        }
    }

    pub(crate) fn unsupported(reason: &'static str) -> Self {
        Self {
            object: None,
            status: ConversionStatus::Unsupported(reason),
            relationship_ids: Vec::new(),
        }
    }
}

pub(crate) fn relationship_ids_for_picture(picture: &read::SpreadsheetPicture) -> Vec<String> {
    let mut ids = Vec::new();
    push_optional_id(&mut ids, picture.blip_fill.embed_id.as_deref());
    push_optional_id(&mut ids, picture.blip_fill.link_id.as_deref());
    ids.extend(relationship_ids_for_non_visual(&picture.nv_pic_pr.c_nv_pr));
    dedupe_relationship_ids(ids)
}

pub(crate) fn relationship_ids_for_graphic_frame(
    gf: &ooxml::SpreadsheetGraphicFrame,
) -> Vec<String> {
    let mut ids = relationship_ids_for_non_visual(&gf.nv_graphic_frame_pr.c_nv_pr);
    if let Some(raw_xml) = gf.graphic_xml.as_deref() {
        ids.extend(relationship_ids_in_raw(raw_xml));
    }
    dedupe_relationship_ids(ids)
}

pub(crate) fn relationship_ids_for_opaque_unknown(
    opaque: &read::OpaqueDrawingContent,
) -> Vec<String> {
    let mut ids = opaque.relationship_ids.clone();
    ids.extend(relationship_ids_in_raw(&opaque.raw_xml));
    dedupe_relationship_ids(ids)
}

pub(crate) fn relationship_ids_for_smartart(sa: &read::SmartArtGraphicFrame) -> Vec<String> {
    dedupe_relationship_ids(
        [
            sa.dm_rel_id.as_str(),
            sa.lo_rel_id.as_str(),
            sa.qs_rel_id.as_str(),
            sa.cs_rel_id.as_str(),
        ]
        .into_iter()
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect(),
    )
}

pub(crate) fn relationship_ids_for_non_visual(props: &read::NonVisualProps) -> Vec<String> {
    let mut ids = Vec::new();
    push_optional_id(
        &mut ids,
        props
            .hlink_click
            .as_ref()
            .and_then(|hyperlink| hyperlink.r_id.as_deref()),
    );
    push_optional_id(
        &mut ids,
        props
            .hlink_hover
            .as_ref()
            .and_then(|hyperlink| hyperlink.r_id.as_deref()),
    );
    dedupe_relationship_ids(ids)
}

pub(crate) fn push_optional_id(ids: &mut Vec<String>, id: Option<&str>) {
    if let Some(id) = id {
        if !id.is_empty() {
            ids.push(id.to_string());
        }
    }
}

pub(crate) fn dedupe_relationship_ids(ids: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for id in ids {
        if !deduped.contains(&id) {
            deduped.push(id);
        }
    }
    deduped
}
