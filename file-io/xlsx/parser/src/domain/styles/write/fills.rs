use crate::domain::styles::types::FillDef;
use crate::write::xml_writer::XmlWriter;

use super::colors::write_color;

pub(super) fn write_fills(w: &mut XmlWriter, fills: &[FillDef]) {
    w.start_element("fills")
        .attr_num("count", fills.len())
        .end_attrs();

    for fill in fills {
        write_fill(w, fill);
    }

    w.end_element("fills");
}

pub(super) fn write_fill(w: &mut XmlWriter, fill: &FillDef) {
    w.start_element("fill").end_attrs();

    match fill {
        FillDef::None => {
            w.start_element("patternFill")
                .attr("patternType", "none")
                .self_close();
        }
        FillDef::Solid { fg_color } => {
            w.start_element("patternFill")
                .attr("patternType", "solid")
                .end_attrs();
            write_color(w, "fgColor", fg_color);
            w.end_element("patternFill");
        }
        FillDef::Pattern {
            pattern_type,
            fg_color,
            bg_color,
        } => {
            let has_children = fg_color.is_some() || bg_color.is_some();
            w.start_element("patternFill");
            if let Some(pt) = pattern_type {
                w.attr("patternType", pt.to_ooxml());
            }

            if has_children {
                w.end_attrs();

                if let Some(fg) = fg_color {
                    write_color(w, "fgColor", fg);
                }
                if let Some(bg) = bg_color {
                    write_color(w, "bgColor", bg);
                }

                w.end_element("patternFill");
            } else {
                w.self_close();
            }
        }
        FillDef::Gradient {
            gradient_type,
            degree,
            stops,
            left,
            right,
            top,
            bottom,
        } => {
            w.start_element("gradientFill")
                .attr("type", gradient_type.to_ooxml());

            if let Some(d) = degree {
                w.attr_num("degree", *d);
            }
            if let Some(l) = left {
                w.attr_num("left", *l);
            }
            if let Some(r) = right {
                w.attr_num("right", *r);
            }
            if let Some(t) = top {
                w.attr_num("top", *t);
            }
            if let Some(b) = bottom {
                w.attr_num("bottom", *b);
            }

            w.end_attrs();

            for stop in stops {
                w.start_element("stop")
                    .attr_num("position", stop.position)
                    .end_attrs();
                write_color(w, "color", &stop.color);
                w.end_element("stop");
            }

            w.end_element("gradientFill");
        }
    }

    w.end_element("fill");
}
