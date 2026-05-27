//! Compatibility facade for drawing object parsers.
//!
//! The implementation lives in `drawings::parse::*`; this module keeps the
//! historical paths used by tests and sibling parser modules stable.

#![allow(unused_imports)]

#[cfg(test)]
use super::parse::connectors::parse_connector;
pub use super::parse::non_visual::parse_nv_props;
pub use super::parse::shapes::parse_shape_preset;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::scanner::find_tag_simd;
    use ooxml_types::drawings::{
        CompoundLine, LineCap, LineEndSize, LineEndType, LineJoin, StDrawingElementId,
        StStyleMatrixColumnIndex,
    };

    use super::super::types::SpreadsheetConnector;

    /// Helper: wrap XML in a `<cxnSp>...</cxnSp>` element and call `parse_connector`.
    fn connector_from_xml(inner: &str) -> SpreadsheetConnector {
        let xml = if inner.trim_start().starts_with('<') {
            format!("<cxnSp>{}</cxnSp>", inner)
        } else {
            format!("<cxnSp{}</cxnSp>", inner)
        };
        let bytes = xml.as_bytes();
        let start = find_tag_simd(bytes, b"cxnSp", 0).expect("cxnSp tag not found");
        parse_connector(bytes, start).expect("parse_connector returned None")
    }

    #[test]
    fn test_connector_with_locks() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Connector 1"/>
                <cNvCxnSpPr>
                    <a:cxnSpLocks noMove="1" noResize="1" noChangeArrowheads="1"/>
                </cNvCxnSpPr>
            </nvCxnSpPr>
            <spPr/>
            "#,
        );
        assert!(c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_move);
        assert!(c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_resize);
        assert!(c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_change_arrowheads);
        assert!(!c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_grp);
        assert!(!c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_select);
        assert!(!c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_rot);
    }

    #[test]
    fn test_connector_with_arrowheads() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Arrow"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr>
                <a:ln w="12700">
                    <a:headEnd type="triangle" w="med" len="lg"/>
                    <a:tailEnd type="stealth" w="sm" len="sm"/>
                </a:ln>
            </spPr>"#,
        );
        let outline = c.sp_pr.ln.expect("ln missing");
        let head = outline.head_end.expect("head_end missing");
        assert_eq!(head.end_type, Some(LineEndType::Triangle));
        assert_eq!(head.width, Some(LineEndSize::Medium));
        assert_eq!(head.length, Some(LineEndSize::Large));

        let tail = outline.tail_end.expect("tail_end missing");
        assert_eq!(tail.end_type, Some(LineEndType::Stealth));
        assert_eq!(tail.width, Some(LineEndSize::Small));
        assert_eq!(tail.length, Some(LineEndSize::Small));
    }

    #[test]
    fn test_connector_with_connections() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Cxn"/>
                <cNvCxnSpPr>
                    <a:stCxn id="5" idx="2"/>
                    <a:endCxn id="8" idx="0"/>
                </cNvCxnSpPr>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        let st = c.nv_cxn_sp_pr.st_cxn.expect("st_cxn missing");
        assert_eq!(st.shape_id, 5);
        assert_eq!(st.idx, 2);

        let en = c.nv_cxn_sp_pr.end_cxn.expect("end_cxn missing");
        assert_eq!(en.shape_id, 8);
        assert_eq!(en.idx, 0);
    }

    #[test]
    fn test_connector_with_cap_and_compound() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Line"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr>
                <a:ln w="25400" cap="rnd" cmpd="dbl">
                    <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
                </a:ln>
            </spPr>"#,
        );
        let outline = c.sp_pr.ln.expect("ln missing");
        assert_eq!(outline.cap, Some(LineCap::Round));
        assert_eq!(outline.compound, Some(CompoundLine::Double));
    }

    #[test]
    fn test_connector_with_miter_join() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Miter"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr>
                <a:ln w="12700">
                    <a:miter lim="800000"/>
                </a:ln>
            </spPr>"#,
        );
        let outline = c.sp_pr.ln.expect("ln missing");
        match outline.join {
            Some(LineJoin::Miter { limit }) => assert_eq!(limit, Some(800000)),
            other => panic!("Expected Miter join, got {:?}", other),
        }
    }

    #[test]
    fn test_connector_with_title_and_hyperlink() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Flow" title="Flow arrow">
                    <a:hlinkClick r:id="rId1" tooltip="Click me"/>
                </cNvPr>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        assert_eq!(c.nv_cxn_sp_pr.c_nv_pr.title.as_deref(), Some("Flow arrow"));
        let hlink = c
            .nv_cxn_sp_pr
            .c_nv_pr
            .hlink_click
            .as_ref()
            .expect("hlinkClick missing");
        assert_eq!(hlink.r_id.as_deref(), Some("rId1"));
        assert_eq!(hlink.tooltip.as_deref(), Some("Click me"));
    }

    #[test]
    fn test_connector_with_style() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Styled"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>
            <style>
                <a:lnRef idx="2">
                    <a:schemeClr val="accent1"/>
                </a:lnRef>
                <a:fillRef idx="0">
                    <a:schemeClr val="accent1"/>
                </a:fillRef>
                <a:effectRef idx="1">
                    <a:schemeClr val="accent1"/>
                </a:effectRef>
                <a:fontRef idx="0">
                    <a:schemeClr val="dk1"/>
                </a:fontRef>
            </style>"#,
        );
        let style = c.style.expect("style missing");
        assert_eq!(style.line_ref.idx, StStyleMatrixColumnIndex::new(2));
        assert_eq!(style.fill_ref.idx, StStyleMatrixColumnIndex::new(0));
    }

    #[test]
    fn test_connector_with_macro() {
        let c = connector_from_xml(
            r#" macro="ConnectorMacro"><nvCxnSpPr>
                <cNvPr id="10" name="MacroCxn"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        assert_eq!(c.macro_name.as_deref(), Some("ConnectorMacro"));
    }

    #[test]
    fn test_minimal_connector() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="1" name="Connector"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        assert_eq!(c.nv_cxn_sp_pr.c_nv_pr.id, StDrawingElementId::new(1));
        assert_eq!(c.nv_cxn_sp_pr.c_nv_pr.name, "Connector");
        assert!(c.nv_cxn_sp_pr.st_cxn.is_none());
        assert!(c.nv_cxn_sp_pr.end_cxn.is_none());
        assert!(c.style.is_none());
        assert!(c.macro_name.is_none());
        assert!(!c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.no_move);
        assert!(c.nv_cxn_sp_pr.c_nv_pr.title.is_none());
        assert!(c.nv_cxn_sp_pr.c_nv_pr.hlink_click.is_none());
        assert!(c.sp_pr.ln.is_none());
    }
}
