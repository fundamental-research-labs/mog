use super::escape::{escape_xml_attr, escape_xml_content, needs_preserve_space};
use domain_types::RichTextRun as DtRichTextRun;
use ooxml_types::styles::UnderlineStyle;

/// Write a rich text run from a domain-types `RichTextRun` with full attribute fidelity.
pub(super) fn write_domain_rich_text_run(run: &DtRichTextRun, xml: &mut Vec<u8>) {
    xml.extend_from_slice(b"<r>");

    // Write <rPr> if any formatting present
    let has_fmt = run.bold
        || run.italic
        || run.underline_style.is_some()
        || run.underline
        || run.strikethrough
        || run.outline.is_some()
        || run.shadow.is_some()
        || run.condense.is_some()
        || run.extend.is_some()
        || run.font_size.is_some()
        || run.color.is_some()
        || run.color_indexed.is_some()
        || run.color_theme.is_some()
        || run.font_name.is_some()
        || run.family.is_some()
        || run.charset.is_some()
        || run.scheme.is_some()
        || run.vert_align.is_some();

    if has_fmt {
        xml.extend_from_slice(b"<rPr>");

        if run.bold {
            xml.extend_from_slice(b"<b/>");
        }
        if run.italic {
            xml.extend_from_slice(b"<i/>");
        }
        if let Some(style) = run.underline_style {
            write_underline(style, xml);
        } else if run.underline {
            xml.extend_from_slice(b"<u/>");
        }
        if run.strikethrough {
            xml.extend_from_slice(b"<strike/>");
        }
        write_optional_bool_property(b"outline", run.outline, xml);
        write_optional_bool_property(b"shadow", run.shadow, xml);
        write_optional_bool_property(b"condense", run.condense, xml);
        write_optional_bool_property(b"extend", run.extend, xml);
        if let Some(size) = run.font_size {
            xml.extend_from_slice(b"<sz val=\"");
            if size.fract() == 0.0 {
                xml.extend_from_slice((size as i64).to_string().as_bytes());
            } else {
                xml.extend_from_slice(size.to_string().as_bytes());
            }
            xml.extend_from_slice(b"\"/>");
        }
        // <color> — support rgb, indexed, theme+tint
        if run.color.is_some() || run.color_indexed.is_some() || run.color_theme.is_some() {
            xml.extend_from_slice(b"<color");
            if let Some(ref rgb) = run.color {
                xml.extend_from_slice(b" rgb=\"");
                xml.extend_from_slice(rgb.as_bytes());
                xml.extend_from_slice(b"\"");
            }
            if let Some(indexed) = run.color_indexed {
                xml.extend_from_slice(b" indexed=\"");
                xml.extend_from_slice(indexed.to_string().as_bytes());
                xml.extend_from_slice(b"\"");
            }
            if let Some(theme) = run.color_theme {
                xml.extend_from_slice(b" theme=\"");
                xml.extend_from_slice(theme.to_string().as_bytes());
                xml.extend_from_slice(b"\"");
            }
            if let Some(tint) = run.color_tint {
                xml.extend_from_slice(b" tint=\"");
                xml.extend_from_slice(tint.to_string().as_bytes());
                xml.extend_from_slice(b"\"");
            }
            xml.extend_from_slice(b"/>");
        }
        if let Some(ref font_name) = run.font_name {
            xml.extend_from_slice(b"<rFont val=\"");
            escape_xml_attr(font_name, xml);
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(family) = run.family {
            xml.extend_from_slice(b"<family val=\"");
            xml.extend_from_slice(family.to_string().as_bytes());
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(charset) = run.charset {
            xml.extend_from_slice(b"<charset val=\"");
            xml.extend_from_slice(charset.to_string().as_bytes());
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(ref scheme) = run.scheme {
            xml.extend_from_slice(b"<scheme val=\"");
            escape_xml_attr(scheme, xml);
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(ref vert_align) = run.vert_align {
            xml.extend_from_slice(b"<vertAlign val=\"");
            escape_xml_attr(vert_align, xml);
            xml.extend_from_slice(b"\"/>");
        }

        xml.extend_from_slice(b"</rPr>");
    }

    // Write <t> with optional xml:space="preserve"
    if run.preserve_space || needs_preserve_space(&run.text) {
        xml.extend_from_slice(b"<t xml:space=\"preserve\">");
    } else {
        xml.extend_from_slice(b"<t>");
    }

    escape_xml_content(&run.text, xml);
    xml.extend_from_slice(b"</t>");
    xml.extend_from_slice(b"</r>");
}

fn write_underline(style: UnderlineStyle, xml: &mut Vec<u8>) {
    match style {
        UnderlineStyle::Single => xml.extend_from_slice(b"<u/>"),
        _ => {
            xml.extend_from_slice(b"<u val=\"");
            xml.extend_from_slice(style.to_ooxml().as_bytes());
            xml.extend_from_slice(b"\"/>");
        }
    }
}

fn write_optional_bool_property(tag: &[u8], value: Option<bool>, xml: &mut Vec<u8>) {
    let Some(value) = value else {
        return;
    };
    xml.extend_from_slice(b"<");
    xml.extend_from_slice(tag);
    if value {
        xml.extend_from_slice(b"/>");
    } else {
        xml.extend_from_slice(b" val=\"0\"/>");
    }
}

pub(super) fn write_rich_string_phonetics(
    rich: &domain_types::RichSharedString,
    xml: &mut Vec<u8>,
) {
    if let Some(raw) = &rich.phonetic_xml {
        xml.extend_from_slice(raw);
        return;
    }

    for run in &rich.phonetic_runs {
        xml.extend_from_slice(b"<rPh sb=\"");
        xml.extend_from_slice(run.start_index.to_string().as_bytes());
        xml.extend_from_slice(b"\" eb=\"");
        xml.extend_from_slice(run.end_index.to_string().as_bytes());
        xml.extend_from_slice(b"\"><t>");
        escape_xml_content(&run.text, xml);
        xml.extend_from_slice(b"</t></rPh>");
    }

    if let Some(props) = &rich.phonetic_properties {
        xml.extend_from_slice(b"<phoneticPr");
        if let Some(font_id) = props.font_id {
            xml.extend_from_slice(b" fontId=\"");
            xml.extend_from_slice(font_id.to_string().as_bytes());
            xml.extend_from_slice(b"\"");
        }
        if let Some(value) = &props.phonetic_type {
            xml.extend_from_slice(b" type=\"");
            escape_xml_attr(value, xml);
            xml.extend_from_slice(b"\"");
        }
        if let Some(value) = &props.alignment {
            xml.extend_from_slice(b" alignment=\"");
            escape_xml_attr(value, xml);
            xml.extend_from_slice(b"\"");
        }
        xml.extend_from_slice(b"/>");
    }
}
