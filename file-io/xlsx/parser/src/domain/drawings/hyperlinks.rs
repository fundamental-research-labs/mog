use std::collections::HashMap;

use ooxml_types::drawings::{
    Hyperlink, NonVisualProps, Paragraph, RunProperties, SpreadsheetConnector,
    SpreadsheetGraphicFrame, SpreadsheetPicture, SpreadsheetShape, TextBody, TextRunContent,
};

use crate::infra::opc::REL_HYPERLINK;

use super::{Anchor, Drawing, DrawingContent, GroupShape};

/// Resolve DrawingML hyperlink relationship IDs into typed hyperlink targets.
///
/// The relationship ID remains an OOXML packaging detail. The semantic target
/// lives on `Hyperlink::url` so export can regenerate a valid relationship graph
/// from current drawing state instead of replaying imported `.rels` bytes.
pub(crate) fn resolve_drawing_hyperlink_targets(drawing: &mut Drawing) {
    let rel_targets: HashMap<&str, &str> = drawing
        .opc_rels
        .iter()
        .filter(|rel| rel.rel_type == REL_HYPERLINK)
        .map(|rel| (rel.id.as_str(), rel.target.as_str()))
        .collect();

    for anchor in &mut drawing.anchors {
        match anchor {
            Anchor::TwoCell(anchor) => {
                resolve_content_hyperlinks(&mut anchor.content, &rel_targets)
            }
            Anchor::OneCell(anchor) => {
                resolve_content_hyperlinks(&mut anchor.content, &rel_targets)
            }
            Anchor::Absolute(anchor) => {
                resolve_content_hyperlinks(&mut anchor.content, &rel_targets)
            }
        }
    }
}

fn resolve_content_hyperlinks(content: &mut DrawingContent, rel_targets: &HashMap<&str, &str>) {
    match content {
        DrawingContent::Picture(pic) => resolve_picture_hyperlinks(pic, rel_targets),
        DrawingContent::Shape(shape) => resolve_shape_hyperlinks(shape, rel_targets),
        DrawingContent::GroupShape(group) => resolve_group_hyperlinks(group, rel_targets),
        DrawingContent::Connector(connector) => {
            resolve_connector_hyperlinks(connector, rel_targets)
        }
        DrawingContent::GraphicFrame(frame) => resolve_graphic_frame_hyperlinks(frame, rel_targets),
        DrawingContent::SmartArt(_)
        | DrawingContent::ContentPart(_)
        | DrawingContent::OpaqueUnknown(_)
        | DrawingContent::Unknown => {}
    }
}

fn resolve_picture_hyperlinks(pic: &mut SpreadsheetPicture, rel_targets: &HashMap<&str, &str>) {
    resolve_non_visual_hyperlinks(&mut pic.nv_pic_pr.c_nv_pr, rel_targets);
}

fn resolve_shape_hyperlinks(shape: &mut SpreadsheetShape, rel_targets: &HashMap<&str, &str>) {
    resolve_non_visual_hyperlinks(&mut shape.nv_sp_pr.c_nv_pr, rel_targets);
    if let Some(text_body) = &mut shape.tx_body {
        resolve_text_body_hyperlinks(text_body, rel_targets);
    }
}

fn resolve_group_hyperlinks(group: &mut GroupShape, rel_targets: &HashMap<&str, &str>) {
    resolve_non_visual_hyperlinks(&mut group.nv_grp_sp_pr.c_nv_pr, rel_targets);
    for child in &mut group.children {
        resolve_content_hyperlinks(child, rel_targets);
    }
}

fn resolve_connector_hyperlinks(
    connector: &mut SpreadsheetConnector,
    rel_targets: &HashMap<&str, &str>,
) {
    resolve_non_visual_hyperlinks(&mut connector.nv_cxn_sp_pr.c_nv_pr, rel_targets);
}

fn resolve_graphic_frame_hyperlinks(
    frame: &mut SpreadsheetGraphicFrame,
    rel_targets: &HashMap<&str, &str>,
) {
    resolve_non_visual_hyperlinks(&mut frame.nv_graphic_frame_pr.c_nv_pr, rel_targets);
}

fn resolve_non_visual_hyperlinks(props: &mut NonVisualProps, rel_targets: &HashMap<&str, &str>) {
    resolve_hyperlink(props.hlink_click.as_mut(), rel_targets);
    resolve_hyperlink(props.hlink_hover.as_mut(), rel_targets);
}

fn resolve_text_body_hyperlinks(text_body: &mut TextBody, rel_targets: &HashMap<&str, &str>) {
    for paragraph in &mut text_body.paragraphs {
        resolve_paragraph_hyperlinks(paragraph, rel_targets);
    }
}

fn resolve_paragraph_hyperlinks(paragraph: &mut Paragraph, rel_targets: &HashMap<&str, &str>) {
    if let Some(props) = paragraph.props.def_run_props.as_deref_mut() {
        resolve_run_property_hyperlinks(props, rel_targets);
    }
    if let Some(props) = &mut paragraph.end_para_rpr {
        resolve_run_property_hyperlinks(props, rel_targets);
    }
    for run in &mut paragraph.runs {
        match run {
            TextRunContent::Run(run) => {
                resolve_run_property_hyperlinks(&mut run.props, rel_targets)
            }
            TextRunContent::LineBreak { props: Some(props) } => {
                resolve_run_property_hyperlinks(props, rel_targets)
            }
            TextRunContent::Field {
                run_props: Some(props),
                para_props: Some(para_props),
                ..
            } => {
                resolve_run_property_hyperlinks(props, rel_targets);
                if let Some(def_props) = para_props.def_run_props.as_deref_mut() {
                    resolve_run_property_hyperlinks(def_props, rel_targets);
                }
            }
            TextRunContent::Field {
                run_props: Some(props),
                para_props: None,
                ..
            } => resolve_run_property_hyperlinks(props, rel_targets),
            TextRunContent::Field {
                run_props: None,
                para_props: Some(para_props),
                ..
            } => {
                if let Some(def_props) = para_props.def_run_props.as_deref_mut() {
                    resolve_run_property_hyperlinks(def_props, rel_targets);
                }
            }
            TextRunContent::LineBreak { props: None }
            | TextRunContent::Field {
                run_props: None,
                para_props: None,
                ..
            } => {}
        }
    }
}

fn resolve_run_property_hyperlinks(props: &mut RunProperties, rel_targets: &HashMap<&str, &str>) {
    resolve_hyperlink(props.hlink_click.as_mut(), rel_targets);
    resolve_hyperlink(props.hlink_mouse_over.as_mut(), rel_targets);
}

fn resolve_hyperlink(hlink: Option<&mut Hyperlink>, rel_targets: &HashMap<&str, &str>) {
    let Some(hlink) = hlink else {
        return;
    };
    if hlink.url.is_some() {
        return;
    }
    let Some(r_id) = hlink.r_id.as_deref() else {
        return;
    };
    if let Some(target) = rel_targets.get(r_id) {
        hlink.url = Some((*target).to_string());
    }
}

#[cfg(test)]
mod tests {
    use ooxml_types::drawings::{
        NonVisualProps, SpreadsheetShape, StDrawingElementId, TextBody, TextRun, TextRunContent,
    };
    use ooxml_types::shared::OpcRelationship;

    use super::*;

    #[test]
    fn resolves_shape_and_text_run_hyperlink_targets() {
        let mut shape = SpreadsheetShape::default();
        shape.nv_sp_pr.c_nv_pr = NonVisualProps {
            id: StDrawingElementId::new(1),
            name: "Rectangle 1".to_string(),
            hlink_click: Some(Hyperlink {
                r_id: Some("rId1".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut text_body = TextBody::default();
        text_body.paragraphs.push(Paragraph {
            runs: vec![TextRunContent::Run(TextRun {
                text: "Click".to_string(),
                props: RunProperties {
                    hlink_click: Some(Hyperlink {
                        r_id: Some("rId2".to_string()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            })],
            ..Default::default()
        });
        shape.tx_body = Some(text_body);

        let mut drawing = Drawing {
            anchors: vec![Anchor::TwoCell(super::super::TwoCellAnchor {
                content: DrawingContent::Shape(shape),
                from: Default::default(),
                to: Default::default(),
                edit_as: None,
                client_data: Default::default(),
                mc_alternate_content: None,
            })],
            opc_rels: vec![
                OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: REL_HYPERLINK.to_string(),
                    target: "#Nav_Description".to_string(),
                    target_mode: None,
                },
                OpcRelationship {
                    id: "rId2".to_string(),
                    rel_type: REL_HYPERLINK.to_string(),
                    target: "https://example.com".to_string(),
                    target_mode: Some("External".to_string()),
                },
            ],
            ..Default::default()
        };

        resolve_drawing_hyperlink_targets(&mut drawing);

        let Anchor::TwoCell(anchor) = &drawing.anchors[0] else {
            panic!("expected two-cell anchor");
        };
        let DrawingContent::Shape(shape) = &anchor.content else {
            panic!("expected shape");
        };
        assert_eq!(
            shape
                .nv_sp_pr
                .c_nv_pr
                .hlink_click
                .as_ref()
                .unwrap()
                .url
                .as_deref(),
            Some("#Nav_Description")
        );
        let text_body = shape.tx_body.as_ref().unwrap();
        let TextRunContent::Run(run) = &text_body.paragraphs[0].runs[0] else {
            panic!("expected text run");
        };
        assert_eq!(
            run.props.hlink_click.as_ref().unwrap().url.as_deref(),
            Some("https://example.com")
        );
    }
}
