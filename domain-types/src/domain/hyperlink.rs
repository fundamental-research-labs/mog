use bridge_types::DescribeSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HyperlinkTargetKind {
    InlineLocation,
    Relationship,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct Hyperlink {
    /// A1 notation
    pub cell_ref: String,
    /// URL or internal reference
    pub target: Option<String>,
    /// Sheet/cell location
    pub location: Option<String>,
    pub display: Option<String>,
    pub tooltip: Option<String>,
    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    /// Authored OOXML representation for the target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_kind: Option<HyperlinkTargetKind>,
    /// Raw OPC TargetMode when the hyperlink is relationship-backed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
}

/// Whether a worksheet hyperlink target must be represented through an OPC
/// relationship (`r:id`) instead of a worksheet `location` attribute.
///
/// Plain workbook anchors such as `Sheet1!A1` and defined-name locations can be
/// written inline as `location`. External URI schemes, file paths, and
/// `#`-prefixed anchors are relationship-backed in Excel-authored XLSX.
pub fn hyperlink_target_needs_relationship(target: &str) -> bool {
    target.starts_with('#')
        || target.contains("://")
        || target
            .split_once(':')
            .is_some_and(|(scheme, _)| is_uri_scheme(scheme))
        || target.starts_with("\\\\")
        || looks_like_external_file_path(target)
}

pub fn hyperlink_target_kind_for_target(target: &str) -> HyperlinkTargetKind {
    if hyperlink_target_needs_relationship(target) {
        HyperlinkTargetKind::Relationship
    } else {
        HyperlinkTargetKind::InlineLocation
    }
}

fn is_uri_scheme(scheme: &str) -> bool {
    !scheme.is_empty()
        && scheme
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'))
}

fn looks_like_external_file_path(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.ends_with(".xlsx")
        || lower.ends_with(".xlsm")
        || lower.ends_with(".xls")
        || lower.ends_with(".csv")
        || lower.starts_with("../")
        || lower.starts_with("./")
        || lower.contains('\\')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_json_defaults_representation_fields() {
        let link: Hyperlink = serde_json::from_str(
            r#"{"cellRef":"A1","target":"https://example.com","location":null}"#,
        )
        .expect("old hyperlink json should deserialize");

        assert_eq!(link.target_kind, None);
        assert_eq!(link.target_mode, None);
    }

    #[test]
    fn representation_fields_roundtrip_as_camel_case() {
        let link = Hyperlink {
            cell_ref: "B2".to_string(),
            target: Some("#Sheet2!A1".to_string()),
            target_kind: Some(HyperlinkTargetKind::Relationship),
            target_mode: Some("External".to_string()),
            ..Default::default()
        };

        let json = serde_json::to_string(&link).expect("serialize hyperlink");
        assert!(json.contains(r#""targetKind":"relationship""#));
        assert!(json.contains(r#""targetMode":"External""#));

        let restored: Hyperlink = serde_json::from_str(&json).expect("deserialize hyperlink");
        assert_eq!(restored, link);
    }

    #[test]
    fn target_kind_classifies_workbook_locations_as_inline() {
        assert!(!hyperlink_target_needs_relationship("Sheet2!A1"));
        assert!(!hyperlink_target_needs_relationship("'Sheet 2'!A1"));
        assert_eq!(
            hyperlink_target_kind_for_target("Sheet2!A1"),
            HyperlinkTargetKind::InlineLocation
        );
    }

    #[test]
    fn target_kind_classifies_external_targets_as_relationships() {
        for target in [
            "https://example.com",
            "mailto:test@example.com",
            "tel:+15551234567",
            "#Sheet2!A1",
            "../other.xlsx",
            r"C:\Docs\book.xlsx",
        ] {
            assert!(
                hyperlink_target_needs_relationship(target),
                "{target} should use a relationship"
            );
            assert_eq!(
                hyperlink_target_kind_for_target(target),
                HyperlinkTargetKind::Relationship
            );
        }
    }
}
