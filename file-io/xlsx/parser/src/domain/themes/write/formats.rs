use super::{effects, fill, line};
use crate::write::xml_writer::XmlWriter;
use ooxml_types::themes::FormatScheme;

// ========================================================================
// Format scheme (top-level)
// ========================================================================

/// Write the format scheme section from the `format_scheme` model.
pub(super) fn write_format_scheme(xml: &mut XmlWriter, format_scheme: &FormatScheme) {
    xml.start_element_ns("a", "fmtScheme")
        .attr("name", &format_scheme.name)
        .end_attrs();

    // Fill style list
    xml.start_element_ns("a", "fillStyleLst").end_attrs();
    for fill in &format_scheme.fill_style_lst {
        fill::write_drawing_fill(xml, fill);
    }
    xml.end_element_ns("a", "fillStyleLst");

    // Line style list
    xml.start_element_ns("a", "lnStyleLst").end_attrs();
    for ln in &format_scheme.ln_style_lst {
        line::write_outline(xml, ln);
    }
    xml.end_element_ns("a", "lnStyleLst");

    // Effect style list
    xml.start_element_ns("a", "effectStyleLst").end_attrs();
    for item in &format_scheme.effect_style_lst {
        effects::write_effect_style_item(xml, item);
    }
    xml.end_element_ns("a", "effectStyleLst");

    // Background fill style list
    xml.start_element_ns("a", "bgFillStyleLst").end_attrs();
    for fill in &format_scheme.bg_fill_style_lst {
        fill::write_drawing_fill(xml, fill);
    }
    xml.end_element_ns("a", "bgFillStyleLst");

    xml.end_element_ns("a", "fmtScheme");
}
