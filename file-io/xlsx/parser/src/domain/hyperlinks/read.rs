//! Hyperlink parser compatibility facade for XLSX worksheets.
//!
//! Worksheet parsing keeps hyperlink metadata from `<hyperlinks>` elements. The
//! optional relationship-aware helper combines that metadata with OPC worksheet
//! relationships for tests and callers that already have `.rels` XML.

mod cell_refs;
mod relationships;
mod resolve;
mod support;
mod worksheet;

pub use super::types::{Hyperlink, HyperlinkRelationship, HyperlinkType, Hyperlinks, TargetMode};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_star_import_keeps_public_hyperlink_api_available() {
        fn accepts_read_exports(
            _: HyperlinkType,
            _: TargetMode,
            _: HyperlinkRelationship,
            _: Hyperlink,
            _: Hyperlinks,
        ) {
        }

        let relationship = HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com".to_string(),
            TargetMode::External,
        );
        let hyperlink = Hyperlink::new("A1".to_string());
        let hyperlinks = Hyperlinks {
            hyperlinks: vec![hyperlink.clone()],
        };

        accepts_read_exports(
            HyperlinkType::from_target("https://example.com"),
            TargetMode::from_bytes(b"External"),
            relationship,
            hyperlink,
            hyperlinks,
        );
    }
}
