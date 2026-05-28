//! Hyperlink target resolution from worksheet relationships.

use crate::domain::hyperlinks::types::{Hyperlink, HyperlinkRelationship, HyperlinkType};
use domain_types::domain::hyperlink::HyperlinkTargetKind;

impl Hyperlink {
    /// Resolve the hyperlink target using relationship data.
    pub fn resolve_target(&mut self, relationships: &[HyperlinkRelationship]) {
        if let Some(ref r_id) = self.r_id {
            if let Some(rel) = relationships.iter().find(|r| r.id == *r_id) {
                let full_target =
                    combine_relationship_target_and_location(&rel.target, self.location.as_deref());

                self.target = Some(full_target.clone());
                self.link_type = HyperlinkType::from_target(&full_target);
                self.target_kind = Some(HyperlinkTargetKind::Relationship);
                self.target_mode = rel.raw_target_mode.clone();
            }
        } else if self.target.is_none() {
            if let Some(ref location) = self.location {
                self.target = Some(location.clone());
                self.link_type = HyperlinkType::Internal;
                self.target_kind = Some(HyperlinkTargetKind::InlineLocation);
            }
        }
    }
}

pub(super) fn combine_relationship_target_and_location(
    target: &str,
    location: Option<&str>,
) -> String {
    let mut full_target = target.to_string();

    if let Some(location) = location {
        if !location.is_empty() {
            if location.starts_with('#') {
                full_target.push_str(location);
            } else {
                full_target.push('#');
                full_target.push_str(location);
            }
        }
    }

    full_target
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::hyperlinks::types::TargetMode;

    #[test]
    fn test_resolve_external_target() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            ..Default::default()
        };

        let rels = vec![HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com".to_string(),
            TargetMode::External,
        )];

        hl.resolve_target(&rels);
        assert_eq!(hl.target, Some("https://example.com".to_string()));
        assert_eq!(hl.link_type, HyperlinkType::Url);
        assert_eq!(hl.target_kind, Some(HyperlinkTargetKind::Relationship));
        assert_eq!(hl.target_mode.as_deref(), Some("External"));
    }

    #[test]
    fn combines_relationship_target_with_fragments() {
        assert_eq!(
            combine_relationship_target_and_location("https://example.com/page", Some("Section1")),
            "https://example.com/page#Section1"
        );
        assert_eq!(
            combine_relationship_target_and_location("https://example.com/page", Some("#Section1")),
            "https://example.com/page#Section1"
        );
        assert_eq!(
            combine_relationship_target_and_location("https://example.com/page", Some("")),
            "https://example.com/page"
        );
        assert_eq!(
            combine_relationship_target_and_location("https://example.com/page", None),
            "https://example.com/page"
        );
    }

    #[test]
    fn relationship_wins_over_inline_target() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            location: Some("Section1".to_string()),
            target: Some("Section1".to_string()),
            target_kind: Some(HyperlinkTargetKind::InlineLocation),
            link_type: HyperlinkType::Internal,
            ..Default::default()
        };

        let rels = vec![HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com/page".to_string(),
            TargetMode::External,
        )];

        hl.resolve_target(&rels);
        assert_eq!(
            hl.target,
            Some("https://example.com/page#Section1".to_string())
        );
        assert_eq!(hl.target_kind, Some(HyperlinkTargetKind::Relationship));
    }

    #[test]
    fn unresolved_r_id_preserves_post_parse_inline_location() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            location: Some("Sheet2!A1".to_string()),
            target: Some("Sheet2!A1".to_string()),
            link_type: HyperlinkType::Internal,
            target_kind: Some(HyperlinkTargetKind::InlineLocation),
            ..Default::default()
        };

        hl.resolve_target(&[]);
        assert_eq!(hl.target, Some("Sheet2!A1".to_string()));
        assert_eq!(hl.link_type, HyperlinkType::Internal);
        assert_eq!(hl.target_kind, Some(HyperlinkTargetKind::InlineLocation));
        assert_eq!(hl.target_mode, None);
    }

    #[test]
    fn test_resolve_internal_only() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("Sheet2!A1".to_string()),
            ..Default::default()
        };

        hl.resolve_target(&[]);
        assert_eq!(hl.target, Some("Sheet2!A1".to_string()));
        assert_eq!(hl.link_type, HyperlinkType::Internal);
        assert_eq!(hl.target_kind, Some(HyperlinkTargetKind::InlineLocation));
    }
}
