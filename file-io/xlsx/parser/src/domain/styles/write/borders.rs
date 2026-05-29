use crate::domain::styles::types::{BorderDef, BorderSideDef, BorderStyle};
use crate::write::xml_writer::XmlWriter;

use super::colors::write_color;

pub(super) fn write_borders(w: &mut XmlWriter, borders: &[BorderDef]) {
    w.start_element("borders")
        .attr_num("count", borders.len())
        .end_attrs();

    for border in borders {
        write_border(w, border);
    }

    w.end_element("borders");
}

pub(super) fn write_border(w: &mut XmlWriter, border: &BorderDef) {
    w.start_element("border");

    match border.diagonal_up {
        Some(true) => {
            w.attr("diagonalUp", "1");
        }
        Some(false) => {
            w.attr("diagonalUp", "0");
        }
        None => {}
    }
    match border.diagonal_down {
        Some(true) => {
            w.attr("diagonalDown", "1");
        }
        Some(false) => {
            w.attr("diagonalDown", "0");
        }
        None => {}
    }
    if let Some(false) = border.outline {
        w.attr("outline", "0");
    }

    w.end_attrs();

    if border.left.is_some() {
        write_border_side(w, "left", &border.left);
    }
    if border.right.is_some() {
        write_border_side(w, "right", &border.right);
    }
    if border.top.is_some() {
        write_border_side(w, "top", &border.top);
    }
    if border.bottom.is_some() {
        write_border_side(w, "bottom", &border.bottom);
    }
    if border.diagonal.is_some() {
        write_border_side(w, "diagonal", &border.diagonal);
    }

    if border.start.is_some() {
        write_border_side(w, "start", &border.start);
    }
    if border.end.is_some() {
        write_border_side(w, "end", &border.end);
    }

    if border.vertical.is_some() {
        write_border_side(w, "vertical", &border.vertical);
    }
    if border.horizontal.is_some() {
        write_border_side(w, "horizontal", &border.horizontal);
    }

    w.end_element("border");
}

fn write_border_side(w: &mut XmlWriter, element_name: &str, side: &Option<BorderSideDef>) {
    match side {
        Some(BorderSideDef { style, color }) if *style != BorderStyle::None || color.is_some() => {
            w.start_element(element_name);
            if *style != BorderStyle::None {
                w.attr("style", style.to_ooxml());
            }

            if let Some(c) = color {
                w.end_attrs();
                write_color(w, "color", c);
                w.end_element(element_name);
            } else if *style == BorderStyle::Thin {
                w.self_close();
            } else {
                w.end_attrs();
                w.end_element(element_name);
            }
        }
        _ => {
            w.start_element(element_name).self_close();
        }
    }
}
