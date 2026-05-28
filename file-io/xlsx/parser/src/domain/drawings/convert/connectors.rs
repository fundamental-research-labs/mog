use super::{read, write};
use ooxml_types::drawings as ooxml;

/// Convert a read-side `SpreadsheetConnector` into a write-side `ConnectorProps`.
pub fn connector_to_props(c: &read::SpreadsheetConnector) -> write::ConnectorProps {
    write::ConnectorProps {
        original_id: Some(c.nv_cxn_sp_pr.c_nv_pr.id.value()),
        name: c.nv_cxn_sp_pr.c_nv_pr.name.clone(),
        description: c.nv_cxn_sp_pr.c_nv_pr.descr.clone(),
        title: c.nv_cxn_sp_pr.c_nv_pr.title.clone(),
        hidden: c.nv_cxn_sp_pr.c_nv_pr.hidden,
        hlink_click: c.nv_cxn_sp_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: c.nv_cxn_sp_pr.c_nv_pr.hlink_hover.clone(),
        nv_ext_lst: c.nv_cxn_sp_pr.c_nv_pr.ext_lst.clone(),

        start_connection: c.nv_cxn_sp_pr.st_cxn.clone(),
        end_connection: c.nv_cxn_sp_pr.end_cxn.clone(),

        locks: c.nv_cxn_sp_pr.c_nv_cxn_sp_pr.clone(),

        transform: c.sp_pr.xfrm.clone().unwrap_or_default(),
        preset_geometry: c.sp_pr.geometry.as_ref().and_then(|g| match g {
            ooxml::ShapeGeometry::Preset(pg) => Some(pg.clone()),
            _ => None,
        }),
        fill: c.sp_pr.fill.clone(),
        outline: c.sp_pr.ln.clone(),

        style: c.style.clone(),
        macro_name: c.macro_name.clone(),
    }
}
