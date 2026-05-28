use super::{color, fill};
use crate::write::xml_writer::XmlWriter;
use ooxml_types::drawings::{LineDash, LineFill, LineJoin, Outline};

// ========================================================================
// Outline (line) serializer
// ========================================================================

/// Write an `Outline` to XML (ECMA-376 CT_LineProperties).
pub(super) fn write_outline(xml: &mut XmlWriter, ln: &Outline) {
    let elem = xml.start_element_ns("a", "ln");
    if let Some(w) = ln.width {
        elem.attr("w", &w.to_string());
    }
    if let Some(cap) = &ln.cap {
        elem.attr("cap", cap.to_ooxml());
    }
    if let Some(cmpd) = &ln.compound {
        elem.attr("cmpd", cmpd.to_ooxml());
    }
    if let Some(algn) = &ln.align {
        elem.attr("algn", algn.to_ooxml());
    }
    elem.end_attrs();

    // Line fill
    if let Some(fill) = &ln.fill {
        write_line_fill(xml, fill);
    }

    // Dash
    if let Some(dash) = &ln.dash {
        write_line_dash(xml, dash);
    }

    // Join
    if let Some(join) = &ln.join {
        write_line_join(xml, join);
    }

    // Head end
    if let Some(head) = &ln.head_end {
        write_line_end(xml, "headEnd", head);
    }

    // Tail end
    if let Some(tail) = &ln.tail_end {
        write_line_end(xml, "tailEnd", tail);
    }

    xml.end_element_ns("a", "ln");
}

/// Write line fill (EG_LineFillProperties).
fn write_line_fill(xml: &mut XmlWriter, fill: &LineFill) {
    match fill {
        LineFill::NoFill => {
            xml.start_element_ns("a", "noFill").self_close();
        }
        LineFill::Solid(s) => {
            xml.start_element_ns("a", "solidFill").end_attrs();
            color::write_drawing_color(xml, &s.color);
            xml.end_element_ns("a", "solidFill");
        }
        LineFill::Gradient(g) => {
            fill::write_gradient_fill(xml, g);
        }
        LineFill::Pattern(p) => {
            fill::write_pattern_fill(xml, p);
        }
    }
}

/// Write line dash (preset or custom).
fn write_line_dash(xml: &mut XmlWriter, dash: &LineDash) {
    match dash {
        LineDash::Preset(style) => {
            xml.start_element_ns("a", "prstDash")
                .attr("val", style.to_ooxml())
                .self_close();
        }
        LineDash::Custom(stops) => {
            xml.start_element_ns("a", "custDash").end_attrs();
            for stop in stops {
                xml.start_element_ns("a", "ds")
                    .attr("d", &stop.d.to_string())
                    .attr("sp", &stop.sp.to_string())
                    .self_close();
            }
            xml.end_element_ns("a", "custDash");
        }
    }
}

/// Write line join.
fn write_line_join(xml: &mut XmlWriter, join: &LineJoin) {
    match join {
        LineJoin::Round => {
            xml.start_element_ns("a", "round").self_close();
        }
        LineJoin::Bevel => {
            xml.start_element_ns("a", "bevel").self_close();
        }
        LineJoin::Miter { limit } => {
            let elem = xml.start_element_ns("a", "miter");
            if let Some(lim) = limit {
                elem.attr("lim", &lim.to_string());
            }
            elem.self_close();
        }
    }
}

/// Write a line end (head or tail arrowhead).
fn write_line_end(
    xml: &mut XmlWriter,
    tag: &str,
    props: &ooxml_types::drawings::LineEndProperties,
) {
    let elem = xml.start_element_ns("a", tag);
    if let Some(t) = &props.end_type {
        elem.attr("type", t.to_ooxml());
    }
    if let Some(w) = &props.width {
        elem.attr("w", w.to_ooxml());
    }
    if let Some(len) = &props.length {
        elem.attr("len", len.to_ooxml());
    }
    elem.self_close();
}
