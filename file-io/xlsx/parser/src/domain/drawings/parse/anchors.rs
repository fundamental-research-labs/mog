//! Anchor parsing for drawings.
//!
//! This module handles parsing of anchor elements (twoCellAnchor, oneCellAnchor,
//! absoluteAnchor) from drawing XML.

use super::super::helpers::{parse_edit_as, parse_i64};
use super::super::reader::attrs::{attr_value, bool_attr_or};
use super::super::reader::elements::{
    direct_child_slice, direct_child_text, document_element_slice,
};
use super::super::types::{
    AbsoluteAnchor, CellAnchor, ClientData, Extent, OneCellAnchor, Position, TwoCellAnchor,
};
use super::content::parse_drawing_content;

/// Parse a two-cell anchor element
pub fn parse_two_cell_anchor(xml: &[u8], start: usize) -> Option<TwoCellAnchor> {
    let element = document_element_slice(&xml[start..])?;

    // Parse editAs attribute
    let edit_as = attr_value(element, b"editAs=\"").and_then(parse_edit_as);

    // Parse from element
    let from = parse_cell_anchor_element(element, b"from")?;

    // Parse to element
    let to = parse_cell_anchor_element(element, b"to")?;

    // Parse content
    let content = parse_drawing_content(element);

    // Parse client data
    let client_data = parse_client_data(element);

    Some(TwoCellAnchor {
        from,
        to,
        content,
        edit_as,
        client_data,
        mc_alternate_content: None,
    })
}

/// Parse a one-cell anchor element
pub fn parse_one_cell_anchor(xml: &[u8], start: usize) -> Option<OneCellAnchor> {
    let element = document_element_slice(&xml[start..])?;

    // Parse from element
    let from = parse_cell_anchor_element(element, b"from")?;

    // Parse extent
    let extent = parse_extent_element(element)?;

    // Parse content
    let content = parse_drawing_content(element);

    // Parse client data
    let client_data = parse_client_data(element);

    Some(OneCellAnchor {
        from,
        extent,
        content,
        client_data,
        mc_alternate_content: None,
    })
}

/// Parse an absolute anchor element
pub fn parse_absolute_anchor(xml: &[u8], start: usize) -> Option<AbsoluteAnchor> {
    let element = document_element_slice(&xml[start..])?;

    // Parse pos element
    let pos = parse_position_element(element)?;

    // Parse extent
    let extent = parse_extent_element(element)?;

    // Parse content
    let content = parse_drawing_content(element);

    // Parse client data
    let client_data = parse_client_data(element);

    Some(AbsoluteAnchor {
        pos,
        extent,
        content,
        client_data,
    })
}

/// Parse a cell anchor (from/to) element
fn parse_cell_anchor_element(xml: &[u8], tag: &[u8]) -> Option<CellAnchor> {
    let element = direct_child_slice(xml, tag)?;

    let col = parse_child_element_u32(element, b"col").unwrap_or(0);
    let col_off = parse_child_element_i64(element, b"colOff").unwrap_or(0);
    let row = parse_child_element_u32(element, b"row").unwrap_or(0);
    let row_off = parse_child_element_i64(element, b"rowOff").unwrap_or(0);

    Some(CellAnchor {
        col,
        col_off,
        row,
        row_off,
    })
}

/// Parse an extent element (cx, cy)
fn parse_extent_element(xml: &[u8]) -> Option<Extent> {
    let element = direct_child_slice(xml, b"ext")?;

    let cx = attr_value(element, b"cx=\"")
        .and_then(|v| parse_i64(v))
        .unwrap_or(0);

    let cy = attr_value(element, b"cy=\"")
        .and_then(|v| parse_i64(v))
        .unwrap_or(0);

    Some(Extent { cx, cy })
}

/// Parse a position element (x, y)
fn parse_position_element(xml: &[u8]) -> Option<Position> {
    let element = direct_child_slice(xml, b"pos")?;

    let x = attr_value(element, b"x=\"")
        .and_then(|v| parse_i64(v))
        .unwrap_or(0);

    let y = attr_value(element, b"y=\"")
        .and_then(|v| parse_i64(v))
        .unwrap_or(0);

    Some(Position { x, y })
}

/// Parse a child element's text content as u32
fn parse_child_element_u32(xml: &[u8], tag: &[u8]) -> Option<u32> {
    super::super::helpers::parse_u32(direct_child_text(xml, tag)?)
}

/// Parse a child element's text content as i64
fn parse_child_element_i64(xml: &[u8], tag: &[u8]) -> Option<i64> {
    parse_i64(direct_child_text(xml, tag)?)
}

/// Parse a `<xdr:clientData>` element.
///
/// Per the OOXML spec, both `fLocksWithSheet` and `fPrintsWithSheet` default
/// to `true` when the element or attributes are absent.
fn parse_client_data(xml: &[u8]) -> ClientData {
    let mut cd = ClientData::default(); // defaults both to true

    if let Some(el) = direct_child_slice(xml, b"clientData") {
        cd.locks_with_sheet = bool_attr_or(el, b"fLocksWithSheet=\"", true);
        cd.prints_with_sheet = bool_attr_or(el, b"fPrintsWithSheet=\"", true);
    }

    cd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_cell_anchor_root_slice_handles_nested_same_local_name() {
        let xml = br#"<xdr:twoCellAnchor editAs="oneCell">
            <xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from>
            <xdr:extLst>
                <xdr:ext>
                    <xdr:twoCellAnchor>
                        <xdr:from><xdr:col>99</xdr:col><xdr:row>99</xdr:row></xdr:from>
                    </xdr:twoCellAnchor>
                </xdr:ext>
            </xdr:extLst>
            <xdr:to><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:to>
            <xdr:clientData fLocksWithSheet="0" fPrintsWithSheet="1"/>
        </xdr:twoCellAnchor>"#;

        let anchor = parse_two_cell_anchor(xml, 0).expect("two cell anchor");

        assert_eq!(anchor.from.col, 1);
        assert_eq!(anchor.from.row, 2);
        assert_eq!(anchor.to.col, 3);
        assert_eq!(anchor.to.row, 4);
        assert!(!anchor.client_data.locks_with_sheet);
        assert!(anchor.client_data.prints_with_sheet);
    }

    #[test]
    fn one_cell_anchor_root_slice_handles_nested_same_local_name() {
        let xml = br#"<xdr:oneCellAnchor>
            <xdr:from><xdr:col>5</xdr:col><xdr:row>6</xdr:row></xdr:from>
            <xdr:extLst>
                <xdr:ext>
                    <xdr:oneCellAnchor>
                        <xdr:from><xdr:col>99</xdr:col><xdr:row>99</xdr:row></xdr:from>
                    </xdr:oneCellAnchor>
                </xdr:ext>
            </xdr:extLst>
            <xdr:ext cx="700" cy="800"/>
            <xdr:clientData fLocksWithSheet="1" fPrintsWithSheet="0"/>
        </xdr:oneCellAnchor>"#;

        let anchor = parse_one_cell_anchor(xml, 0).expect("one cell anchor");

        assert_eq!(anchor.from.col, 5);
        assert_eq!(anchor.from.row, 6);
        assert_eq!(anchor.extent.cx, 700);
        assert_eq!(anchor.extent.cy, 800);
        assert!(anchor.client_data.locks_with_sheet);
        assert!(!anchor.client_data.prints_with_sheet);
    }

    #[test]
    fn absolute_anchor_root_slice_handles_nested_same_local_name() {
        let xml = br#"<xdr:absoluteAnchor>
            <xdr:pos x="10" y="20"/>
            <xdr:extLst>
                <xdr:ext>
                    <xdr:absoluteAnchor>
                        <xdr:pos x="99" y="99"/>
                    </xdr:absoluteAnchor>
                </xdr:ext>
            </xdr:extLst>
            <xdr:ext cx="30" cy="40"/>
            <xdr:clientData fLocksWithSheet="0" fPrintsWithSheet="0"/>
        </xdr:absoluteAnchor>"#;

        let anchor = parse_absolute_anchor(xml, 0).expect("absolute anchor");

        assert_eq!(anchor.pos.x, 10);
        assert_eq!(anchor.pos.y, 20);
        assert_eq!(anchor.extent.cx, 30);
        assert_eq!(anchor.extent.cy, 40);
        assert!(!anchor.client_data.locks_with_sheet);
        assert!(!anchor.client_data.prints_with_sheet);
    }
}
