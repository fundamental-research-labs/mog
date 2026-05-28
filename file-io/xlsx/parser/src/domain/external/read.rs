//! External links parser facade for XLSX files.
//!
//! The parser implementation is split by responsibility under this module, but
//! this facade keeps the historical `domain::external::read` API available.

mod cache;
mod entry;
mod legacy;
mod rels;
mod support;
mod value;
mod workbook;

pub use crate::domain::external::types::ExternalLinks;
pub use rels::external_book_rid;

use domain_types::domain::external_link::ExternalLink;

impl ExternalLinks {
    /// Parse an externalLink*.xml file.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the externalLink XML file
    /// * `link_id` - Identifier for this link (e.g., "1" from externalLink1.xml)
    ///
    /// # Returns
    /// Parsed ExternalLink, or None if parsing fails.
    pub fn parse_external_link(xml: &[u8], link_id: &str) -> Option<ExternalLink> {
        entry::parse_external_link(xml, link_id)
    }

    /// Resolve the file path and alternate URL for an external link from its
    /// rels XML (`xl/externalLinks/_rels/externalLinkN.xml.rels`).
    pub fn resolve_rels(link: &mut ExternalLink, rels_xml: &[u8], book_xml: &[u8]) {
        rels::resolve_rels(link, rels_xml, book_xml);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_import_path_resolves() {
        let xml = br#"<externalLink><externalBook r:id="rId1"/></externalLink>"#;
        let link = ExternalLinks::parse_external_link(xml, "1").unwrap();
        assert_eq!(link.id, "1");
        assert_eq!(external_book_rid(xml).as_deref(), Some("rId1"));
    }
}
