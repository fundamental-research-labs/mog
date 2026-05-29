#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LegacyVmlRelationshipRole {
    LegacyDrawing,
    LegacyDrawingHeaderFooter,
    Unreferenced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LegacyVmlOwnerKind {
    CommentNotes,
    FormControls,
    OlePreviews,
    HeaderFooterImages,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LegacyVmlDisposition {
    Modeled { owner: LegacyVmlOwnerKind },
    MixedModeledLegacyVml { owners: Vec<LegacyVmlOwnerKind> },
    UnsupportedLegacyVml { reason: &'static str },
}

pub(crate) fn classify_legacy_vml_part(
    xml: &[u8],
    role: LegacyVmlRelationshipRole,
) -> LegacyVmlDisposition {
    let mut owners = Vec::new();

    if has_header_footer_image_shape(xml)
        || role == LegacyVmlRelationshipRole::LegacyDrawingHeaderFooter
    {
        push_owner(&mut owners, LegacyVmlOwnerKind::HeaderFooterImages);
    }
    if has_note_client_data(xml) {
        push_owner(&mut owners, LegacyVmlOwnerKind::CommentNotes);
    }
    if has_form_control_client_data(xml) {
        push_owner(&mut owners, LegacyVmlOwnerKind::FormControls);
    }
    if has_ole_preview_shape(xml) {
        push_owner(&mut owners, LegacyVmlOwnerKind::OlePreviews);
    }

    if owners.len() == 1 {
        return LegacyVmlDisposition::Modeled { owner: owners[0] };
    }
    if owners.len() > 1 {
        return LegacyVmlDisposition::MixedModeledLegacyVml { owners };
    }

    if contains_vml_shape(xml) {
        LegacyVmlDisposition::UnsupportedLegacyVml {
            reason: "unsupported VML shapes without a modeled worksheet owner",
        }
    } else {
        LegacyVmlDisposition::UnsupportedLegacyVml {
            reason: "legacy VML part has no recognized modeled content",
        }
    }
}

pub(crate) fn legacy_vml_disposition_label(disposition: &LegacyVmlDisposition) -> &'static str {
    match disposition {
        LegacyVmlDisposition::Modeled {
            owner: LegacyVmlOwnerKind::CommentNotes,
        } => "comment-note VML modeled by comments",
        LegacyVmlDisposition::Modeled {
            owner: LegacyVmlOwnerKind::FormControls,
        } => "form-control VML modeled by controls",
        LegacyVmlDisposition::Modeled {
            owner: LegacyVmlOwnerKind::OlePreviews,
        } => "OLE preview VML modeled by OLE objects",
        LegacyVmlDisposition::Modeled {
            owner: LegacyVmlOwnerKind::HeaderFooterImages,
        } => "header/footer image VML modeled by print settings",
        LegacyVmlDisposition::MixedModeledLegacyVml { .. } => {
            "mixed modeled legacy VML requires coordinated regeneration"
        }
        LegacyVmlDisposition::UnsupportedLegacyVml { reason } => reason,
    }
}

fn push_owner(owners: &mut Vec<LegacyVmlOwnerKind>, owner: LegacyVmlOwnerKind) {
    if !owners.contains(&owner) {
        owners.push(owner);
    }
}

fn has_note_client_data(xml: &[u8]) -> bool {
    contains(xml, b"ObjectType=\"Note\"")
}

fn has_form_control_client_data(xml: &[u8]) -> bool {
    let Some(mut pos) = find(xml, b"ObjectType=\"") else {
        return false;
    };

    while let Some(attr_pos) = find_from(xml, b"ObjectType=\"", pos) {
        let value_start = attr_pos + b"ObjectType=\"".len();
        let value_end = memchr::memchr(b'"', &xml[value_start..])
            .map(|offset| value_start + offset)
            .unwrap_or(xml.len());
        let value = &xml[value_start..value_end];
        if value != b"Note" && value != b"Pict" {
            return true;
        }
        pos = value_end.saturating_add(1);
    }

    false
}

fn has_ole_preview_shape(xml: &[u8]) -> bool {
    contains(xml, b"<v:imagedata") && contains(xml, b"ObjectType=\"Pict\"")
}

fn has_header_footer_image_shape(xml: &[u8]) -> bool {
    let position_ids: &[&[u8]] = &[
        b"id=\"LH\"",
        b"id=\"CH\"",
        b"id=\"RH\"",
        b"id=\"LF\"",
        b"id=\"CF\"",
        b"id=\"RF\"",
    ];
    position_ids.iter().any(|needle| contains(xml, needle)) && contains(xml, b"o:relid=\"")
}

fn contains_vml_shape(xml: &[u8]) -> bool {
    let shape_tags: &[&[u8]] = &[
        b"<v:shape",
        b"<v:rect",
        b"<v:oval",
        b"<v:line",
        b"<v:polyline",
        b"<v:group",
    ];
    shape_tags.iter().any(|needle| contains(xml, needle))
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    find(haystack, needle).is_some()
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    memchr::memmem::find(haystack, needle)
}

fn find_from(haystack: &[u8], needle: &[u8], pos: usize) -> Option<usize> {
    memchr::memmem::find(&haystack[pos..], needle).map(|offset| pos + offset)
}
