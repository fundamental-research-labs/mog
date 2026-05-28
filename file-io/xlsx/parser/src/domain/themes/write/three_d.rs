use super::color;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::drawings::{Backdrop, Bevel, Scene3D, Shape3D};

// ========================================================================
// 3D serializers
// ========================================================================

/// Write a Scene3D element (CT_Scene3D).
pub(super) fn write_scene_3d(xml: &mut XmlWriter, scene: &Scene3D) {
    xml.start_element_ns("a", "scene3d").end_attrs();

    // Camera
    {
        let cam = &scene.camera;
        let elem = xml.start_element_ns("a", "camera");
        elem.attr("prst", cam.prst.to_ooxml());
        if let Some(fov) = cam.fov {
            elem.attr("fov", &fov.value().to_string());
        }
        if let Some(zoom) = cam.zoom {
            elem.attr("zoom", &zoom.to_string());
        }
        if let Some(rot) = &cam.rot {
            elem.end_attrs();
            xml.start_element_ns("a", "rot")
                .attr("lat", &rot.lat.value().to_string())
                .attr("lon", &rot.lon.value().to_string())
                .attr("rev", &rot.rev.value().to_string())
                .self_close();
            xml.end_element_ns("a", "camera");
        } else {
            elem.self_close();
        }
    }

    // Light rig
    {
        let rig = &scene.light_rig;
        let elem = xml.start_element_ns("a", "lightRig");
        elem.attr("rig", rig.rig.to_ooxml());
        elem.attr("dir", rig.dir.to_ooxml());
        if let Some(rot) = &rig.rot {
            elem.end_attrs();
            xml.start_element_ns("a", "rot")
                .attr("lat", &rot.lat.value().to_string())
                .attr("lon", &rot.lon.value().to_string())
                .attr("rev", &rot.rev.value().to_string())
                .self_close();
            xml.end_element_ns("a", "lightRig");
        } else {
            elem.self_close();
        }
    }

    // Optional backdrop
    if let Some(backdrop) = &scene.backdrop {
        write_backdrop(xml, backdrop);
    }

    xml.end_element_ns("a", "scene3d");
}

/// Write a backdrop (CT_Backdrop).
pub(super) fn write_backdrop(xml: &mut XmlWriter, backdrop: &Backdrop) {
    xml.start_element_ns("a", "backdrop").end_attrs();

    // Anchor point
    xml.start_element_ns("a", "anchor")
        .attr("x", &backdrop.anchor.x.value().to_string())
        .attr("y", &backdrop.anchor.y.value().to_string())
        .attr("z", &backdrop.anchor.z.value().to_string())
        .self_close();

    // Normal vector
    xml.start_element_ns("a", "norm")
        .attr("dx", &backdrop.norm.x.value().to_string())
        .attr("dy", &backdrop.norm.y.value().to_string())
        .attr("dz", &backdrop.norm.z.value().to_string())
        .self_close();

    // Up vector
    xml.start_element_ns("a", "up")
        .attr("dx", &backdrop.up.x.value().to_string())
        .attr("dy", &backdrop.up.y.value().to_string())
        .attr("dz", &backdrop.up.z.value().to_string())
        .self_close();

    xml.end_element_ns("a", "backdrop");
}

/// Write Shape3D properties (CT_Shape3D).
pub(super) fn write_shape_3d(xml: &mut XmlWriter, sp3d: &Shape3D) {
    let elem = xml.start_element_ns("a", "sp3d");
    if let Some(eh) = sp3d.extrusion_h {
        elem.attr("extrusionH", &eh.value().to_string());
    }
    if let Some(cw) = sp3d.contour_w {
        elem.attr("contourW", &cw.value().to_string());
    }
    if let Some(mat) = &sp3d.prst_material {
        elem.attr("prstMaterial", mat.to_ooxml());
    }
    if let Some(z) = sp3d.z {
        elem.attr("z", &z.value().to_string());
    }

    let has_children = sp3d.bevel_t.is_some()
        || sp3d.bevel_b.is_some()
        || sp3d.extrusion_clr.is_some()
        || sp3d.contour_clr.is_some();

    if !has_children {
        elem.self_close();
        return;
    }

    elem.end_attrs();

    // Top bevel
    if let Some(bevel) = &sp3d.bevel_t {
        write_bevel(xml, "bevelT", bevel);
    }

    // Bottom bevel
    if let Some(bevel) = &sp3d.bevel_b {
        write_bevel(xml, "bevelB", bevel);
    }

    // Extrusion color
    if let Some(color) = &sp3d.extrusion_clr {
        xml.start_element_ns("a", "extrusionClr").end_attrs();
        color::write_drawing_color(xml, color);
        xml.end_element_ns("a", "extrusionClr");
    }

    // Contour color
    if let Some(color) = &sp3d.contour_clr {
        xml.start_element_ns("a", "contourClr").end_attrs();
        color::write_drawing_color(xml, color);
        xml.end_element_ns("a", "contourClr");
    }

    xml.end_element_ns("a", "sp3d");
}

/// Write a bevel element (CT_Bevel).
pub(super) fn write_bevel(xml: &mut XmlWriter, tag: &str, bevel: &Bevel) {
    let elem = xml.start_element_ns("a", tag);
    if let Some(w) = bevel.w {
        elem.attr("w", &w.value().to_string());
    }
    if let Some(h) = bevel.h {
        elem.attr("h", &h.value().to_string());
    }
    if let Some(prst) = &bevel.prst {
        elem.attr("prst", prst.to_ooxml());
    }
    elem.self_close();
}
