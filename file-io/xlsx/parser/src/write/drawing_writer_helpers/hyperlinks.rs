use std::collections::HashSet;

use ooxml_types::drawings::{Hyperlink, Paragraph, RunProperties, TextBody, TextRunContent};
use ooxml_types::shared::OpcRelationship;

use crate::domain::drawings::write::{DrawingAnchor, DrawingObject};
use crate::infra::opc::REL_HYPERLINK;

pub(super) fn register_anchor_hyperlink_relationships(
    anchor: &mut DrawingAnchor,
    drawing_rels: &mut Vec<OpcRelationship>,
    reserved_relationship_ids: &[(String, String)],
) {
    let obj = match anchor {
        DrawingAnchor::TwoCell(_, obj)
        | DrawingAnchor::OneCell(_, obj)
        | DrawingAnchor::Absolute(_, obj) => obj,
    };
    register_object_hyperlink_relationships(obj, drawing_rels, reserved_relationship_ids);
}

fn register_object_hyperlink_relationships(
    obj: &mut DrawingObject,
    drawing_rels: &mut Vec<OpcRelationship>,
    reserved_relationship_ids: &[(String, String)],
) {
    match obj {
        DrawingObject::Picture(image) => {
            register_hyperlink(
                image.hlink_click.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
            register_hyperlink(
                image.hlink_hover.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
        }
        DrawingObject::TextBox(text_box) => {
            register_hyperlink(
                text_box.hlink_click.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
            register_hyperlink(
                text_box.hlink_hover.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
            if let Some(text_body) = &mut text_box.text_body {
                register_text_body_hyperlinks(text_body, drawing_rels, reserved_relationship_ids);
            }
        }
        DrawingObject::Connector(connector) => {
            register_hyperlink(
                connector.hlink_click.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
            register_hyperlink(
                connector.hlink_hover.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
        }
        DrawingObject::Chart(chart) => {
            register_hyperlink(
                chart.hlink_click.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
            register_hyperlink(
                chart.hlink_hover.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
        }
        DrawingObject::GroupShape(group) => {
            register_hyperlink(
                group.hlink_click.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
            register_hyperlink(
                group.hlink_hover.as_mut(),
                drawing_rels,
                reserved_relationship_ids,
            );
            for child in &mut group.children {
                register_object_hyperlink_relationships(
                    child,
                    drawing_rels,
                    reserved_relationship_ids,
                );
            }
        }
        DrawingObject::Shape(_)
        | DrawingObject::ChartEx(_)
        | DrawingObject::GraphicFrame(_)
        | DrawingObject::OpaqueRaw(_)
        | DrawingObject::ContentPart(_)
        | DrawingObject::SmartArt(_)
        | DrawingObject::Slicer { .. }
        | DrawingObject::Timeline { .. } => {}
    }
}

fn register_text_body_hyperlinks(
    text_body: &mut TextBody,
    drawing_rels: &mut Vec<OpcRelationship>,
    reserved_relationship_ids: &[(String, String)],
) {
    for paragraph in &mut text_body.paragraphs {
        register_paragraph_hyperlinks(paragraph, drawing_rels, reserved_relationship_ids);
    }
}

fn register_paragraph_hyperlinks(
    paragraph: &mut Paragraph,
    drawing_rels: &mut Vec<OpcRelationship>,
    reserved_relationship_ids: &[(String, String)],
) {
    if let Some(props) = paragraph.props.def_run_props.as_deref_mut() {
        register_run_property_hyperlinks(props, drawing_rels, reserved_relationship_ids);
    }
    if let Some(props) = &mut paragraph.end_para_rpr {
        register_run_property_hyperlinks(props, drawing_rels, reserved_relationship_ids);
    }
    for run in &mut paragraph.runs {
        match run {
            TextRunContent::Run(run) => register_run_property_hyperlinks(
                &mut run.props,
                drawing_rels,
                reserved_relationship_ids,
            ),
            TextRunContent::LineBreak { props: Some(props) } => {
                register_run_property_hyperlinks(props, drawing_rels, reserved_relationship_ids)
            }
            TextRunContent::Field {
                run_props,
                para_props,
                ..
            } => {
                if let Some(props) = run_props {
                    register_run_property_hyperlinks(
                        props,
                        drawing_rels,
                        reserved_relationship_ids,
                    );
                }
                if let Some(para_props) = para_props {
                    if let Some(props) = para_props.def_run_props.as_deref_mut() {
                        register_run_property_hyperlinks(
                            props,
                            drawing_rels,
                            reserved_relationship_ids,
                        );
                    }
                }
            }
            TextRunContent::LineBreak { props: None } => {}
        }
    }
}

fn register_run_property_hyperlinks(
    props: &mut RunProperties,
    drawing_rels: &mut Vec<OpcRelationship>,
    reserved_relationship_ids: &[(String, String)],
) {
    register_hyperlink(
        props.hlink_click.as_mut(),
        drawing_rels,
        reserved_relationship_ids,
    );
    register_hyperlink(
        props.hlink_mouse_over.as_mut(),
        drawing_rels,
        reserved_relationship_ids,
    );
}

fn register_hyperlink(
    hlink: Option<&mut Hyperlink>,
    drawing_rels: &mut Vec<OpcRelationship>,
    reserved_relationship_ids: &[(String, String)],
) {
    let Some(hlink) = hlink else {
        return;
    };
    let Some(target) = hlink.url.clone() else {
        return;
    };
    let target_mode = hyperlink_target_mode(&target);

    if let Some(existing_id) = hlink.r_id.as_deref() {
        if drawing_rels.iter().any(|rel| {
            rel.id == existing_id
                && rel.rel_type == REL_HYPERLINK
                && rel.target == target
                && rel.target_mode == target_mode
        }) {
            return;
        }
    }

    let id = if let Some(existing_id) = hlink.r_id.as_deref() {
        if relationship_id_available(
            existing_id,
            drawing_rels,
            reserved_relationship_ids,
            Some((&target, target_mode.as_deref())),
        ) {
            existing_id.to_string()
        } else {
            next_hyperlink_relationship_id(drawing_rels, reserved_relationship_ids)
        }
    } else {
        next_hyperlink_relationship_id(drawing_rels, reserved_relationship_ids)
    };
    hlink.r_id = Some(id.clone());
    drawing_rels.push(OpcRelationship {
        id,
        rel_type: REL_HYPERLINK.to_string(),
        target,
        target_mode,
    });
}

fn hyperlink_target_mode(target: &str) -> Option<String> {
    if target.starts_with('#') {
        None
    } else {
        Some("External".to_string())
    }
}

fn relationship_id_available(
    id: &str,
    drawing_rels: &[OpcRelationship],
    reserved_relationship_ids: &[(String, String)],
    allowed_hyperlink: Option<(&str, Option<&str>)>,
) -> bool {
    let reserved = reserved_relationship_ids
        .iter()
        .map(|(id, _)| id.as_str())
        .any(|reserved_id| reserved_id == id);
    if reserved {
        return false;
    }
    drawing_rels.iter().all(|rel| {
        if rel.id != id {
            return true;
        }
        let Some((target, target_mode)) = allowed_hyperlink else {
            return false;
        };
        rel.rel_type == REL_HYPERLINK
            && rel.target == target
            && rel.target_mode.as_deref() == target_mode
    })
}

fn next_hyperlink_relationship_id(
    drawing_rels: &[OpcRelationship],
    reserved_relationship_ids: &[(String, String)],
) -> String {
    let used: HashSet<&str> = drawing_rels
        .iter()
        .map(|rel| rel.id.as_str())
        .chain(reserved_relationship_ids.iter().map(|(id, _)| id.as_str()))
        .collect();
    let mut index = 1;
    loop {
        let candidate = format!("rIdHyperlink{index}");
        if !used.contains(candidate.as_str()) {
            return candidate;
        }
        index += 1;
    }
}
