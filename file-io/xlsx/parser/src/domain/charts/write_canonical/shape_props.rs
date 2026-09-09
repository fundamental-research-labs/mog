use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::ShapeProperties;
use ooxml_types::drawings::{
    BlipEffect, DrawingColor, DrawingFill, FillMode, LineDash, LineFill, LineJoin, Outline,
};

use super::util::write_raw_xml_if_relationship_safe;

pub(crate) fn emit_shape_properties(w: &mut XmlWriter, sp: &ShapeProperties, tag: &str) {
    w.start_element(tag);
    if let Some(ref bw) = sp.bw_mode {
        w.attr("bwMode", bw.to_ooxml());
    }
    w.end_attrs();

    // xfrm
    if let Some(ref xfrm) = sp.xfrm {
        w.start_element("a:xfrm");
        if let Some(rot) = xfrm.rotation {
            w.attr_num("rot", rot.value());
        }
        if let Some(true) = xfrm.flip_h {
            w.attr("flipH", "1");
        }
        if let Some(true) = xfrm.flip_v {
            w.attr("flipV", "1");
        }
        w.end_attrs();
        if let Some((x, y)) = xfrm.offset {
            w.start_element("a:off")
                .attr_num("x", x)
                .attr_num("y", y)
                .self_close();
        }
        if let Some((cx, cy)) = xfrm.extent {
            w.start_element("a:ext")
                .attr_num("cx", cx)
                .attr_num("cy", cy)
                .self_close();
        }
        w.end_element("a:xfrm");
    }

    // geometry
    if let Some(ref geom) = sp.geometry {
        match geom {
            ooxml_types::drawings::ShapeGeometry::Preset(prst) => {
                w.start_element("a:prstGeom")
                    .attr("prst", prst.prst.to_ooxml())
                    .end_attrs();
                if prst.av_list.is_empty() {
                    w.start_element("a:avLst").self_close();
                } else {
                    w.start_element("a:avLst").end_attrs();
                    for gd in &prst.av_list {
                        w.start_element("a:gd")
                            .attr("name", &gd.name)
                            .attr("fmla", &gd.fmla)
                            .self_close();
                    }
                    w.end_element("a:avLst");
                }
                w.end_element("a:prstGeom");
            }
            ooxml_types::drawings::ShapeGeometry::Custom(_cust) => {
                // Custom geometry serialization is complex and rare in charts.
                // Full support would require emitting path lists, adjust handles, etc.
            }
        }
    }

    // fill
    if let Some(ref fill) = sp.fill {
        emit_fill(w, fill);
    }

    // ln (outline)
    if let Some(ref ln) = sp.ln {
        emit_outline(w, ln);
    }

    // effects
    if let Some(ref effects) = sp.effects {
        emit_effect_properties(w, effects);
    }

    // scene3d
    if let Some(ref scene) = sp.scene3d {
        emit_scene3d(w, scene);
    }

    // sp3d
    if let Some(ref sp3d) = sp.sp3d {
        emit_shape3d(w, sp3d);
    }

    // extLst
    if let Some(ref ext) = sp.ext_lst {
        write_raw_xml_if_relationship_safe(w, ext);
    }

    w.end_element(tag);
}

pub(super) fn emit_fill(w: &mut XmlWriter, fill: &DrawingFill) {
    match fill {
        DrawingFill::NoFill => {
            w.start_element("a:noFill").self_close();
        }
        DrawingFill::Solid(solid) => {
            w.start_element("a:solidFill").end_attrs();
            emit_drawing_color(w, &solid.color);
            w.end_element("a:solidFill");
        }
        DrawingFill::Gradient(grad) => {
            w.start_element("a:gradFill").end_attrs();
            w.start_element("a:gsLst").end_attrs();
            for stop in &grad.stops {
                w.start_element("a:gs")
                    .attr_num("pos", stop.position)
                    .end_attrs();
                emit_drawing_color(w, &stop.color);
                w.end_element("a:gs");
            }
            w.end_element("a:gsLst");
            if let Some(ang) = grad.lin_ang {
                w.start_element("a:lin")
                    .attr_num("ang", ang.value())
                    .attr_bool("scaled", true)
                    .self_close();
            }
            w.end_element("a:gradFill");
        }
        DrawingFill::Pattern(patt) => {
            w.start_element("a:pattFill");
            if let Some(ref preset) = patt.preset {
                w.attr("prst", preset.to_ooxml());
            }
            w.end_attrs();
            if let Some(ref fg) = patt.fg_color {
                w.start_element("a:fgClr").end_attrs();
                emit_drawing_color(w, fg);
                w.end_element("a:fgClr");
            }
            if let Some(ref bg) = patt.bg_color {
                w.start_element("a:bgClr").end_attrs();
                emit_drawing_color(w, bg);
                w.end_element("a:bgClr");
            }
            w.end_element("a:pattFill");
        }
        DrawingFill::Blip(blip) => {
            emit_blip_fill(w, blip);
        }
        DrawingFill::Group => {
            w.start_element("a:grpFill").self_close();
        }
    }
}

fn emit_blip_fill(w: &mut XmlWriter, blip: &ooxml_types::drawings::BlipFill) {
    let has_blip = blip.embed_id.is_some()
        || blip.link_id.is_some()
        || blip.compression.is_some()
        || !blip.effects.is_empty()
        || blip.ext_lst.is_some();
    if !has_blip {
        // CT_BlipFill requires a CT_Blip child. Do not manufacture an empty
        // complex fill when programmatic data has no source image or effect.
        return;
    }

    let mut fill = w.start_element("a:blipFill");
    if let Some(dpi) = blip.dpi {
        fill = fill.attr_num("dpi", dpi);
    }
    if let Some(rot_with_shape) = blip.rot_with_shape {
        fill = fill.attr("rotWithShape", if rot_with_shape { "1" } else { "0" });
    }
    fill.end_attrs();

    let mut element = w.start_element("a:blip");
    if let Some(embed_id) = blip.embed_id.as_deref() {
        element = element.attr("r:embed", embed_id);
    }
    if let Some(link_id) = blip.link_id.as_deref() {
        element = element.attr("r:link", link_id);
    }
    if let Some(compression) = blip.compression {
        element = element.attr("cstate", compression.to_ooxml());
    }
    if blip.effects.is_empty() && blip.ext_lst.is_none() {
        element.self_close();
    } else {
        element.end_attrs();
        emit_blip_effects(w, &blip.effects);
        if let Some(ext_lst) = blip.ext_lst.as_deref() {
            write_raw_xml_if_relationship_safe(w, ext_lst);
        }
        w.end_element("a:blip");
    }

    if let Some(source_rect) = blip.source_rect.as_ref() {
        let mut element = w.start_element("a:srcRect");
        if blip.src_rect_explicit & 1 != 0 {
            element = element.attr_num("l", source_rect.left.value());
        }
        if blip.src_rect_explicit & 2 != 0 {
            element = element.attr_num("t", source_rect.top.value());
        }
        if blip.src_rect_explicit & 4 != 0 {
            element = element.attr_num("r", source_rect.right.value());
        }
        if blip.src_rect_explicit & 8 != 0 {
            element = element.attr_num("b", source_rect.bottom.value());
        }
        element.self_close();
    }

    match blip.fill_mode.as_ref() {
        Some(FillMode::Stretch { fill_rect }) => {
            w.start_element("a:stretch").end_attrs();
            if let Some(fill_rect) = fill_rect {
                w.start_element("a:fillRect")
                    .attr_num("l", fill_rect.left.value())
                    .attr_num("t", fill_rect.top.value())
                    .attr_num("r", fill_rect.right.value())
                    .attr_num("b", fill_rect.bottom.value())
                    .self_close();
            }
            w.end_element("a:stretch");
        }
        Some(FillMode::Tile(tile)) => {
            let mut element = w.start_element("a:tile");
            if let Some(tx) = tile.tx {
                element = element.attr_num("tx", tx.value());
            }
            if let Some(ty) = tile.ty {
                element = element.attr_num("ty", ty.value());
            }
            if let Some(sx) = tile.sx {
                element = element.attr_num("sx", sx.value());
            }
            if let Some(sy) = tile.sy {
                element = element.attr_num("sy", sy.value());
            }
            element = element.attr("flip", tile.flip.to_ooxml());
            if let Some(align) = tile.align {
                element = element.attr("algn", align.to_ooxml());
            }
            element.self_close();
        }
        None => {}
    }

    w.end_element("a:blipFill");
}

fn emit_blip_effects(w: &mut XmlWriter, effects: &[BlipEffect]) {
    for effect in effects {
        match effect {
            BlipEffect::AlphaModFix { amt } => {
                w.start_element("a:alphaModFix")
                    .attr_num("amt", *amt)
                    .self_close();
            }
            BlipEffect::Luminance { bright, contrast } => {
                w.start_element("a:lum")
                    .attr_num("bright", *bright)
                    .attr_num("contrast", *contrast)
                    .self_close();
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
                if let Some(color) = color {
                    w.start_element("a:alphaInv").end_attrs();
                    emit_drawing_color(w, color);
                    w.end_element("a:alphaInv");
                } else {
                    w.start_element("a:alphaInv").self_close();
                }
            }
            BlipEffect::AlphaModulate => {
                // CT_AlphaModulateEffect requires a `<a:cont>` child. The
                // compact model has no field for it. Authored input uses the
                // ordered RawXml variant; a programmatic empty value must not
                // produce invalid OOXML.
            }
            BlipEffect::AlphaReplace { alpha } => {
                w.start_element("a:alphaRepl")
                    .attr_num("a", *alpha)
                    .self_close();
            }
            BlipEffect::Blur(blur) => {
                w.start_element("a:blur")
                    .attr_num("rad", blur.rad.value())
                    .attr("grow", if blur.grow { "1" } else { "0" })
                    .self_close();
            }
            BlipEffect::ColorChange { use_alpha, raw_xml } => {
                let Some(raw_xml) = raw_xml else {
                    // clrChange requires clrFrom and clrTo children.
                    continue;
                };
                let mut element = w.start_element("a:clrChange");
                if *use_alpha {
                    element = element.attr("useA", "1");
                }
                element.end_attrs();
                write_raw_xml_if_relationship_safe(w, raw_xml);
                w.end_element("a:clrChange");
            }
            BlipEffect::RawXml(raw_xml) => {
                // The parser stores one authored direct child here when its
                // nested schema is not modeled. Preserve its position while
                // rejecting relationship-bearing fragments whose ids cannot
                // be validated by the chart serializer.
                write_raw_xml_if_relationship_safe(w, raw_xml);
            }
            BlipEffect::ColorReplace { color } => {
                let Some(color) = color else {
                    // clrRepl requires one colour child.
                    continue;
                };
                w.start_element("a:clrRepl").end_attrs();
                emit_drawing_color(w, color);
                w.end_element("a:clrRepl");
            }
            BlipEffect::Duotone { color1, color2 } => {
                let (Some(color1), Some(color2)) = (color1, color2) else {
                    // duotone requires exactly two colour children.
                    continue;
                };
                w.start_element("a:duotone").end_attrs();
                emit_drawing_color(w, color1);
                emit_drawing_color(w, color2);
                w.end_element("a:duotone");
            }
            BlipEffect::FillOverlay(effect) => {
                let Some(fill) = effect.fill.as_ref() else {
                    // fillOverlay requires one EG_FillProperties child.
                    continue;
                };
                let mut element = w.start_element("a:fillOverlay");
                element = element.attr("blend", effect.blend.to_ooxml());
                element.end_attrs();
                emit_fill(w, fill);
                w.end_element("a:fillOverlay");
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

pub(super) fn emit_outline(w: &mut XmlWriter, outline: &Outline) {
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

    // line fill
    if let Some(ref fill) = outline.fill {
        emit_line_fill(w, fill);
    }

    // dash
    if let Some(ref dash) = outline.dash {
        emit_line_dash(w, dash);
    }

    // join
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

    // head end
    if let Some(ref head) = outline.head_end {
        emit_line_end(w, "a:headEnd", head);
    }
    // tail end
    if let Some(ref tail) = outline.tail_end {
        emit_line_end(w, "a:tailEnd", tail);
    }

    w.end_element("a:ln");
}

pub(super) fn emit_line_fill(w: &mut XmlWriter, fill: &LineFill) {
    match fill {
        LineFill::Solid(sf) => {
            w.start_element("a:solidFill").end_attrs();
            emit_drawing_color(w, &sf.color);
            w.end_element("a:solidFill");
        }
        LineFill::NoFill => {
            w.start_element("a:noFill").self_close();
        }
        LineFill::Gradient(_) => {
            // TODO: gradient line fill
        }
        LineFill::Pattern(_) => {
            // TODO: pattern line fill
        }
    }
}

pub(super) fn emit_line_dash(w: &mut XmlWriter, dash: &LineDash) {
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

fn emit_line_end(
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

pub(super) fn emit_drawing_color(w: &mut XmlWriter, clr: &DrawingColor) {
    match clr {
        DrawingColor::SrgbClr { val, transforms } => {
            let elem = w.start_element("a:srgbClr").attr("val", val);
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                emit_color_transforms(w, transforms);
                w.end_element("a:srgbClr");
            }
        }
        DrawingColor::SchemeClr { val, transforms } => {
            let elem = w.start_element("a:schemeClr").attr("val", val.to_ooxml());
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                emit_color_transforms(w, transforms);
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
                emit_color_transforms(w, transforms);
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
                emit_color_transforms(w, transforms);
                w.end_element("a:sysClr");
            }
        }
        DrawingColor::PrstClr { val, transforms } => {
            let elem = w.start_element("a:prstClr").attr("val", val.to_ooxml());
            if transforms.is_empty() {
                elem.self_close();
            } else {
                elem.end_attrs();
                emit_color_transforms(w, transforms);
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
                emit_color_transforms(w, transforms);
                w.end_element("a:scrgbClr");
            }
        }
    }
}

pub(super) fn emit_color_transforms(
    w: &mut XmlWriter,
    transforms: &[ooxml_types::drawings::ColorTransform],
) {
    for t in transforms {
        let name = format!("a:{}", t.to_ooxml_name());
        if let Some(val) = t.val() {
            w.start_element(&name).attr_num("val", val).self_close();
        } else {
            w.start_element(&name).self_close();
        }
    }
}

pub(super) fn emit_effect_properties(
    w: &mut XmlWriter,
    ep: &ooxml_types::drawings::EffectProperties,
) {
    use ooxml_types::drawings::EffectProperties;
    match ep {
        EffectProperties::EffectList(effects) => {
            if effects.is_empty() {
                w.start_element("a:effectLst").self_close();
            } else {
                w.start_element("a:effectLst").end_attrs();
                emit_effect_list_children(w, effects);
                w.end_element("a:effectLst");
            }
        }
        EffectProperties::EffectDag(container) => {
            w.start_element("a:effectDag");
            if let Some(ref ct) = container.container_type {
                w.attr("type", ct.to_ooxml());
            }
            if let Some(ref name) = container.name {
                w.attr("name", name);
            }
            w.end_attrs();
            // Convert DAG effects to effect list for now
            let effect_list = dag_effects_to_effect_list(&container.effects);
            emit_effect_list_children(w, &effect_list);
            w.end_element("a:effectDag");
        }
    }
}

fn dag_effects_to_effect_list(
    effects: &[ooxml_types::drawings::DagEffect],
) -> ooxml_types::drawings::EffectList {
    use ooxml_types::drawings::{DagEffect, EffectList};
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
            _ => {}
        }
    }
    list
}

fn emit_effect_list_children(w: &mut XmlWriter, effects: &ooxml_types::drawings::EffectList) {
    if let Some(ref blur) = effects.blur {
        w.start_element("a:blur")
            .attr_num("rad", blur.rad)
            .attr("grow", if blur.grow { "1" } else { "0" })
            .self_close();
    }
    if let Some(ref fo) = effects.fill_overlay {
        if let Some(ref fill) = fo.fill {
            w.start_element("a:fillOverlay")
                .attr("blend", fo.blend.to_ooxml())
                .end_attrs();
            emit_fill(w, fill);
            w.end_element("a:fillOverlay");
        } else {
            w.start_element("a:fillOverlay")
                .attr("blend", fo.blend.to_ooxml())
                .self_close();
        }
    }
    if let Some(ref glow) = effects.glow {
        w.start_element("a:glow").attr_num("rad", glow.rad);
        if let Some(ref color) = glow.color {
            w.end_attrs();
            emit_drawing_color(w, color);
            w.end_element("a:glow");
        } else {
            w.self_close();
        }
    }
    if let Some(ref is) = effects.inner_shadow {
        w.start_element("a:innerShdw")
            .attr_num("blurRad", is.blur_rad)
            .attr_num("dist", is.dist)
            .attr_num("dir", is.dir);
        if let Some(ref color) = is.color {
            w.end_attrs();
            emit_drawing_color(w, color);
            w.end_element("a:innerShdw");
        } else {
            w.self_close();
        }
    }
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
            emit_drawing_color(w, color);
            w.end_element("a:outerShdw");
        } else {
            w.self_close();
        }
    }
    if let Some(ref ps) = effects.preset_shadow {
        w.start_element("a:prstShdw")
            .attr("prst", ps.preset.to_ooxml())
            .attr_num("dist", ps.dist)
            .attr_num("dir", ps.dir);
        if let Some(ref color) = ps.color {
            w.end_attrs();
            emit_drawing_color(w, color);
            w.end_element("a:prstShdw");
        } else {
            w.self_close();
        }
    }
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
    if let Some(ref se) = effects.soft_edge {
        w.start_element("a:softEdge")
            .attr_num("rad", se.rad)
            .self_close();
    }
}

fn emit_scene3d(w: &mut XmlWriter, scene: &ooxml_types::drawings::Scene3D) {
    w.start_element("a:scene3d").end_attrs();

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
            write_raw_xml_if_relationship_safe(w, ext);
        }
        w.end_element("a:backdrop");
    }

    if let Some(ref ext) = scene.ext_lst {
        write_raw_xml_if_relationship_safe(w, ext);
    }

    w.end_element("a:scene3d");
}

fn emit_shape3d(w: &mut XmlWriter, sp3d: &ooxml_types::drawings::Shape3D) {
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

    if let Some(ref bevel) = sp3d.bevel_t {
        emit_bevel(w, "a:bevelT", bevel);
    }
    if let Some(ref bevel) = sp3d.bevel_b {
        emit_bevel(w, "a:bevelB", bevel);
    }
    if let Some(ref clr) = sp3d.extrusion_clr {
        w.start_element("a:extrusionClr").end_attrs();
        emit_drawing_color(w, clr);
        w.end_element("a:extrusionClr");
    }
    if let Some(ref clr) = sp3d.contour_clr {
        w.start_element("a:contourClr").end_attrs();
        emit_drawing_color(w, clr);
        w.end_element("a:contourClr");
    }
    if let Some(ref ext) = sp3d.ext_lst {
        write_raw_xml_if_relationship_safe(w, ext);
    }

    w.end_element("a:sp3d");
}

fn emit_bevel(w: &mut XmlWriter, tag: &str, bevel: &ooxml_types::drawings::Bevel) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::drawings::{BlipFill, StCoordinate, StPercentage, TileFill, TileFlipMode};

    #[test]
    fn chart_shape_writer_preserves_embedded_blip_and_tile_settings() {
        let shape = ShapeProperties {
            fill: Some(DrawingFill::Blip(BlipFill {
                embed_id: Some("rIdImage".to_string()),
                fill_mode: Some(FillMode::Tile(TileFill {
                    tx: Some(StCoordinate::new(12)),
                    ty: Some(StCoordinate::new(-7)),
                    sx: Some(StPercentage::new(100_000)),
                    sy: Some(StPercentage::new(100_000)),
                    flip: TileFlipMode::None,
                    align: Some(ooxml_types::drawings::RectAlignment::TopLeft),
                })),
                ..Default::default()
            })),
            ..Default::default()
        };
        let mut writer = XmlWriter::new();
        emit_shape_properties(&mut writer, &shape, "c:spPr");
        let xml = writer.finish_string();

        assert!(
            xml.contains("<a:blip r:embed=\"rIdImage\"/>")
                || xml.contains("<a:blip r:embed=\"rIdImage\" />")
        );
        assert!(xml.contains("<a:tile"));
        assert!(xml.contains("tx=\"12\""));
        assert!(xml.contains("ty=\"-7\""));
        assert!(xml.contains("sx=\"100000\""));
        assert!(xml.contains("sy=\"100000\""));
        assert!(xml.contains("algn=\"tl\""));
    }

    #[test]
    fn chart_shape_writer_preserves_required_blip_children() {
        let blip = crate::domain::drawings::parse_blip_fill(
            br#"<a:blipFill><a:blip>
                <a:clrRepl><a:srgbClr val="112233"/></a:clrRepl>
                <a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FFFFFF"/></a:duotone>
                <a:fillOverlay blend="mult"><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:fillOverlay>
                <a:alphaMod><a:cont val="50000"/></a:alphaMod>
            </a:blip></a:blipFill>"#,
        );
        let shape = ShapeProperties {
            fill: Some(DrawingFill::Blip(blip)),
            ..Default::default()
        };

        let mut writer = XmlWriter::new();
        emit_shape_properties(&mut writer, &shape, "c:spPr");
        let xml = writer.finish_string();

        assert!(xml.contains("<a:clrRepl><a:srgbClr val=\"112233\"/></a:clrRepl>"));
        assert!(xml.contains(
            "<a:duotone><a:srgbClr val=\"000000\"/><a:srgbClr val=\"FFFFFF\"/></a:duotone>"
        ));
        assert!(xml.contains("<a:fillOverlay blend=\"mult\"><a:solidFill><a:srgbClr val=\"ABCDEF\"/></a:solidFill></a:fillOverlay>"));
        assert!(xml.contains("<a:alphaMod><a:cont val=\"50000\"/></a:alphaMod>"));
        assert!(!xml.contains("<a:alphaMod/>"));
        assert!(!xml.contains("<a:clrRepl/>"));
        assert!(!xml.contains("<a:duotone></a:duotone>"));
        assert!(!xml.contains("<a:fillOverlay blend=\"mult\"/>"));
    }
}
