use super::escape::escape_xml_attr;
use super::types::RichTextRun;
use super::xml::write_text_element;

/// Write a rich text run (`<r>` element).
pub(super) fn write_rich_text_run(run: &RichTextRun, xml: &mut Vec<u8>) {
    xml.extend_from_slice(b"<r>");

    // Write run properties if any
    if run.has_formatting() {
        xml.extend_from_slice(b"<rPr>");

        if run.bold == Some(true) {
            xml.extend_from_slice(b"<b/>");
        }
        if run.italic == Some(true) {
            xml.extend_from_slice(b"<i/>");
        }
        if run.underline == Some(true) {
            xml.extend_from_slice(b"<u/>");
        }
        if run.strike == Some(true) {
            xml.extend_from_slice(b"<strike/>");
        }
        if let Some(size) = run.font_size {
            xml.extend_from_slice(b"<sz val=\"");
            // Format as integer if whole number, otherwise with decimals
            if size.fract() == 0.0 {
                xml.extend_from_slice((size as i64).to_string().as_bytes());
            } else {
                xml.extend_from_slice(size.to_string().as_bytes());
            }
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(ref color) = run.color {
            xml.extend_from_slice(b"<color rgb=\"");
            // Ensure ARGB format (prepend FF if only RGB)
            if color.len() == 6 {
                xml.extend_from_slice(b"FF");
            }
            xml.extend_from_slice(color.as_bytes());
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(ref font_name) = run.font_name {
            xml.extend_from_slice(b"<rFont val=\"");
            escape_xml_attr(font_name, xml);
            xml.extend_from_slice(b"\"/>");
        }

        xml.extend_from_slice(b"</rPr>");
    }

    // Write text content
    write_text_element(&run.text, xml);

    xml.extend_from_slice(b"</r>");
}
