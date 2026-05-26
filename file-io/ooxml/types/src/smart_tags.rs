//! Smart tag types (ECMA-376 Part 1, §18.3.1 — Smart Tags). Deprecated in modern Excel.

// =============================================================================
// SmartTagShow
// =============================================================================

/// Smart tag display mode (ECMA-376 ST_SmartTagShow, §18.18.69).
///
/// Controls how smart tags are displayed in the workbook.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum SmartTagShow {
    /// Show all smart tags with indicators.
    #[default]
    All,
    /// Do not show smart tags.
    NoShow,
    /// Show smart tags but without visual indicators.
    NoIndicator,
}

impl SmartTagShow {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "all" => Self::All,
            "none" => Self::NoShow,
            "noIndicator" => Self::NoIndicator,
            _ => Self::All,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::All => "all",
            Self::NoShow => "none",
            Self::NoIndicator => "noIndicator",
        }
    }
}

// =============================================================================
// SmartTagType
// =============================================================================

/// A smart tag type definition (ECMA-376 CT_SmartTagType).
///
/// Identifies a type of smart tag by its namespace URI, name, and optional URL.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SmartTagType {
    /// Namespace URI for the smart tag type.
    pub namespace_uri: Option<String>,
    /// Name of the smart tag type.
    pub name: Option<String>,
    /// URL associated with the smart tag type.
    pub url: Option<String>,
}

// =============================================================================
// SmartTagTypes
// =============================================================================

/// Container for smart tag type definitions (ECMA-376 CT_SmartTagTypes).
///
/// Holds the collection of smart tag type declarations for the workbook.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SmartTagTypes {
    /// Smart tag type definitions.
    pub smart_tag_type: Vec<SmartTagType>,
    /// Future extensibility.
    pub ext_lst: Option<crate::ExtensionList>,
}

// =============================================================================
// SmartTagPr
// =============================================================================

/// Smart tag properties (ECMA-376 CT_SmartTagPr).
///
/// Workbook-level properties controlling smart tag behavior.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SmartTagPr {
    /// Whether to embed smart tags in the workbook. Default: `false`.
    pub embed: bool,
    /// Smart tag display mode.
    pub show: SmartTagShow,
}

// =============================================================================
// CellSmartTagPr
// =============================================================================

/// Smart tag property key-value pair (CT_CellSmartTagPr).
///
/// A single property associated with a cell smart tag.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CellSmartTagPr {
    /// Property key (required).
    pub key: String,
    /// Property value (required).
    pub val: String,
}

// =============================================================================
// CellSmartTag
// =============================================================================

/// A single smart tag on a cell (CT_CellSmartTag).
///
/// Identifies the smart tag type and carries associated properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CellSmartTag {
    /// Smart tag type ID (required).
    pub r#type: u32,
    /// Whether this smart tag has been deleted. Default: `false`.
    pub deleted: bool,
    /// Whether this smart tag is XML-based. Default: `false`.
    pub xml_based: bool,
    /// Properties associated with this smart tag.
    pub properties: Vec<CellSmartTagPr>,
}

// =============================================================================
// CellSmartTags
// =============================================================================

/// Collection of smart tags for a cell (CT_CellSmartTags).
///
/// Groups all smart tags associated with a single cell reference.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CellSmartTags {
    /// Cell reference in A1 notation (required).
    pub r: String,
    /// Smart tags attached to this cell.
    pub tags: Vec<CellSmartTag>,
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_smart_tag_show_from_ooxml() {
        assert_eq!(SmartTagShow::from_ooxml("all"), SmartTagShow::All);
        assert_eq!(SmartTagShow::from_ooxml("none"), SmartTagShow::NoShow);
        assert_eq!(
            SmartTagShow::from_ooxml("noIndicator"),
            SmartTagShow::NoIndicator
        );
        // Unknown values fall back to default
        assert_eq!(SmartTagShow::from_ooxml("unknown"), SmartTagShow::All);
    }

    #[test]
    fn test_smart_tag_show_to_ooxml() {
        assert_eq!(SmartTagShow::All.to_ooxml(), "all");
        assert_eq!(SmartTagShow::NoShow.to_ooxml(), "none");
        assert_eq!(SmartTagShow::NoIndicator.to_ooxml(), "noIndicator");
    }

    #[test]
    fn test_smart_tag_show_roundtrip() {
        for variant in [
            SmartTagShow::All,
            SmartTagShow::NoShow,
            SmartTagShow::NoIndicator,
        ] {
            assert_eq!(SmartTagShow::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_smart_tag_show_default() {
        assert_eq!(SmartTagShow::default(), SmartTagShow::All);
    }

    #[test]
    fn test_smart_tag_type_default() {
        let t = SmartTagType::default();
        assert!(t.namespace_uri.is_none());
        assert!(t.name.is_none());
        assert!(t.url.is_none());
    }

    #[test]
    fn test_smart_tag_types_default() {
        let types = SmartTagTypes::default();
        assert!(types.smart_tag_type.is_empty());
        assert!(types.ext_lst.is_none());
    }

    #[test]
    fn test_smart_tag_pr_default() {
        let pr = SmartTagPr::default();
        assert!(!pr.embed);
        assert_eq!(pr.show, SmartTagShow::All);
    }

    #[test]
    fn test_smart_tag_pr_serde_roundtrip() {
        let original = SmartTagPr {
            embed: true,
            show: SmartTagShow::NoIndicator,
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: SmartTagPr = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_cell_smart_tag_pr_defaults() {
        let pr = CellSmartTagPr::default();
        assert!(pr.key.is_empty());
        assert!(pr.val.is_empty());
    }

    #[test]
    fn test_cell_smart_tag_defaults() {
        let t = CellSmartTag::default();
        assert_eq!(t.r#type, 0);
        assert!(!t.deleted);
        assert!(!t.xml_based);
        assert!(t.properties.is_empty());
    }

    #[test]
    fn test_cell_smart_tags_defaults() {
        let ts = CellSmartTags::default();
        assert!(ts.r.is_empty());
        assert!(ts.tags.is_empty());
    }

    #[test]
    fn test_smart_tag_type_serde_roundtrip() {
        let original = SmartTagType {
            namespace_uri: Some("urn:schemas-microsoft-com:office:smarttags".to_string()),
            name: Some("date".to_string()),
            url: Some("http://example.com".to_string()),
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: SmartTagType = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
