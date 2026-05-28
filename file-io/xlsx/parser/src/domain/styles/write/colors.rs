use crate::domain::styles::types::{ColorDef, ColorsDef};
use crate::write::xml_writer::XmlWriter;

pub(super) fn write_color(w: &mut XmlWriter, element_name: &str, color: &ColorDef) {
    w.start_element(element_name);

    match color {
        ColorDef::Indexed { id, tint } => {
            w.attr_num("indexed", *id);
            if let Some(t) = tint {
                w.attr("tint", t);
            }
        }
        ColorDef::Rgb { val, tint } => {
            w.attr("rgb", val);
            if let Some(t) = tint {
                w.attr("tint", t);
            }
        }
        ColorDef::Theme { id, tint } => {
            w.attr_num("theme", *id);
            if let Some(t) = tint {
                w.attr("tint", t);
            }
        }
        ColorDef::Auto { tint } => {
            w.attr("auto", "1");
            if let Some(t) = tint {
                w.attr("tint", t);
            }
        }
    }

    w.self_close();
}

pub(super) fn write_colors(w: &mut XmlWriter, colors: &ColorsDef) {
    w.start_element("colors").end_attrs();

    if !colors.indexed_colors.is_empty() {
        w.start_element("indexedColors").end_attrs();
        for rgb in &colors.indexed_colors {
            w.start_element("rgbColor").attr("rgb", rgb).self_close();
        }
        w.end_element("indexedColors");
    }

    if !colors.mru_colors.is_empty() {
        w.start_element("mruColors").end_attrs();
        for color in &colors.mru_colors {
            write_color(w, "color", color);
        }
        w.end_element("mruColors");
    }

    w.end_element("colors");
}
