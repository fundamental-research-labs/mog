//! Hyperlink types (CT_Hyperlinks, CT_Hyperlink).

/// Hyperlinks container (CT_Hyperlinks, sml.xsd §18.3.1.48).
///
/// Wraps all `<hyperlink>` elements within a worksheet.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Hyperlinks {
    /// Individual hyperlinks
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hyperlink: Vec<Hyperlink>,
}

/// Single hyperlink (CT_Hyperlink, sml.xsd §18.3.1.47).
///
/// Links a cell range to an external URL (via relationship ID) or
/// an internal location within the workbook.
///
/// # External vs Internal Links
/// - **External**: `r_id` is set, pointing to a relationship that holds the URL
/// - **Internal**: `location` is set (e.g., "Sheet2!A1"), `r_id` may be absent
/// - **Both**: Excel allows both `r_id` and `location` simultaneously
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Hyperlink {
    /// Cell reference for the hyperlink anchor (e.g., "A1")
    pub ref_cell: String,
    /// Relationship ID (r:id) pointing to the external URL.
    /// Resolved via the worksheet's .rels file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_id: Option<String>,
    /// Internal location (e.g., "Sheet2!A1" or defined name)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    /// Tooltip text shown on hover
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    /// Display text (overrides cell value for display purposes)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyperlink_external() {
        let link = Hyperlink {
            ref_cell: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            location: None,
            tooltip: Some("Visit website".to_string()),
            display: Some("Example".to_string()),
        };
        assert_eq!(link.ref_cell, "A1");
        assert_eq!(link.r_id.as_deref(), Some("rId1"));
        assert!(link.location.is_none());
    }

    #[test]
    fn hyperlink_internal() {
        let link = Hyperlink {
            ref_cell: "B2".to_string(),
            r_id: None,
            location: Some("Sheet2!A1".to_string()),
            tooltip: None,
            display: None,
        };
        assert!(link.r_id.is_none());
        assert_eq!(link.location.as_deref(), Some("Sheet2!A1"));
    }

    #[test]
    fn hyperlink_both() {
        let link = Hyperlink {
            ref_cell: "C3".to_string(),
            r_id: Some("rId2".to_string()),
            location: Some("Sheet3!B5".to_string()),
            tooltip: Some("Both".to_string()),
            display: None,
        };
        assert!(link.r_id.is_some());
        assert!(link.location.is_some());
    }

    #[test]
    fn hyperlinks_container_default() {
        let container = Hyperlinks::default();
        assert!(container.hyperlink.is_empty());
    }

    #[test]
    fn hyperlink_serde_roundtrip() {
        let link = Hyperlink {
            ref_cell: "D4".to_string(),
            r_id: Some("rId3".to_string()),
            location: Some("Sheet1!A1".to_string()),
            tooltip: Some("Go here".to_string()),
            display: Some("Click me".to_string()),
        };
        let json = serde_json::to_string(&link).unwrap();
        let deserialized: Hyperlink = serde_json::from_str(&json).unwrap();
        assert_eq!(link, deserialized);
    }

    #[test]
    fn hyperlinks_serde_skip_empty() {
        let container = Hyperlinks::default();
        let json = serde_json::to_string(&container).unwrap();
        assert!(
            !json.contains("hyperlink"),
            "empty vec should be skipped: {json}"
        );
    }

    #[test]
    fn hyperlink_serde_skip_none() {
        let link = Hyperlink {
            ref_cell: "A1".to_string(),
            ..Default::default()
        };
        let json = serde_json::to_string(&link).unwrap();
        assert!(
            !json.contains("r_id"),
            "None r_id should be skipped: {json}"
        );
        assert!(
            !json.contains("location"),
            "None location should be skipped: {json}"
        );
        assert!(
            !json.contains("tooltip"),
            "None tooltip should be skipped: {json}"
        );
        assert!(
            !json.contains("display"),
            "None display should be skipped: {json}"
        );
    }
}
