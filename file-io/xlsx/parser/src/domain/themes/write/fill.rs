use super::color;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::drawings::{DrawingFill, GradientFill, GradientStop, PatternFill, RelativeRect};

// ========================================================================
// DrawingFill serializer
// ========================================================================

/// Write a `DrawingFill` to XML (ECMA-376 EG_FillProperties).
pub(super) fn write_drawing_fill( xml: &mut XmlWriter, fill: &DrawingFill) {
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
        DrawingFill::Blip(_) | DrawingFill::Group => {
            // Blip and Group fills are not used in theme format schemes; skip.
        }
    }
}

/// Write a gradient fill.
pub(super) fn write_gradient_fill( xml: &mut XmlWriter, g: &GradientFill) {
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
fn write_gradient_stop( xml: &mut XmlWriter, stop: &GradientStop) {
    xml.start_element_ns("a", "gs")
        .attr("pos", &stop.position.value().to_string())
        .end_attrs();
    color::write_drawing_color(xml, &stop.color);
    xml.end_element_ns("a", "gs");
}

/// Write a relative rectangle element.
pub(super) fn write_relative_rect( xml: &mut XmlWriter, tag: &str, rect: &RelativeRect) {
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
pub(super) fn write_pattern_fill( xml: &mut XmlWriter, p: &PatternFill) {
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
