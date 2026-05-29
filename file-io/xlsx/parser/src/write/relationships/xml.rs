use super::{RELATIONSHIPS_NS, manager::RelationshipManager};

impl RelationshipManager {
    /// Generate the .rels XML content
    ///
    /// # Returns
    /// The XML content as bytes, ready to be written to a .rels file
    pub fn to_xml(&self) -> Vec<u8> {
        let mut xml = Vec::with_capacity(512);

        // XML declaration
        xml.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");

        // Relationships element with namespace
        xml.extend_from_slice(b"<Relationships xmlns=\"");
        xml.extend_from_slice(RELATIONSHIPS_NS.as_bytes());
        xml.extend_from_slice(b"\">");

        // Individual relationships
        for rel in self.relationships() {
            xml.extend_from_slice(b"<Relationship Id=\"");
            xml.extend_from_slice(rel.id.as_bytes());
            xml.extend_from_slice(b"\" Type=\"");
            xml.extend_from_slice(rel.rel_type.as_bytes());
            xml.extend_from_slice(b"\" Target=\"");
            // Escape XML special characters in target
            xml.extend_from_slice(&escape_xml_attr(&rel.target));
            xml.push(b'"');

            if let Some(ref mode) = rel.target_mode {
                xml.extend_from_slice(b" TargetMode=\"");
                xml.extend_from_slice(&escape_xml_attr(mode));
                xml.push(b'"');
            }

            xml.extend_from_slice(b"/>");
        }

        xml.extend_from_slice(b"</Relationships>");

        xml
    }
}

/// Escape XML special characters in attribute values
fn escape_xml_attr(s: &str) -> Vec<u8> {
    let mut result = Vec::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'&' => result.extend_from_slice(b"&amp;"),
            b'<' => result.extend_from_slice(b"&lt;"),
            b'>' => result.extend_from_slice(b"&gt;"),
            b'"' => result.extend_from_slice(b"&quot;"),
            b'\'' => result.extend_from_slice(b"&apos;"),
            _ => result.push(byte),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::escape_xml_attr;

    #[test]
    fn test_escape_xml_attr_no_escaping() {
        let result = escape_xml_attr("simple text");
        assert_eq!(result, b"simple text");
    }

    #[test]
    fn test_escape_xml_attr_ampersand() {
        let result = escape_xml_attr("a & b");
        assert_eq!(result, b"a &amp; b");
    }

    #[test]
    fn test_escape_xml_attr_all_entities() {
        let result = escape_xml_attr("<\"&'>test");
        assert_eq!(result, b"&lt;&quot;&amp;&apos;&gt;test");
    }
}
