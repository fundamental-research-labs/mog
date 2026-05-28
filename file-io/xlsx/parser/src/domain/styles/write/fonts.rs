use crate::domain::styles::types::{FontDef, UnderlineStyle, VerticalAlignRun};
use crate::write::xml_writer::XmlWriter;

use super::colors::write_color;

pub(super) fn write_fonts(w: &mut XmlWriter, fonts: &[FontDef], known_fonts: bool) {
    w.start_element("fonts").attr_num("count", fonts.len());

    if known_fonts {
        w.attr("x14ac:knownFonts", "1");
    }

    w.end_attrs();

    for font in fonts {
        write_font(w, font);
    }

    w.end_element("fonts");
}

fn write_font(w: &mut XmlWriter, font: &FontDef) {
    write_font_inner(w, font, false);
}

/// Write a font element. When `preserve_defaults` is true (used in DXFs),
/// emit default-value elements like `<u val="none"/>` and `<vertAlign val="baseline"/>`
/// because they represent explicit overrides of the base style.
pub(super) fn write_font_inner(w: &mut XmlWriter, font: &FontDef, preserve_defaults: bool) {
    w.start_element("font").end_attrs();

    match font.bold {
        Some(true) => {
            w.start_element("b").self_close();
        }
        Some(false) => {
            w.start_element("b").attr("val", "0").self_close();
        }
        None => {}
    }

    match font.italic {
        Some(true) => {
            w.start_element("i").self_close();
        }
        Some(false) => {
            w.start_element("i").attr("val", "0").self_close();
        }
        None => {}
    }

    match font.strikethrough {
        Some(true) => {
            w.start_element("strike").self_close();
        }
        Some(false) => {
            w.start_element("strike").attr("val", "0").self_close();
        }
        None => {}
    }

    match font.condense {
        Some(true) => {
            w.start_element("condense").self_close();
        }
        Some(false) => {
            w.start_element("condense").attr("val", "0").self_close();
        }
        None => {}
    }

    match font.extend {
        Some(true) => {
            w.start_element("extend").self_close();
        }
        Some(false) => {
            w.start_element("extend").attr("val", "0").self_close();
        }
        None => {}
    }

    match font.outline {
        Some(true) => {
            w.start_element("outline").self_close();
        }
        Some(false) => {
            w.start_element("outline").attr("val", "0").self_close();
        }
        None => {}
    }

    match font.shadow {
        Some(true) => {
            w.start_element("shadow").self_close();
        }
        Some(false) => {
            w.start_element("shadow").attr("val", "0").self_close();
        }
        None => {}
    }

    if let Some(underline) = font.underline {
        if preserve_defaults || underline != UnderlineStyle::None {
            let elem = w.start_element("u");
            if underline != UnderlineStyle::Single {
                elem.attr("val", underline.to_ooxml());
            }
            elem.self_close();
        }
    }

    if let Some(vert_align) = font.vert_align {
        if preserve_defaults || vert_align != VerticalAlignRun::Baseline {
            w.start_element("vertAlign")
                .attr("val", vert_align.to_ooxml())
                .self_close();
        }
    }

    if let Some(size) = font.size {
        if size > 0.0 {
            w.start_element("sz").attr_num("val", size).self_close();
        }
    }

    if let Some(ref color) = font.color {
        write_color(w, "color", color);
    }

    if let Some(ref name) = font.name {
        if !name.is_empty() {
            w.start_element("name").attr("val", name).self_close();
        }
    }

    if let Some(family) = font.family {
        w.start_element("family")
            .attr_num("val", family)
            .self_close();
    }

    if let Some(charset) = font.charset {
        w.start_element("charset")
            .attr_num("val", charset)
            .self_close();
    }

    if let Some(scheme) = font.scheme {
        w.start_element("scheme")
            .attr("val", scheme.to_ooxml())
            .self_close();
    }

    w.end_element("font");
}
