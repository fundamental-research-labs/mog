//! Connector parsing for spreadsheet drawings.

use super::super::helpers::parse_u32;
use super::super::reader::attrs::{attr_value, parse_bool};
use super::super::reader::elements::{direct_child_slice, document_element_slice};
use super::super::reader::raw::extract_ext_lst_raw;
use super::super::types::{Connection, DrawingLocking, SpreadsheetConnector};
use super::non_visual::parse_nv_props;
use super::styling::{parse_shape_properties, parse_shape_style};

/// Parse a connector element.
pub fn parse_connector(xml: &[u8], start: usize) -> Option<SpreadsheetConnector> {
    let element = document_element_slice(&xml[start..])?;

    let mut connector = SpreadsheetConnector::default();

    connector.macro_name = attr_value(element, b"macro=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(ToOwned::to_owned);
    connector.f_published = attr_value(element, b"fPublished=\"").and_then(parse_bool);

    if let Some(nv_element) = direct_child_slice(element, b"nvCxnSpPr") {
        connector.nv_cxn_sp_pr.c_nv_pr = parse_nv_props(nv_element);

        if let Some(cnv_slice) = direct_child_slice(nv_element, b"cNvCxnSpPr") {
            if let Some(st_cxn) = direct_child_slice(cnv_slice, b"stCxn") {
                connector.nv_cxn_sp_pr.st_cxn = parse_connection(st_cxn);
            }
            if let Some(end_cxn) = direct_child_slice(cnv_slice, b"endCxn") {
                connector.nv_cxn_sp_pr.end_cxn = parse_connection(end_cxn);
            }
            if let Some(locks) = direct_child_slice(cnv_slice, b"cxnSpLocks") {
                connector.nv_cxn_sp_pr.c_nv_cxn_sp_pr = parse_connector_locking(locks);
            }
            connector.nv_cxn_sp_pr.c_nv_cxn_sp_pr_ext_lst = extract_ext_lst_raw(cnv_slice);
        }
    }

    if let Some(sp_pr) = direct_child_slice(element, b"spPr") {
        connector.sp_pr = parse_shape_properties(sp_pr);
    }

    if let Some(style) = direct_child_slice(element, b"style") {
        connector.style = parse_shape_style(style);
    }

    Some(connector)
}

fn parse_connector_locking(xml: &[u8]) -> DrawingLocking {
    let parse_bool_attr =
        |attr: &[u8]| -> bool { attr_value(xml, attr).and_then(parse_bool).unwrap_or(false) };

    DrawingLocking {
        no_grp: parse_bool_attr(b"noGrp=\""),
        no_select: parse_bool_attr(b"noSelect=\""),
        no_rot: parse_bool_attr(b"noRot=\""),
        no_change_aspect: parse_bool_attr(b"noChangeAspect=\""),
        no_move: parse_bool_attr(b"noMove=\""),
        no_resize: parse_bool_attr(b"noResize=\""),
        no_edit_points: parse_bool_attr(b"noEditPoints=\""),
        no_adjust_handles: parse_bool_attr(b"noAdjustHandles=\""),
        no_change_arrowheads: parse_bool_attr(b"noChangeArrowheads=\""),
        no_change_shape_type: parse_bool_attr(b"noChangeShapeType=\""),
        ext_lst: extract_ext_lst_raw(xml),
        ..Default::default()
    }
}

fn parse_connection(xml: &[u8]) -> Option<Connection> {
    let shape_id = attr_value(xml, b"id=\"").and_then(parse_u32)?;

    let idx = attr_value(xml, b"idx=\"").and_then(parse_u32).unwrap_or(0);

    Some(Connection { shape_id, idx })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::drawings::{
        CompoundLine, LineCap, LineEndSize, LineEndType, LineJoin, ShapePreset, StDrawingElementId,
        StStyleMatrixColumnIndex,
    };

    use super::super::super::types::SpreadsheetConnector;

    fn connector_from_xml(inner: &str) -> SpreadsheetConnector {
        let xml = if inner.trim_start().starts_with('<') {
            format!("<cxnSp>{}</cxnSp>", inner)
        } else {
            format!("<cxnSp{}</cxnSp>", inner)
        };
        parse_connector(xml.as_bytes(), 0).expect("parse_connector returned None")
    }

    #[test]
    fn connector_with_locks() {
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
    fn connector_with_arrowheads() {
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
    fn connector_with_connections() {
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
    fn missing_connection_idx_defaults_to_zero() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Cxn"/>
                <cNvCxnSpPr><a:stCxn id="5"/></cNvCxnSpPr>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        let st = c.nv_cxn_sp_pr.st_cxn.expect("st_cxn missing");
        assert_eq!(st.shape_id, 5);
        assert_eq!(st.idx, 0);
    }

    #[test]
    fn missing_connection_id_returns_none() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Cxn"/>
                <cNvCxnSpPr><a:stCxn idx="2"/></cNvCxnSpPr>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        assert!(c.nv_cxn_sp_pr.st_cxn.is_none());
    }

    #[test]
    fn connector_with_cap_and_compound() {
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
    fn connector_with_miter_join() {
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
    fn connector_with_title_and_hyperlink() {
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
    fn connector_with_style() {
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
    fn connector_with_macro() {
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
    fn connector_preserves_empty_macro_and_f_published() {
        let c = connector_from_xml(
            r#" macro="" fPublished="1"><nvCxnSpPr>
                <cNvPr id="10" name="MacroCxn"/>
                <cNvCxnSpPr/>
            </nvCxnSpPr>
            <spPr/>"#,
        );
        assert_eq!(c.macro_name.as_deref(), Some(""));
        assert_eq!(c.f_published, Some(true));
    }

    #[test]
    fn minimal_connector() {
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

    #[test]
    fn connector_reads_connections_from_cnv_connector_props() {
        let xml = br#"<xdr:cxnSp><xdr:nvCxnSpPr><xdr:cNvPr id="1" name="Connector"/><xdr:cNvCxnSpPr><a:stCxn id="3" idx="1"/><a:endCxn id="4" idx="2"/></xdr:cNvCxnSpPr></xdr:nvCxnSpPr><xdr:spPr/></xdr:cxnSp>"#;
        let connector = parse_connector(xml, 0).unwrap();

        assert_eq!(connector.nv_cxn_sp_pr.st_cxn.unwrap().shape_id, 3);
        assert_eq!(connector.nv_cxn_sp_pr.end_cxn.unwrap().idx, 2);
    }

    #[test]
    fn connector_does_not_read_sibling_shape_properties() {
        let xml = br#"<xdr:cxnSp><xdr:nvCxnSpPr><xdr:cNvPr id="1" name="Connector"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr></xdr:cxnSp><xdr:spPr><a:prstGeom prst="line"/></xdr:spPr>"#;
        let connector = parse_connector(xml, 0).unwrap();

        assert!(connector.sp_pr.geometry.is_none());
    }

    #[test]
    fn connector_reads_scoped_shape_properties() {
        let xml = br#"<xdr:cxnSp><xdr:nvCxnSpPr><xdr:cNvPr id="1" name="Connector"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr><a:prstGeom prst="line"/></xdr:spPr></xdr:cxnSp>"#;
        let connector = parse_connector(xml, 0).unwrap();

        assert_eq!(
            connector
                .sp_pr
                .geometry
                .as_ref()
                .and_then(|geometry| match geometry {
                    ooxml_types::drawings::ShapeGeometry::Preset(preset) => Some(preset.prst),
                    _ => None,
                }),
            Some(ShapePreset::Line)
        );
    }

    #[test]
    fn connector_preserves_cnv_connector_and_lock_ext_lists() {
        let c = connector_from_xml(
            r#"<nvCxnSpPr>
                <cNvPr id="10" name="Connector"/>
                <cNvCxnSpPr>
                    <a:cxnSpLocks noMove="1">
                        <a:extLst><a:ext uri="locks"/></a:extLst>
                    </a:cxnSpLocks>
                    <a:extLst><a:ext uri="connector"/></a:extLst>
                </cNvCxnSpPr>
            </nvCxnSpPr>
            <spPr/>"#,
        );

        assert!(
            c.nv_cxn_sp_pr
                .c_nv_cxn_sp_pr
                .ext_lst
                .as_deref()
                .is_some_and(|xml| xml.contains("locks"))
        );
        assert!(
            c.nv_cxn_sp_pr
                .c_nv_cxn_sp_pr_ext_lst
                .as_deref()
                .is_some_and(|xml| xml.contains("connector"))
        );
    }
}
