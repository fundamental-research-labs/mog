//! Group shape parsing for spreadsheet drawings.

use super::super::helpers::extract_attr_value_in_element;
use super::super::reader::elements::{
    direct_child_elements, direct_child_slice, document_element_slice,
};
use super::super::reader::raw::extract_ext_lst_raw;
use super::super::types::{
    BlackWhiteMode, DrawingContent, GroupLocking, GroupShape, GroupTransform2D,
    SpreadsheetGraphicFrame,
};
use super::connectors::parse_connector;
use super::content::opaque_content_from_element;
use super::graphic_frames::{parse_graphic_frame_nv, parse_graphic_frame_xfrm};
use super::non_visual::parse_nv_props;
use super::pictures::parse_picture;
use super::shapes::parse_shape;
use super::styling::{parse_effect_list, parse_fill};

/// Parse a group shape element (CT_GroupShape).
pub fn parse_group_shape(xml: &[u8], start: usize) -> Option<GroupShape> {
    let element = document_element_slice(&xml[start..])?;

    let mut group = GroupShape::default();

    if let Some(nv_element) = direct_child_slice(element, b"nvGrpSpPr") {
        group.nv_grp_sp_pr.c_nv_pr = parse_nv_props(nv_element);

        if let Some(cnv_el) = direct_child_slice(nv_element, b"cNvGrpSpPr") {
            if let Some(locks) = direct_child_slice(cnv_el, b"grpSpLocks") {
                group.nv_grp_sp_pr.c_nv_grp_sp_pr = Some(parse_group_locking(locks));
            }
            if let Some(ext_lst) = direct_child_slice(cnv_el, b"extLst") {
                group.nv_grp_sp_pr.c_nv_grp_sp_pr_ext_lst =
                    std::str::from_utf8(ext_lst).ok().map(ToOwned::to_owned);
            }
        }
    }

    if let Some(grp_element) = direct_child_slice(element, b"grpSpPr") {
        group.grp_sp_pr.bw_mode = extract_attr_value_in_element(grp_element, b"bwMode=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(BlackWhiteMode::from_ooxml);

        if let Some(xfrm_element) = direct_child_slice(grp_element, b"xfrm") {
            group.grp_sp_pr.xfrm = parse_group_transform_2d(xfrm_element);
        }

        group.grp_sp_pr.fill = parse_fill(grp_element);

        if let Some(effect_list) = direct_child_slice(grp_element, b"effectLst") {
            group.grp_sp_pr.effects = parse_effect_list(effect_list)
                .map(ooxml_types::drawings::EffectProperties::EffectList);
        }

        if let Some(scene3d) = direct_child_slice(grp_element, b"scene3d") {
            group.grp_sp_pr.scene3d = super::three_d::parse_scene3d(scene3d);
        }

        if let Some(ext_lst) = direct_child_slice(grp_element, b"extLst") {
            group.grp_sp_pr.ext_lst = std::str::from_utf8(ext_lst).ok().map(ToOwned::to_owned);
        }
    }

    for child in direct_child_elements(element) {
        let child_xml = child.full_slice(element);
        match child.local_name {
            b"nvGrpSpPr" | b"grpSpPr" => {}
            b"pic" => {
                if let Some(pic) = parse_picture(child_xml, 0) {
                    group.children.push(DrawingContent::Picture(pic));
                }
            }
            b"sp" => {
                if let Some(shape) = parse_shape(child_xml, 0) {
                    group.children.push(DrawingContent::Shape(shape));
                }
            }
            b"cxnSp" => {
                if let Some(connector) = parse_connector(child_xml, 0) {
                    group.children.push(DrawingContent::Connector(connector));
                }
            }
            b"contentPart" => {
                if let Some(r_id) = extract_attr_value_in_element(child_xml, b"id=\"")
                    .or_else(|| extract_attr_value_in_element(child_xml, b"r:id=\""))
                {
                    group.children.push(DrawingContent::ContentPart(
                        ooxml_types::drawings::ContentPartRef {
                            r_id: String::from_utf8_lossy(r_id).into_owned(),
                        },
                    ));
                }
            }
            b"grpSp" => {
                if let Some(nested_group) = parse_group_shape(child_xml, 0) {
                    group
                        .children
                        .push(DrawingContent::GroupShape(nested_group));
                }
            }
            b"graphicFrame" => {
                let element = child_xml;
                let macro_name = extract_attr_value_in_element(element, b"macro=\"")
                    .map(|v| String::from_utf8_lossy(v).into_owned());
                if let Ok(raw_xml) = std::str::from_utf8(element) {
                    group
                        .children
                        .push(DrawingContent::GraphicFrame(SpreadsheetGraphicFrame {
                            nv_graphic_frame_pr: parse_graphic_frame_nv(element),
                            xfrm: parse_graphic_frame_xfrm(element),
                            graphic_xml: Some(raw_xml.to_string()),
                            macro_name,
                            ..Default::default()
                        }));
                }
            }
            _ => {
                if let Some(opaque) = opaque_content_from_element(child_xml, child.local_name) {
                    group.children.push(DrawingContent::OpaqueUnknown(opaque));
                }
            }
        }
    }

    Some(group)
}

fn parse_group_transform_2d(xml: &[u8]) -> Option<GroupTransform2D> {
    let element = document_element_slice(xml)?;

    let mut xfrm = GroupTransform2D::default();

    xfrm.rotation = extract_attr_value_in_element(element, b"rot=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(|s| s.parse::<i32>().ok())
        .map(ooxml_types::drawings::StAngle::new);
    xfrm.flip_h = extract_attr_value_in_element(element, b"flipH=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s == "1" || s == "true");
    xfrm.flip_v = extract_attr_value_in_element(element, b"flipV=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(|s| s == "1" || s == "true");

    parse_i64_pair(element, b"off", &mut xfrm.offset);
    parse_u64_pair(element, b"ext", &mut xfrm.extent);
    parse_i64_pair(element, b"chOff", &mut xfrm.child_offset);
    parse_u64_pair(element, b"chExt", &mut xfrm.child_extent);

    Some(xfrm)
}

fn parse_i64_pair(xml: &[u8], tag: &[u8], target: &mut Option<(i64, i64)>) {
    if let Some(el) = direct_child_slice(xml, tag) {
        let x = extract_attr_value_in_element(el, b"x=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let y = extract_attr_value_in_element(el, b"y=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        *target = Some((x, y));
    }
}

fn parse_u64_pair(xml: &[u8], tag: &[u8], target: &mut Option<(u64, u64)>) {
    if let Some(el) = direct_child_slice(xml, tag) {
        let cx = extract_attr_value_in_element(el, b"cx=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let cy = extract_attr_value_in_element(el, b"cy=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        *target = Some((cx, cy));
    }
}

fn parse_group_locking(xml: &[u8]) -> GroupLocking {
    GroupLocking {
        no_grp: parse_bool_attr(xml, b"noGrp=\""),
        no_ungrp: parse_bool_attr(xml, b"noUngrp=\""),
        no_select: parse_bool_attr(xml, b"noSelect=\""),
        no_rot: parse_bool_attr(xml, b"noRot=\""),
        no_change_aspect: parse_bool_attr(xml, b"noChangeAspect=\""),
        no_move: parse_bool_attr(xml, b"noMove=\""),
        no_resize: parse_bool_attr(xml, b"noResize=\""),
        ext_lst: extract_ext_lst_raw(xml),
    }
}

fn parse_bool_attr(xml: &[u8], attr: &[u8]) -> bool {
    extract_attr_value_in_element(xml, attr)
        .map(|v| v == b"1" || v == b"true")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn children_follow_document_order() {
        let xml = br#"<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Group"/></xdr:nvGrpSpPr><xdr:grpSpPr/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Shape"/></xdr:nvSpPr><xdr:spPr/></xdr:sp><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Picture"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:cxnSp><xdr:nvCxnSpPr><xdr:cNvPr id="4" name="Connector"/></xdr:nvCxnSpPr><xdr:spPr/></xdr:cxnSp></xdr:grpSp>"#;
        let group = parse_group_shape(xml, 0).unwrap();

        assert!(matches!(group.children[0], DrawingContent::Shape(_)));
        assert!(matches!(group.children[1], DrawingContent::Picture(_)));
        assert!(matches!(group.children[2], DrawingContent::Connector(_)));
    }

    #[test]
    fn nested_group_descendants_are_not_duplicated_as_direct_children() {
        let xml = br#"<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Outer"/></xdr:nvGrpSpPr><xdr:grpSpPr/><xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="2" name="Inner"/></xdr:nvGrpSpPr><xdr:grpSpPr/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="3" name="Nested Shape"/></xdr:nvSpPr><xdr:spPr/></xdr:sp></xdr:grpSp></xdr:grpSp>"#;
        let group = parse_group_shape(xml, 0).unwrap();

        assert_eq!(group.children.len(), 1);
        let DrawingContent::GroupShape(inner) = &group.children[0] else {
            panic!("expected nested group");
        };
        assert_eq!(inner.children.len(), 1);
        assert!(matches!(inner.children[0], DrawingContent::Shape(_)));
    }

    #[test]
    fn group_properties_read_direct_fill_only() {
        let xml = br#"<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Group"/></xdr:nvGrpSpPr><xdr:grpSpPr bwMode="auto"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:effectLst/><a:extLst><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:extLst></xdr:grpSpPr></xdr:grpSp>"#;
        let group = parse_group_shape(xml, 0).unwrap();

        assert_eq!(group.grp_sp_pr.bw_mode, Some(BlackWhiteMode::Auto));
        let Some(super::super::super::types::Fill::Solid(fill)) = group.grp_sp_pr.fill else {
            panic!("expected direct solid fill");
        };
        assert!(matches!(
            fill.color,
            ooxml_types::drawings::DrawingColor::SrgbClr { ref val, .. } if val == "FF0000"
        ));
        assert!(group.grp_sp_pr.effects.is_some());
        assert!(group.grp_sp_pr.ext_lst.is_some());
    }

    #[test]
    fn group_properties_preserve_direct_scene3d_and_ext_lst() {
        let xml = br#"<xdr:grpSp>
            <xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Group"/></xdr:nvGrpSpPr>
            <xdr:grpSpPr>
                <a:scene3d>
                    <a:camera prst="orthographicFront"/>
                    <a:lightRig rig="threePt" dir="t"/>
                </a:scene3d>
                <a:extLst><a:ext uri="group-props"/></a:extLst>
            </xdr:grpSpPr>
        </xdr:grpSp>"#;
        let group = parse_group_shape(xml, 0).unwrap();

        assert!(group.grp_sp_pr.scene3d.is_some());
        assert!(
            group
                .grp_sp_pr
                .ext_lst
                .as_deref()
                .is_some_and(|xml| xml.contains("group-props"))
        );
    }

    #[test]
    fn group_non_visual_locking_reads_direct_children_only() {
        let xml = br#"<xdr:grpSp>
            <xdr:nvGrpSpPr>
                <xdr:cNvPr id="1" name="Group"/>
                <xdr:extLst>
                    <xdr:ext>
                        <xdr:cNvGrpSpPr>
                            <a:grpSpLocks noGrp="1"/>
                        </xdr:cNvGrpSpPr>
                    </xdr:ext>
                </xdr:extLst>
                <xdr:cNvGrpSpPr>
                    <xdr:extLst>
                        <xdr:ext>
                            <a:grpSpLocks noUngrp="1"/>
                        </xdr:ext>
                    </xdr:extLst>
                    <a:grpSpLocks noSelect="1" noRot="true"/>
                </xdr:cNvGrpSpPr>
            </xdr:nvGrpSpPr>
            <xdr:grpSpPr/>
        </xdr:grpSp>"#;

        let group = parse_group_shape(xml, 0).unwrap();
        let locks = group
            .nv_grp_sp_pr
            .c_nv_grp_sp_pr
            .expect("direct group locks");

        assert!(!locks.no_grp);
        assert!(!locks.no_ungrp);
        assert!(locks.no_select);
        assert!(locks.no_rot);
    }

    #[test]
    fn group_locks_preserve_direct_ext_lst() {
        let xml = br#"<xdr:grpSp>
            <xdr:nvGrpSpPr>
                <xdr:cNvPr id="1" name="Group"/>
                <xdr:cNvGrpSpPr>
                    <a:grpSpLocks noMove="1">
                        <a:extLst><a:ext uri="group-locks"/></a:extLst>
                    </a:grpSpLocks>
                </xdr:cNvGrpSpPr>
            </xdr:nvGrpSpPr>
            <xdr:grpSpPr/>
        </xdr:grpSp>"#;

        let group = parse_group_shape(xml, 0).unwrap();
        let locks = group
            .nv_grp_sp_pr
            .c_nv_grp_sp_pr
            .expect("direct group locks");

        assert!(locks.no_move);
        assert!(
            locks
                .ext_lst
                .as_deref()
                .is_some_and(|xml| xml.contains("group-locks"))
        );
    }

    #[test]
    fn group_unknown_child_preserves_raw_xml_and_relationships() {
        let xml = br#"<xdr:grpSp>
            <xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Group"/></xdr:nvGrpSpPr>
            <xdr:grpSpPr/>
            <vendor:widget r:id="rIdWidget"/>
        </xdr:grpSp>"#;

        let group = parse_group_shape(xml, 0).unwrap();

        let DrawingContent::OpaqueUnknown(opaque) = &group.children[0] else {
            panic!("expected opaque unknown child");
        };
        assert_eq!(opaque.relationship_ids, ["rIdWidget"]);
        assert_eq!(opaque.kind_hint.as_deref(), Some("widget"));
        assert!(opaque.raw_xml.contains("vendor:widget"));
    }

    #[test]
    fn group_transform_reads_root_and_direct_pairs_only() {
        let xml = br#"<a:xfrm rot="60000" flipH="1">
            <a:extLst>
                <a:ext>
                    <a:xfrm rot="999">
                        <a:off x="1" y="2"/>
                    </a:xfrm>
                    <a:off x="3" y="4"/>
                    <a:ext cx="5" cy="6"/>
                    <a:chOff x="7" y="8"/>
                    <a:chExt cx="9" cy="10"/>
                </a:ext>
            </a:extLst>
            <a:off x="11" y="22"/>
            <a:ext cx="33" cy="44"/>
            <a:chOff x="55" y="66"/>
            <a:chExt cx="77" cy="88"/>
        </a:xfrm>"#;

        let xfrm = parse_group_transform_2d(xml).expect("group transform");

        assert_eq!(
            xfrm.rotation,
            Some(ooxml_types::drawings::StAngle::new(60000))
        );
        assert_eq!(xfrm.flip_h, Some(true));
        assert_eq!(xfrm.offset, Some((11, 22)));
        assert_eq!(xfrm.extent, Some((33, 44)));
        assert_eq!(xfrm.child_offset, Some((55, 66)));
        assert_eq!(xfrm.child_extent, Some((77, 88)));
    }

    #[test]
    fn group_child_graphic_frame_is_preserved_as_opaque_child() {
        let xml = br#"<xdr:grpSp>
            <xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Group"/></xdr:nvGrpSpPr>
            <xdr:grpSpPr/>
            <xdr:graphicFrame macro="">
                <xdr:nvGraphicFramePr>
                    <xdr:cNvPr id="2" name="Frame"/>
                    <xdr:cNvGraphicFramePr/>
                </xdr:nvGraphicFramePr>
                <xdr:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></xdr:xfrm>
                <a:graphic><a:graphicData uri="opaque"/></a:graphic>
            </xdr:graphicFrame>
        </xdr:grpSp>"#;
        let group = parse_group_shape(xml, 0).unwrap();

        let DrawingContent::GraphicFrame(frame) = &group.children[0] else {
            panic!("expected graphic frame child");
        };
        assert_eq!(frame.nv_graphic_frame_pr.c_nv_pr.name, "Frame");
        assert_eq!(frame.xfrm.offset, Some((1, 2)));
        assert_eq!(frame.macro_name.as_deref(), Some(""));
        assert!(
            frame
                .graphic_xml
                .as_deref()
                .is_some_and(|xml| xml.contains("graphicFrame"))
        );
    }
}
