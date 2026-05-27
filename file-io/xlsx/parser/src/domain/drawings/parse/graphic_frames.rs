//! Graphic frame parsing and opaque preservation helpers.

use super::super::reader::attrs::{attr_value, parse_bool};
use super::super::reader::elements::{
    direct_child_slice, document_element_slice, first_descendant_slice,
};
use super::super::reader::raw::extract_ext_lst_raw;
use super::super::types::{DrawingLocking, GraphicFrameNonVisual, SmartArtGraphicFrame};
use super::non_visual::parse_nv_props;

/// Diagram namespace URI used to identify SmartArt in `<a:graphicData uri="...">`.
const DIAGRAM_URI: &[u8] = b"http://schemas.openxmlformats.org/drawingml/2006/diagram";

/// Parse a SmartArt graphicFrame element.
pub(crate) fn parse_smartart_graphic_frame(
    xml: &[u8],
    start: usize,
) -> Option<SmartArtGraphicFrame> {
    let element = document_element_slice(&xml[start..])?;

    memchr::memmem::find(element, DIAGRAM_URI)?;

    let rel_ids_el = first_descendant_slice(element, b"relIds")?;

    let dm = rel_id(rel_ids_el, b"r:dm=\"", b"dm=\"");
    let lo = rel_id(rel_ids_el, b"r:lo=\"", b"lo=\"");
    let qs = rel_id(rel_ids_el, b"r:qs=\"", b"qs=\"");
    let cs = rel_id(rel_ids_el, b"r:cs=\"", b"cs=\"");

    if dm.is_empty() || lo.is_empty() || qs.is_empty() || cs.is_empty() {
        return None;
    }

    Some(SmartArtGraphicFrame {
        dm_rel_id: dm,
        lo_rel_id: lo,
        qs_rel_id: qs,
        cs_rel_id: cs,
    })
}

fn rel_id(xml: &[u8], namespaced: &[u8], unqualified: &[u8]) -> String {
    attr_value(xml, namespaced)
        .or_else(|| attr_value(xml, unqualified))
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

/// Parse `<xdr:xfrm>` inside a graphicFrame element into a `Transform2D`.
pub(crate) fn parse_graphic_frame_xfrm(element: &[u8]) -> ooxml_types::drawings::Transform2D {
    let mut xfrm = ooxml_types::drawings::Transform2D::default();

    let Some(xfrm_el) = direct_child_slice(element, b"xfrm") else {
        return xfrm;
    };

    xfrm.rotation = attr_value(xfrm_el, b"rot=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .and_then(|s| s.parse::<i32>().ok())
        .map(ooxml_types::drawings::StAngle::new);
    xfrm.flip_h = attr_value(xfrm_el, b"flipH=\"").and_then(parse_bool);
    xfrm.flip_v = attr_value(xfrm_el, b"flipV=\"").and_then(parse_bool);

    if let Some(off_el) = direct_child_slice(xfrm_el, b"off") {
        let x = attr_value(off_el, b"x=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let y = attr_value(off_el, b"y=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        xfrm.offset = Some((x, y));
    }

    if let Some(ext_el) = direct_child_slice(xfrm_el, b"ext") {
        let cx = attr_value(ext_el, b"cx=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let cy = attr_value(ext_el, b"cy=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        xfrm.extent = Some((cx, cy));
    }

    xfrm
}

/// Parse non-visual properties for a graphic frame (`nvGraphicFramePr`).
pub(crate) fn parse_graphic_frame_nv(xml: &[u8]) -> GraphicFrameNonVisual {
    let nv_xml = direct_child_slice(xml, b"nvGraphicFramePr").unwrap_or(xml);
    let mut result = GraphicFrameNonVisual {
        c_nv_pr: parse_nv_props(nv_xml),
        ..Default::default()
    };

    if let Some(scope) = direct_child_slice(nv_xml, b"cNvGraphicFramePr") {
        if let Some(locks_xml) = direct_child_slice(scope, b"graphicFrameLocks") {
            result.has_graphic_frame_locks = true;
            let parse_bool_attr = |attr: &[u8]| -> bool {
                attr_value(locks_xml, attr)
                    .and_then(parse_bool)
                    .unwrap_or(false)
            };
            result.no_change_aspect_explicit =
                attr_value(locks_xml, b"noChangeAspect=\"").and_then(parse_bool);
            result.c_nv_graphic_frame_pr = DrawingLocking {
                no_grp: parse_bool_attr(b"noGrp=\""),
                no_select: parse_bool_attr(b"noSelect=\""),
                no_change_aspect: parse_bool_attr(b"noChangeAspect=\""),
                no_move: parse_bool_attr(b"noMove=\""),
                no_resize: parse_bool_attr(b"noResize=\""),
                ext_lst: extract_ext_lst_raw(locks_xml),
                ..Default::default()
            };
            result.no_drilldown = parse_bool_attr(b"noDrilldown=\"");
        }

        result.c_nv_graphic_frame_pr_ext_lst = extract_ext_lst_raw(scope);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphic_frame_transform_uses_direct_xfrm_only() {
        let xml = br#"<xdr:graphicFrame><xdr:nvGraphicFramePr/><a:graphic><a:xfrm><a:off x="999" y="999"/></a:xfrm></a:graphic></xdr:graphicFrame>"#;
        let xfrm = parse_graphic_frame_xfrm(xml);

        assert_eq!(xfrm.offset, None);
    }

    #[test]
    fn graphic_frame_transform_reads_direct_xfrm() {
        let xml = br#"<xdr:graphicFrame><xdr:xfrm flipH="1"><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></xdr:xfrm><a:graphic/></xdr:graphicFrame>"#;
        let xfrm = parse_graphic_frame_xfrm(xml);

        assert_eq!(xfrm.flip_h, Some(true));
        assert_eq!(xfrm.offset, Some((10, 20)));
        assert_eq!(xfrm.extent, Some((30, 40)));
    }

    #[test]
    fn smartart_rel_ids_are_scoped_to_graphic_frame() {
        let xml = br#"<xdr:graphicFrame><xdr:nvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds r:dm="rId1" r:lo="rId2" r:qs="rId3" r:cs="rId4"/></a:graphicData></a:graphic></xdr:graphicFrame><dgm:relIds r:dm="bad" r:lo="bad" r:qs="bad" r:cs="bad"/>"#;
        let smartart = parse_smartart_graphic_frame(xml, 0).unwrap();

        assert_eq!(smartart.dm_rel_id, "rId1");
        assert_eq!(smartart.cs_rel_id, "rId4");
    }

    #[test]
    fn graphic_frame_locks_use_direct_nonvisual_scope() {
        let xml = br#"<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Frame"/><xdr:cNvGraphicFramePr><a:graphicFrameLocks noMove="1" noResize="1"/></xdr:cNvGraphicFramePr></xdr:nvGraphicFramePr><a:graphicFrameLocks noMove="0"/></xdr:graphicFrame>"#;
        let nv = parse_graphic_frame_nv(xml);

        assert!(nv.has_graphic_frame_locks);
        assert!(nv.c_nv_graphic_frame_pr.no_move);
        assert!(nv.c_nv_graphic_frame_pr.no_resize);
    }
}
