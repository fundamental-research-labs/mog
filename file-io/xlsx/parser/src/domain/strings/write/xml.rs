use super::domain_rich_text::{write_domain_rich_text_run, write_rich_string_phonetics};
use super::escape::{escape_xml_content, needs_preserve_space};
use super::rich_text::write_rich_text_run;
use super::table::SharedStringsWriter;
use super::types::{SharedStringValue, StringEntry};

impl SharedStringsWriter {
    /// Generate the sharedStrings.xml content in insertion order.
    ///
    /// Cells reference SST entries by position (`<c t="s"><v>N</v>`),
    /// so the slot emitted here must equal the index returned by
    /// `add()` for every entry. Emitting in insertion order
    /// makes that invariant structural: the entry at `entries[i]` is
    /// emitted at slot `i`, which is the index its insertion returned.
    /// Any reorder on this path silently corrupts text cells, because
    /// cell `<v>` values are stored before the XML is produced.
    pub fn to_xml(&self) -> Vec<u8> {
        if self.is_empty() {
            return self.write_empty_xml();
        }

        let total_count = self.total_count();
        let unique_count = self.len();

        let mut xml = Vec::with_capacity(64 + unique_count * 64);

        xml.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");
        xml.extend_from_slice(
            b"<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"",
        );
        xml.extend_from_slice(total_count.to_string().as_bytes());
        xml.extend_from_slice(b"\" uniqueCount=\"");
        xml.extend_from_slice(unique_count.to_string().as_bytes());
        xml.extend_from_slice(b"\">");

        for entry in &self.entries {
            write_string_item(entry, &mut xml);
        }

        if let Some(ext_lst_xml) = &self.root_ext_lst_xml {
            xml.extend_from_slice(ext_lst_xml);
        }

        xml.extend_from_slice(b"</sst>");
        xml
    }

    /// Write empty SST XML.
    fn write_empty_xml(&self) -> Vec<u8> {
        let mut xml = Vec::with_capacity(256);
        xml.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");
        if let Some(ext_lst_xml) = &self.root_ext_lst_xml {
            xml.extend_from_slice(b"<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"0\" uniqueCount=\"0\">");
            xml.extend_from_slice(ext_lst_xml);
            xml.extend_from_slice(b"</sst>");
        } else {
            xml.extend_from_slice(b"<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"0\" uniqueCount=\"0\"/>");
        }
        xml
    }
}

/// Write a single string item (`<si>` element).
fn write_string_item(entry: &StringEntry, xml: &mut Vec<u8>) {
    xml.extend_from_slice(b"<si>");

    match &entry.value {
        SharedStringValue::Plain(text) => {
            write_text_element(text, xml);
        }
        SharedStringValue::RichText(runs) => {
            for run in runs {
                write_rich_text_run(run, xml);
            }
        }
        SharedStringValue::DomainRichText(runs) => {
            for run in runs {
                write_domain_rich_text_run(run, xml);
            }
        }
        SharedStringValue::RichSharedString(rich) => {
            if rich.runs.is_empty() {
                write_text_element(&rich.plain_text, xml);
            } else {
                for run in &rich.runs {
                    write_domain_rich_text_run(run, xml);
                }
            }
            write_rich_string_phonetics(rich, xml);
        }
    }

    // Write phonetic data (rPh elements + phoneticPr) if present
    if let Some(ref phonetic) = entry.phonetic_xml {
        xml.extend_from_slice(phonetic);
    }

    xml.extend_from_slice(b"</si>");
}

/// Write a plain text element (`<t>`).
pub(super) fn write_text_element(text: &str, xml: &mut Vec<u8>) {
    // Excel emits xml:space="preserve" when there is leading/trailing
    // whitespace, including \r and \n.  While XML 1.0 §2.10 preserves
    // newlines in element text, Excel still adds the attribute for strings
    // ending with \r\n (carriage return + newline), so we match that
    // behaviour to avoid round-trip diffs.
    if text.is_empty() {
        xml.extend_from_slice(b"<t></t>");
        return;
    }

    if needs_preserve_space(text) {
        xml.extend_from_slice(b"<t xml:space=\"preserve\">");
    } else {
        xml.extend_from_slice(b"<t>");
    }

    escape_xml_content(text, xml);
    xml.extend_from_slice(b"</t>");
}
