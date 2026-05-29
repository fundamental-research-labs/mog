//! Styling and visual property writers for DrawingML XML.
//!
//! Handles fills (solid, gradient, pattern, blip), outlines, effects
//! (shadows, glow, reflection, blur), hyperlinks, style references,
//! and 3D scene/shape properties.

use crate::write::xml_writer::XmlWriter;

use ooxml_types::drawings::{FontReference, LineDash, LineFill, LineJoin};

use super::super::types::{
    Bevel, BlipEffect, DrawingColor, DrawingFill, EffectList, EffectProperties, GeomGuide, Outline,
    Scene3D, Shape3D, ShapeStyle, StyleRef,
};

use super::DrawingWriter;

impl DrawingWriter {
    /// Write a drawing color element with optional transform children
    pub(super) fn write_drawing_color(&self, w: &mut XmlWriter, color: &DrawingColor) {
        write_drawing_color_ref(w, color);
    }

    /// Write a shape style reference (`<xdr:style>`) using the ooxml_types ShapeStyle.
    pub fn write_shape_style(&self, w: &mut XmlWriter, style: &ShapeStyle) {
        w.start_element("xdr:style").end_attrs();
        {
            self.write_ooxml_style_ref(w, "a:lnRef", &style.line_ref);
            self.write_ooxml_style_ref(w, "a:fillRef", &style.fill_ref);
            self.write_ooxml_style_ref(w, "a:effectRef", &style.effect_ref);
            self.write_ooxml_font_ref(w, &style.font_ref);
        }
        w.end_element("xdr:style");
    }

    /// Write a single ooxml style reference element for shape styles
    pub(super) fn write_ooxml_style_ref(&self, w: &mut XmlWriter, tag: &str, style_ref: &StyleRef) {
        w.start_element(tag).attr_num("idx", style_ref.idx.value());
        if let Some(color) = &style_ref.color {
            w.end_attrs();
            self.write_drawing_color(w, color);
            w.end_element(tag);
        } else {
            w.self_close();
        }
    }

    /// Write a font reference element (`<a:fontRef>`)
    pub(super) fn write_ooxml_font_ref(&self, w: &mut XmlWriter, font_ref: &FontReference) {
        w.start_element("a:fontRef")
            .attr("idx", font_ref.idx.to_ooxml());
        if let Some(color) = &font_ref.color {
            w.end_attrs();
            self.write_drawing_color(w, color);
            w.end_element("a:fontRef");
        } else {
            w.self_close();
        }
    }

    /// Write a hyperlink element (`<a:hlinkClick>` or `<a:hlinkHover>`)
    pub(super) fn write_hyperlink(
        &self,
        w: &mut XmlWriter,
        tag: &str,
        hlink: &ooxml_types::drawings::Hyperlink,
    ) {
        w.start_element(tag);
        if let Some(ref r_id) = hlink.r_id {
            if self.can_write_relationship_id(r_id) {
                w.attr("r:id", r_id);
            }
        }
        if let Some(ref action) = hlink.action {
            w.attr("action", action);
        }
        if let Some(ref tooltip) = hlink.tooltip {
            w.attr("tooltip", tooltip);
        }
        if let Some(ref tgt_frame) = hlink.tgt_frame {
            w.attr("tgtFrame", tgt_frame);
        }
        if let Some(ref invalid_url) = hlink.invalid_url {
            w.attr("invalidUrl", invalid_url);
        }
        // history defaults to true; only emit "0" when explicitly false
        if let Some(false) = hlink.history {
            w.attr("history", "0");
        }
        if let Some(true) = hlink.highlight_click {
            w.attr("highlightClick", "1");
        }
        if let Some(true) = hlink.end_snd {
            w.attr("endSnd", "1");
        }
        if let Some(ref ext) = hlink.ext_lst {
            w.end_attrs();
            self.write_raw_xml(w, ext);
            w.end_element(tag);
        } else {
            w.self_close();
        }
    }

    /// Write a line end element (`<a:headEnd>` or `<a:tailEnd>`)
    pub(super) fn write_line_end(
        &self,
        w: &mut XmlWriter,
        tag: &str,
        end_props: &ooxml_types::drawings::LineEndProperties,
    ) {
        w.start_element(tag);
        if let Some(ref end_type) = end_props.end_type {
            w.attr("type", end_type.to_ooxml());
        }
        if let Some(ref width) = end_props.width {
            w.attr("w", width.to_ooxml());
        }
        if let Some(ref length) = end_props.length {
            w.attr("len", length.to_ooxml());
        }
        w.self_close();
    }

    /// Write blip-level image effects (children of `<a:blip>`)
    pub(super) fn write_blip_effects(&self, w: &mut XmlWriter, effects: &[BlipEffect]) {
        for effect in effects {
            match effect {
                BlipEffect::AlphaModFix { amt } => {
                    w.start_element("a:alphaModFix")
                        .attr_num("amt", *amt)
                        .self_close();
                }
                BlipEffect::Luminance { bright, contrast } => {
                    w.start_element("a:lum");
                    if *bright != 0 {
                        w.attr_num("bright", *bright);
                    }
                    if *contrast != 0 {
                        w.attr_num("contrast", *contrast);
                    }
                    w.self_close();
                }
                BlipEffect::Grayscale => {
                    w.start_element("a:grayscl").self_close();
                }
                BlipEffect::BiLevel { thresh } => {
                    w.start_element("a:biLevel")
                        .attr_num("thresh", *thresh)
                        .self_close();
                }
                BlipEffect::AlphaBiLevel { thresh } => {
                    w.start_element("a:alphaBiLevel")
                        .attr_num("thresh", *thresh)
                        .self_close();
                }
                BlipEffect::AlphaCeiling => {
                    w.start_element("a:alphaCeiling").self_close();
                }
                BlipEffect::AlphaFloor => {
                    w.start_element("a:alphaFloor").self_close();
                }
                BlipEffect::AlphaInverse { color } => {
                    if let Some(c) = color {
                        w.start_element("a:alphaInv").end_attrs();
                        self.write_drawing_color(w, c);
                        w.end_element("a:alphaInv");
                    } else {
                        w.start_element("a:alphaInv").self_close();
                    }
                }
                BlipEffect::AlphaModulate => {
                    w.start_element("a:alphaMod").self_close();
                }
                BlipEffect::AlphaReplace { alpha } => {
                    w.start_element("a:alphaRepl")
                        .attr_num("a", *alpha)
                        .self_close();
                }
                BlipEffect::Blur(blur) => {
                    w.start_element("a:blur")
                        .attr_num("rad", blur.rad)
                        .attr("grow", if blur.grow { "1" } else { "0" })
                        .self_close();
                }
                BlipEffect::ColorChange { use_alpha, raw_xml } => {
                    w.start_element("a:clrChange");
                    if *use_alpha {
                        w.attr("useA", "1");
                    }
                    if let Some(xml) = raw_xml {
                        w.end_attrs();
                        self.write_raw_xml(w, xml);
                        w.end_element("a:clrChange");
                    } else {
                        w.self_close();
                    }
                }
                BlipEffect::ColorReplace { color } => {
                    if let Some(c) = color {
                        w.start_element("a:clrRepl").end_attrs();
                        self.write_drawing_color(w, c);
                        w.end_element("a:clrRepl");
                    } else {
                        w.start_element("a:clrRepl").self_close();
                    }
                }
                BlipEffect::Duotone { color1, color2 } => {
                    w.start_element("a:duotone").end_attrs();
                    if let Some(c1) = color1 {
                        self.write_drawing_color(w, c1);
                    }
                    if let Some(c2) = color2 {
                        self.write_drawing_color(w, c2);
                    }
                    w.end_element("a:duotone");
                }
                BlipEffect::FillOverlay(fo) => {
                    w.start_element("a:fillOverlay")
                        .attr("blend", fo.blend.to_ooxml())
                        .self_close();
                }
                BlipEffect::Hsl { hue, sat, lum } => {
                    w.start_element("a:hsl")
                        .attr_num("hue", *hue)
                        .attr_num("sat", *sat)
                        .attr_num("lum", *lum)
                        .self_close();
                }
                BlipEffect::Tint { hue, amt } => {
                    w.start_element("a:tint")
                        .attr_num("hue", *hue)
                        .attr_num("amt", *amt)
                        .self_close();
                }
            }
        }
    }

    /// Write effect properties (effectLst or effectDag).
    pub(super) fn write_effect_properties(&self, w: &mut XmlWriter, ep: &EffectProperties) {
        match ep {
            EffectProperties::EffectList(effects) => self.write_effect_list(w, effects),
            EffectProperties::EffectDag(container) => {
                let mut el = w.start_element("a:effectDag");
                if let Some(ref ct) = container.container_type {
                    el = el.attr("type", ct.to_ooxml());
                }
                if let Some(ref name) = container.name {
                    el = el.attr("name", name);
                }
                el.end_attrs();
                // Write the inner DAG effects — extract the EffectList-compatible
                // subset from the DagEffect vec for now (effectDag can contain
                // the same effects as effectLst plus DAG-only effects).
                let effect_list = dag_effects_to_effect_list(&container.effects);
                self.write_effect_list_children(w, &effect_list);
                w.end_element("a:effectDag");
            }
        }
    }

    /// Write shape-level effect list (`<a:effectLst>`)
    pub(super) fn write_effect_list(&self, w: &mut XmlWriter, effects: &EffectList) {
        w.start_element("a:effectLst").end_attrs();
        self.write_effect_list_children(w, effects);
        w.end_element("a:effectLst");
    }

    /// Write the children of an effect list (shared between effectLst and effectDag).
    pub(super) fn write_effect_list_children(&self, w: &mut XmlWriter, effects: &EffectList) {
        // Blur
        if let Some(ref blur) = effects.blur {
            w.start_element("a:blur")
                .attr_num("rad", blur.rad)
                .attr("grow", if blur.grow { "1" } else { "0" })
                .self_close();
        }

        // Fill overlay
        if let Some(ref fo) = effects.fill_overlay {
            if let Some(ref fill) = fo.fill {
                w.start_element("a:fillOverlay")
                    .attr("blend", fo.blend.to_ooxml())
                    .end_attrs();
                self.write_ooxml_fill(w, fill);
                w.end_element("a:fillOverlay");
            } else {
                w.start_element("a:fillOverlay")
                    .attr("blend", fo.blend.to_ooxml())
                    .self_close();
            }
        }

        // Glow
        if let Some(ref glow) = effects.glow {
            w.start_element("a:glow").attr_num("rad", glow.rad);
            if let Some(ref color) = glow.color {
                w.end_attrs();
                self.write_drawing_color(w, color);
                w.end_element("a:glow");
            } else {
                w.self_close();
            }
        }

        // Inner shadow
        if let Some(ref is) = effects.inner_shadow {
            w.start_element("a:innerShdw")
                .attr_num("blurRad", is.blur_rad)
                .attr_num("dist", is.dist)
                .attr_num("dir", is.dir);
            if let Some(ref color) = is.color {
                w.end_attrs();
                self.write_drawing_color(w, color);
                w.end_element("a:innerShdw");
            } else {
                w.self_close();
            }
        }

        // Outer shadow
        if let Some(ref os) = effects.outer_shadow {
            w.start_element("a:outerShdw")
                .attr_num("blurRad", os.blur_rad)
                .attr_num("dist", os.dist)
                .attr_num("dir", os.dir);
            if os.sx.value() != 0 {
                w.attr_num("sx", os.sx);
            }
            if os.sy.value() != 0 {
                w.attr_num("sy", os.sy);
            }
            if os.kx.value() != 0 {
                w.attr_num("kx", os.kx);
            }
            if os.ky.value() != 0 {
                w.attr_num("ky", os.ky);
            }
            if let Some(ref align) = os.align {
                w.attr("algn", align.to_ooxml());
            }
            w.attr("rotWithShape", if os.rot_with_shape { "1" } else { "0" });
            if let Some(ref color) = os.color {
                w.end_attrs();
                self.write_drawing_color(w, color);
                w.end_element("a:outerShdw");
            } else {
                w.self_close();
            }
        }

        // Preset shadow
        if let Some(ref ps) = effects.preset_shadow {
            w.start_element("a:prstShdw")
                .attr("prst", ps.preset.to_ooxml())
                .attr_num("dist", ps.dist)
                .attr_num("dir", ps.dir);
            if let Some(ref color) = ps.color {
                w.end_attrs();
                self.write_drawing_color(w, color);
                w.end_element("a:prstShdw");
            } else {
                w.self_close();
            }
        }

        // Reflection
        if let Some(ref refl) = effects.reflection {
            w.start_element("a:reflection")
                .attr_num("blurRad", refl.blur_rad)
                .attr_num("stA", refl.start_alpha)
                .attr_num("stPos", refl.start_pos)
                .attr_num("endA", refl.end_alpha)
                .attr_num("endPos", refl.end_pos)
                .attr_num("dist", refl.dist)
                .attr_num("dir", refl.dir)
                .attr_num("fadeDir", refl.fade_dir);
            if refl.sx.value() != 0 {
                w.attr_num("sx", refl.sx);
            }
            if refl.sy.value() != 0 {
                w.attr_num("sy", refl.sy);
            }
            if refl.kx.value() != 0 {
                w.attr_num("kx", refl.kx);
            }
            if refl.ky.value() != 0 {
                w.attr_num("ky", refl.ky);
            }
            if let Some(ref align) = refl.align {
                w.attr("algn", align.to_ooxml());
            }
            w.attr("rotWithShape", if refl.rot_with_shape { "1" } else { "0" });
            w.self_close();
        }

        // Soft edge
        if let Some(ref se) = effects.soft_edge {
            w.start_element("a:softEdge")
                .attr_num("rad", se.rad)
                .self_close();
        }
    }

    /// Write `<a:avLst>` with optional `<a:gd>` children.
    /// Emits a self-closing `<a:avLst/>` when the list is empty.
    pub(super) fn write_av_list(w: &mut XmlWriter, av_list: &[GeomGuide]) {
        if av_list.is_empty() {
            w.start_element("a:avLst").self_close();
        } else {
            w.start_element("a:avLst").end_attrs();
            for gd in av_list {
                w.start_element("a:gd")
                    .attr("name", &gd.name)
                    .attr("fmla", &gd.fmla)
                    .self_close();
            }
            w.end_element("a:avLst");
        }
    }

    /// Write an OOXML `DrawingFill` (the shared type from ooxml_types)
    pub(super) fn write_ooxml_fill(&self, w: &mut XmlWriter, fill: &DrawingFill) {
        match fill {
            DrawingFill::NoFill => {
                w.start_element("a:noFill").self_close();
            }
            DrawingFill::Solid(solid) => {
                w.start_element("a:solidFill").end_attrs();
                self.write_drawing_color(w, &solid.color);
                w.end_element("a:solidFill");
            }
            DrawingFill::Gradient(grad) => {
                w.start_element("a:gradFill").end_attrs();
                {
                    w.start_element("a:gsLst").end_attrs();
                    for stop in &grad.stops {
                        w.start_element("a:gs")
                            .attr_num("pos", stop.position)
                            .end_attrs();
                        self.write_drawing_color(w, &stop.color);
                        w.end_element("a:gs");
                    }
                    w.end_element("a:gsLst");

                    // Linear gradient with angle
                    if let Some(ang) = grad.lin_ang {
                        w.start_element("a:lin")
                            .attr_num("ang", ang.value())
                            .attr_bool("scaled", true)
                            .self_close();
                    }
                }
                w.end_element("a:gradFill");
            }
            DrawingFill::Pattern(patt) => {
                w.start_element("a:pattFill");
                if let Some(ref preset) = patt.preset {
                    w.attr("prst", preset.to_ooxml());
                }
                w.end_attrs();
                {
                    if let Some(ref fg) = patt.fg_color {
                        w.start_element("a:fgClr").end_attrs();
                        self.write_drawing_color(w, fg);
                        w.end_element("a:fgClr");
                    }
                    if let Some(ref bg) = patt.bg_color {
                        w.start_element("a:bgClr").end_attrs();
                        self.write_drawing_color(w, bg);
                        w.end_element("a:bgClr");
                    }
                }
                w.end_element("a:pattFill");
            }
            DrawingFill::Blip(blip) => {
                w.start_element("a:blipFill").end_attrs();
                if !self.suppress_unregistered_relationships
                    || (blip.embed_id.is_none() && blip.link_id.is_none())
                {
                    w.start_element("a:blip");
                    if !self.suppress_unregistered_relationships {
                        if let Some(ref embed) = blip.embed_id {
                            w.attr("r:embed", embed);
                        }
                        if let Some(ref link) = blip.link_id {
                            w.attr("r:link", link);
                        }
                    }
                    if let Some(ref comp) = blip.compression {
                        w.attr("cstate", comp.to_ooxml());
                    }
                    if let Some(ref ext) = blip.ext_lst {
                        w.end_attrs();
                        self.write_raw_xml(w, ext);
                        w.end_element("a:blip");
                    } else {
                        w.self_close();
                    }

                    // Default stretch
                    w.start_element("a:stretch").end_attrs();
                    w.start_element("a:fillRect").self_close();
                    w.end_element("a:stretch");
                }
                w.end_element("a:blipFill");
            }
            DrawingFill::Group => {
                w.start_element("a:grpFill").self_close();
            }
        }
    }

    /// Write an OOXML `Outline` (the shared type from ooxml_types) as `<a:ln>`
    pub(super) fn write_ooxml_outline(&self, w: &mut XmlWriter, outline: &Outline) {
        w.start_element("a:ln");
        if let Some(width) = outline.width {
            w.attr_num("w", width);
        }
        if let Some(ref cap) = outline.cap {
            w.attr("cap", cap.to_ooxml());
        }
        if let Some(ref compound) = outline.compound {
            w.attr("cmpd", compound.to_ooxml());
        }
        if let Some(ref align) = outline.align {
            w.attr("algn", align.to_ooxml());
        }
        w.end_attrs();
        {
            // Line fill
            if let Some(ref fill) = outline.fill {
                match fill {
                    LineFill::Solid(sf) => {
                        w.start_element("a:solidFill").end_attrs();
                        self.write_drawing_color(w, &sf.color);
                        w.end_element("a:solidFill");
                    }
                    LineFill::NoFill => {
                        w.start_element("a:noFill").self_close();
                    }
                    LineFill::Gradient(_gf) => {
                        // TODO: write gradient line fill
                    }
                    LineFill::Pattern(_pf) => {
                        // TODO: write pattern line fill
                    }
                }
            }

            // Dash style
            if let Some(ref dash) = outline.dash {
                match dash {
                    LineDash::Preset(ds) => {
                        w.start_element("a:prstDash")
                            .attr("val", ds.to_ooxml())
                            .self_close();
                    }
                    LineDash::Custom(stops) => {
                        w.start_element("a:custDash").end_attrs();
                        for stop in stops {
                            w.start_element("a:ds")
                                .attr_num("d", stop.d)
                                .attr_num("sp", stop.sp)
                                .self_close();
                        }
                        w.end_element("a:custDash");
                    }
                }
            }

            // Line join
            if let Some(ref join) = outline.join {
                match join {
                    LineJoin::Round => {
                        w.start_element("a:round").self_close();
                    }
                    LineJoin::Bevel => {
                        w.start_element("a:bevel").self_close();
                    }
                    LineJoin::Miter { limit } => {
                        w.start_element("a:miter");
                        if let Some(lim) = limit {
                            w.attr_num("lim", *lim);
                        }
                        w.self_close();
                    }
                }
            }

            // Head end
            if let Some(ref head) = outline.head_end {
                self.write_line_end(w, "a:headEnd", head);
            }

            // Tail end
            if let Some(ref tail) = outline.tail_end {
                self.write_line_end(w, "a:tailEnd", tail);
            }
        }
        w.end_element("a:ln");
    }
}

// =============================================================================
// Free helper functions
// =============================================================================

/// Write a typed `Scene3D` as `<a:scene3d>`.
pub(crate) fn write_scene3d(w: &mut XmlWriter, scene: &Scene3D) {
    w.start_element("a:scene3d").end_attrs();
    {
        // Camera
        w.start_element("a:camera")
            .attr("prst", scene.camera.prst.to_ooxml());
        if let Some(fov) = scene.camera.fov {
            w.attr_num("fov", fov);
        }
        if let Some(ref rot) = scene.camera.rot {
            w.end_attrs();
            w.start_element("a:rot")
                .attr_num("lat", rot.lat)
                .attr_num("lon", rot.lon)
                .attr_num("rev", rot.rev)
                .self_close();
            w.end_element("a:camera");
        } else {
            w.self_close();
        }

        // Light rig
        w.start_element("a:lightRig")
            .attr("rig", scene.light_rig.rig.to_ooxml())
            .attr("dir", scene.light_rig.dir.to_ooxml());
        if let Some(ref rot) = scene.light_rig.rot {
            w.end_attrs();
            w.start_element("a:rot")
                .attr_num("lat", rot.lat)
                .attr_num("lon", rot.lon)
                .attr_num("rev", rot.rev)
                .self_close();
            w.end_element("a:lightRig");
        } else {
            w.self_close();
        }

        // Backdrop
        if let Some(ref backdrop) = scene.backdrop {
            w.start_element("a:backdrop").end_attrs();
            w.start_element("a:anchor")
                .attr_num("x", backdrop.anchor.x)
                .attr_num("y", backdrop.anchor.y)
                .attr_num("z", backdrop.anchor.z)
                .self_close();
            w.start_element("a:norm")
                .attr_num("x", backdrop.norm.x)
                .attr_num("y", backdrop.norm.y)
                .attr_num("z", backdrop.norm.z)
                .self_close();
            w.start_element("a:up")
                .attr_num("x", backdrop.up.x)
                .attr_num("y", backdrop.up.y)
                .attr_num("z", backdrop.up.z)
                .self_close();
            if let Some(ref ext) = backdrop.ext_lst {
                DrawingWriter::write_raw_xml_if_relationship_safe(w, ext);
            }
            w.end_element("a:backdrop");
        }

        // Scene3D extLst
        if let Some(ref ext) = scene.ext_lst {
            DrawingWriter::write_raw_xml_if_relationship_safe(w, ext);
        }
    }
    w.end_element("a:scene3d");
}

/// Write a typed `Shape3D` as `<a:sp3d>`.
pub(crate) fn write_shape3d(w: &mut XmlWriter, sp3d: &Shape3D) {
    w.start_element("a:sp3d");
    if let Some(ref material) = sp3d.prst_material {
        w.attr("prstMaterial", material.to_ooxml());
    }
    if let Some(z) = sp3d.z {
        w.attr_num("z", z);
    }
    if let Some(h) = sp3d.extrusion_h {
        w.attr_num("extrusionH", h);
    }
    if let Some(cw) = sp3d.contour_w {
        w.attr_num("contourW", cw);
    }
    w.end_attrs();
    {
        // bevelT child
        if let Some(ref bevel) = sp3d.bevel_t {
            write_bevel(w, "a:bevelT", bevel);
        }
        // bevelB child
        if let Some(ref bevel) = sp3d.bevel_b {
            write_bevel(w, "a:bevelB", bevel);
        }
        // extrusionClr child
        if let Some(ref clr) = sp3d.extrusion_clr {
            w.start_element("a:extrusionClr").end_attrs();
            write_drawing_color_ref(w, clr);
            w.end_element("a:extrusionClr");
        }
        // contourClr child
        if let Some(ref clr) = sp3d.contour_clr {
            w.start_element("a:contourClr").end_attrs();
            write_drawing_color_ref(w, clr);
            w.end_element("a:contourClr");
        }

        // Shape3D extLst
        if let Some(ref ext) = sp3d.ext_lst {
            DrawingWriter::write_raw_xml_if_relationship_safe(w, ext);
        }
    }
    w.end_element("a:sp3d");
}

/// Write a `<a:bevelT>` or `<a:bevelB>` element.
pub(crate) fn write_bevel(w: &mut XmlWriter, tag: &str, bevel: &Bevel) {
    w.start_element(tag);
    if let Some(width) = bevel.w {
        w.attr_num("w", width);
    }
    if let Some(height) = bevel.h {
        w.attr_num("h", height);
    }
    if let Some(ref prst) = bevel.prst {
        w.attr("prst", prst.to_ooxml());
    }
    w.self_close();
}

/// Write a DrawingColor element (`<a:schemeClr>`, `<a:srgbClr>`, etc.) with transforms.
pub(crate) fn write_drawing_color_ref(w: &mut XmlWriter, clr: &DrawingColor) {
    match clr {
        DrawingColor::SrgbClr { val, transforms } => {
            let elem = w.start_element("a:srgbClr").attr("val", val);
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_transforms(w, transforms);
                w.end_element("a:srgbClr");
            }
        }
        DrawingColor::SchemeClr { val, transforms } => {
            let elem = w.start_element("a:schemeClr").attr("val", val.to_ooxml());
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_transforms(w, transforms);
                w.end_element("a:schemeClr");
            }
        }
        DrawingColor::HslClr {
            hue,
            sat,
            lum,
            transforms,
        } => {
            let elem = w
                .start_element("a:hslClr")
                .attr_num("hue", *hue)
                .attr_num("sat", *sat)
                .attr_num("lum", *lum);
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_transforms(w, transforms);
                w.end_element("a:hslClr");
            }
        }
        DrawingColor::SysClr {
            val,
            last_clr,
            transforms,
        } => {
            let mut elem = w.start_element("a:sysClr");
            elem = elem.attr("val", val.to_ooxml());
            if let Some(lc) = last_clr {
                elem = elem.attr("lastClr", lc);
            }
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_transforms(w, transforms);
                w.end_element("a:sysClr");
            }
        }
        DrawingColor::PrstClr { val, transforms } => {
            let elem = w.start_element("a:prstClr").attr("val", val.to_ooxml());
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_transforms(w, transforms);
                w.end_element("a:prstClr");
            }
        }
        DrawingColor::ScrgbClr {
            r,
            g,
            b,
            transforms,
        } => {
            let elem = w
                .start_element("a:scrgbClr")
                .attr_num("r", *r)
                .attr_num("g", *g)
                .attr_num("b", *b);
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                write_transforms(w, transforms);
                w.end_element("a:scrgbClr");
            }
        }
    }
}

/// Convert a `Vec<DagEffect>` to an `EffectList` by extracting the EffectList-compatible
/// effects. DAG-only effects are dropped during this conversion.
fn dag_effects_to_effect_list(effects: &[ooxml_types::drawings::DagEffect]) -> EffectList {
    use ooxml_types::drawings::DagEffect;
    let mut list = EffectList::default();
    for e in effects {
        match e {
            DagEffect::Blur(v) => list.blur = Some(v.clone()),
            DagEffect::FillOverlay(v) => list.fill_overlay = Some(v.clone()),
            DagEffect::Glow(v) => list.glow = Some(v.clone()),
            DagEffect::InnerShadow(v) => list.inner_shadow = Some(v.clone()),
            DagEffect::OuterShadow(v) => list.outer_shadow = Some(v.clone()),
            DagEffect::PresetShadow(v) => list.preset_shadow = Some(v.clone()),
            DagEffect::Reflection(v) => list.reflection = Some(v.clone()),
            DagEffect::SoftEdge(v) => list.soft_edge = Some(v.clone()),
            // DAG-only effects are not part of CT_EffectList
            _ => {}
        }
    }
    list
}

/// Write color transform children.
fn write_transforms(w: &mut XmlWriter, transforms: &[ooxml_types::drawings::ColorTransform]) {
    for t in transforms {
        let name = format!("a:{}", t.to_ooxml_name());
        if let Some(val) = t.val() {
            w.start_element(&name).attr_num("val", val).self_close();
        } else {
            w.start_element(&name).self_close();
        }
    }
}
