use crate::write::xml_writer::XmlWriter;
use ooxml_types::themes::{FontCollection, FontScheme, ThemeFontDef};

// ========================================================================
// Font scheme
// ========================================================================

/// Write the font scheme section.
pub(super) fn write_font_scheme(xml: &mut XmlWriter, font_scheme: &FontScheme) {
    xml.start_element_ns("a", "fontScheme")
        .attr("name", &font_scheme.name)
        .end_attrs();

    // Major font (headings)
    write_font_collection(xml, "majorFont", &font_scheme.major_font);

    // Minor font (body)
    write_font_collection(xml, "minorFont", &font_scheme.minor_font);

    xml.end_element_ns("a", "fontScheme");
}

/// Write a font collection (majorFont or minorFont).
fn write_font_collection(xml: &mut XmlWriter, name: &str, collection: &FontCollection) {
    xml.start_element_ns("a", name).end_attrs();

    // Latin font (required)
    write_font_def(xml, "latin", &collection.latin);

    // East Asian font
    write_font_def(xml, "ea", &collection.ea);

    // Complex script font
    write_font_def(xml, "cs", &collection.cs);

    // Script-specific fonts
    for sf in &collection.script_fonts {
        xml.start_element_ns("a", "font")
            .attr("script", &sf.script)
            .attr("typeface", &sf.typeface)
            .self_close();
    }

    xml.end_element_ns("a", name);
}

/// Write a font definition element.
fn write_font_def(xml: &mut XmlWriter, name: &str, font: &ThemeFontDef) {
    xml.start_element_ns("a", name)
        .attr("typeface", &font.typeface);

    if let Some(ref panose) = font.panose {
        xml.attr("panose", panose);
    }
    if let Some(pitch_family) = font.pitch_family {
        xml.attr("pitchFamily", &pitch_family.to_string());
    }
    if let Some(charset) = font.charset {
        xml.attr("charset", &charset.to_string());
    }

    xml.self_close();
}
