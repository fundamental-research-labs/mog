//! Chart-level 3D view and surface element parsing.

use crate::infra::scanner::{find_closing_tag, find_tag_simd};

use super::super::*;
use super::attrs;

/// Parse view3D element.
pub(super) fn parse_view_3d(xml: &[u8]) -> View3D {
    let mut v = View3D::default();
    if let Some(start) = find_tag_simd(xml, b"rotX", 0) {
        v.rot_x = Some(attrs::parse_i32_attr(&xml[start..], b"val=\"").unwrap_or(15) as i8);
    }
    if let Some(start) = find_tag_simd(xml, b"rotY", 0) {
        v.rot_y = Some(attrs::parse_u32_attr(&xml[start..], b"val=\"").unwrap_or(20) as u16);
    }
    if let Some(start) = find_tag_simd(xml, b"rAngAx", 0) {
        v.right_angle_axes = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"perspective", 0) {
        v.perspective = Some(attrs::parse_u32_attr(&xml[start..], b"val=\"").unwrap_or(30) as u8);
    }
    if let Some(start) = find_tag_simd(xml, b"hPercent", 0) {
        v.height_percent =
            Some(attrs::parse_u32_attr(&xml[start..], b"val=\"").unwrap_or(100) as u16);
    }
    if let Some(start) = find_tag_simd(xml, b"depthPercent", 0) {
        v.depth_percent =
            Some(attrs::parse_u32_attr(&xml[start..], b"val=\"").unwrap_or(100) as u16);
    }
    v
}

/// Parse a chart surface (floor/sideWall/backWall).
pub(super) fn parse_chart_surface(xml: &[u8]) -> ChartSurface {
    let mut surface = ChartSurface::default();
    if let Some(start) = find_tag_simd(xml, b"thickness", 0) {
        surface.thickness = attrs::parse_string_attr(&xml[start..], b"val=\"");
    }
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        surface.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }
    surface
}
