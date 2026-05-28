//! OPC-backed worksheet hyperlink relationship parsing.

use crate::domain::hyperlinks::types::{HyperlinkRelationship, TargetMode};
use crate::infra::opc::{
    PackageOwner, RelationshipTargetMode, WorksheetRelationships, parse_owned_relationships,
};

impl HyperlinkRelationship {
    /// Parse hyperlink relationships from a worksheet's .rels file.
    pub fn parse_all(xml: &[u8]) -> Vec<Self> {
        let relationships = parse_owned_relationships(
            PackageOwner::Worksheet {
                sheet_index: 0,
                path: "xl/worksheets/sheet1.xml".to_string(),
            },
            xml,
        );

        WorksheetRelationships::new(&relationships)
            .hyperlinks()
            .into_iter()
            .map(|rel| HyperlinkRelationship {
                id: rel.id.clone(),
                target: rel.target.raw().to_string(),
                target_mode: match rel.target_mode {
                    RelationshipTargetMode::External => TargetMode::External,
                    RelationshipTargetMode::Internal => TargetMode::Internal,
                },
                raw_target_mode: match rel.target_mode {
                    RelationshipTargetMode::External => Some("External".to_string()),
                    RelationshipTargetMode::Internal => None,
                },
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hyperlink_relationships() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:test@example.com" TargetMode="External"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#;

        let rels = HyperlinkRelationship::parse_all(xml);
        assert_eq!(rels.len(), 2);

        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].target, "https://example.com");
        assert_eq!(rels[0].target_mode, TargetMode::External);
        assert_eq!(rels[0].raw_target_mode.as_deref(), Some("External"));

        assert_eq!(rels[1].id, "rId2");
        assert_eq!(rels[1].target, "mailto:test@example.com");
        assert_eq!(rels[1].target_mode, TargetMode::External);
    }

    #[test]
    fn test_parse_hyperlink_relationships_empty() {
        let xml = br#"<Relationships></Relationships>"#;
        let rels = HyperlinkRelationship::parse_all(xml);
        assert_eq!(rels.len(), 0);
    }

    #[test]
    fn test_parse_hyperlink_relationships_rejects_near_miss_type() {
        let xml = br#"<Relationships>
  <Relationship Id="rId1" Type="http://example.invalid/relationships/not-a-hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>"#;

        let rels = HyperlinkRelationship::parse_all(xml);
        assert!(rels.is_empty());
    }

    #[test]
    fn test_parse_hyperlink_relationships_preserves_order_and_attribute_order() {
        let xml = br#"<Relationships>
  <Relationship Target="https://first.example.com" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Id="rId1"/>
  <Relationship Target="../internal.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Id="rId2"/>
</Relationships>"#;

        let rels = HyperlinkRelationship::parse_all(xml);
        assert_eq!(rels.len(), 2);
        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].target, "https://first.example.com");
        assert_eq!(rels[0].raw_target_mode.as_deref(), Some("External"));
        assert_eq!(rels[1].id, "rId2");
        assert_eq!(rels[1].target_mode, TargetMode::Internal);
        assert_eq!(rels[1].raw_target_mode, None);
    }
}
