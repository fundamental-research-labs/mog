//! Worksheet images require a background picture or a live OLE/control preview owner.

use std::collections::{HashMap, HashSet};

use ooxml_types::shared::OpcRelationship;
use quick_xml::{events::Event, name::ResolveResult, reader::NsReader};

use crate::infra::opc::{
    REL_ACTIVE_X_CONTROL, REL_CTRL_PROP, REL_EMBEDDED_PACKAGE, REL_IMAGE, REL_OLE_OBJECT,
};
use crate::zip::XlsxArchive;

use super::{
    PackageIntegrityError,
    paths::{is_worksheet_part, worksheet_rels_path},
};

const WORKSHEET_NS: &[u8] = b"http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIP_NS: &[u8] =
    b"http://schemas.openxmlformats.org/officeDocument/2006/relationships";

pub(super) fn validate_worksheet_images(
    archive: &XlsxArchive<'_>,
    worksheet_path: &str,
    relationships: &[OpcRelationship],
    errors: &mut Vec<PackageIntegrityError>,
) {
    if !is_worksheet_part(worksheet_path)
        || !relationships.iter().any(|rel| rel.rel_type == REL_IMAGE)
    {
        return;
    }
    let referenced = archive
        .read_file(worksheet_path)
        .ok()
        .and_then(|xml| owned_image_ids(&xml, relationships))
        .unwrap_or_default();
    for rel in relationships.iter().filter(|rel| rel.rel_type == REL_IMAGE) {
        if !referenced.contains(&rel.id) {
            errors.push(PackageIntegrityError::InvalidRelationshipTarget {
                rels_path: worksheet_rels_path(worksheet_path),
                id: rel.id.clone(),
                rel_type: rel.rel_type.clone(),
                target: rel.target.clone(),
                reason: "worksheet image target has no live background picture or OLE/control preview reference".to_string(),
            });
        }
    }
}

#[derive(Default)]
struct Element {
    name: Vec<u8>,
    worksheet_namespace: bool,
    live_owner: bool,
}

fn owned_image_ids(xml: &[u8], relationships: &[OpcRelationship]) -> Option<HashSet<String>> {
    let rel_types: HashMap<_, _> = relationships
        .iter()
        .map(|rel| (rel.id.as_str(), rel.rel_type.as_str()))
        .collect();
    let mut reader = NsReader::from_reader(xml);
    let mut buf = Vec::new();
    let mut stack: Vec<Element> = Vec::new();
    let mut ids = HashSet::new();
    loop {
        let (namespace, event) = reader.read_resolved_event_into(&mut buf).ok()?;
        let worksheet_namespace =
            matches!(namespace, ResolveResult::Bound(ns) if ns.as_ref() == WORKSHEET_NS);
        let is_start = matches!(&event, Event::Start(_));
        match event {
            Event::Start(ref start) | Event::Empty(ref start) => {
                let name = start.local_name().as_ref().to_vec();
                let mut relationship_id = None;
                let mut has_shape_id = false;
                for attr in start.attributes() {
                    let attr = attr.ok()?;
                    let (namespace, local) = reader.resolve_attribute(attr.key);
                    if local.as_ref() == b"id"
                        && matches!(namespace, ResolveResult::Bound(ns) if ns.as_ref() == RELATIONSHIP_NS)
                    {
                        relationship_id = Some(attr.unescape_value().ok()?.into_owned());
                    } else if attr.key.as_ref() == b"shapeId" {
                        has_shape_id = attr
                            .unescape_value()
                            .ok()?
                            .parse::<u32>()
                            .is_ok_and(|id| id > 0);
                    }
                }
                let in_worksheet = stack.first().is_some_and(|root| {
                    root.worksheet_namespace && root.name.as_slice() == b"worksheet"
                });
                let parent = stack.last();
                let valid_property = worksheet_namespace
                    && in_worksheet
                    && parent.is_some_and(|owner| {
                        owner.live_owner
                            && ((name.as_slice() == b"objectPr"
                                && owner.name.as_slice() == b"oleObject")
                                || (name.as_slice() == b"controlPr"
                                    && owner.name.as_slice() == b"control"))
                    });
                // CT_SheetBackgroundPicture is the worksheet's direct image
                // owner (sml.xsd §18.3.1.73). Drawings and header/footer VML
                // retain their own relationship owners.
                let background_picture = worksheet_namespace
                    && in_worksheet
                    && stack.len() == 1
                    && name.as_slice() == b"picture";
                let owner_type = relationship_id
                    .as_deref()
                    .and_then(|id| rel_types.get(id))
                    .copied();
                if (valid_property || background_picture)
                    && owner_type == Some(REL_IMAGE)
                    && let Some(id) = &relationship_id
                {
                    ids.insert(id.clone());
                }
                let live_owner = worksheet_namespace
                    && in_worksheet
                    && has_shape_id
                    && match name.as_slice() {
                        b"oleObject" => {
                            matches!(owner_type, Some(REL_OLE_OBJECT | REL_EMBEDDED_PACKAGE))
                                && stack.iter().any(|parent| {
                                    parent.worksheet_namespace
                                        && parent.name.as_slice() == b"oleObjects"
                                })
                        }
                        b"control" => {
                            matches!(owner_type, Some(REL_CTRL_PROP | REL_ACTIVE_X_CONTROL))
                                && stack.iter().any(|parent| {
                                    parent.worksheet_namespace
                                        && parent.name.as_slice() == b"controls"
                                })
                        }
                        _ => false,
                    };
                if is_start {
                    stack.push(Element {
                        name,
                        worksheet_namespace,
                        live_owner,
                    });
                }
            }
            Event::End(_) => {
                stack.pop()?;
            }
            Event::Eof => return stack.is_empty().then_some(ids),
            _ => {}
        }
        buf.clear();
    }
}
