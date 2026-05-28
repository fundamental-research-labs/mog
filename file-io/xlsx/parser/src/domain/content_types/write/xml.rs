use crate::write::xml_writer::XmlWriter;

use super::constants::CONTENT_TYPES_NS;
use super::manager::ContentTypesManager;

impl ContentTypesManager {
    /// Generate the `[Content_Types].xml` file content.
    pub fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();

        writer.xml_declaration();
        writer.start_element_with_attrs("Types", &[("xmlns", CONTENT_TYPES_NS)]);

        for default in self.defaults() {
            writer.empty_element(
                "Default",
                &[
                    ("Extension", &default.extension),
                    ("ContentType", &default.content_type),
                ],
            );
        }

        for over in self.overrides() {
            writer.empty_element(
                "Override",
                &[
                    ("PartName", &over.part_name),
                    ("ContentType", &over.content_type),
                ],
            );
        }

        writer.end_element("Types");
        writer.into_bytes()
    }
}
