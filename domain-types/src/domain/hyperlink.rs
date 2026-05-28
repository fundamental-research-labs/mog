use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HyperlinkTargetKind {
    InlineLocation,
    Relationship,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
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
}
