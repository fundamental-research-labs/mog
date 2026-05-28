use super::color;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::drawings::{
    BlipFill, DrawingFill, FillMode, GradientFill, GradientStop, PatternFill, RelativeRect,
};

// ========================================================================
// DrawingFill serializer
// ========================================================================

/// Write a `DrawingFill` to XML (ECMA-376 EG_FillProperties).
pub(super) fn write_drawing_fill(xml: &mut XmlWriter, fill: &DrawingFill) {
    match fill {
        DrawingFill::NoFill => {
            xml.start_element_ns("a", "noFill").self_close();
        }
        DrawingFill::Solid(s) => {
            xml.start_element_ns("a", "solidFill").end_attrs();
            color::write_drawing_color(xml, &s.color);
            xml.end_element_ns("a", "solidFill");
        }
        DrawingFill::Gradient(g) => {
            write_gradient_fill(xml, g);
        }
        DrawingFill::Pattern(p) => {
            write_pattern_fill(xml, p);
        }
        DrawingFill::Blip(fill) => {
            write_blip_fill(xml, fill);
        }
        DrawingFill::Group => {
            xml.start_element_ns("a", "grpFill").self_close();
        }
    }
}

fn write_blip_fill(xml: &mut XmlWriter, fill: &BlipFill) {
    let elem = xml.start_element_ns("a", "blipFill");
    if let Some(dpi) = fill.dpi {
        elem.attr("dpi", &dpi.to_string());
    }
    if let Some(rot) = fill.rot_with_shape {
        elem.attr("rotWithShape", if rot { "1" } else { "0" });
    }
    elem.end_attrs();

    if fill.embed_id.is_some() || fill.link_id.is_some() || fill.compression.is_some() {
        let blip = xml.start_element_ns("a", "blip");
        if let Some(embed) = &fill.embed_id {
            blip.attr("r:embed", embed);
        }
        if let Some(link) = &fill.link_id {
            blip.attr("r:link", link);
        }
        if let Some(compression) = &fill.compression {
            blip.attr("cstate", compression.to_ooxml());
        }
        blip.self_close();
    }

    if let Some(rect) = &fill.source_rect {
        let elem = xml.start_element_ns("a", "srcRect");
        if fill.src_rect_explicit & 1 != 0 {
            elem.attr("l", &rect.left.value().to_string());
        }
        if fill.src_rect_explicit & 2 != 0 {
            elem.attr("t", &rect.top.value().to_string());
        }
        if fill.src_rect_explicit & 4 != 0 {
            elem.attr("r", &rect.right.value().to_string());
        }
        if fill.src_rect_explicit & 8 != 0 {
            elem.attr("b", &rect.bottom.value().to_string());
        }
        elem.self_close();
    }

    match &fill.fill_mode {
        Some(FillMode::Stretch { .. }) => {
            xml.start_element_ns("a", "stretch").end_attrs();
            xml.start_element_ns("a", "fillRect").self_close();
            xml.end_element_ns("a", "stretch");
        }
        Some(FillMode::Tile(_)) => {
            xml.start_element_ns("a", "tile").self_close();
        }
        None => {}
    }

    xml.end_element_ns("a", "blipFill");
}

/// Write a gradient fill.
pub(super) fn write_gradient_fill(xml: &mut XmlWriter, g: &GradientFill) {
    let elem = xml.start_element_ns("a", "gradFill");
    if let Some(flip) = &g.flip {
        elem.attr("flip", flip.to_ooxml());
    }
    if let Some(rws) = g.rotate_with_shape {
        elem.attr("rotWithShape", if rws { "1" } else { "0" });
    }
    elem.end_attrs();

    // Gradient stop list
    if !g.stops.is_empty() {
        xml.start_element_ns("a", "gsLst").end_attrs();
        for stop in &g.stops {
            write_gradient_stop(xml, stop);
        }
        xml.end_element_ns("a", "gsLst");
    }

    // Linear or path shade
    if let Some(lin_ang) = g.lin_ang {
        let elem = xml.start_element_ns("a", "lin");
        elem.attr("ang", &lin_ang.value().to_string());
        if let Some(scaled) = g.lin_scaled {
            elem.attr("scaled", if scaled { "1" } else { "0" });
        }
        elem.self_close();
    } else if let Some(path_type) = &g.path {
        xml.start_element_ns("a", "path")
            .attr("path", path_type.to_ooxml())
            .end_attrs();
        if let Some(rect) = &g.fill_to_rect {
            write_relative_rect(xml, "a:fillToRect", rect);
        }
        xml.end_element_ns("a", "path");
    }

    // Tile rect
    if let Some(rect) = &g.tile_rect {
        write_relative_rect(xml, "a:tileRect", rect);
    }

    xml.end_element_ns("a", "gradFill");
}

/// Write a gradient stop.
fn write_gradient_stop(xml: &mut XmlWriter, stop: &GradientStop) {
    xml.start_element_ns("a", "gs")
        .attr("pos", &stop.position.value().to_string())
        .end_attrs();
    color::write_drawing_color(xml, &stop.color);
    xml.end_element_ns("a", "gs");
}

/// Write a relative rectangle element.
pub(super) fn write_relative_rect(xml: &mut XmlWriter, tag: &str, rect: &RelativeRect) {
    // Split "a:fillToRect" -> ("a", "fillToRect")
    let (ns, local) = tag.split_once(':').unwrap_or(("a", tag));
    let elem = xml.start_element_ns(ns, local);
    if let Some(l) = rect.l {
        elem.attr("l", &l.value().to_string());
    }
    if let Some(t) = rect.t {
        elem.attr("t", &t.value().to_string());
    }
    if let Some(r) = rect.r {
        elem.attr("r", &r.value().to_string());
    }
    if let Some(b) = rect.b {
        elem.attr("b", &b.value().to_string());
    }
    elem.self_close();
}

/// Write a pattern fill.
pub(super) fn write_pattern_fill(xml: &mut XmlWriter, p: &PatternFill) {
    let elem = xml.start_element_ns("a", "pattFill");
    if let Some(prst) = &p.preset {
        elem.attr("prst", prst.to_ooxml());
    }
    elem.end_attrs();

    if let Some(fg) = &p.fg_color {
        xml.start_element_ns("a", "fgClr").end_attrs();
        color::write_drawing_color(xml, fg);
        xml.end_element_ns("a", "fgClr");
    }
    if let Some(bg) = &p.bg_color {
        xml.start_element_ns("a", "bgClr").end_attrs();
        color::write_drawing_color(xml, bg);
        xml.end_element_ns("a", "bgClr");
    }

    xml.end_element_ns("a", "pattFill");
}
