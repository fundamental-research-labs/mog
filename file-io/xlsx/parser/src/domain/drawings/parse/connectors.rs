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
}
