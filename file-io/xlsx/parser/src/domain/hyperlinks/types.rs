//! Public hyperlink model types.

use domain_types::domain::hyperlink::HyperlinkTargetKind;

/// Type of hyperlink target
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HyperlinkType {
    /// External URL (http://, https://, ftp://)
    #[default]
    Url,
    /// Local or network file path
    File,
    /// Email address (mailto:)
    Email,
    /// Internal reference within the workbook (#Sheet1!A1)
    Internal,
}

impl HyperlinkType {
    /// Detect hyperlink type from target string
    pub fn from_target(target: &str) -> Self {
        let target_lower = target.to_lowercase();

        if target_lower.starts_with("mailto:") {
            Self::Email
        } else if target_lower.starts_with("http://")
            || target_lower.starts_with("https://")
            || target_lower.starts_with("ftp://")
        {
            Self::Url
        } else if target.starts_with('#') {
            Self::Internal
        } else if target_lower.contains("://") {
            Self::Url
        } else {
            Self::File
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::File => "file",
            Self::Email => "email",
            Self::Internal => "internal",
        }
    }
}

/// Target mode for external relationships
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TargetMode {
    /// Internal target (within the package)
    #[default]
    Internal,
    /// External target (outside the package)
    External,
}

impl TargetMode {
    /// Parse from XML attribute value
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"External" => Self::External,
            b"external" => Self::External,
            _ => Self::Internal,
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Internal => "Internal",
            Self::External => "External",
        }
    }
}

/// Hyperlink relationship from the .rels file
///
/// Maps a relationship ID to an external target URL/path.
#[derive(Debug, Clone, Default)]
pub struct HyperlinkRelationship {
    /// Relationship ID (e.g., "rId1")
    pub id: String,

    /// Target URL or file path
    pub target: String,

    /// Target mode (Internal or External)
    pub target_mode: TargetMode,

    /// Raw target mode from the relationship XML.
    pub raw_target_mode: Option<String>,
}

impl HyperlinkRelationship {
    /// Create a new HyperlinkRelationship
    pub fn new(id: String, target: String, target_mode: TargetMode) -> Self {
        Self {
            id,
            target,
            target_mode,
            raw_target_mode: Some(target_mode.as_str().to_string()),
        }
    }
}

/// A single hyperlink in a worksheet (CT_Hyperlink)
///
/// Represents a hyperlink that can be applied to one or more cells.
/// The actual target URL may come from either:
/// - The `location` attribute (for internal links)
/// - A relationship referenced by `r_id` (for external links)
#[derive(Debug, Clone, Default)]
pub struct Hyperlink {
    /// Cell reference or range this hyperlink applies to (e.g., "A1" or "A1:B5")
    pub cell_ref: String,

    /// Relationship ID linking to worksheet's .rels file (for external links)
    pub r_id: Option<String>,

    /// Internal location/anchor within the workbook (e.g., "Sheet2!A1" or "#Sheet2!A1")
    pub location: Option<String>,

    /// Display text (shown instead of the URL)
    pub display: Option<String>,

    /// Tooltip text (shown on hover)
    pub tooltip: Option<String>,

    /// Target URL/path (resolved from relationship or internal location)
    /// This is populated after combining with relationship data
    pub target: Option<String>,

    /// Detected hyperlink type based on target
    pub link_type: HyperlinkType,

    /// History tracking - unique ID for this hyperlink
    pub id: Option<String>,

    /// Extension UID for revision tracking (xr:uid)
    pub uid: Option<String>,

    /// Authored target representation.
    pub target_kind: Option<HyperlinkTargetKind>,

    /// Raw relationship TargetMode when the hyperlink uses r:id.
    pub target_mode: Option<String>,
}

impl Hyperlink {
    /// Create a new Hyperlink with just a cell reference
    pub fn new(cell_ref: String) -> Self {
        Self {
            cell_ref,
            ..Default::default()
        }
    }

    /// Get the final resolved URL/target
    ///
    /// Returns the target URL, falling back to location if no external target
    pub fn get_target(&self) -> Option<&str> {
        self.target.as_deref().or(self.location.as_deref())
    }

    /// Check if this is an external link
    pub fn is_external(&self) -> bool {
        self.r_id.is_some()
            || matches!(
                self.link_type,
                HyperlinkType::Url | HyperlinkType::File | HyperlinkType::Email
            )
    }

    /// Check if this is an internal link
    pub fn is_internal(&self) -> bool {
        matches!(self.link_type, HyperlinkType::Internal)
    }

    /// Parse the location fragment to extract sheet name and cell reference
    ///
    /// # Returns
    /// Tuple of (sheet_name, cell_reference) if parseable
    #[allow(clippy::string_slice)]
    pub fn parse_location(&self) -> Option<(String, String)> {
        let location = self.location.as_ref()?;
        let loc = location.trim_start_matches('#');

        if let Some(sep_pos) = loc.find('!') {
            let sheet_name = &loc[..sep_pos];
            let cell_ref = &loc[sep_pos + 1..];
            let sheet_name = sheet_name.trim_matches('\'');

            Some((sheet_name.to_string(), cell_ref.to_string()))
        } else {
            Some((String::new(), loc.to_string()))
        }
    }
}

/// Container for all hyperlinks in a worksheet (CT_Hyperlinks)
#[derive(Debug, Clone, Default)]
pub struct Hyperlinks {
    /// List of hyperlinks
    pub hyperlinks: Vec<Hyperlink>,
}

impl Hyperlinks {
    /// Get hyperlink for a specific cell
    pub fn get(&self, cell_ref: &str) -> Option<&Hyperlink> {
        self.hyperlinks.iter().find(|h| h.cell_ref == cell_ref)
    }

    /// Get the number of hyperlinks
    pub fn len(&self) -> usize {
        self.hyperlinks.len()
    }

    /// Check if there are no hyperlinks
    pub fn is_empty(&self) -> bool {
        self.hyperlinks.is_empty()
    }

    /// Iterate over hyperlinks
    pub fn iter(&self) -> impl Iterator<Item = &Hyperlink> {
        self.hyperlinks.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hyperlink_type_from_target_url() {
        assert_eq!(
            HyperlinkType::from_target("http://example.com"),
            HyperlinkType::Url
        );
        assert_eq!(
            HyperlinkType::from_target("https://example.com"),
            HyperlinkType::Url
        );
        assert_eq!(
            HyperlinkType::from_target("HTTP://EXAMPLE.COM"),
            HyperlinkType::Url
        );
        assert_eq!(
            HyperlinkType::from_target("ftp://files.example.com"),
            HyperlinkType::Url
        );
        assert_eq!(
            HyperlinkType::from_target("custom://example.com"),
            HyperlinkType::Url
        );
    }

    #[test]
    fn test_hyperlink_type_from_target_email() {
        assert_eq!(
            HyperlinkType::from_target("mailto:test@example.com"),
            HyperlinkType::Email
        );
        assert_eq!(
            HyperlinkType::from_target("MAILTO:TEST@EXAMPLE.COM"),
            HyperlinkType::Email
        );
    }

    #[test]
    fn test_hyperlink_type_from_target_internal() {
        assert_eq!(
            HyperlinkType::from_target("#Sheet1!A1"),
            HyperlinkType::Internal
        );
    }

    #[test]
    fn test_hyperlink_type_from_target_file() {
        assert_eq!(HyperlinkType::from_target("file.xlsx"), HyperlinkType::File);
        assert_eq!(
            HyperlinkType::from_target("../other/file.xlsx"),
            HyperlinkType::File
        );
        assert_eq!(
            HyperlinkType::from_target("C:\\Documents\\file.xlsx"),
            HyperlinkType::File
        );
    }

    #[test]
    fn test_hyperlink_type_as_str() {
        assert_eq!(HyperlinkType::Url.as_str(), "url");
        assert_eq!(HyperlinkType::File.as_str(), "file");
        assert_eq!(HyperlinkType::Email.as_str(), "email");
        assert_eq!(HyperlinkType::Internal.as_str(), "internal");
    }

    #[test]
    fn test_target_mode_from_bytes() {
        assert_eq!(TargetMode::from_bytes(b"External"), TargetMode::External);
        assert_eq!(TargetMode::from_bytes(b"external"), TargetMode::External);
        assert_eq!(TargetMode::from_bytes(b"Internal"), TargetMode::Internal);
        assert_eq!(TargetMode::from_bytes(b""), TargetMode::Internal);
    }

    #[test]
    fn test_target_mode_as_str() {
        assert_eq!(TargetMode::Internal.as_str(), "Internal");
        assert_eq!(TargetMode::External.as_str(), "External");
    }

    #[test]
    fn test_hyperlink_new() {
        let hl = Hyperlink::new("A1".to_string());
        assert_eq!(hl.cell_ref, "A1");
        assert!(hl.r_id.is_none());
        assert!(hl.location.is_none());
        assert!(hl.display.is_none());
        assert!(hl.tooltip.is_none());
        assert!(hl.target.is_none());
        assert_eq!(hl.link_type, HyperlinkType::Url);
    }

    #[test]
    fn test_hyperlink_relationship_new() {
        let rel = HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com".to_string(),
            TargetMode::External,
        );
        assert_eq!(rel.id, "rId1");
        assert_eq!(rel.target, "https://example.com");
        assert_eq!(rel.target_mode, TargetMode::External);
        assert_eq!(rel.raw_target_mode.as_deref(), Some("External"));
    }

    #[test]
    fn test_hyperlink_get_target_and_predicates() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("Sheet1!A1".to_string()),
            link_type: HyperlinkType::Internal,
            ..Default::default()
        };

        assert_eq!(hl.get_target(), Some("Sheet1!A1"));
        assert!(hl.is_internal());
        assert!(!hl.is_external());

        hl.r_id = Some("rId1".to_string());
        assert!(hl.is_external());
    }

    #[test]
    fn test_parse_location() {
        let hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("Sheet2!B5".to_string()),
            ..Default::default()
        };
        assert_eq!(
            hl.parse_location(),
            Some(("Sheet2".to_string(), "B5".to_string()))
        );
    }

    #[test]
    fn test_parse_location_with_hash_and_quoted_sheet() {
        let hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("#'Sheet With Spaces'!A1".to_string()),
            ..Default::default()
        };
        assert_eq!(
            hl.parse_location(),
            Some(("Sheet With Spaces".to_string(), "A1".to_string()))
        );
    }

    #[test]
    fn test_parse_location_named_range() {
        let hl = Hyperlink {
            cell_ref: "A1".to_string(),
            location: Some("MyNamedRange".to_string()),
            ..Default::default()
        };
        assert_eq!(
            hl.parse_location(),
            Some((String::new(), "MyNamedRange".to_string()))
        );
    }
}
