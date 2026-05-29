//! Drawing fact extraction for round-trip verification.
//!
//! Facts intentionally describe user-visible drawing semantics rather than raw
//! XML spelling. Relationship ids are resolved to relationship targets when the
//! drawing relationship graph is available, so facts can survive rId renumbering.

use std::collections::HashMap;

use super::reader::raw::relationship_ids_in_raw;
use super::types::{
    AbsoluteAnchor, Anchor, BulletColor, BulletProperties, BulletSize, BulletType, CellAnchor,
    ClientData, Drawing, DrawingColor, DrawingContent, Fill, FillMode, GroupShape, Hyperlink,
    OneCellAnchor, ParagraphProperties, Position, RunProperties, ShapeGeometry, ShapeProperties,
    SpreadsheetConnector, SpreadsheetGraphicFrame, SpreadsheetPicture, SpreadsheetShape,
    TextAutofit, TextBodyProperties, TextFont, TextRunContent, TextSpacing, TwoCellAnchor,
    UnderlineFill, UnderlineLine,
};
pub use xlsx_test_contracts::{
    AnchorFact, AnchorGeometryFact, AnchorKindFact, CellAnchorFact, ClientDataFact, ConnectionFact,
    ConnectorFact, DrawingFacts, ExtentFact, GraphicFrameFact, GraphicFrameKindFact, GroupFact,
    GroupTransformFact, ObjectFact, ParagraphFact, PictureFact, PositionFact, ShapeFact,
    ShapePropertiesFact, SmartArtFact, SourceRectFact, TextBodyFact, TextBreakFact, TextFact,
    TextFieldFact, TextRunFact, TextRunPropertiesFact, TextTabFact, TransformFact,
};

/// Extract stable facts from a parsed drawing.
pub fn drawing_facts(drawing: &Drawing) -> DrawingFacts {
    let rel_targets = relationship_targets(drawing);
    DrawingFacts {
        anchors: drawing
            .anchors
            .iter()
            .map(|anchor| anchor_fact(anchor, &rel_targets))
            .collect(),
    }
}

fn anchor_fact(anchor: &Anchor, rel_targets: &HashMap<&str, &str>) -> AnchorFact {
    match anchor {
        Anchor::TwoCell(anchor) => two_cell_anchor_fact(anchor, rel_targets),
        Anchor::OneCell(anchor) => one_cell_anchor_fact(anchor, rel_targets),
        Anchor::Absolute(anchor) => absolute_anchor_fact(anchor, rel_targets),
    }
}

fn two_cell_anchor_fact(anchor: &TwoCellAnchor, rel_targets: &HashMap<&str, &str>) -> AnchorFact {
    AnchorFact {
        kind: AnchorKindFact::TwoCell,
        geometry: AnchorGeometryFact::TwoCell {
            from: cell_anchor_fact(&anchor.from),
            to: cell_anchor_fact(&anchor.to),
            edit_as: anchor.edit_as.map(|edit_as| format!("{edit_as:?}")),
        },
        object: object_fact(&anchor.content, rel_targets),
        client_data: client_data_fact(anchor.client_data),
        raw_alternate_content: anchor.mc_alternate_content.is_some(),
    }
}

fn one_cell_anchor_fact(anchor: &OneCellAnchor, rel_targets: &HashMap<&str, &str>) -> AnchorFact {
    AnchorFact {
        kind: AnchorKindFact::OneCell,
        geometry: AnchorGeometryFact::OneCell {
            from: cell_anchor_fact(&anchor.from),
            extent: ExtentFact {
                cx: anchor.extent.cx,
                cy: anchor.extent.cy,
            },
        },
        object: object_fact(&anchor.content, rel_targets),
        client_data: client_data_fact(anchor.client_data),
        raw_alternate_content: anchor.mc_alternate_content.is_some(),
    }
}

fn absolute_anchor_fact(anchor: &AbsoluteAnchor, rel_targets: &HashMap<&str, &str>) -> AnchorFact {
    AnchorFact {
        kind: AnchorKindFact::Absolute,
        geometry: AnchorGeometryFact::Absolute {
            position: position_fact(&anchor.pos),
            extent: ExtentFact {
                cx: anchor.extent.cx,
                cy: anchor.extent.cy,
            },
        },
        object: object_fact(&anchor.content, rel_targets),
        client_data: client_data_fact(anchor.client_data),
        raw_alternate_content: false,
    }
}

fn object_fact(content: &DrawingContent, rel_targets: &HashMap<&str, &str>) -> ObjectFact {
    match content {
        DrawingContent::Picture(picture) => ObjectFact::Picture(picture_fact(picture, rel_targets)),
        DrawingContent::Shape(shape) => ObjectFact::Shape(shape_fact(shape, rel_targets)),
        DrawingContent::Connector(connector) => ObjectFact::Connector(connector_fact(connector)),
        DrawingContent::GroupShape(group) => ObjectFact::Group(group_fact(group, rel_targets)),
        DrawingContent::GraphicFrame(frame) => {
            ObjectFact::GraphicFrame(graphic_frame_fact(frame, rel_targets))
        }
        DrawingContent::SmartArt(smartart) => ObjectFact::SmartArt(SmartArtFact {
            relationship_targets: resolve_ids(
                [
                    smartart.dm_rel_id.as_str(),
                    smartart.lo_rel_id.as_str(),
                    smartart.qs_rel_id.as_str(),
                    smartart.cs_rel_id.as_str(),
                ],
                rel_targets,
            ),
        }),
        DrawingContent::ContentPart(_) => ObjectFact::Unknown,
        DrawingContent::OpaqueUnknown(_) => ObjectFact::Unknown,
        DrawingContent::Unknown => ObjectFact::Unknown,
    }
}

fn picture_fact(picture: &SpreadsheetPicture, rel_targets: &HashMap<&str, &str>) -> PictureFact {
    PictureFact {
        name: picture.nv_pic_pr.c_nv_pr.name.clone(),
        source_targets: resolve_ids(
            [
                picture.blip_fill.embed_id.as_deref().unwrap_or_default(),
                picture.blip_fill.link_id.as_deref().unwrap_or_default(),
            ],
            rel_targets,
        ),
        fill_mode: picture.blip_fill.fill_mode.as_ref().map(fill_mode_name),
        crop: picture.blip_fill.source_rect.map(|rect| SourceRectFact {
            top: rect.top.value(),
            bottom: rect.bottom.value(),
            left: rect.left.value(),
            right: rect.right.value(),
        }),
        blip_effect_count: picture.blip_fill.effects.len(),
        properties: shape_properties_fact(&picture.sp_pr),
    }
}

fn shape_fact(shape: &SpreadsheetShape, rel_targets: &HashMap<&str, &str>) -> ShapeFact {
    ShapeFact {
        name: shape.nv_sp_pr.c_nv_pr.name.clone(),
        preset: preset_fact(&shape.sp_pr),
        text: shape
            .tx_body
            .as_ref()
            .map(|text| text_fact(text, rel_targets))
            .unwrap_or_default(),
        properties: shape_properties_fact(&shape.sp_pr),
    }
}

fn connector_fact(connector: &SpreadsheetConnector) -> ConnectorFact {
    ConnectorFact {
        name: connector.nv_cxn_sp_pr.c_nv_pr.name.clone(),
        preset: preset_fact(&connector.sp_pr),
        start_connection: connector.nv_cxn_sp_pr.st_cxn.as_ref().map(connection_fact),
        end_connection: connector.nv_cxn_sp_pr.end_cxn.as_ref().map(connection_fact),
        properties: shape_properties_fact(&connector.sp_pr),
    }
}

fn group_fact(group: &GroupShape, rel_targets: &HashMap<&str, &str>) -> GroupFact {
    GroupFact {
        name: group.nv_grp_sp_pr.c_nv_pr.name.clone(),
        transform: group
            .grp_sp_pr
            .xfrm
            .as_ref()
            .map(|xfrm| GroupTransformFact {
                offset: xfrm.offset,
                extent: xfrm.extent,
                child_offset: xfrm.child_offset,
                child_extent: xfrm.child_extent,
                rotation: xfrm.rotation.map(|rot| rot.value()),
                flip_h: xfrm.flip_h,
                flip_v: xfrm.flip_v,
            }),
        child_count: group.children.len(),
        children: group
            .children
            .iter()
            .map(|child| object_fact(child, rel_targets))
            .collect(),
        has_fill: group.grp_sp_pr.fill.is_some(),
        has_effects: group.grp_sp_pr.effects.is_some(),
        has_3d: group.grp_sp_pr.scene3d.is_some(),
    }
}

fn graphic_frame_fact(
    frame: &SpreadsheetGraphicFrame,
    rel_targets: &HashMap<&str, &str>,
) -> GraphicFrameFact {
    let raw = frame.graphic_xml.as_deref().unwrap_or_default();
    GraphicFrameFact {
        name: frame.nv_graphic_frame_pr.c_nv_pr.name.clone(),
        classification: classify_graphic_frame(raw),
        relationship_targets: resolve_ids(
            relationship_ids_in_raw(raw).iter().map(String::as_str),
            rel_targets,
        ),
        opaque_preserved: frame.graphic_xml.is_some(),
    }
}

fn shape_properties_fact(properties: &ShapeProperties) -> ShapePropertiesFact {
    ShapePropertiesFact {
        transform: properties.xfrm.as_ref().map(|xfrm| TransformFact {
            offset: xfrm.offset,
            extent: xfrm.extent,
            rotation: xfrm.rotation.map(|rot| rot.value()),
            flip_h: xfrm.flip_h,
            flip_v: xfrm.flip_v,
        }),
        preset: preset_fact(properties),
        fill: properties.fill.as_ref().map(fill_name),
        fill_detail: properties.fill.as_ref().map(|fill| format!("{fill:?}")),
        outline: properties.ln.is_some(),
        outline_detail: properties.ln.as_ref().map(|outline| format!("{outline:?}")),
        effects: properties.effects.is_some(),
        effect_detail: properties
            .effects
            .as_ref()
            .map(|effects| format!("{effects:?}")),
        scene3d: properties.scene3d.is_some(),
        scene3d_detail: properties
            .scene3d
            .as_ref()
            .map(|scene3d| format!("{scene3d:?}")),
        shape3d: properties.sp3d.is_some(),
        shape3d_detail: properties
            .sp3d
            .as_ref()
            .map(|shape3d| format!("{shape3d:?}")),
    }
}

fn text_fact(text_body: &super::types::TextBody, rel_targets: &HashMap<&str, &str>) -> TextFact {
    let mut fact = TextFact {
        paragraph_count: text_body.paragraphs.len(),
        body: text_body_fact(&text_body.body_props),
        ..TextFact::default()
    };
    for (paragraph_index, paragraph) in text_body.paragraphs.iter().enumerate() {
        fact.paragraphs.push(paragraph_fact(
            paragraph_index,
            &paragraph.props,
            rel_targets,
        ));
        if let Some(end_para_rpr) = paragraph.end_para_rpr.as_ref() {
            fact.end_paragraph_runs
                .push(run_properties_fact(end_para_rpr, rel_targets));
        }
        for (run_index, run) in paragraph.runs.iter().enumerate() {
            match run {
                TextRunContent::Run(run) => {
                    fact.run_count += 1;
                    fact.text.push_str(&run.text);
                    fact.runs.push(TextRunFact {
                        paragraph_index,
                        run_index,
                        text: run.text.clone(),
                        properties: run_properties_fact(&run.props, rel_targets),
                    });
                }
                TextRunContent::LineBreak { props } => {
                    fact.break_count += 1;
                    fact.breaks.push(TextBreakFact {
                        paragraph_index,
                        run_index,
                        properties: props
                            .as_ref()
                            .map(|props| run_properties_fact(props, rel_targets)),
                    });
                }
                TextRunContent::Field {
                    id,
                    field_type,
                    text,
                    run_props,
                    ..
                } => {
                    fact.field_count += 1;
                    if let Some(text) = text {
                        fact.text.push_str(text);
                    }
                    fact.fields.push(TextFieldFact {
                        paragraph_index,
                        run_index,
                        id: id.clone(),
                        field_type: field_type.clone(),
                        text: text.clone(),
                        properties: run_props
                            .as_ref()
                            .map(|props| run_properties_fact(props, rel_targets)),
                    });
                }
            }
        }
    }
    fact
}

fn text_body_fact(props: &TextBodyProperties) -> TextBodyFact {
    TextBodyFact {
        anchor: props.anchor.map(|value| format!("{value:?}")),
        wrap: props.wrap.map(|value| format!("{value:?}")),
        vertical: props.vert.map(|value| format!("{value:?}")),
        vertical_overflow: props.vert_overflow.map(|value| format!("{value:?}")),
        horizontal_overflow: props.horz_overflow.map(|value| format!("{value:?}")),
        rotation: props.rot.map(|value| value.value()),
        inset_left: props.l_ins,
        inset_top: props.t_ins,
        inset_right: props.r_ins,
        inset_bottom: props.b_ins,
        autofit: props.autofit.as_ref().map(autofit_fact),
        preset_warp: props
            .prst_tx_warp
            .as_ref()
            .map(|warp| format!("{:?}", warp.preset)),
    }
}

fn paragraph_fact(
    index: usize,
    props: &ParagraphProperties,
    rel_targets: &HashMap<&str, &str>,
) -> ParagraphFact {
    let tabs = props
        .tab_list
        .as_ref()
        .map(|tabs| {
            tabs.iter()
                .map(|tab| TextTabFact {
                    position: tab.position,
                    align: tab.align.map(|align| format!("{align:?}")),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    ParagraphFact {
        index,
        align: props.align.map(|align| format!("{align:?}")),
        level: props.level.map(|level| level.value()),
        margin_left: props.margin_l,
        margin_right: props.margin_r,
        indent: props.indent,
        rtl: props.rtl,
        font_align: props.font_align.map(|align| format!("{align:?}")),
        line_spacing: props.line_spacing.as_ref().map(text_spacing_fact),
        space_before: props.space_before.as_ref().map(text_spacing_fact),
        space_after: props.space_after.as_ref().map(text_spacing_fact),
        bullet: props.bullet.as_ref().map(bullet_fact),
        tab_count: tabs.len(),
        tabs,
        default_run: props
            .def_run_props
            .as_ref()
            .map(|props| run_properties_fact(props, rel_targets)),
    }
}

fn run_properties_fact(
    props: &RunProperties,
    rel_targets: &HashMap<&str, &str>,
) -> TextRunPropertiesFact {
    TextRunPropertiesFact {
        size: props.size.map(|size| size.value()),
        bold: props.bold,
        italic: props.italic,
        underline: props.underline.map(|value| format!("{value:?}")),
        strike: props.strike.map(|value| format!("{value:?}")),
        color: props.color.as_ref().map(drawing_color_fact),
        fill: props.text_fill.as_ref().map(fill_name),
        highlight: props.highlight.as_ref().map(drawing_color_fact),
        latin_font: props.latin.as_ref().map(text_font_fact),
        east_asian_font: props.ea.as_ref().map(text_font_fact),
        complex_script_font: props.cs.as_ref().map(text_font_fact),
        symbol_font: props.sym.as_ref().map(text_font_fact),
        language: props.lang.clone(),
        alternate_language: props.alt_lang.clone(),
        kerning: props.kern.map(|value| value.value()),
        caps: props.cap.map(|value| format!("{value:?}")),
        spacing: props.spacing.map(|value| value.value()),
        baseline: props.baseline.map(|value| value.value()),
        click_target: hyperlink_target(props.hlink_click.as_ref(), rel_targets),
        mouse_over_target: hyperlink_target(props.hlink_mouse_over.as_ref(), rel_targets),
        bookmark: props.bmk.clone(),
        rtl: props.rtl,
        effects: props.effects.is_some(),
        outline: props.text_outline.is_some(),
        underline_line: props.underline_line.as_ref().map(underline_line_fact),
        underline_fill: props.underline_fill.as_ref().map(underline_fill_fact),
    }
}

fn bullet_fact(bullet: &BulletProperties) -> xlsx_test_contracts::BulletFact {
    xlsx_test_contracts::BulletFact {
        kind: bullet
            .bullet_type
            .as_ref()
            .map(|kind| match kind {
                BulletType::None => "none".to_string(),
                BulletType::Char(value) => format!("char:{value}"),
                BulletType::AutoNum { scheme, start_at } => {
                    format!("auto:{scheme:?}:{}", opt_u32(*start_at))
                }
                BulletType::Blip(r_id) => format!("blip:{r_id}"),
            })
            .unwrap_or_else(|| "unspecified".to_string()),
        color: bullet.color.as_ref().map(|color| match color {
            BulletColor::FollowText => "follow_text".to_string(),
            BulletColor::Custom(color) => drawing_color_fact(color),
        }),
        size: bullet.size.as_ref().map(|size| match size {
            BulletSize::FollowText => "follow_text".to_string(),
            BulletSize::Percent(value) => format!("percent:{value}"),
            BulletSize::Points(value) => format!("points:{value}"),
        }),
        font: if bullet.font_follows_text {
            Some("follow_text".to_string())
        } else {
            bullet.font.as_ref().map(text_font_fact)
        },
    }
}

fn autofit_fact(autofit: &TextAutofit) -> String {
    match autofit {
        TextAutofit::NoAutofit => "none".to_string(),
        TextAutofit::ShapeAutofit => "shape".to_string(),
        TextAutofit::NormalAutofit {
            font_scale,
            line_space_reduction,
        } => format!(
            "normal:font_scale={}:line_space_reduction={}",
            opt_u32(*font_scale),
            opt_u32(*line_space_reduction)
        ),
    }
}

fn text_spacing_fact(spacing: &TextSpacing) -> String {
    match spacing {
        TextSpacing::Percent(value) => format!("percent:{value}"),
        TextSpacing::Points(value) => format!("points:{value}"),
    }
}

fn text_font_fact(font: &TextFont) -> String {
    let mut parts = vec![font.typeface.clone()];
    if let Some(panose) = font.panose.as_ref() {
        parts.push(format!("panose={panose}"));
    }
    if let Some(pitch_family) = font.pitch_family {
        parts.push(format!("pitch={}", pitch_family.value()));
    }
    if let Some(charset) = font.charset {
        parts.push(format!("charset={charset}"));
    }
    parts.join("|")
}

fn hyperlink_target(
    hyperlink: Option<&Hyperlink>,
    rel_targets: &HashMap<&str, &str>,
) -> Option<String> {
    let hyperlink = hyperlink?;
    if let Some(r_id) = hyperlink.r_id.as_deref() {
        return Some(rel_targets.get(r_id).copied().unwrap_or(r_id).to_string());
    }
    hyperlink
        .action
        .as_ref()
        .or(hyperlink.tooltip.as_ref())
        .cloned()
}

fn underline_line_fact(line: &UnderlineLine) -> String {
    match line {
        UnderlineLine::FollowText => "follow_text".to_string(),
        UnderlineLine::Custom(_) => "custom".to_string(),
    }
}

fn underline_fill_fact(fill: &UnderlineFill) -> String {
    match fill {
        UnderlineFill::FollowText => "follow_text".to_string(),
        UnderlineFill::Custom(fill) => fill_name(fill),
    }
}

fn drawing_color_fact(color: &DrawingColor) -> String {
    match color {
        DrawingColor::SrgbClr { val, transforms } => {
            format!("srgb:{val}:transforms={}", transforms.len())
        }
        DrawingColor::SchemeClr { val, transforms } => {
            format!("scheme:{val:?}:transforms={}", transforms.len())
        }
        DrawingColor::HslClr {
            hue,
            sat,
            lum,
            transforms,
        } => format!("hsl:{hue}:{sat}:{lum}:transforms={}", transforms.len()),
        DrawingColor::SysClr {
            val,
            last_clr,
            transforms,
        } => format!(
            "sys:{val:?}:last={}:transforms={}",
            last_clr.as_deref().unwrap_or("none"),
            transforms.len()
        ),
        DrawingColor::PrstClr { val, transforms } => {
            format!("preset:{val:?}:transforms={}", transforms.len())
        }
        DrawingColor::ScrgbClr {
            r,
            g,
            b,
            transforms,
        } => format!("scrgb:{r}:{g}:{b}:transforms={}", transforms.len()),
    }
}

fn opt_u32(value: Option<u32>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "none".to_string())
}

fn preset_fact(properties: &ShapeProperties) -> Option<String> {
    match properties.geometry.as_ref()? {
        ShapeGeometry::Preset(preset) => Some(format!("{:?}", preset.prst)),
        ShapeGeometry::Custom(_) => Some("Custom".to_string()),
    }
}

fn fill_name(fill: &Fill) -> String {
    match fill {
        Fill::NoFill => "none",
        Fill::Solid(_) => "solid",
        Fill::Gradient(_) => "gradient",
        Fill::Pattern(_) => "pattern",
        Fill::Blip(_) => "blip",
        Fill::Group => "group",
    }
    .to_string()
}

fn fill_mode_name(fill_mode: &FillMode) -> String {
    match fill_mode {
        FillMode::Stretch { .. } => "stretch",
        FillMode::Tile(_) => "tile",
    }
    .to_string()
}

fn classify_graphic_frame(raw: &str) -> GraphicFrameKindFact {
    if raw.contains("http://schemas.openxmlformats.org/drawingml/2006/chart") {
        GraphicFrameKindFact::Chart
    } else if raw.contains("http://schemas.microsoft.com/office/drawing/2014/chartex") {
        GraphicFrameKindFact::ChartEx
    } else if raw.contains("/slicer")
        || raw.contains("/slicers")
        || raw.contains(":slicer")
        || raw.contains("timeslicer")
    {
        GraphicFrameKindFact::SlicerLike
    } else {
        GraphicFrameKindFact::Opaque
    }
}

fn connection_fact(connection: &super::types::Connection) -> ConnectionFact {
    ConnectionFact {
        shape_id: connection.shape_id,
        idx: connection.idx,
    }
}

fn cell_anchor_fact(anchor: &CellAnchor) -> CellAnchorFact {
    CellAnchorFact {
        col: anchor.col,
        row: anchor.row,
        col_off: anchor.col_off,
        row_off: anchor.row_off,
    }
}

fn position_fact(position: &Position) -> PositionFact {
    PositionFact {
        x: position.x,
        y: position.y,
    }
}

fn client_data_fact(client_data: ClientData) -> ClientDataFact {
    ClientDataFact {
        locks_with_sheet: client_data.locks_with_sheet,
        prints_with_sheet: client_data.prints_with_sheet,
    }
}

fn relationship_targets(drawing: &Drawing) -> HashMap<&str, &str> {
    drawing
        .opc_rels
        .iter()
        .map(|rel| (rel.id.as_str(), rel.target.as_str()))
        .collect()
}

fn resolve_ids<'a, I>(ids: I, rel_targets: &HashMap<&str, &str>) -> Vec<String>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut targets = Vec::new();
    for id in ids {
        if id.is_empty() {
            continue;
        }
        let target = rel_targets.get(id).copied().unwrap_or(id);
        if !targets.iter().any(|existing| existing == target) {
            targets.push(target.to_string());
        }
    }
    targets
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::drawings::parse_drawing;
    use ooxml_types::shared::OpcRelationship;

    #[test]
    fn picture_facts_resolve_relationship_targets_not_ids() {
        let xml_a = br#"<xdr:twoCellAnchor>
            <xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from>
            <xdr:to><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:to>
            <xdr:pic>
                <xdr:nvPicPr><xdr:cNvPr id="2" name="Picture"/></xdr:nvPicPr>
                <xdr:blipFill>
                    <a:blip r:embed="rId1"/>
                    <a:srcRect l="1000" t="2000" r="3000" b="4000"/>
                    <a:stretch/>
                </xdr:blipFill>
                <xdr:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></a:xfrm></xdr:spPr>
            </xdr:pic>
            <xdr:clientData/>
        </xdr:twoCellAnchor>"#;
        let xml_b = String::from_utf8_lossy(xml_a).replace("rId1", "rId99");

        let mut drawing_a = parse_drawing(xml_a);
        drawing_a.opc_rels.push(image_rel("rId1"));
        let mut drawing_b = parse_drawing(xml_b.as_bytes());
        drawing_b.opc_rels.push(image_rel("rId99"));

        assert_eq!(drawing_facts(&drawing_a), drawing_facts(&drawing_b));

        let ObjectFact::Picture(picture) = &drawing_facts(&drawing_a).anchors[0].object else {
            panic!("expected picture fact");
        };
        assert_eq!(picture.source_targets, ["../media/image1.png"]);
        assert_eq!(picture.fill_mode.as_deref(), Some("stretch"));
        assert_eq!(
            picture.crop,
            Some(SourceRectFact {
                top: 2000,
                bottom: 4000,
                left: 1000,
                right: 3000,
            })
        );
    }

    #[test]
    fn group_facts_preserve_document_order_recursively() {
        let xml = br#"<xdr:twoCellAnchor>
            <xdr:from><xdr:col>0</xdr:col><xdr:row>0</xdr:row></xdr:from>
            <xdr:to><xdr:col>5</xdr:col><xdr:row>5</xdr:row></xdr:to>
            <xdr:grpSp>
                <xdr:nvGrpSpPr><xdr:cNvPr id="10" name="Group"/></xdr:nvGrpSpPr>
                <xdr:grpSpPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm></xdr:grpSpPr>
                <xdr:sp>
                    <xdr:nvSpPr><xdr:cNvPr id="11" name="Shape"/></xdr:nvSpPr>
                    <xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr>
                    <xdr:txBody><a:bodyPr/><a:p><a:r><a:t>Hello</a:t></a:r></a:p></xdr:txBody>
                </xdr:sp>
                <xdr:cxnSp>
                    <xdr:nvCxnSpPr><xdr:cNvPr id="12" name="Connector"/><xdr:cNvCxnSpPr><a:stCxn id="11" idx="0"/></xdr:cNvCxnSpPr></xdr:nvCxnSpPr>
                    <xdr:spPr><a:prstGeom prst="straightConnector1"/></xdr:spPr>
                </xdr:cxnSp>
            </xdr:grpSp>
            <xdr:clientData/>
        </xdr:twoCellAnchor>"#;

        let facts = drawing_facts(&parse_drawing(xml));
        let ObjectFact::Group(group) = &facts.anchors[0].object else {
            panic!("expected group fact");
        };

        assert_eq!(group.name, "Group");
        assert_eq!(group.child_count, 2);
        assert!(matches!(group.children[0], ObjectFact::Shape(_)));
        assert!(matches!(group.children[1], ObjectFact::Connector(_)));

        let ObjectFact::Shape(shape) = &group.children[0] else {
            panic!("expected shape child");
        };
        assert_eq!(shape.text.text, "Hello");
        assert_eq!(shape.text.paragraph_count, 1);
        assert_eq!(shape.text.run_count, 1);
    }

    #[test]
    fn graphic_frame_facts_resolve_raw_relationship_targets() {
        let xml = br#"<xdr:oneCellAnchor>
            <xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from>
            <xdr:ext cx="10" cy="20"/>
            <xdr:graphicFrame>
                <xdr:nvGraphicFramePr><xdr:cNvPr id="7" name="Chart"/></xdr:nvGraphicFramePr>
                <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId8"/></a:graphicData></a:graphic>
            </xdr:graphicFrame>
            <xdr:clientData/>
        </xdr:oneCellAnchor>"#;

        let mut drawing = parse_drawing(xml);
        drawing.opc_rels.push(OpcRelationship {
            id: "rId8".to_string(),
            rel_type: "chart".to_string(),
            target: "../charts/chart1.xml".to_string(),
            target_mode: None,
        });

        let ObjectFact::GraphicFrame(frame) = &drawing_facts(&drawing).anchors[0].object else {
            panic!("expected graphic frame fact");
        };
        assert_eq!(frame.classification, GraphicFrameKindFact::Chart);
        assert_eq!(frame.relationship_targets, ["../charts/chart1.xml"]);
        assert!(frame.opaque_preserved);
    }

    #[test]
    fn graphic_frame_facts_resolve_common_raw_relationship_attributes() {
        let xml = br#"<xdr:oneCellAnchor>
            <xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from>
            <xdr:ext cx="10" cy="20"/>
            <xdr:graphicFrame>
                <xdr:nvGraphicFramePr><xdr:cNvPr id="8" name="Opaque"/></xdr:nvGraphicFramePr>
                <a:graphic>
                    <a:graphicData uri="urn:mog:test:opaque">
                        <mog:payload xmlns:mog="urn:mog:test" r:id="rIdPart" r:embed="rIdMedia" r:link="rIdExternal"/>
                    </a:graphicData>
                </a:graphic>
            </xdr:graphicFrame>
            <xdr:clientData/>
        </xdr:oneCellAnchor>"#;

        let mut drawing = parse_drawing(xml);
        drawing.opc_rels.push(OpcRelationship {
            id: "rIdPart".to_string(),
            rel_type: "customXml".to_string(),
            target: "../customXml/item1.xml".to_string(),
            target_mode: None,
        });
        drawing.opc_rels.push(OpcRelationship {
            id: "rIdMedia".to_string(),
            rel_type: "image".to_string(),
            target: "../media/image1.png".to_string(),
            target_mode: None,
        });
        drawing.opc_rels.push(OpcRelationship {
            id: "rIdExternal".to_string(),
            rel_type: "hyperlink".to_string(),
            target: "https://example.test/".to_string(),
            target_mode: Some("External".to_string()),
        });

        let ObjectFact::GraphicFrame(frame) = &drawing_facts(&drawing).anchors[0].object else {
            panic!("expected graphic frame fact");
        };
        assert_eq!(
            frame.relationship_targets,
            [
                "../customXml/item1.xml",
                "../media/image1.png",
                "https://example.test/"
            ]
        );
    }

    #[test]
    fn shape_text_facts_include_body_paragraph_and_run_formatting() {
        let xml = br#"<xdr:twoCellAnchor>
            <xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from>
            <xdr:to><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:to>
            <xdr:sp>
                <xdr:nvSpPr><xdr:cNvPr id="2" name="Styled Text"/></xdr:nvSpPr>
                <xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr>
                <xdr:txBody>
                    <a:bodyPr anchor="ctr" wrap="square" lIns="10" tIns="20" rIns="30" bIns="40">
                        <a:spAutoFit/>
                    </a:bodyPr>
                    <a:p>
                        <a:pPr algn="ctr" lvl="1" marL="100" indent="-50">
                            <a:buChar char="*"/>
                            <a:defRPr b="1" sz="1200">
                                <a:latin typeface="Aptos"/>
                            </a:defRPr>
                        </a:pPr>
                        <a:r>
                            <a:rPr b="1" i="1" sz="1400" u="dbl" strike="sngStrike" lang="en-US">
                                <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
                                <a:latin typeface="Arial"/>
                            </a:rPr>
                            <a:t>Styled</a:t>
                        </a:r>
                    </a:p>
                </xdr:txBody>
            </xdr:sp>
            <xdr:clientData/>
        </xdr:twoCellAnchor>"#;

        let ObjectFact::Shape(shape) = &drawing_facts(&parse_drawing(xml)).anchors[0].object else {
            panic!("expected shape fact");
        };

        assert_eq!(shape.text.text, "Styled");
        assert_eq!(shape.text.body.anchor.as_deref(), Some("Center"));
        assert_eq!(shape.text.body.wrap.as_deref(), Some("Square"));
        assert_eq!(shape.text.body.inset_left, Some(10));
        assert_eq!(shape.text.body.inset_top, Some(20));
        assert_eq!(shape.text.body.inset_right, Some(30));
        assert_eq!(shape.text.body.inset_bottom, Some(40));
        assert_eq!(shape.text.body.autofit.as_deref(), Some("shape"));

        let paragraph = &shape.text.paragraphs[0];
        assert_eq!(paragraph.index, 0);
        assert_eq!(paragraph.align.as_deref(), Some("Center"));
        assert_eq!(paragraph.level, Some(1));
        assert_eq!(paragraph.margin_left, Some(100));
        assert_eq!(paragraph.indent, Some(-50));
        assert_eq!(
            paragraph.bullet.as_ref().map(|bullet| bullet.kind.as_str()),
            Some("char:*")
        );
        let default_run = paragraph.default_run.as_ref().expect("default run");
        assert_eq!(default_run.size, Some(1200));
        assert_eq!(default_run.bold, Some(true));
        assert_eq!(default_run.latin_font.as_deref(), Some("Aptos"));

        let run = &shape.text.runs[0];
        assert_eq!(run.paragraph_index, 0);
        assert_eq!(run.run_index, 0);
        assert_eq!(run.text, "Styled");
        assert_eq!(run.properties.size, Some(1400));
        assert_eq!(run.properties.bold, Some(true));
        assert_eq!(run.properties.italic, Some(true));
        assert_eq!(run.properties.underline.as_deref(), Some("Double"));
        assert_eq!(run.properties.strike.as_deref(), Some("SingleStrike"));
        assert_eq!(
            run.properties.color.as_deref(),
            Some("srgb:FF0000:transforms=0")
        );
        assert_eq!(run.properties.latin_font.as_deref(), Some("Arial"));
        assert_eq!(run.properties.language.as_deref(), Some("en-US"));
    }

    #[test]
    fn shape_property_facts_include_styling_value_details() {
        let xml = br#"<xdr:twoCellAnchor>
            <xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from>
            <xdr:to><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:to>
            <xdr:sp>
                <xdr:nvSpPr><xdr:cNvPr id="2" name="Styled Shape"/></xdr:nvSpPr>
                <xdr:spPr>
                    <a:prstGeom prst="rect"/>
                    <a:solidFill><a:srgbClr val="123456"/></a:solidFill>
                    <a:ln w="12700" cap="rnd">
                        <a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill>
                        <a:prstDash val="dash"/>
                    </a:ln>
                    <a:effectLst>
                        <a:glow rad="63500"><a:srgbClr val="00FF00"/></a:glow>
                    </a:effectLst>
                    <a:scene3d>
                        <a:camera prst="orthographicFront"/>
                        <a:lightRig rig="threePt" dir="t"/>
                    </a:scene3d>
                    <a:sp3d prstMaterial="plastic" z="4000"/>
                </xdr:spPr>
            </xdr:sp>
            <xdr:clientData/>
        </xdr:twoCellAnchor>"#;

        let ObjectFact::Shape(shape) = &drawing_facts(&parse_drawing(xml)).anchors[0].object else {
            panic!("expected shape fact");
        };

        assert_eq!(shape.properties.fill.as_deref(), Some("solid"));
        assert!(
            shape
                .properties
                .fill_detail
                .as_deref()
                .is_some_and(|detail| detail.contains("123456"))
        );
        assert!(shape.properties.outline);
        assert!(
            shape
                .properties
                .outline_detail
                .as_deref()
                .is_some_and(|detail| detail.contains("12700") && detail.contains("ABCDEF"))
        );
        assert!(shape.properties.effects);
        assert!(
            shape
                .properties
                .effect_detail
                .as_deref()
                .is_some_and(|detail| detail.contains("Glow") && detail.contains("00FF00"))
        );
        assert!(shape.properties.scene3d);
        assert!(
            shape
                .properties
                .scene3d_detail
                .as_deref()
                .is_some_and(|detail| detail.contains("OrthographicFront"))
        );
        assert!(shape.properties.shape3d);
        assert!(
            shape
                .properties
                .shape3d_detail
                .as_deref()
                .is_some_and(|detail| detail.contains("Plastic") && detail.contains("4000"))
        );
    }

    fn image_rel(id: &str) -> OpcRelationship {
        OpcRelationship {
            id: id.to_string(),
            rel_type: "image".to_string(),
            target: "../media/image1.png".to_string(),
            target_mode: None,
        }
    }
}
