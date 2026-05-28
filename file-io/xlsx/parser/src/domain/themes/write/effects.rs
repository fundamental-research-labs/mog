use super::{color, fill, three_d};
use crate::write::xml_writer::XmlWriter;
use ooxml_types::drawings::{
    BlurEffect, DagEffect, EffectContainer, EffectList, EffectProperties, FillOverlayEffect, Glow,
    InnerShadow, OuterShadow, PresetShadow, Reflection, SoftEdge,
};
use ooxml_types::themes::EffectStyleItem;

// ========================================================================
// Effect serializers
// ========================================================================

/// Write an `EffectStyleItem` to XML (CT_EffectStyleItem).
pub(super) fn write_effect_style_item(xml: &mut XmlWriter, item: &EffectStyleItem) {
    xml.start_element_ns("a", "effectStyle").end_attrs();

    // Effect properties (required per spec; write empty effectLst if None)
    match &item.effect_properties {
        Some(props) => write_effect_properties(xml, props),
        None => {
            xml.start_element_ns("a", "effectLst").self_close();
        }
    }

    // Optional scene3d
    if let Some(scene) = &item.scene_3d {
        three_d::write_scene_3d(xml, scene);
    }

    // Optional sp3d
    if let Some(sp3d) = &item.sp_3d {
        three_d::write_shape_3d(xml, sp3d);
    }

    xml.end_element_ns("a", "effectStyle");
}

/// Write effect properties (effectLst or effectDag).
pub(super) fn write_effect_properties(xml: &mut XmlWriter, props: &EffectProperties) {
    match props {
        EffectProperties::EffectList(list) => {
            write_effect_list(xml, list);
        }
        EffectProperties::EffectDag(container) => {
            write_effect_container(xml, "effectDag", container);
        }
    }
}

/// Write an effect list (CT_EffectList).
pub(super) fn write_effect_list(xml: &mut XmlWriter, list: &EffectList) {
    let is_empty = list.blur.is_none()
        && list.fill_overlay.is_none()
        && list.glow.is_none()
        && list.inner_shadow.is_none()
        && list.outer_shadow.is_none()
        && list.preset_shadow.is_none()
        && list.reflection.is_none()
        && list.soft_edge.is_none();

    if is_empty {
        xml.start_element_ns("a", "effectLst").self_close();
        return;
    }

    xml.start_element_ns("a", "effectLst").end_attrs();

    // Write effects in OOXML spec order
    if let Some(blur) = &list.blur {
        write_blur(xml, blur);
    }
    if let Some(fo) = &list.fill_overlay {
        write_fill_overlay(xml, fo);
    }
    if let Some(glow) = &list.glow {
        write_glow(xml, glow);
    }
    if let Some(inner) = &list.inner_shadow {
        write_inner_shadow(xml, inner);
    }
    if let Some(outer) = &list.outer_shadow {
        write_outer_shadow(xml, outer);
    }
    if let Some(preset) = &list.preset_shadow {
        write_preset_shadow(xml, preset);
    }
    if let Some(refl) = &list.reflection {
        write_reflection(xml, refl);
    }
    if let Some(se) = &list.soft_edge {
        write_soft_edge(xml, se);
    }

    xml.end_element_ns("a", "effectLst");
}

/// Write a blur effect.
pub(super) fn write_blur(xml: &mut XmlWriter, blur: &BlurEffect) {
    let elem = xml.start_element_ns("a", "blur");
    elem.attr("rad", &blur.rad.value().to_string());
    elem.attr("grow", if blur.grow { "1" } else { "0" });
    elem.self_close();
}

/// Write a fill overlay effect.
pub(super) fn write_fill_overlay(xml: &mut XmlWriter, fo: &FillOverlayEffect) {
    xml.start_element_ns("a", "fillOverlay")
        .attr("blend", fo.blend.to_ooxml())
        .end_attrs();
    if let Some(fill) = &fo.fill {
        fill::write_drawing_fill(xml, fill);
    }
    xml.end_element_ns("a", "fillOverlay");
}

/// Write a glow effect.
pub(super) fn write_glow(xml: &mut XmlWriter, glow: &Glow) {
    xml.start_element_ns("a", "glow")
        .attr("rad", &glow.rad.value().to_string())
        .end_attrs();
    if let Some(color) = &glow.color {
        color::write_drawing_color(xml, color);
    }
    xml.end_element_ns("a", "glow");
}

/// Write an inner shadow effect.
pub(super) fn write_inner_shadow(xml: &mut XmlWriter, s: &InnerShadow) {
    xml.start_element_ns("a", "innerShdw")
        .attr("blurRad", &s.blur_rad.value().to_string())
        .attr("dist", &s.dist.value().to_string())
        .attr("dir", &s.dir.value().to_string())
        .end_attrs();
    if let Some(color) = &s.color {
        color::write_drawing_color(xml, color);
    }
    xml.end_element_ns("a", "innerShdw");
}

/// Write an outer shadow effect.
pub(super) fn write_outer_shadow(xml: &mut XmlWriter, s: &OuterShadow) {
    let elem = xml.start_element_ns("a", "outerShdw");
    // Only emit optional attributes when they differ from XSD defaults
    if s.blur_rad.value() != 0 {
        elem.attr("blurRad", &s.blur_rad.value().to_string());
    }
    if s.dist.value() != 0 {
        elem.attr("dist", &s.dist.value().to_string());
    }
    if s.dir.value() != 0 {
        elem.attr("dir", &s.dir.value().to_string());
    }
    if s.sx.value() != 100_000 {
        elem.attr("sx", &s.sx.value().to_string());
    }
    if s.sy.value() != 100_000 {
        elem.attr("sy", &s.sy.value().to_string());
    }
    if s.kx.value() != 0 {
        elem.attr("kx", &s.kx.value().to_string());
    }
    if s.ky.value() != 0 {
        elem.attr("ky", &s.ky.value().to_string());
    }
    if let Some(algn) = &s.align {
        elem.attr("algn", algn.to_ooxml());
    }
    if !s.rot_with_shape {
        elem.attr("rotWithShape", "0");
    }
    elem.end_attrs();
    if let Some(color) = &s.color {
        color::write_drawing_color(xml, color);
    }
    xml.end_element_ns("a", "outerShdw");
}

/// Write a preset shadow effect.
pub(super) fn write_preset_shadow(xml: &mut XmlWriter, s: &PresetShadow) {
    xml.start_element_ns("a", "prstShdw")
        .attr("prst", s.preset.to_ooxml())
        .attr("dist", &s.dist.value().to_string())
        .attr("dir", &s.dir.value().to_string())
        .end_attrs();
    if let Some(color) = &s.color {
        color::write_drawing_color(xml, color);
    }
    xml.end_element_ns("a", "prstShdw");
}

/// Write a reflection effect.
pub(super) fn write_reflection(xml: &mut XmlWriter, r: &Reflection) {
    let elem = xml.start_element_ns("a", "reflection");
    elem.attr("blurRad", &r.blur_rad.value().to_string());
    elem.attr("stA", &r.start_alpha.value().to_string());
    elem.attr("stPos", &r.start_pos.value().to_string());
    elem.attr("endA", &r.end_alpha.value().to_string());
    elem.attr("endPos", &r.end_pos.value().to_string());
    elem.attr("dist", &r.dist.value().to_string());
    elem.attr("dir", &r.dir.value().to_string());
    elem.attr("fadeDir", &r.fade_dir.value().to_string());
    elem.attr("sx", &r.sx.value().to_string());
    elem.attr("sy", &r.sy.value().to_string());
    elem.attr("kx", &r.kx.value().to_string());
    elem.attr("ky", &r.ky.value().to_string());
    if let Some(algn) = &r.align {
        elem.attr("algn", algn.to_ooxml());
    }
    elem.attr("rotWithShape", if r.rot_with_shape { "1" } else { "0" });
    elem.self_close();
}

/// Write a soft edge effect.
pub(super) fn write_soft_edge(xml: &mut XmlWriter, se: &SoftEdge) {
    xml.start_element_ns("a", "softEdge")
        .attr("rad", &se.rad.value().to_string())
        .self_close();
}

/// Write an effect container (effectDag or nested cont).
pub(super) fn write_effect_container(xml: &mut XmlWriter, tag: &str, container: &EffectContainer) {
    let elem = xml.start_element_ns("a", tag);
    if let Some(ct) = &container.container_type {
        elem.attr("type", ct.to_ooxml());
    }
    if let Some(name) = &container.name {
        elem.attr("name", name);
    }
    if container.effects.is_empty() {
        elem.self_close();
    } else {
        elem.end_attrs();
        // DAG effects are complex; for now serialize what we can
        for effect in &container.effects {
            write_dag_effect(xml, effect);
        }
        xml.end_element_ns("a", tag);
    }
}

/// Write a single DAG effect (EG_Effect).
pub(super) fn write_dag_effect(xml: &mut XmlWriter, effect: &DagEffect) {
    match effect {
        DagEffect::Container(c) => {
            write_effect_container(xml, "cont", c);
        }
        DagEffect::EffectRef(r) => {
            xml.start_element_ns("a", "effect")
                .attr("ref", &r.ref_token)
                .self_close();
        }
        DagEffect::Blur(b) => {
            write_blur(xml, b);
        }
        DagEffect::Glow(g) => {
            write_glow(xml, g);
        }
        DagEffect::InnerShadow(s) => {
            write_inner_shadow(xml, s);
        }
        DagEffect::OuterShadow(s) => {
            write_outer_shadow(xml, s);
        }
        DagEffect::PresetShadow(s) => {
            write_preset_shadow(xml, s);
        }
        DagEffect::Reflection(r) => {
            write_reflection(xml, r);
        }
        DagEffect::SoftEdge(se) => {
            write_soft_edge(xml, se);
        }
        DagEffect::FillOverlay(fo) => {
            write_fill_overlay(xml, fo);
        }
        // Remaining DAG-only effects
        DagEffect::AlphaBiLevel(e) => {
            xml.start_element_ns("a", "alphaBiLevel")
                .attr("thresh", &e.thresh.value().to_string())
                .self_close();
        }
        DagEffect::AlphaCeiling(_) => {
            xml.start_element_ns("a", "alphaCeiling").self_close();
        }
        DagEffect::AlphaFloor(_) => {
            xml.start_element_ns("a", "alphaFloor").self_close();
        }
        DagEffect::AlphaInverse(e) => {
            if let Some(color) = &e.color {
                xml.start_element_ns("a", "alphaInv").end_attrs();
                color::write_drawing_color(xml, color);
                xml.end_element_ns("a", "alphaInv");
            } else {
                xml.start_element_ns("a", "alphaInv").self_close();
            }
        }
        DagEffect::AlphaModulate(e) => {
            xml.start_element_ns("a", "alphaMod").end_attrs();
            write_effect_container(xml, "cont", &e.cont);
            xml.end_element_ns("a", "alphaMod");
        }
        DagEffect::AlphaModulateFixed(e) => {
            xml.start_element_ns("a", "alphaModFix")
                .attr("amt", &e.amt.value().to_string())
                .self_close();
        }
        DagEffect::AlphaOutset(e) => {
            xml.start_element_ns("a", "alphaOutset")
                .attr("rad", &e.rad.value().to_string())
                .self_close();
        }
        DagEffect::AlphaReplace(e) => {
            xml.start_element_ns("a", "alphaRepl")
                .attr("a", &e.a.value().to_string())
                .self_close();
        }
        DagEffect::BiLevel(e) => {
            xml.start_element_ns("a", "biLevel")
                .attr("thresh", &e.thresh.value().to_string())
                .self_close();
        }
        DagEffect::Blend(e) => {
            xml.start_element_ns("a", "blend")
                .attr("blend", e.blend.to_ooxml())
                .end_attrs();
            write_effect_container(xml, "cont", &e.cont);
            xml.end_element_ns("a", "blend");
        }
        DagEffect::ColorChange(e) => {
            let elem = xml.start_element_ns("a", "clrChange");
            if let Some(ua) = e.use_a {
                elem.attr("useA", if ua { "1" } else { "0" });
            }
            elem.end_attrs();
            if let Some(from) = &e.clr_from {
                xml.start_element_ns("a", "clrFrom").end_attrs();
                color::write_drawing_color(xml, from);
                xml.end_element_ns("a", "clrFrom");
            }
            if let Some(to) = &e.clr_to {
                xml.start_element_ns("a", "clrTo").end_attrs();
                color::write_drawing_color(xml, to);
                xml.end_element_ns("a", "clrTo");
            }
            xml.end_element_ns("a", "clrChange");
        }
        DagEffect::ColorReplace(e) => {
            if let Some(color) = &e.color {
                xml.start_element_ns("a", "clrRepl").end_attrs();
                color::write_drawing_color(xml, color);
                xml.end_element_ns("a", "clrRepl");
            } else {
                xml.start_element_ns("a", "clrRepl").self_close();
            }
        }
        DagEffect::Duotone(e) => {
            xml.start_element_ns("a", "duotone").end_attrs();
            for color in &e.colors {
                color::write_drawing_color(xml, color);
            }
            xml.end_element_ns("a", "duotone");
        }
        DagEffect::Fill(e) => {
            if let Some(fill) = &e.fill {
                xml.start_element_ns("a", "fill").end_attrs();
                fill::write_drawing_fill(xml, fill);
                xml.end_element_ns("a", "fill");
            } else {
                xml.start_element_ns("a", "fill").self_close();
            }
        }
        DagEffect::Grayscale(_) => {
            xml.start_element_ns("a", "grayscl").self_close();
        }
        DagEffect::Hsl(e) => {
            xml.start_element_ns("a", "hsl")
                .attr("hue", &e.hue.value().to_string())
                .attr("sat", &e.sat.value().to_string())
                .attr("lum", &e.lum.value().to_string())
                .self_close();
        }
        DagEffect::Luminance(e) => {
            xml.start_element_ns("a", "lum")
                .attr("bright", &e.bright.value().to_string())
                .attr("contrast", &e.contrast.value().to_string())
                .self_close();
        }
        DagEffect::RelativeOffset(e) => {
            xml.start_element_ns("a", "relOff")
                .attr("tx", &e.tx.value().to_string())
                .attr("ty", &e.ty.value().to_string())
                .self_close();
        }
        DagEffect::Tint(e) => {
            xml.start_element_ns("a", "tint")
                .attr("hue", &e.hue.value().to_string())
                .attr("amt", &e.amt.value().to_string())
                .self_close();
        }
        DagEffect::Transform(e) => {
            xml.start_element_ns("a", "xfrm")
                .attr("sx", &e.sx.value().to_string())
                .attr("sy", &e.sy.value().to_string())
                .attr("kx", &e.kx.value().to_string())
                .attr("ky", &e.ky.value().to_string())
                .attr("tx", &e.tx.value().to_string())
                .attr("ty", &e.ty.value().to_string())
                .self_close();
        }
    }
}
